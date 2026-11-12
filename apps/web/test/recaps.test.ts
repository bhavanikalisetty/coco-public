import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/lib/api";
import {
  newestRecaps,
  recapReview,
  recapReviewKey,
  publishRecap,
  writeRecap,
  type RecapDraft,
} from "../src/lib/recaps";



test("edit and approve send the reviewed revision once even after ambiguous failure", async () => {
  const original = globalThis.fetch;
  const requests: { url: string; method: string | undefined; body: unknown }[] =
    [];
  globalThis.fetch = (async (url, options) => {
    requests.push({
      url: String(url),
      method: options?.method,
      body: JSON.parse(String(options?.body)),
    });
    return new Response(
      JSON.stringify({ error: { message: "Temporary failure" } }),
      { status: 500 },
    );
  }) as typeof fetch;
  try {
    await assert.rejects(
      writeRecap(
        "owner",
        { kind: "edit", id: "draft_1", revision: 7, text: "Edited" },
        new AbortController().signal,
      ),
    );
    await assert.rejects(
      writeRecap(
        "owner",
        { kind: "approve", id: "draft_1", revision: 7, revocationVersion: 2 },
        new AbortController().signal,
      ),
    );
    assert.deepEqual(requests, [
      {
        url: "/api/coco/v1/recaps/draft_1",
        method: "PATCH",
        body: { revision: 7, text: "Edited" },
      },
      {
        url: "/api/coco/v1/recaps/draft_1/approve",
        method: "POST",
        body: { revision: 7, revocationVersion: 2 },
      },
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test("recap creation preserves its idempotency body and only creation gets 60 seconds", async () => {
  const originalFetch = globalThis.fetch,
    originalTimeout = AbortSignal.timeout;
  const bodies: unknown[] = [],
    timeouts: number[] = [];
  AbortSignal.timeout = (ms: number) => {
    timeouts.push(ms);
    return new AbortController().signal;
  };
  globalThis.fetch = (async (_url, options) => {
    bodies.push(JSON.parse(String(options?.body)));
    return new Response("{}");
  }) as typeof fetch;
  try {
    const action = {
      kind: "create" as const,
      body: { requestId: "same-id", instructions: "My conversations" },
    };
    await writeRecap("owner", action, new AbortController().signal);
    await writeRecap("owner", action, new AbortController().signal);
    await writeRecap(
      "owner",
      { kind: "approve", id: "draft_1", revision: 2, revocationVersion: 0 },
      new AbortController().signal,
    );
    assert.deepEqual(bodies[0], bodies[1]);
    assert.deepEqual(timeouts, [60000, 60000, 30000]);
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
  }
});

test("recap history is newest first without changing the API array", () => {
  const drafts = [
    { id: "old", createdAt: "2026-10-23T12:00:00Z" },
    { id: "new", createdAt: "2026-10-24T12:00:00Z" },
  ] as RecapDraft[];
  assert.deepEqual(
    newestRecaps(drafts).map((d) => d.id),
    ["new", "old"],
  );
  assert.equal(drafts[0].id, "old");
});

test("posting keeps the reviewed version and request ID without automatic retries", async () => {
  const original = globalThis.fetch;
  const calls: unknown[] = [];
  globalThis.fetch = (async (_url, options) => {
    calls.push(JSON.parse(String(options?.body)));
    return new Response(
      JSON.stringify({ error: { message: "Unknown outcome" } }),
      { status: 502 },
    );
  }) as typeof fetch;
  try {
    const body = { requestId: "post_once", revision: 3, revocationVersion: 4 };
    await assert.rejects(
      publishRecap("owner", "draft_1", body, new AbortController().signal),
    );
    assert.equal(calls.length, 1);
    await assert.rejects(
      publishRecap("owner", "draft_1", body, new AbortController().signal),
    );
    assert.deepEqual(calls, [body, body]);
  } finally {
    globalThis.fetch = original;
  }
});

test("Not now sends only a decline for the current revision", async () => {
  const original = globalThis.fetch;
  const calls: unknown[] = [];
  globalThis.fetch = (async (url, options) => {
    calls.push({
      url: String(url),
      method: options?.method,
      body: JSON.parse(String(options?.body)),
    });
    return new Response(
      JSON.stringify({
        revision: 3,
        status: "draft",
        postDecision: "declined",
      }),
    );
  }) as typeof fetch;
  try {
    const result = await writeRecap(
      "owner",
      { kind: "decline", id: "draft_1", revision: 3 },
      new AbortController().signal,
    );
    assert.equal(result.postDecision, "declined");
    assert.deepEqual(calls, [
      {
        url: "/api/coco/v1/recaps/draft_1/decline",
        method: "POST",
        body: { revision: 3 },
      },
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test("a later refusal invalidates approval and posting even when the text revision is unchanged", async () => {
  const original = globalThis.fetch;
  const old = { id: "draft_1", revision: 3 };
  const refused = { ...old, revocationVersion: 1 };
  const oldReview = recapReview(old);
  assert.deepEqual(oldReview, { revision: 3, revocationVersion: 0 });
  assert.notEqual(recapReviewKey(old), recapReviewKey(refused));
  assert.equal(
    recapReviewKey(old),
    recapReviewKey({ ...old, revocationVersion: 0 }),
  );
  const calls: {
    revision: number;
    revocationVersion: number;
    requestId?: string;
  }[] = [];
  globalThis.fetch = (async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    calls.push(body);
    const current =
      body.revision === refused.revision &&
      body.revocationVersion === refused.revocationVersion;
    return new Response(
      JSON.stringify(
        current
          ? refused
          : {
              error: {
                code: "DRAFT_CHANGED",
                message: "Posting was declined. Review it again.",
              },
            },
      ),
      { status: current ? 200 : 409 },
    );
  }) as typeof fetch;
  const signal = new AbortController().signal;
  try {
    const isConflict = (error: unknown) =>
      error instanceof ApiError &&
      error.status === 409 &&
      error.code === "DRAFT_CHANGED";
    await assert.rejects(
      writeRecap(
        "owner",
        { kind: "approve", id: old.id, ...oldReview },
        signal,
      ),
      isConflict,
    );
    await assert.rejects(
      publishRecap(
        "owner",
        old.id,
        { requestId: "old-post", ...oldReview },
        signal,
      ),
      isConflict,
    );
    assert.equal(
      calls.length,
      2,
      "conflicts must not retry with a newer authorization",
    );
    assert.deepEqual(
      oldReview,
      { revision: 3, revocationVersion: 0 },
      "the old confirmation stays frozen",
    );
    await writeRecap(
      "owner",
      { kind: "approve", id: refused.id, ...recapReview(refused) },
      signal,
    );
    await publishRecap(
      "owner",
      refused.id,
      { requestId: "new-post", ...recapReview(refused) },
      signal,
    );
    assert.deepEqual(
      calls.map((body) => body.revocationVersion),
      [0, 0, 1, 1],
    );
  } finally {
    globalThis.fetch = original;
  }
});
