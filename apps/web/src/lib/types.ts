import type { MeetingReply } from "./meetings";

export type Person = {
  id: string;
  name: string;
  isFictional?: boolean;
  isDemoParticipant?: boolean;
  linkedinUrl?: string;
  enrichmentStatus?: string;
};
export type Session = {
  id: string;
  title: string;
  room: string;
  speakers: string[];
  topics: string[];
  startsAt: string;
  endsAt: string;
};
export type Zone = {
  id: string;
  name: string;
  floor: number;
  x: number;
  y: number;
};
export type Conference = {
  id: string;
  name: string;
  venue: string;
  isFictional: boolean;
  time: string;
  clockMode: string;
};
export type Bootstrap = {
  access?: "demo" | "owner";
  me: { personId: string; companyId: string };
  conference: Conference;
  people: Person[];
  sessions: Session[];
  zones: Zone[];
  capabilities: Record<string, boolean | string | number>;
};
export type Intent = {
  kind: string;
  requestId: string;
  expiresAt: number;
  matchId?: string;
  peerId?: string;
};
export type Context = {
  conference: Conference;
  location: { zoneId: string; source: string };
  activeIntents: Intent[];
};
// Wire-compatible with packages/contracts; kept package-local to preserve ownership.
export type GraphNode = {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
};
export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  properties: Record<string, unknown>;
};
export type Graph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  source: string;
  eventId: string;
  partial?: boolean;
};
export type Trace = {
  tool: string;
  input?: string;
  output?: string;
  status: string;
  durationMs?: number;
};
export type Job = {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed";
  result?: {
    text?: string;
    audioId?: string;
    audioError?: string;
    transcript?: string;
    trace?: Trace[];
    graphEvidence?: Graph;
    origin?: "proactive";
    notificationKind?: string;
    meeting?: MeetingReply;
  };
  error?: { code: string; message: string };
};
export type Turn = {
  requestId: string;
  prompt: string;
  job?: Job;
  error?: string;
  pending?: boolean;
  pollStopped?: boolean;
  createdAt: number;
  kind: "chat" | "voice";
  origin?: "badge" | "proactive";
  body?: Blob;
};
export type View =
  "today" | "schedule" | "map" | "people" | "memory" | "company" | "graph";
export const topicNames: Record<string, string> = {
  browser: "Browser agents",
  memory: "Graph memory",
  mcp: "MCP",
  reliability: "Agent reliability",
  workflow: "Workflow automation",
  creator: "Creator tools",
  accessibility: "Accessible design",
  voice: "Voice agents",
};
