import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeWav, startCapture } from "../src/lib/audio";
import {
  conflicts,
  isFixture,
  neighborhood,
  safeLink,
  projectorGraph,
  companyRecords,
  visibleGraphNodes,
  reconcileSelection,
} from "../src/lib/graph";
import { request } from "../src/lib/api";
import fixture from "../src/lib/fixture.json";

test("voice becomes mono PCM16 16 kHz at the correct duration", async () => {
  const wav = await encodeWav(
      new Float32Array(48000).fill(0.5),
      48000,
    ).arrayBuffer(),
    v = new DataView(wav);
  assert.equal(wav.byteLength, 32044);
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 32000);
  assert.equal(v.getInt16(44, true), 16383);
});
test("voice clips out-of-range PCM safely", async () => {
  const v = new DataView(
    await encodeWav(new Float32Array([-2, 2]), 16000).arrayBuffer(),
  );
  assert.equal(v.getInt16(44, true), -32768);
  assert.equal(v.getInt16(46, true), 32767);
});
test("adjacent sessions do not conflict; simultaneous sessions do", () => {
  const session = fixture.sessions.find((s) => s.id === "s06")!;
  assert.equal(
    conflicts(
      session,
      fixture.sessions.filter((s) => ["s07", "s08"].includes(s.id)),
    ).length,
    1,
  );
});
test("graph focus expands only through returned edges", () => {
  const graph = {
    nodes: [],
    edges: [
      { id: "1", source: "a", target: "b", type: "ABOUT", properties: {} },
      { id: "2", source: "b", target: "c", type: "ABOUT", properties: {} },
    ],
    source: "falkordb",
    eventId: "test",
  };
  assert.deepEqual([...neighborhood(graph, "a")], ["a", "b"]);
  assert.deepEqual([...neighborhood(graph, "a", 2)], ["a", "b", "c"]);
});
test("fixture evidence never becomes confirmed activity", () => {
  assert.equal(isFixture({ source: "fixture" }), true);
  assert.equal(isFixture({ isSimulated: true }), true);
  assert.equal(isFixture({ source: "confirmed_badge_tap" }), false);
});
test("untrusted source links only allow HTTPS", () => {
  assert.equal(safeLink("javascript:alert(1)"), undefined);
  assert.equal(safeLink("data:text/html,test"), undefined);
  assert.equal(
    safeLink("https://example.org/profile"),
    "https://example.org/profile",
  );
});
test("retry keeps the same mutation request ID and body", async () => {
  const original = globalThis.fetch;
  const bodies: unknown[] = [];
  globalThis.fetch = (async (_url, opts) => {
    bodies.push(opts?.body);
    if (bodies.length === 1) throw new TypeError("offline");
    return new Response(JSON.stringify({ jobId: "test", status: "queued" }), {
      status: 202,
    });
  }) as typeof fetch;
  try {
    await request("test-token", "/v1/chat", {
      method: "POST",
      body: { requestId: "same-request", text: "hello", speak: true },
    });
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0], bodies[1]);
  } finally {
    globalThis.fetch = original;
  }
});

test("projector excludes private memory and strips contact and edge details", () => {
  const g = {
    source: "falkordb",
    eventId: "event",
    nodes: [
      {
        id: "1",
        labels: ["Person"],
        properties: {
          id: "private",
          name: "Secret Name",
          email: "private@example.org",
        },
      },
      {
        id: "2",
        labels: ["Note", "Source"],
        properties: { text: "private note" },
      },
      {
        id: "3",
        labels: ["Person"],
        properties: { id: "public", name: "Public Name" },
      },
    ],
    edges: [
      {
        id: "a",
        source: "1",
        target: "3",
        type: "MET",
        properties: {
          context: "private conversation",
          source: "confirmed_badge_tap",
        },
      },
      { id: "b", source: "1", target: "2", type: "REMEMBERS", properties: {} },
    ],
  };
  const redacted = projectorGraph(g, { ...g, nodes: [g.nodes[2]] });
  const text = JSON.stringify(redacted);
  assert.equal(redacted.nodes.length, 2);
  assert.equal(redacted.edges.length, 1);
  for (const secret of [
    "Secret Name",
    "private@example.org",
    "private note",
    "private conversation",
  ])
    assert.equal(text.includes(secret), false);
  assert.ok(text.includes("Public Name"));
});

