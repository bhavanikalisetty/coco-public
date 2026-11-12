import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  RotateCcw,
  RefreshCw,
  ArrowUpRight,
  Network,
} from "lucide-react";
import type { Graph, GraphNode, GraphEdge } from "../lib/types";
import { SourceProvenance } from "./SourceProvenance";
import {
  nodeName,
  safeLink,
  graphFallback,
  reconcileSelection,
  visibleGraphNodes,
} from "../lib/graph";
const type = (n: GraphNode) =>
  n.labels.includes("Person")
    ? "Person"
    : n.labels.includes("Session")
      ? "Session"
      : n.labels.includes("Topic")
        ? "Topic"
        : n.labels.includes("Company")
          ? "Company"
          : n.labels.includes("Room")
            ? "Room"
            : n.labels.includes("Encounter")
              ? "Encounter"
              : n.labels.includes("Booth")
                ? "Booth"
                : "Source";
export function GraphView({
  graph,
  error,
  focusId,
  onRefresh,
  projector = false,
  refreshLabel = "Refresh",
}: {
  graph: Graph;
  error?: string;
  focusId?: string;
  onRefresh: () => void;
  projector?: boolean;
  refreshLabel?: string;
}) {
  const [query, setQuery] = useState(""),
    [focus, setFocus] = useState(""),
    [edgeId, setEdgeId] = useState(""),
    [expanded, setExpanded] = useState(false);
  const initialized = useRef(false);
  const canvas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    initialized.current = false;
    setFocus(graphFallback(graph, focusId));
    setEdgeId("");
    setExpanded(!!focusId);
  }, [focusId, graph.eventId]);
  useEffect(() => {
    if (!graph.nodes.length) return;
    if (!initialized.current) {
      setFocus(graphFallback(graph, focusId));
      initialized.current = true;
    } else {
      setFocus((current) => reconcileSelection(graph, current, "").focus);
    }
    setEdgeId((current) => reconcileSelection(graph, "", current).edgeId);
  }, [graph, focusId]);
  const matches = useMemo(
    () =>
      query
        ? graph.nodes.filter((n) =>
            nodeName(n).toLowerCase().includes(query.toLowerCase()),
          )
        : [],
    [query, graph],
  );
  const selected = graph.nodes.find((n) => n.id === focus),
    selectedEdge = graph.edges.find((e) => e.id === edgeId);
  const visible = useMemo(
    () => visibleGraphNodes(graph, focus, expanded ? 2 : 1),
    [graph, focus, expanded],
  );
  const maxRows = Math.max(
    1,
    ...Object.values(
      visible.reduce<Record<string, number>>((a, n) => {
        a[type(n)] = (a[type(n)] ?? 0) + 1;
        return a;
      }, {}),
    ),
  );
  const layoutHeight = Math.max(300, Math.min(800, maxRows * 85 + 100));
  const positioned = useMemo(() => {
    const groups: Record<string, GraphNode[]> = {};
    visible.forEach((n) => (groups[type(n)] ??= []).push(n));
    const columns = Object.entries(groups).sort(
      ([a], [b]) =>
        [
          "Person",
          "Encounter",
          "Topic",
          "Session",
          "Booth",
          "Company",
          "Room",
          "Source",
        ].indexOf(a) -
        [
          "Person",
          "Encounter",
          "Topic",
          "Session",
          "Booth",
          "Company",
          "Room",
          "Source",
        ].indexOf(b),
    );
    return columns.flatMap(([kind, nodes], col) =>
      nodes.map((n, i) => ({
        ...n,
        kind,
        x:
          columns.length === 1
            ? 450
            : 100 + (col * 700) / Math.max(1, columns.length - 1),
        y:
          layoutHeight / 2 -
          25 -
          ((nodes.length - 1) *
            Math.min(
              85,
              (layoutHeight - 120) / Math.max(1, nodes.length - 1),
            )) /
            2 +
          i *
            Math.min(85, (layoutHeight - 120) / Math.max(1, nodes.length - 1)),
      })),
    );
  }, [visible, layoutHeight]);
  const visibleEdges = graph.edges.filter(
    (e) =>
      positioned.some((n) => n.id === e.source) &&
      positioned.some((n) => n.id === e.target),
  );
  useEffect(() => {
    const surface = canvas.current;
    const node = surface?.querySelector(".graph-node.selected");
    if (!surface || !node) return;
    const bounds = surface.getBoundingClientRect();
    const target = node.getBoundingClientRect();
    surface.scrollLeft +=
      target.left + target.width / 2 - bounds.left - bounds.width / 2;
  }, [focus, graph.eventId, projector]);
  const summary = selected
    ? `${nodeName(selected)} connects to ${Math.max(0, visible.length - 1)} visible records. Select a relationship to see its source.`
    : "Select a person, topic or session to focus its connections.";
  return (
    <section className="graph-workspace">
      <div className="graph-toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Search graph"
            placeholder="Find a person, session or topic"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {focus && (
          <button
            className="graph-expand secondary"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Direct links" : "Expand path"}
          </button>
        )}
        <button
          className="icon-button"
          aria-label="Reset graph"
          onClick={() => {
            setFocus("");
            setEdgeId("");
            setQuery("");
            setExpanded(false);
          }}
        >
          <RotateCcw size={18} />
        </button>
        <button
          className="icon-button"
          aria-label={
            refreshLabel === "Refresh" ? "Refresh graph" : refreshLabel
          }
          title={refreshLabel}
          onClick={onRefresh}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {query && (
        <div className="graph-results">
          {matches.length ? (
            matches.slice(0, 12).map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  setFocus(n.id);
                  setQuery("");
                  setEdgeId("");
                }}
              >
                {nodeName(n)} <small>{type(n)}</small>
              </button>
            ))
          ) : (
            <p>No matching records.</p>
          )}
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}{" "}
          {graph.nodes.length > 0 ? "Showing the last successful graph." : ""}
        </div>
      )}
      {!graph.nodes.length ? (
        <div className="empty">
          <Network />
          <h3>{error ? "Graph unavailable" : "No graph records yet"}</h3>
          <p>
            {graph.source === "unavailable"
              ? "Connect your badge to load real FalkorDB relationships."
              : "This graph has no returned relationships."}
          </p>
        </div>
      ) : (
        <>
          <div className="graph-canvas" ref={canvas}>
            <svg
              viewBox={`0 0 900 ${layoutHeight}`}
              style={{
                height: Math.min(
                  projector ? 500 : 460,
                  layoutHeight * (projector ? 1.4 : 1.2),
                ),
              }}
              role="group"
              aria-label="Directed relationships from FalkorDB. Use the relationship list below for keyboard navigation."
            >
              <defs>
                <marker
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="29"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M0 0L10 5L0 10" fill="context-stroke" />
                </marker>
              </defs>
              {visibleEdges.map((e) => {
                const a = positioned.find((n) => n.id === e.source)!,
                  b = positioned.find((n) => n.id === e.target)!;
                const mx = (a.x + b.x) / 2,
                  my = (a.y + b.y) / 2,
                  curve = Math.abs(a.x - b.x) > 400 ? -90 : 0;
                const path = `M${a.x} ${a.y} Q${mx} ${my + curve} ${b.x} ${b.y}`;
                return (
                  <g
                    key={e.id}
                    className={`graph-edge ${edgeId === e.id ? "selected" : ""}`}
                    onClick={() => setEdgeId(e.id)}
                  >
                    <path className="edge-hit" d={path} />
                    <path markerEnd="url(#arrow)" d={path} />
                    {visibleEdges.length <= 9 && (
                      <text
                        className="edge-label"
                        x={mx}
                        y={my + curve / 2 - 7}
                      >
                        {e.type.replaceAll("_", " ").toLowerCase()}
                      </text>
                    )}
                  </g>
                );
              })}
              {positioned.map((n) => (
                <g
                  key={n.id}
                  className={`graph-node ${n.kind.toLowerCase()} ${focus === n.id ? "selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Focus ${nodeName(n)}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setFocus(n.id);
                      setEdgeId("");
                    }
                  }}
                  onClick={() => {
                    setFocus(n.id);
                    setEdgeId("");
                  }}
                >
                  <circle cx={n.x} cy={n.y} r={focus === n.id ? 25 : 19} />
                  <text x={n.x} y={n.y + 5} className="node-symbol">
                    {n.kind === "Person"
                      ? nodeName(n)
                          .split(" ")
                          .map((s) => s[0])
                          .slice(0, 2)
                          .join("")
                      : n.kind === "Topic"
                        ? "#"
                        : n.kind === "Session"
                          ? "▤"
                          : "•"}
                  </text>
                  <text x={n.x} y={n.y + 43}>
                    {nodeName(n)
                      .match(/.{1,23}(?:\s|$)|.{1,23}/g)
                      ?.slice(0, 3)
                      .map((part, i) => (
                        <tspan key={i} x={n.x} dy={i ? 13 : 0}>
                          {part.trim()}
                        </tspan>
                      ))}
                  </text>
                </g>
              ))}
            </svg>
          </div>
          <div className="graph-legend">
            <span>
              <i className="person-dot" />
              Person
            </span>
            <span>
              <i className="topic-dot" />
              Topic
            </span>
            <span>
              <i className="session-dot" />
              Session
            </span>
            <span className="graph-source">
              FalkorDB · {graph.nodes.length} records · {graph.edges.length}{" "}
              relationships
            </span>
          </div>
          <div className="graph-detail">
            <div>
              <span className="eyebrow">
                {selectedEdge
                  ? "Selected relationship"
                  : selected
                    ? "Focused record"
                    : "Explore the evidence"}
              </span>
              <h3>
                {selectedEdge
                  ? selectedEdge.type.replaceAll("_", " ").toLowerCase()
                  : selected
                    ? nodeName(selected)
                    : "Every connection has a reason."}
              </h3>
              <p>
                {selectedEdge ? (
                  <EdgeSentence edge={selectedEdge} graph={graph} />
                ) : (
                  summary
                )}
              </p>
              {selectedEdge && (
                <>
                  {!projector && selectedEdge.properties.context && (
                    <p>{String(selectedEdge.properties.context)}</p>
                  )}
                  {selectedEdge.properties.at && (
                    <p>{String(selectedEdge.properties.at)}</p>
                  )}
                </>
              )}
              {!projector && (selectedEdge || selected) && (
                <SourceProvenance
                  properties={(selectedEdge ?? selected)!.properties}
                />
              )}
              {selected &&
                safeLink(
                  selected.properties.url ?? selected.properties.linkedinUrl,
                ) && (
                  <a
                    href={safeLink(
                      selected.properties.url ??
                        selected.properties.linkedinUrl,
                    )}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open source <ArrowUpRight size={14} />
                  </a>
                )}
            </div>
            <div className="edge-list" aria-label="Graph relationships">
              {visibleEdges.slice(0, 30).map((e) => (
                <button
                  className={edgeId === e.id ? "active" : ""}
                  key={e.id}
                  onClick={() => setEdgeId(e.id)}
                >
                  <EdgeSentence edge={e} graph={graph} />
                </button>
              ))}
            </div>
          </div>
          {visible.length < graph.nodes.length && (
            <p className="subtle">
              Showing {visible.length} of {graph.nodes.length} records. Search
              to focus any returned record.
            </p>
          )}
        </>
      )}
    </section>
  );
}
function EdgeSentence({ edge, graph }: { edge: GraphEdge; graph: Graph }) {
  return (
    <>
      {nodeName(graph.nodes.find((n) => n.id === edge.source)!)}{" "}
      <span className="relation">
        → {edge.type.replaceAll("_", " ").toLowerCase()} →
      </span>{" "}
      {nodeName(graph.nodes.find((n) => n.id === edge.target)!)}
    </>
  );
}
