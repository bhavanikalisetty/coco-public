import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "./api";
import type { Graph, Job } from "./types";

export type SourceRecord = {
  id: string;
  ownerId: string;
  createdAt: string;
  projection: "pending" | "ready";
  data: Record<string, unknown>;
};
export type MemoryData = {
  records: SourceRecord[];
  pendingRecords: SourceRecord[];
  encounters: {
    id: string;
    at: string;
    context: string;
    source: string;
    peer: { id: string; name: string };
  }[];
  graph: Graph;
  graphStatus: "ready" | "unavailable";
  message?: string;
};
export type CrmData = {
  companyId: string;
  contacts: {
    id: string;
    name: string;
    emails: string[];
    employees: { id: string; name?: string }[];
    encounters: Record<string, unknown>[];
  }[];
  followUps: {
    id: string;
    text: string;
    contactId: string;
    assignedTo: string;
    status: "open" | "done" | "cancelled";
    dueAt?: string;
  }[];
  records: SourceRecord[];
  pendingRecords: SourceRecord[];
  graph: Graph;
  graphStatus: "ready" | "unavailable";
  message?: string;
};
export type RecordingSummary = {
  title: string;
  summary: string;
  keyPoints: { text: string; quote: string }[];
  suggestedActionItems: { text: string; quote: string }[];
  topicIds: string[];
};
export type RecordingResult = NonNullable<Job["result"]> & {
  summary?: RecordingSummary;
  memoryId?: string;
  recordingId?: string;
  actionsExecuted?: boolean;
};
export type Clip = {
  id: string;
  status: Job["status"];
  createdAt: string;
  sessionId?: string;
  result?: RecordingResult;
  error?: { code: string; message: string };
  audioPath?: string;
};

export function useResource<T>(
  token: string,
  path: string,
  enabled = true,
  anonymous = false,
) {
  const key = `${token}:${path}`;
  const [snapshot, setSnapshot] = useState<{ key: string; data: T }>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if ((!token && !anonymous) || !enabled) {
      setSnapshot(undefined);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    request<T>(token, path, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) {
          setSnapshot({ key, data: value });
          setError("");
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, path, enabled, revision, key, anonymous]);
  return {
    data: snapshot?.key === key ? snapshot.data : undefined,
    error,
    loading,
    refresh: useCallback(() => setRevision((n) => n + 1), []),
  };
}
type Mutation = { path: string; body: unknown; id?: string };
export function useMutation<T>(token: string, onSaved: (result: T) => void) {
  const [pending, setPending] = useState<Mutation | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const controller = useRef(new AbortController()),
    saved = useRef(onSaved),
    inFlight = useRef(false);
  saved.current = onSaved;
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, [token]);
  async function send(mutation: Mutation) {
    if (inFlight.current) return;
    const signal = controller.current.signal;
    inFlight.current = true;
    setBusy(true);
    setPending(mutation);
    setError("");
    try {
      const result = await request<T>(token, mutation.path, {
        method: "POST",
        body: mutation.body,
        id: mutation.id,
        signal,
      });
      if (!signal.aborted) {
        setPending(null);
        saved.current(result);
      }
    } catch (e) {
      if (!signal.aborted) setError((e as Error).message);
    } finally {
      inFlight.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  return {
    pending,
    busy,
    error,
    send,
    retry: () => pending && void send(pending),
    clear: () => {
      setPending(null);
      setError("");
    },
  };
}
// Only user-authored requests can be reconstructed. Service-generated recording/tap sources use a different namespace.
export function retrySource(
  record: SourceRecord,
  ownerId: string,
  company = false,
): Mutation | undefined {
  const d = record.data;
  if (
    record.ownerId !== ownerId ||
    typeof d.requestId !== "string" ||
    d.recording ||
    d.provenance
  )
    return;
  const keys = company
    ? d.type === "booth_visit"
      ? [
          "requestId",
          "contactId",
          "note",
          "email",
          "atBooth",
          "topicIds",
          "isDemo",
        ]
      : d.type === "follow_up"
        ? ["requestId", "contactId", "text", "assignedTo", "dueAt"]
        : []
    : [
        "requestId",
        "kind",
        "text",
        "sessionId",
        "personId",
        "topicIds",
        "isDemo",
      ];
  if (!keys.length) return;
  return {
    path: company
      ? d.type === "booth_visit"
        ? "/v1/crm/visits"
        : "/v1/crm/follow-ups"
      : "/v1/memory",
    body: Object.fromEntries(
      keys.filter((k) => d[k] !== undefined).map((k) => [k, d[k]]),
    ),
  };
}
export const dateLabel = (value: string) =>
  new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
