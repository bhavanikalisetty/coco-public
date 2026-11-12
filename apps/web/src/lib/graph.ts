import type { Graph, GraphNode, Session } from "./types";
export const nodeName = (node: GraphNode) => {
  if (node.properties.name || node.properties.title)
    return String(node.properties.name ?? node.properties.title);
  if (node.labels.includes("Encounter"))
    return `Encounter ${node.properties.at ? time(String(node.properties.at)) : node.id.slice(-4)}`;
  if (node.labels.includes("FollowUp"))
    return `Follow-up · ${node.properties.status ?? "unassigned"}`;
  return (
    String(node.labels[0] ?? "Record") +
    " " +
    String(node.properties.id ?? node.id).slice(0, 8)
  );
};
export const isFixture = (props: Record<string, unknown>) =>
  props.isFictional === true ||
  props.isSimulated === true ||
  props.isDemo === true ||
  props.source === "fixture";
export function neighborhood(graph: Graph, id: string, hops = 1) {
  const ids = new Set([id]);
  for (let i = 0; i < hops; i++)
    for (const edge of graph.edges.filter(
      (e) => ids.has(e.source) || ids.has(e.target),
    )) {
      ids.add(edge.source);
      ids.add(edge.target);
    }
  return ids;
}
export function conflicts(session: Session, selected: Session[]) {
  return selected.filter(
    (s) =>
      s.id !== session.id &&
      Date.parse(session.startsAt) < Date.parse(s.endsAt) &&
      Date.parse(s.startsAt) < Date.parse(session.endsAt),
  );
}
export const safeLink = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
};
export const time = (value: string) =>
  new Date(value).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
export function projectorGraph(graph: Graph, publicGraph: Graph): Graph {
  const publicIds = new Set(publicGraph.nodes.map((n) => n.properties.id));
  const nodes = graph.nodes
    .filter((n) =>
      [
        "Person",
        "Topic",
        "Session",
        "Company",
        "Room",
        "Profile",
        "Encounter",
        "Booth",
      ].some((label) => n.labels.includes(label)),
    )
    .map((n) => ({
      ...n,
      properties: {
        id: n.properties.id,
        name:
          n.labels.includes("Person") && !publicIds.has(n.properties.id)
            ? "Private contact"
            : nodeName(n),
        isFictional: n.properties.isFictional,
        isDemo: n.properties.isDemo,
        isDemoParticipant: n.properties.isDemoParticipant,
        source: n.properties.source,
      },
    }));
  const ids = new Set(nodes.map((n) => n.id));
  return {
    ...graph,
    nodes,
    edges: graph.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({
        ...e,
        properties: {
          source: e.properties.source,
          isFictional: e.properties.isFictional,
          isSimulated: e.properties.isSimulated,
          isDemo: e.properties.isDemo,
          at: e.properties.at,
        },
      })),
  };
}

export function companyRecords(graph: Graph) {
  const employeeIds = new Set(
    graph.edges.filter((e) => e.type === "WORKS_AT").map((e) => e.source),
  );
  return graph.nodes
    .filter((n) => n.labels.includes("Person") && !employeeIds.has(n.id))
    .map((node) => {
      const encounterIds = graph.edges
        .filter((e) => e.source === node.id && e.type === "PARTICIPATED_IN")
        .map((e) => e.target);
      const encounters = graph.nodes.filter((n) => encounterIds.includes(n.id));
      const met = graph.edges.filter(
        (e) => e.type === "MET" && [e.source, e.target].includes(node.id),
      );
      const staffIds = new Set([
        ...graph.edges
          .filter(
            (e) =>
              e.type === "PARTICIPATED_IN" &&
              encounterIds.includes(e.target) &&
              employeeIds.has(e.source),
          )
          .map((e) => e.source),
        ...met.map((e) => (e.source === node.id ? e.target : e.source)),
      ]);
      const employees = graph.nodes.filter((n) => staffIds.has(n.id));
      const followIds = graph.edges
        .filter((e) => e.type === "FOR_CONTACT" && e.target === node.id)
        .map((e) => e.source);
      const followups = graph.nodes.filter((n) => followIds.includes(n.id));
      const evidence = [
        ...encounters.map((n) => n.properties),
        ...met.map((e) => e.properties),
      ];
      const latest = [...encounters].sort((a, b) =>
        String(b.properties.at ?? "").localeCompare(
          String(a.properties.at ?? ""),
        ),
      )[0];
      return {
        node,
        encounters,
        met,
        employees,
        followups,
        evidence,
        latest,
        booth: graph.edges.some(
          (e) => e.source === node.id && e.type === "VISITED",
        ),
      };
    });
}

export function graphFallback(graph: Graph, requested?: string) {
  return (
    graph.nodes.find((n) => n.id === requested || n.properties.id === requested)
      ?.id ??
    graph.nodes.find((n) => n.labels.includes("Person"))?.id ??
    graph.nodes[0]?.id ??
    ""
  );
}
export function reconcileSelection(
  graph: Graph,
  focus: string,
  edgeId: string,
) {
  return {
    focus:
      focus && !graph.nodes.some((n) => n.id === focus)
        ? graphFallback(graph)
        : focus,
    edgeId: edgeId && !graph.edges.some((e) => e.id === edgeId) ? "" : edgeId,
  };
}
export function visibleGraphNodes(
  graph: Graph,
  focus: string,
  hops = 1,
  limit = 22,
) {
  if (!focus) return graph.nodes.slice(0, limit);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  if (!byId.has(focus)) return graph.nodes.slice(0, limit);
  // Breadth-first order reserves the focus, then direct neighbors, then expanded paths.
  const ids = [...neighborhood(graph, focus, hops)];
  return ids
    .map((id) => byId.get(id))
    .filter((n): n is GraphNode => !!n)
    .slice(0, limit);
}
