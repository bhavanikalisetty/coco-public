import type { Graph } from "./types";

export type Attendance = { isDemo: boolean; sourceId?: string };

// Plans and elapsed session times are not attendance. Use the owner's saved graph edges.
export function sessionAttendance(graph: Graph, ownerId: string) {
  const result = new Map<string, Attendance>();
  if (graph.source !== "falkordb") return result;
  const ownerNodes = new Set(
    graph.nodes
      .filter(
        (node) =>
          node.labels.includes("Person") && node.properties.id === ownerId,
      )
      .map((node) => node.id),
  );
  for (const edge of graph.edges) {
    if (
      edge.type !== "ATTENDED" ||
      !ownerNodes.has(edge.source) ||
      edge.properties.source !== "user_reported" ||
      typeof edge.properties.sourceId !== "string"
    )
      continue;
    const session = graph.nodes.find(
      (node) => node.id === edge.target && node.labels.includes("Session"),
    );
    const id = session?.properties.id;
    if (typeof id !== "string") continue;
    const previous = result.get(id);
    if (previous && (!previous.isDemo || edge.properties.isDemo === true))
      continue;
    result.set(id, {
      isDemo: edge.properties.isDemo === true,
      sourceId:
        typeof edge.properties.sourceId === "string"
          ? edge.properties.sourceId
          : undefined,
    });
  }
  return result;
}

export function attendanceSource(graph: Graph, attendance: Attendance) {
  return graph.nodes.find(
    (node) =>
      node.labels.includes("Memory") &&
      (node.id === attendance.sourceId ||
        node.properties.id === attendance.sourceId),
  )?.id;
}
