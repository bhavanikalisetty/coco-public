export type LinkedinTapTask = {
  id: string;
  encounterId: string;
  actorPersonId: string;
  targetPersonId: string;
  targetLinkedinUrl: string;
  targetName?: string;
  bindingVersion: number;
  confirmedAt: string;
  authorizationExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  status:
    | "queued"
    | "running"
    | "pending"
    | "confirmed"
    | "needs_login"
    | "uncertain"
    | "failed"
    | "unavailable";
  outcome?: { status: string; verifiedState?: boolean; detail?: string };
};

export function newestTapTasks<
  T extends Pick<LinkedinTapTask, "id" | "createdAt">,
>(tasks: T[]) {
  const time = (value: string) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return [...tasks].sort(
    (a, b) => time(b.createdAt) - time(a.createdAt) || a.id.localeCompare(b.id),
  );
}

export function tapStatus(task: Pick<LinkedinTapTask, "status" | "outcome">) {
  switch (task.status) {
    case "queued":
      return {
        label: "Queued",
        description: "Waiting to start.",
        verified: false,
      };
    case "running":
      return {
        label: "In progress",
        description: "Coco is working on this connection request.",
        verified: false,
      };
    case "pending":
      return task.outcome?.verifiedState === true
        ? {
            label: "Pending on LinkedIn",
            description: "LinkedIn shows Pending on this profile.",
            verified: true,
          }
        : {
            label: "In progress",
            description: "The connection request has not been verified yet.",
            verified: false,
          };
    case "confirmed":
      return {
        label: "Confirmed",
        description:
          task.outcome?.detail?.trim() ||
          "A connection state was confirmed. This may be an existing connection.",
        verified: true,
      };
    case "needs_login":
      return {
        label: "LinkedIn sign-in needed",
        description: "LinkedIn needs a signed-in account.",
        verified: false,
      };
    case "uncertain":
      return {
        label: "Result uncertain",
        description: "The outcome has not been verified.",
        verified: false,
      };
    case "failed":
      return {
        label: "Could not complete",
        description: "This task did not complete successfully.",
        verified: false,
      };
    case "unavailable":
      return {
        label: "Unavailable",
        description: "LinkedIn requests are unavailable for this task.",
        verified: false,
      };
    default:
      return {
        label: "Status unavailable",
        description: "No recognized result was returned.",
        verified: false,
      };
  }
}
