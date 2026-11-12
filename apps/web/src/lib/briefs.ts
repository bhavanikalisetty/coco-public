import { request } from "./api";
import type { Graph } from "./types";

export type BriefPost = {
  text: string;
  url: string;
  authorUrl: string | null;
  activityOwnerUrl: string;
  urlKind: "post" | "activity";
  publishedLabel: string;
  publishedAt: string | null;
  datePrecision: "absolute" | "relative" | "label";
  kind: "original" | "reshare" | "unknown";
  textTruncated: boolean;
  fetchedAt: string;
};
export type MeetingBriefData = {
  person: { id: string; name: string; linkedinUrl?: string | null };
  graphStatus: "ready" | "unavailable";
  sharedTopics: string[];
  sharedSessions: { id: string; title: string }[];
  explanation: Graph;
  recentPosts: {
    status:
      | "ready"
      | "partial"
      | "pending"
      | "stale"
      | "missing"
      | "failed"
      | "needs_login";
    items: BriefPost[];
    evidence: {
      provider: string;
      sourceUrl: string;
      fetchedAt: string;
      requestId?: string;
      snapshotId?: string;
      datasetId?: string;
    }[];
    reason?: string;
  };
  preparedAt: string | null;
};

export const briefStatusText: Record<
  MeetingBriefData["recentPosts"]["status"],
  string
> = {
  ready: "Recent activity available",
  partial: "Some recent activity is available",
  pending:
    "Activity is still being collected. Reload the saved brief to check.",
  stale: "Saved activity may be out of date",
  missing: "No recent activity is available",
  failed: "Recent activity could not be loaded",
  needs_login: "LinkedIn connection needs attention",
};
export const postKindText: Record<BriefPost["kind"], string> = {
  original: "Original post",
  reshare: "Reshared activity",
  unknown: "Authorship unverified",
};
export function linkedinSource(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      ["linkedin.com", "www.linkedin.com"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function postDate(post: BriefPost) {
  const label = post.publishedLabel?.trim();
  if (!label) return "Publication date unavailable";
  if (post.datePrecision === "relative") return `${label} · relative date`;
  if (post.datePrecision !== "absolute")
    return `${label} · exact date unverified`;
  return label;
}
export function matchingBrief(brief: MeetingBriefData, personId: string) {
  if (brief.person?.id !== personId)
    throw new Error("Coco returned a brief for a different attendee.");
  return brief;
}
export function prepareBrief(
  token: string,
  personId: string,
  signal: AbortSignal,
) {
  return request<MeetingBriefData>(token, "/v1/briefs", {
    method: "POST",
    body: { personId },
    signal,
    retry: false,
    timeoutMs: 65000,
  }).then((brief) => matchingBrief(brief, personId));
}
