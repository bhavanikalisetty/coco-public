import type { Bootstrap, Job, Turn } from "./types";

export type ProactiveNotification = {
  personId: string;
  jobId: string;
  kind: string;
  createdAt: string;
  expiresAt: string;
};
export type BadgeCommand = {
  type: string;
  createdAt: string;
  payload: { jobId?: string };
};
export type IncomingJob = {
  jobId: string;
  createdAt: number;
  origin: "badge" | "proactive";
};
export function observeProactive(data: Bootstrap) {
  return (
    data.access !== "demo" && data.capabilities.proactiveNotifications === true
  );
}
export function incomingJobs(
  commands: BadgeCommand[],
  notifications: ProactiveNotification[],
  personId: string,
  now = Date.now(),
) {
  const jobs = new Map<string, IncomingJob>();
  const add = (
    jobId: string | undefined,
    createdAt: string,
    origin: IncomingJob["origin"],
  ) => {
    const timestamp = Date.parse(createdAt);
    if (
      jobId &&
      /^[a-zA-Z0-9_-]{1,150}$/.test(jobId) &&
      Number.isFinite(timestamp)
    )
      jobs.set(jobId, { jobId, createdAt: timestamp, origin });
  };
  for (const command of commands)
    if (command.type === "display")
      add(command.payload?.jobId, command.createdAt, "badge");
  // Notification metadata takes precedence when the same job also reached a badge.
  for (const notification of notifications)
    if (
      notification.personId === personId &&
      Date.parse(notification.expiresAt) > now
    )
      add(notification.jobId, notification.createdAt, "proactive");
  return [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt);
}
export function updateJob(turns: Turn[], job: Job) {
  return turns.flatMap((turn) => {
    if (turn.job?.jobId !== job.jobId) return [turn];
    if (
      turn.origin === "proactive" &&
      job.status === "completed" &&
      job.result?.origin !== "proactive"
    )
      return [];
    return [
      {
        ...turn,
        job,
        error: undefined,
        pollStopped: false,
        ...(job.result?.origin === "proactive"
          ? { origin: "proactive" as const, prompt: "" }
          : {}),
      },
    ];
  });
}
export function mergeIncomingJob(
  turns: Turn[],
  job: Job,
  incoming: IncomingJob,
) {
  if (job.jobId !== incoming.jobId) return turns;
  if (
    incoming.origin === "proactive" &&
    job.status === "completed" &&
    job.result?.origin !== "proactive"
  )
    return turns;
  if (turns.some((turn) => turn.job?.jobId === job.jobId))
    return updateJob(turns, job);
  const origin =
    job.result?.origin === "proactive" ? "proactive" : incoming.origin;
  return [
    ...turns,
    {
      requestId: `observed_${job.jobId}`,
      prompt: origin === "badge" ? "From your badge" : "",
      origin,
      kind: "chat" as const,
      createdAt: incoming.createdAt,
      job,
    },
  ];
}
export function userMessage(turn: Turn) {
  return turn.origin === "proactive" || turn.job?.result?.origin === "proactive"
    ? undefined
    : (turn.job?.result?.transcript ?? turn.prompt);
}
