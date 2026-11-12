import { useEffect, useRef, useState } from "react";
import { ExternalLink, Network, RefreshCw } from "lucide-react";
import { request } from "../lib/api";
import {
  briefStatusText,
  linkedinSource,
  matchingBrief,
  postDate,
  postKindText,
  prepareBrief,
  type MeetingBriefData,
} from "../lib/briefs";
import { dateLabel } from "../lib/workspace";
import { safeLink } from "../lib/graph";
import { topicNames, type Graph } from "../lib/types";
import type { CocoState } from "../lib/useCoco";

export function MeetingBrief({
  state,
  initialPersonId = "",
  onEvidence,
}: {
  state: CocoState;
  initialPersonId?: string;
  onEvidence: (graph: Graph) => void;
}) {
  const [personId, setPersonId] = useState(initialPersonId);
  const allowed = state.live && !state.demo;
  const people = state.data.people.filter(
    (p) => p.id !== state.data.me.personId,
  );
  const selected = people.find((p) => p.id === personId);
  return (
    <section className="editor-paper meeting-brief" aria-label="Meeting brief">
      <span className="eyebrow">BEFORE YOU MEET</span>
      <h2>A little context before hello.</h2>
      <p>
        Shared interests, sessions and up to four recent LinkedIn activities.
      </p>
      {!allowed && (
        <p className="notice">
          Connect your own account to prepare and read meeting briefs.
        </p>
      )}
      <label className="form-label">
        Who are you meeting?
        <select
          value={selected?.id ?? ""}
          disabled={!allowed}
          onChange={(e) => setPersonId(e.target.value)}
        >
          <option value="">Choose an attendee</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {allowed && selected && (
        <BriefDetails
          key={`${state.token}:${selected.id}`}
          token={state.token}
          personId={selected.id}
          onEvidence={onEvidence}
        />
      )}
    </section>
  );
}

function BriefDetails({
  token,
  personId,
  onEvidence,
}: {
  token: string;
  personId: string;
  onEvidence: (graph: Graph) => void;
}) {
  const [brief, setBrief] = useState<MeetingBriefData>();
  const [busy, setBusy] = useState<"read" | "prepare" | null>("read");
  const [error, setError] = useState("");
  const controller = useRef(new AbortController());
  const inFlight = useRef(false);
  async function load(prepare = false) {
    if (inFlight.current) return;
    const signal = controller.current.signal;
    inFlight.current = true;
    setBusy(prepare ? "prepare" : "read");
    setError("");
    try {
      const result = prepare
        ? await prepareBrief(token, personId, signal)
        : matchingBrief(
            await request<MeetingBriefData>(
              token,
              `/v1/briefs/${encodeURIComponent(personId)}`,
              { signal },
            ),
            personId,
          );
      if (!signal.aborted) setBrief(result);
    } catch (e) {
      if (!signal.aborted) setError((e as Error).message);
    } finally {
      if (!signal.aborted) {
        setBusy(null);
        inFlight.current = false;
      }
    }
  }
  useEffect(() => {
    controller.current = new AbortController();
    inFlight.current = false;
    void load();
    return () => controller.current.abort();
  }, [token, personId]);
  return (
    <>
      <div className="button-row brief-actions">
        <button
          className="primary"
          disabled={!!busy}
          onClick={() => void load(true)}
        >
          {busy === "prepare"
            ? "Preparing brief…"
            : brief?.preparedAt
              ? "Refresh brief"
              : "Prepare brief"}
        </button>
        <button
          className="secondary"
          disabled={!!busy}
          onClick={() => void load()}
        >
          <RefreshCw size={14} /> Reload saved brief
        </button>
      </div>
      <p className="subtle">
        Prepare or refresh checks recent activity. Reload reads only the saved
        brief.
      </p>
      {busy && (
        <p role="status">
          {busy === "prepare"
            ? "Checking shared context and recent activity. This can take a minute…"
            : "Loading saved brief…"}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
          {brief ? " Showing the last loaded brief." : ""}
        </p>
      )}
      {!brief && !busy && !error && (
        <p>No saved brief yet. Prepare one when you are ready.</p>
      )}
      {brief && <BriefContent brief={brief} onEvidence={onEvidence} />}
    </>
  );
}

export function BriefContent({
  brief,
  onEvidence,
}: {
  brief: MeetingBriefData;
  onEvidence: (graph: Graph) => void;
}) {
  const profile = linkedinSource(brief.person.linkedinUrl);
  return (
    <div className="brief-content">
      <div className="section-heading">
        <h3>{brief.person.name}</h3>
        {profile && (
          <a href={profile} target="_blank" rel="noreferrer">
            LinkedIn profile <ExternalLink size={13} />
          </a>
        )}
      </div>
      {brief.preparedAt && (
        <p className="subtle">Prepared {dateLabel(brief.preparedAt)}</p>
      )}
      <section aria-label="Shared context">
        <h3>In common</h3>
        {brief.graphStatus === "unavailable" ? (
          <p className="notice">Shared context is unavailable right now.</p>
        ) : (
          <>
            <div className="tags">
              {brief.sharedTopics.map((topic) => (
                <span key={topic}>{topicNames[topic] ?? topic}</span>
              ))}
            </div>
            {brief.sharedSessions.length > 0 && (
              <>
                <h4>Sessions in common</h4>
                <ul>
                  {brief.sharedSessions.map((s) => (
                    <li key={s.id}>{s.title}</li>
                  ))}
                </ul>
              </>
            )}
            {!brief.sharedTopics.length && !brief.sharedSessions.length && (
              <p>No shared interests or sessions were returned.</p>
            )}
          </>
        )}
        {brief.explanation.nodes.length > 0 && (
          <button
            className="text-button"
            onClick={() => onEvidence(brief.explanation)}
          >
            <Network size={15} /> Explore shared connections
          </button>
        )}
      </section>
      <section aria-label="Recent LinkedIn activity">
        <h3>Recent LinkedIn activity</h3>
        <p className="notice" role="status">
          {briefStatusText[brief.recentPosts.status] ??
            "Activity status unavailable"}
        </p>
        {brief.recentPosts.reason && (
          <p className="subtle">{brief.recentPosts.reason}</p>
        )}
        <div className="brief-posts">
          {brief.recentPosts.items.slice(0, 4).map((post, i) => {
            const source = linkedinSource(post.url);
            return (
              <article className="brief-post" key={`${post.url}:${i}`}>
                <div className="brief-post-meta">
                  <strong>
                    {postKindText[post.kind] ?? "Authorship unverified"}
                  </strong>
                  <span>{postDate(post)}</span>
                </div>
                <p className="brief-post-text">{post.text}</p>
                {post.textTruncated && (
                  <p className="subtle">Excerpt · full text may be longer.</p>
                )}
                {source ? (
                  <a href={source} target="_blank" rel="noreferrer">
                    {post.urlKind === "post"
                      ? "View source post"
                      : "View activity page"}{" "}
                    <ExternalLink size={13} />
                  </a>
                ) : (
                  <span className="subtle">Source link unavailable</span>
                )}
              </article>
            );
          })}
        </div>
        {brief.recentPosts.evidence.length > 0 && (
          <details className="brief-sources">
            <summary>Source details</summary>
            {brief.recentPosts.evidence.map((source, i) => (
              <p key={i}>
                {source.provider} · retrieved {dateLabel(source.fetchedAt)}{" "}
                {safeLink(source.sourceUrl) && (
                  <a
                    href={safeLink(source.sourceUrl)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Source <ExternalLink size={12} />
                  </a>
                )}
              </p>
            ))}
          </details>
        )}
      </section>
    </div>
  );
}
