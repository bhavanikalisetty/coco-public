import type { Graph, GraphEdge, GraphNode, Trace } from "./types";
const sensitive = /token|secret|password|authorization|credential|api.?key/i;
// Tool envelopes can contain another JSON document in content[].text.
function structured(value: unknown, depth = 0): unknown {
  if (depth > 14) return "[Nested output omitted]";
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object")
        return structured(parsed, depth + 1);
    } catch {
      /* A normal source string. */
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => structured(v, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        sensitive.test(key) ? "[redacted]" : structured(v, depth + 1),
      ]),
    );
  return value;
}
export function safeTrace(output?: string): unknown {
  if (!output) return undefined;
  try {
    return structured(JSON.parse(output));
  } catch {
    return "Structured output is unavailable. See the tool status.";
  }
}
export function answerGraph(
  trace: Trace[] = [],
  provided?: Graph,
): Graph | undefined {
  const nodes = new Map<string, GraphNode>(),
    edges = new Map<string, GraphEdge>();
  let eventId = "";
  let partial = false;
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    const o = value as Record<string, unknown>;
    if (
      o.source === "falkordb" &&
      Array.isArray(o.nodes) &&
      Array.isArray(o.edges)
    ) {
      for (const n of o.nodes)
        if (
          n &&
          typeof n.id === "string" &&
          Array.isArray(n.labels) &&
          n.properties &&
          typeof n.properties === "object"
        )
          nodes.set(n.id, n);
      for (const e of o.edges)
        if (
          e &&
          typeof e.id === "string" &&
          typeof e.source === "string" &&
          typeof e.target === "string" &&
          typeof e.type === "string" &&
          e.properties
        )
          edges.set(e.id, e);
      if (typeof o.eventId === "string") eventId = o.eventId;
      if (o.partial === true) partial = true;
      return;
    }
    for (const child of Object.values(o)) visit(child);
  }
  if (provided) visit(structured(provided));
  else
    for (const item of trace)
      if (item.status === "completed") visit(safeTrace(item.output));
  return nodes.size
    ? {
        nodes: [...nodes.values()],
        edges: [...edges.values()].filter(
          (e) => nodes.has(e.source) && nodes.has(e.target),
        ),
        source: "falkordb",
        eventId,
        partial,
      }
    : undefined;
}
