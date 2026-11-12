import { test } from "node:test";
import assert from "node:assert/strict";
import {
  incomingJobs,
  mergeIncomingJob,
  observeProactive,
  updateJob,
  userMessage,
  type ProactiveNotification,
} from "../src/lib/incomingJobs";
import type { Bootstrap, Job, Turn } from "../src/lib/types";

const at = Date.parse("2026-10-24T21:00:00Z");
const notification: ProactiveNotification = {
  personId: "owner",
  jobId: "job_coffee",
  kind: "coffee",
  createdAt: "2026-10-24T20:59:00Z",
  expiresAt: "2026-10-24T22:00:00Z",
};
const completed: Job = {
  jobId: notification.jobId,
  status: "completed",
  result: {
    origin: "proactive",
    text: "A coffee suggestion.",
    audioId: "reply_coffee",
  },
};


test("notification discovery filters other owners, expired records and invalid jobs", () => {
  const invalid = [
    { ...notification, personId: "someone_else" },
    { ...notification, expiresAt: new Date(at).toISOString() },
    { ...notification, expiresAt: "invalid" },
    { ...notification, createdAt: "invalid" },
    { ...notification, jobId: "../someone_else" },
  ];
  assert.deepEqual(incomingJobs([], invalid, "owner", at), []);
  assert.equal(incomingJobs([], [notification], "owner", at).length, 1);
});

test("the same badge and notification job is fetched once with proactive metadata", () => {
  const command = {
    type: "display",
    createdAt: notification.createdAt,
    payload: { jobId: notification.jobId },
  };
  const jobs = incomingJobs(
    [command, command, { ...command, type: "speak" }],
    [notification, notification],
    "owner",
    at,
  );
  assert.deepEqual(jobs, [
    {
      jobId: notification.jobId,
      createdAt: Date.parse(notification.createdAt),
      origin: "proactive",
    },
  ]);
  assert.deepEqual(
    incomingJobs(
      [],
      [
        {
          ...notification,
          jobId: "newer",
          createdAt: new Date(at).toISOString(),
        },
        notification,
      ],
      "owner",
      at,
    ).map((job) => job.jobId),
    [notification.jobId, "newer"],
  );
});

test("proactive jobs progress without creating a user message and do not duplicate on another poll", () => {
  const incoming = incomingJobs([], [notification], "owner", at)[0];
  const queued = { jobId: completed.jobId, status: "queued" as const };
  let turns = mergeIncomingJob([], queued, incoming);
  assert.equal(turns.length, 1);
  assert.equal(userMessage(turns[0]), undefined);
  assert.equal(turns[0].prompt, "");
  turns = updateJob(turns, completed);
  const key = turns[0].requestId;
  turns = mergeIncomingJob(turns, completed, { ...incoming, origin: "badge" });
  assert.equal(turns.length, 1);
  assert.equal(turns[0].requestId, key);
  assert.equal(turns[0].job?.result?.audioId, "reply_coffee");
  assert.equal(userMessage(turns[0]), undefined);
});

test("a proactive result from badge commands suppresses even a supplied transcript", () => {
  const incoming = {
    jobId: completed.jobId,
    createdAt: at,
    origin: "badge" as const,
  };
  const job = {
    ...completed,
    result: {
      ...completed.result,
      transcript: "Do not show this as user speech",
    },
  };
  assert.equal(userMessage(mergeIncomingJob([], job, incoming)[0]), undefined);
  const ownTurn: Turn = {
    requestId: "typed",
    prompt: "My actual question",
    createdAt: at,
    kind: "chat",
    job: { jobId: "own", status: "running" },
  };
  assert.equal(userMessage(ownTurn), "My actual question");
});

test("unrelated or unmarked completed jobs cannot become proactive messages", () => {
  const incoming = incomingJobs([], [notification], "owner", at)[0];
  assert.deepEqual(
    mergeIncomingJob([], { ...completed, jobId: "different" }, incoming),
    [],
  );
  const unmarked: Job = {
    ...completed,
    result: { text: "Not a proactive result" },
  };
  assert.deepEqual(mergeIncomingJob([], unmarked, incoming), []);
  const pending = mergeIncomingJob(
    [],
    { jobId: completed.jobId, status: "running" },
    incoming,
  );
  assert.deepEqual(updateJob(pending, unmarked), []);
});
