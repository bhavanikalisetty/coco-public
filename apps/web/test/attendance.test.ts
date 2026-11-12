import { test } from "node:test";
import assert from "node:assert/strict";
import { attendanceSource, sessionAttendance } from "../src/lib/attendance";
import type { Graph } from "../src/lib/types";

const graph: Graph = {
  source: "falkordb",
  eventId: "demo",
  nodes: [
    {
      id: "public_owner",
      labels: ["Attendee", "Person"],
      properties: { id: "person_maya" },
    },
    {
      id: "node_owner",
      labels: ["Person"],
      properties: { id: "person_maya" },
    },
    {
      id: "node_other",
      labels: ["Person"],
      properties: { id: "person_leo" },
    },
    ...["s01", "s02", "s03", "s04"].map((id) => ({
      id: `node_${id}`,
      labels: ["Session"],
      properties: { id },
    })),
  ],
  edges: [
    {
      id: "done",
      source: "node_owner",
      target: "node_s01",
      type: "ATTENDED",
      properties: {
        isDemo: true,
        sourceId: "memory_1",
        source: "user_reported",
      },
    },
    {
      id: "reported",
      source: "node_owner",
      target: "node_s02",
      type: "ATTENDED",
      properties: {
        isDemo: false,
        sourceId: "memory_2",
        source: "user_reported",
      },
    },
    {
      id: "plan",
      source: "node_owner",
      target: "node_s03",
      type: "PLANS_TO_ATTEND",
      properties: {},
    },
    {
      id: "other",
      source: "node_other",
      target: "node_s04",
      type: "ATTENDED",
      properties: {},
    },
  ],
};

test("agenda resolves canonical session IDs from only the owner's ATTENDED edges", () => {
  assert.deepEqual(
    [...sessionAttendance(graph, "person_maya")],
    [
      ["s01", { isDemo: true, sourceId: "memory_1" }],
      ["s02", { isDemo: false, sourceId: "memory_2" }],
    ],
  );
  assert.equal(sessionAttendance(graph, "missing").size, 0);
});

test("fixtures and unavailable graphs never establish saved attendance", () => {
  for (const source of ["fixture", "preview", "unavailable"])
    assert.equal(
      sessionAttendance({ ...graph, source }, "person_maya").size,
      0,
    );
});

test("public simulated attendance cannot replace private saved memory", () => {
  const publicOnly = {
    ...graph,
    edges: graph.edges.map((edge) => ({
      ...edge,
      source: "public_owner",
      properties: { source: "explicit_demo_seed", isSimulated: true },
    })),
  };
  assert.equal(sessionAttendance(publicOnly, "person_maya").size, 0);
});

test("dangling attendance and non-session targets do not mark agenda sessions done", () => {
  const broken = {
    ...graph,
    nodes: graph.nodes
      .filter((node) => node.id !== "node_s01")
      .map((node) =>
        node.id === "node_s02" ? { ...node, labels: ["Memory"] } : node,
      ),
  };
  assert.equal(sessionAttendance(broken, "person_maya").size, 0);
});

test("mixed demo and real reports keep the source that supports the displayed label", () => {
  const real = {
    ...graph.edges[0],
    id: "real",
    properties: {
      source: "user_reported",
      sourceId: "real_memory",
      isDemo: false,
    },
  };
  for (const edges of [
    [real, graph.edges[0]],
    [graph.edges[0], real],
  ]) {
    assert.deepEqual(
      sessionAttendance({ ...graph, edges }, "person_maya").get("s01"),
      { isDemo: false, sourceId: "real_memory" },
    );
  }
});

test("a missing attendance source never resolves to an unrelated graph node", () => {
  const attendance = { isDemo: true, sourceId: "memory_1" };
  assert.equal(attendanceSource(graph, attendance), undefined);
  assert.equal(
    attendanceSource(
      {
        ...graph,
        nodes: [
          ...graph.nodes,
          {
            id: "private:42",
            labels: ["Memory"],
            properties: { id: "memory_1" },
          },
        ],
      },
      attendance,
    ),
    "private:42",
  );
});