test("company contact joins both employee encounter paths without name-based merging", () => {
  const nodes = [
    { id: "e1", labels: ["Person"], properties: { name: "Employee One" } },
    { id: "e2", labels: ["Person"], properties: { name: "Employee Two" } },
    { id: "c", labels: ["Company"], properties: {} },
    {
      id: "p",
      labels: ["Person"],
      properties: { name: "Same Contact", id: "canonical" },
    },
    {
      id: "m1",
      labels: ["Encounter"],
      properties: { at: "2026-10-24T10:00:00Z", isDemo: true },
    },
    {
      id: "m2",
      labels: ["Encounter"],
      properties: { at: "2026-10-24T11:00:00Z", isDemo: true },
    },
  ];
  const edges = [
    ["e1", "c", "WORKS_AT"],
    ["e2", "c", "WORKS_AT"],
    ["e1", "m1", "PARTICIPATED_IN"],
    ["e2", "m2", "PARTICIPATED_IN"],
    ["p", "m1", "PARTICIPATED_IN"],
    ["p", "m2", "PARTICIPATED_IN"],
  ].map(([source, target, type], i) => ({
    id: String(i),
    source,
    target,
    type,
    properties: {},
  }));
  const records = companyRecords({
    nodes,
    edges,
    source: "falkordb",
    eventId: "test",
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].employees.length, 2);
  assert.equal(records[0].encounters.length, 2);
  assert.equal(records[0].latest?.id, "m2");
});

test("focused record survives a drawing limit even when last in the response", () => {
  const nodes = Array.from({ length: 30 }, (_, i) => ({
    id: String(i),
    labels: ["Person"],
    properties: { name: `Person ${i}` },
  }));
  const edges = nodes.slice(0, 29).map((n) => ({
    id: n.id,
    source: "29",
    target: n.id,
    type: "MET",
    properties: {},
  }));
  const visible = visibleGraphNodes(
    { nodes, edges, source: "falkordb", eventId: "test" },
    "29",
  );
  assert.equal(visible.length, 22);
  assert.equal(visible[0].id, "29");
  assert.ok(visible.some((n) => n.id === "0"));
});
test("same-count graph replacement recovers focus and added nodes preserve selection", () => {
  const graph = {
    nodes: [
      { id: "a", labels: ["Person"], properties: {} },
      { id: "b", labels: ["Person"], properties: {} },
    ],
    edges: [{ id: "e", source: "a", target: "b", type: "MET", properties: {} }],
    source: "falkordb",
    eventId: "test",
  };
  assert.deepEqual(reconcileSelection(graph, "b", "e"), {
    focus: "b",
    edgeId: "e",
  });
  assert.deepEqual(
    reconcileSelection(
      {
        ...graph,
        nodes: [
          graph.nodes[0],
          { id: "c", labels: ["Person"], properties: {} },
        ],
        edges: [],
      },
      "b",
      "e",
    ),
    { focus: "a", edgeId: "" },
  );
  assert.deepEqual(
    reconcileSelection(
      {
        ...graph,
        nodes: [
          ...graph.nodes,
          { id: "c", labels: ["Person"], properties: {} },
        ],
      },
      "b",
      "e",
    ),
    { focus: "b", edgeId: "e" },
  );
});
test("legacy company MET paths remain useful without invented booth or follow-up data", () => {
  const graph = {
    nodes: [
      { id: "a", labels: ["Person"], properties: { name: "Employee" } },
      { id: "b", labels: ["Person"], properties: { name: "Contact" } },
      { id: "c", labels: ["Company"], properties: {} },
    ],
    edges: [
      { id: "w", source: "a", target: "c", type: "WORKS_AT", properties: {} },
      {
        id: "m",
        source: "a",
        target: "b",
        type: "MET",
        properties: { source: "fixture" },
      },
    ],
    source: "falkordb",
    eventId: "test",
  };
  const [record] = companyRecords(graph);
  assert.equal(record.employees[0].properties.name, "Employee");
  assert.equal(record.met.length, 1);
  assert.equal(record.booth, false);
  assert.equal(record.followups.length, 0);
  assert.equal(isFixture(record.evidence[0]), true);
});
test("failed media-node setup releases every acquired microphone resource", async () => {
  const nav = Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    audio = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  let stopped = 0,
    closed = 0,
    disconnected = 0;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => stopped++ }],
        }),
      },
    },
  });
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: class {
      state = "running";
      async resume() {}
      createMediaStreamSource() {
        return { disconnect: () => disconnected++ };
      }
      createScriptProcessor() {
        throw new Error("setup failed");
      }
      async close() {
        closed++;
      }
    },
  });
  try {
    await assert.rejects(() => startCapture(() => {}), /setup failed/);
    assert.equal(stopped, 1);
    assert.equal(closed, 1);
    assert.equal(disconnected, 1);
  } finally {
    if (nav) Object.defineProperty(globalThis, "navigator", nav);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (audio) Object.defineProperty(globalThis, "AudioContext", audio);
    else Reflect.deleteProperty(globalThis, "AudioContext");
  }
});


