import { useState } from "react";
import { CalendarDays, ExternalLink, RefreshCw } from "lucide-react";
import { safeLink } from "../lib/graph";
import { useResource } from "../lib/workspace";
import {
  meetingStatusText,
  meetingTime,
  meetingView,
  ownedMeeting,
  sameProposal,
  type MeetingInvite,
  type MeetingReply,
} from "../lib/meetings";

export function MeetingProposal({
  reply,
  token,
  personId,
  allowed,
}: {
  reply: MeetingReply;
  token: string;
  personId: string;
  allowed: boolean;
}) {
  if (!allowed || !token || !ownedMeeting(reply, personId)) return null;
  return (
    <ProposalDetails
      key={`${personId}:${reply.meetingId}:${reply.revision}:${reply.status}`}
      reply={reply}
      token={token}
    />
  );
}

function ProposalDetails({
  reply,
  token,
}: {
  reply: MeetingReply;
  token: string;
}) {
  const [checking, setChecking] = useState(false);
  const resource = useResource<MeetingInvite>(
    token,
    `/v1/meetings/${reply.meetingId}`,
    checking,
  );
  const { meeting, status, canRefresh, eventUrl } = meetingView(
    reply,
    resource.data,
  );
  const changed = resource.data && !sameProposal(reply.meeting, resource.data);
  const mapUrl = safeLink(meeting.venue.mapUrl);
  return (
    <section className="meeting-proposal" aria-label="Calendar invitation">
      <div className="meeting-proposal-heading">
        <CalendarDays size={17} aria-hidden="true" />
        <strong>
          {meeting.kind === "lunch" ? "Lunch" : "Coffee"} with{" "}
          {meeting.recipient.name}
        </strong>
      </div>
      <p className="meeting-status" role="status">
        {meetingStatusText[status] ?? "Status unavailable"}
      </p>
      <dl>
        <div>
          <dt>When</dt>
          <dd>{meetingTime(meeting.start, meeting.end)}</dd>
        </div>
        <div>
          <dt>Where</dt>
          <dd>
            {meeting.venue.name}
            <span>{meeting.venue.address}</span>
          </dd>
        </div>
      </dl>
      <div className="meeting-proposal-actions">
        {mapUrl && (
          <a href={mapUrl} target="_blank" rel="noreferrer">
            View place <ExternalLink size={13} />
          </a>
        )}
        {eventUrl && (
          <a href={eventUrl} target="_blank" rel="noreferrer">
            Open calendar event <ExternalLink size={13} />
          </a>
        )}
        {canRefresh && (
          <button
            className="text-button"
            disabled={resource.loading}
            onClick={() => {
              if (checking) resource.refresh();
              else setChecking(true);
            }}
          >
            <RefreshCw size={13} />
            {resource.loading ? "Checking…" : "Check status"}
          </button>
        )}
      </div>
      {(resource.error || changed) && (
        <p className="notice error" role="alert">
          {changed
            ? "This proposal has changed. Ask Coco to review its current details."
            : `Status check failed: ${resource.error}`}
        </p>
      )}
    </section>
  );
}
