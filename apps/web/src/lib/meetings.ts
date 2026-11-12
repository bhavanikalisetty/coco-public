import { safeLink } from "./graph";

// Package-local view of docs/MEETINGS_API.md. Only owner status reads are exposed.
export type MeetingStatus =
  | "proposed"
  | "queued"
  | "running"
  | "pending"
  | "confirmed"
  | "uncertain"
  | "needs_login"
  | "unavailable"
  | "failed";
export type MeetingInvite = {
  id: string;
  actorPersonId: string;
  recipient: { personId: string; name: string };
  kind: "coffee" | "lunch";
  start: string;
  end: string;
  venue: {
    id: string;
    name: string;
    address: string;
    mapUrl: string;
    fetchedAt: string;
  };
  revision: number;
  status: MeetingStatus;
  expiresAt: string;
  outcome?: { status: MeetingStatus; url?: string; detail?: string };
};
export type MeetingReply = {
  text: string;
  meetingId: string;
  revision: number;
  meeting: MeetingInvite;
  status: MeetingStatus | "declined" | "expired" | "review_required";
  confirmationRequired: boolean;
  sent: boolean;
};

export function ownedMeeting(reply: MeetingReply, personId: string) {
  return (
    !!personId &&
    reply.meeting?.actorPersonId === personId &&
    /^meet_[a-f0-9]{40}$/.test(reply.meetingId) &&
    reply.meeting.id === reply.meetingId &&
    reply.meeting.revision === reply.revision
  );
}

export function sameProposal(a: MeetingInvite, b: MeetingInvite) {
  return (
    a.id === b.id &&
    a.revision === b.revision &&
    a.actorPersonId === b.actorPersonId
  );
}

export function meetingView(reply: MeetingReply, latest?: MeetingInvite) {
  // These conversation states cannot be reopened by a saved "proposed" status.
  const closed =
    reply.status === "declined" ||
    reply.status === "expired" ||
    reply.status === "review_required";
  const meeting =
    !closed && latest && sameProposal(reply.meeting, latest)
      ? latest
      : reply.meeting;
  const status = closed ? reply.status : meeting.status;
  return {
    meeting,
    status,
    canRefresh: !closed,
    eventUrl:
      status === "confirmed" ? safeLink(meeting.outcome?.url) : undefined,
  };
}

export const meetingStatusText: Record<MeetingReply["status"], string> = {
  proposed: "Awaiting your reply in chat",
  queued: "Queued · not yet confirmed",
  running: "Sending · not yet confirmed",
  pending: "Waiting for Calendar confirmation",
  confirmed: "Invitation confirmed",
  uncertain: "Delivery unverified",
  needs_login: "Calendar connection needed",
  unavailable: "Calendar unavailable",
  failed: "Invitation not confirmed",
  declined: "Declined · not sent",
  expired: "Expired · review a new time",
  review_required: "Review required · not sent",
};

export function meetingTime(start: string, end: string) {
  const from = new Date(start),
    to = new Date(end);
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || +to <= +from)
    return "Meeting time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: "America/Los_Angeles",
  }).formatRange(from, to);
}