import { answerGraph, safeTrace } from "../src/lib/evidence";
import { retrySource } from "../src/lib/workspace";
test("answer evidence unwraps tool envelopes, redacts tokens and uses only returned FalkorDB records", () => {
  const graph = {
    source: "falkordb",
    eventId: "demo",
    nodes: [
      {
        id: "n",
        labels: ["Person"],
        properties: { name: "Pat", token: "hidden" },
      },
    ],
    edges: [],
  };
  const output = JSON.stringify({
    result: {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            me: { nfcToken: "public-but-not-displayed" },
            explanation: graph,
          }),
        },
      ],
    },
  });
  assert.ok(
    !JSON.stringify(safeTrace(output)).includes("public-but-not-displayed"),
  );
  const result = answerGraph([
    { tool: "recommend_sessions", status: "completed", output },
  ]);
  assert.equal(result?.nodes.length, 1);
  assert.equal(result?.nodes[0].properties.token, "[redacted]");
  assert.equal(
    answerGraph([{ tool: "recommend_sessions", status: "failed", output }]),
    undefined,
  );
  assert.equal(
    answerGraph([
      {
        tool: "chat",
        status: "completed",
        output: "Graph memory sounds useful",
      },
    ]),
    undefined,
  );
});
test("pending retries preserve authored fields and cannot replay another actor or service-generated source", () => {
  const record = {
    id: "source",
    ownerId: "me",
    createdAt: "2026-10-24T10:00:00Z",
    projection: "pending" as const,
    data: {
      requestId: "same-id",
      type: "booth_visit",
      contactId: "pat",
      note: "Exact note",
      atBooth: true,
      topicIds: [],
      isDemo: true,
    },
  };
  assert.deepEqual(retrySource(record, "me", true), {
    path: "/v1/crm/visits",
    body: {
      requestId: "same-id",
      contactId: "pat",
      note: "Exact note",
      atBooth: true,
      topicIds: [],
      isDemo: true,
    },
  });
  assert.equal(retrySource(record, "other", true), undefined);
  assert.equal(
    retrySource(
      {
        ...record,
        data: { ...record.data, provenance: { source: "confirmed_badge_tap" } },
      },
      "me",
      true,
    ),
    undefined,
  );
});

test("structured job evidence takes precedence over truncated traces and preserves partial status", () => {
  const result = answerGraph(
    [{ tool: "recommend_sessions", status: "completed", output: '{"result":' }],
    {
      source: "falkordb",
      eventId: "event",
      partial: true,
      nodes: [
        { id: "n", labels: ["Topic"], properties: { name: "Graph memory" } },
      ],
      edges: [],
    },
  );
  assert.equal(result?.nodes[0].properties.name, "Graph memory");
  assert.equal(result?.partial, true);
});


import {
  graphScopes,
  observeDeviceCommands,
  canManageDemoBadge,
  reviewableTopics,
  usernameSuggestion,
} from "../src/lib/access";
test("demo and browser-owned profiles do not poll physical badge commands or private demo graphs", () => {
  const demo = {
    ...fixture,
    access: "demo" as const,
    capabilities: {
      chat: false,
      deviceCommands: false,
      personalMemory: false,
      companyCrm: false,
    },
  };
  assert.deepEqual(graphScopes(demo), ["conference"]);
  assert.equal(observeDeviceCommands(demo), false);
  const owner = {
    ...demo,
    access: "owner" as const,
    capabilities: { ...demo.capabilities, personalMemory: true, chat: true },
  };
  assert.deepEqual(graphScopes(owner), ["conference", "me"]);
  assert.equal(observeDeviceCommands(owner), false);
  assert.equal(observeDeviceCommands(fixture), true);
});
test("registration sends no prior bearer and does not automatically retry an ambiguous failure", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let authorization: unknown;
  globalThis.fetch = (async (_url, options) => {
    calls++;
    authorization = (options?.headers as Record<string, string>)?.Authorization;
    throw new TypeError("connection lost");
  }) as typeof fetch;
  try {
    await assert.rejects(
      request("", "/v1/demo/register", {
        method: "POST",
        body: { username: "new_person" },
        retry: false,
      }),
    );
    assert.equal(calls, 1);
    assert.equal(authorization, undefined);
  } finally {
    globalThis.fetch = original;
  }
});
test("username suggestions stay within the public registration alphabet and length", () => {
  assert.equal(usernameSuggestion("Érin", "O’Neil"), "erin_oneil");
  assert.equal(usernameSuggestion("A".repeat(40), "Person").length, 30);
});

