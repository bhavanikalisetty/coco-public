import { test } from "node:test";
import assert from "node:assert/strict";
import { readAccountStatus } from "../src/lib/accountStatus";

test("one account verification makes one attempt even after a server failure", async () => {
  const original = globalThis.fetch;
  const calls: { url: string; method?: string }[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method });
    return new Response(
      JSON.stringify({ error: { message: "Provider unavailable" } }),
      { status: 502 },
    );
  };
  try {
    await assert.rejects(
      readAccountStatus("test-token", new AbortController().signal),
      /Provider unavailable/,
    );
    assert.deepEqual(calls, [
      { url: "/api/coco/v1/connections/truefoundry/status", method: "GET" },
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test("account status preserves the provider reason and server verification timestamp", async () => {
  const original = globalThis.fetch;
  const result = {
    status: "failed",
    accountIdentityVerified: false,
    tools: [],
    connectAvailable: true,
    checkedAt: "2026-10-24T22:31:00Z",
    reason:
      "Zapier’s task limit has been reached. Increase task capacity in Zapier; reconnecting will not fix this.",
  };
  globalThis.fetch = async () => new Response(JSON.stringify(result));
  try {
    assert.deepEqual(
      await readAccountStatus("test-token", new AbortController().signal),
      result,
    );
  } finally {
    globalThis.fetch = original;
  }
});
