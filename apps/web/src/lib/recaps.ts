import { request } from "./api";

export type RecapDraft = {
  id: string;
  personId: string;
  revision: number;
  text: string;
  citations: { sourceId: string; quote: string }[];
  sources: {
    id: string;
    kind: "Memory" | "Encounter";
    at: string;
    text: string;
    isDemo: boolean;
  }[];
  createdAt: string;
  updatedAt: string;
  status: "draft" | "approved";
  approvedAt?: string;
  edited: boolean;
  projection: "pending" | "ready";
  published: boolean;
  publication?: {
    taskId: string;
    status: string;
    updatedAt: string;
    url?: string;
  };
  day: string;
  postDecision?: "declined";
  revocationVersion?: number;
};
export type RecapReview = { revision: number; revocationVersion: number };
export function recapReview(
  draft: Pick<RecapDraft, "revision" | "revocationVersion">,
): RecapReview {
  return {
    revision: draft.revision,
    revocationVersion: draft.revocationVersion ?? 0,
  };
}
export function recapReviewKey(
  draft: Pick<RecapDraft, "id" | "revision" | "revocationVersion">,
) {
  return `${draft.id}:${draft.revision}:${draft.revocationVersion ?? 0}`;
}
export type RecapList = { drafts: RecapDraft[]; publishAvailable: boolean };
export type RecapCreation = { requestId: string; instructions?: string };
export type RecapPublishResult = {
  text: string;
  draftId: string;
  revision: number;
  published: boolean;
  task?: { id: string; status: string; detail?: string };
};
export type RecapPostingStatus = {
  enabled: boolean;
  sender?: { personId: string; linkedinUrl: string };
  tasks: {
    id: string;
    actorPersonId: string;
    draftId: string;
    draftRevision: number;
    status: string;
    createdAt: string;
    updatedAt: string;
    outcome?: { detail?: string; url?: string };
  }[];
};

export function publishRecap(
  token: string,
  id: string,
  body: RecapReview & { requestId: string },
  signal: AbortSignal,
) {
  return request<RecapPublishResult>(
    token,
    `/v1/recaps/${encodeURIComponent(id)}/publish`,
    {
      method: "POST",
      body,
      signal,
      retry: false,
    },
  );
}

// Writes never retry automatically. A revision conflict requires a fresh review.
export function writeRecap(
  token: string,
  action:
    | { kind: "create"; body: RecapCreation }
    | { kind: "edit"; id: string; revision: number; text: string }
    | ({ kind: "approve"; id: string } & RecapReview)
    | { kind: "decline"; id: string; revision: number },
  signal: AbortSignal,
) {
  const path =
    action.kind === "create"
      ? "/v1/recaps"
      : `/v1/recaps/${encodeURIComponent(action.id)}${action.kind === "edit" ? "" : `/${action.kind}`}`;
  const body =
    action.kind === "create"
      ? action.body
      : {
          revision: action.revision,
          ...(action.kind === "edit" ? { text: action.text } : {}),
          ...(action.kind === "approve"
            ? { revocationVersion: action.revocationVersion }
            : {}),
        };
  return request<RecapDraft>(token, path, {
    method: action.kind === "edit" ? "PATCH" : "POST",
    body,
    signal,
    retry: false,
    ...(action.kind === "create" ? { timeoutMs: 60000 } : {}),
  });
}

export function newestRecaps(drafts: RecapDraft[]) {
  return [...drafts].sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
  );
}