import { exchangeOnce, takeConnectionReturn } from "../src/lib/oauthReturn";
test("OAuth return removes the one-time code and never trusts the status parameter", () => {
  let path = "";
  const result = takeConnectionReturn(
    new URL(
      "https://coco.example/?keep=1&connection=truefoundry&status=connected&connectionExchange=single-use#settings",
    ),
    (value) => {
      path = value;
    },
  );
  assert.deepEqual(result, {
    returned: true,
    code: "single-use",
    failed: false,
  });
  assert.equal(path, "/?keep=1#settings");
  assert.deepEqual(
    takeConnectionReturn(
      new URL("https://coco.example/?status=connected"),
      () => assert.fail(),
    ),
    { returned: false, code: null, failed: false },
  );
});
test("OAuth exchange is anonymous and single-use even across repeated initialization", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_url, options) => {
    calls++;
    assert.equal(
      (options?.headers as Record<string, string>).Authorization,
      undefined,
    );
    assert.equal(options?.body, JSON.stringify({ code: "single-use" }));
    return new Response(
      JSON.stringify({
        token: "test-owner",
        personId: "person_test",
        access: "owner",
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    const complete = exchangeOnce("single-use");
    const sessions = await Promise.all([complete(), complete()]);
    assert.equal(calls, 1);
    assert.equal(sessions[0], sessions[1]);
  } finally {
    globalThis.fetch = original;
  }
});

test("failed OAuth return retains a safe failure indicator after query cleanup", () => {
  for (const status of ["failed", "needs_identity"]) {
    let path = "";
    const result = takeConnectionReturn(
      new URL(`https://coco.example/?connection=truefoundry&status=${status}`),
      (next) => {
        path = next;
      },
    );
    assert.equal(result.failed, true);
    assert.equal(result.code, null);
    assert.equal(path, "/");
  }
  const pending = takeConnectionReturn(
    new URL(
      "https://coco.example/?connection=truefoundry&status=needs_identity&connectionExchange=single-use",
    ),
    () => {},
  );
  assert.equal(pending.failed, false);
  assert.equal(pending.code, "single-use");
});

test("parsed interests remain visible, unique and reviewable in the loaded catalogue", () => {
  assert.deepEqual(
    reviewableTopics(
      ["topic_memory", "unknown", "topic_memory", 3],
      [{ id: "topic_memory" }],
    ),
    ["topic_memory"],
  );
  assert.deepEqual(reviewableTopics(["topic_memory"], undefined), []);
  const topics = Array.from({ length: 10 }, (_, i) => ({ id: `topic_${i}` }));
  assert.equal(
    reviewableTopics(
      topics.map((t) => t.id),
      topics,
    ).length,
    8,
  );
});

import { newestTapTasks, tapStatus } from "../src/lib/tapStatus";
test("LinkedIn tap status distinguishes observed Pending from an unverified task", () => {
  assert.equal(tapStatus({ status: "pending" }).label, "In progress");
  assert.equal(
    tapStatus({
      status: "pending",
      outcome: { status: "pending", verifiedState: false },
    }).verified,
    false,
  );
  const observed = tapStatus({
    status: "pending",
    outcome: { status: "pending", verifiedState: true },
  });
  assert.equal(observed.label, "Pending on LinkedIn");
  assert.equal(observed.verified, true);
  const existing = tapStatus({
    status: "confirmed",
    outcome: {
      status: "confirmed",
      detail: "Already connected to this profile.",
    },
  });
  assert.equal(existing.description, "Already connected to this profile.");
  assert.doesNotMatch(tapStatus({ status: "confirmed" }).description, /sent/i);
  for (const status of [
    "queued",
    "running",
    "needs_login",
    "uncertain",
    "failed",
    "unavailable",
  ] as const)
    assert.equal(tapStatus({ status }).verified, false);
});
test("tap history sorts a copy by newest creation time before selecting the summary", () => {
  const tasks = [
    { id: "old", createdAt: "2026-10-24T20:00:00Z" },
    { id: "new", createdAt: "2026-10-24T20:03:00Z" },
    { id: "unknown", createdAt: "invalid" },
    { id: "b", createdAt: "2026-10-24T20:02:00Z" },
    { id: "a", createdAt: "2026-10-24T20:02:00Z" },
  ];
  assert.deepEqual(
    newestTapTasks(tasks)
      .slice(0, 3)
      .map((t) => t.id),
    ["new", "a", "b"],
  );
  assert.deepEqual(
    tasks.map((t) => t.id),
    ["old", "new", "unknown", "b", "a"],
  );
});
