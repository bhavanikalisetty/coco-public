import { useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { requestId } from "../lib/api";
import type { CocoState } from "../lib/useCoco";
import { topicNames } from "../lib/types";
import {
  dateLabel,
  retrySource,
  useMutation,
  useResource,
  type MemoryData,
  type SourceRecord,
} from "../lib/workspace";
import { Recordings } from "./Recordings";

export function MutationStatus({
  mutation,
}: {
  mutation: {
    busy: boolean;
    error: string;
    retry: () => unknown;
    clear: () => void;
  };
}) {
  return (
    <>
      {mutation.busy && (
        <p role="status" className="notice">
          Saving to Coco…
        </p>
      )}
      {mutation.error && (
        <div className="notice error" role="alert">
          <p>
            {mutation.error} The last request may already be stored. Retry
            preserves its ID and content.
          </p>
          <div className="button-row">
            <button className="secondary" onClick={mutation.retry}>
              Retry same request
            </button>
            <button className="text-button" onClick={mutation.clear}>
              Start a different request
            </button>
          </div>
        </div>
      )}
    </>
  );
}
export function SourceDetails({ record }: { record: SourceRecord }) {
  return (
    <details className="source-details">
      <summary>Source record</summary>
      <dl>
        <dt>Source ID</dt>
        <dd>{record.id}</dd>
        <dt>Recorded</dt>
        <dd>{dateLabel(record.createdAt)}</dd>
        <dt>Author</dt>
        <dd>{record.ownerId}</dd>
        <dt>Graph projection</dt>
        <dd>{record.projection}</dd>
        <dt>Test record</dt>
        <dd>{record.data.isDemo === true ? "Yes" : "Not marked"}</dd>
      </dl>
    </details>
  );
}
export function MemoryWorkspace({
  state,
  openGraph,
}: {
  state: CocoState;
  openGraph: (id?: string, scope?: string) => void;
}) {
  const enabled = state.live && state.data.capabilities.personalMemory === true;
  const memory = useResource<MemoryData>(state.token, "/v1/memory", enabled);
  const [kind, setKind] = useState("note"),
    [text, setText] = useState(""),
    [sessionId, setSessionId] = useState(""),
    [personId, setPersonId] = useState(""),
    [topic, setTopic] = useState(""),
    [demo, setDemo] = useState(false),
    [saved, setSaved] = useState("");
  const mutation = useMutation<{ id: string; projection: string }>(
    state.token,
    (result) => {
      setSaved(
        `Saved to your private memory. Source ${result.id.slice(0, 10)} · ${result.projection}.`,
      );
      setText("");
      memory.refresh();
      void state.refreshGraphs();
    },
  );
  const available = enabled && !mutation.pending;
  return (
    <div className="memory-layout">
      <div className="memory-main">
        <section className="editor-paper">
          <span className="eyebrow">A NOTE FOR LATER</span>
          <h2>Keep the useful parts.</h2>
          <p>
            Save an idea or a conversation. Only you can read your personal
            memory.
          </p>
          {!enabled && (
            <p className="notice">
              {state.live
                ? "Personal memory is unavailable from this API."
                : "Connect your badge to save and read private notes."}
            </p>
          )}
          <form
            className="workspace-form"
            onSubmit={(e) => {
              e.preventDefault();
              setSaved("");
              void mutation.send({
                path: "/v1/memory",
                body: {
                  requestId: requestId(),
                  kind,
                  text: text.trim(),
                  ...(sessionId ? { sessionId } : {}),
                  ...(personId ? { personId } : {}),
                  topicIds: topic ? [topic] : [],
                  isDemo: demo,
                },
              });
            }}
          >
            <fieldset disabled={!available}>
              <div className="form-grid">
                <label>
                  Kind
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="note">Note</option>
                    <option value="insight">Insight</option>
                    <option value="attendance">I attended a session</option>
                  </select>
                </label>
                <label>
                  Session {kind === "attendance" ? "(required)" : "(optional)"}
                  <select
                    required={kind === "attendance"}
                    value={sessionId}
                    onChange={(e) => setSessionId(e.target.value)}
                  >
                    <option value="">Choose a session</option>
                    {state.data.sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Your note
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  required
                  maxLength={12000}
                  rows={4}
                  placeholder="What would you like to remember?"
                />
              </label>
              <div className="form-grid">
                <label>
                  Person (optional)
                  <select
                    value={personId}
                    onChange={(e) => setPersonId(e.target.value)}
                  >
                    <option value="">No person linked</option>
                    {state.data.people
                      .filter((p) => p.id !== state.data.me.personId)
                      .map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Topic (optional)
                  <select
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                  >
                    <option value="">No extra topic</option>
                    {Object.entries(topicNames).map(([id, name]) => (
                      <option key={id} value={`topic_${id}`}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <details className="source-details">
                <summary>Source options</summary>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={demo}
                    onChange={(e) => setDemo(e.target.checked)}
                  />
                  Test record
                </label>
              </details>
              {kind === "attendance" && (
                <p className="subtle">
                  This records your own attendance report. Adding a session to
                  your agenda does not.
                </p>
              )}
              <button className="primary" disabled={!text.trim()}>
                Save private note
              </button>
            </fieldset>
          </form>
          <MutationStatus mutation={mutation} />
          {saved && (
            <p className="notice" role="status">
              {saved}
            </p>
          )}
        </section>
        <Recordings
          state={state}
          onSaved={() => {
            memory.refresh();
            void state.refreshGraphs();
          }}
        />
        <section className="editor-paper">
          <div className="section-heading">
            <h2>Your memory</h2>
            <button
              className="secondary"
              disabled={!enabled || memory.loading}
              onClick={memory.refresh}
            >
              <RefreshCw size={14} />
              Refresh notes
            </button>
          </div>
          {memory.loading && <p role="status">Loading your memory…</p>}
          {memory.error && (
            <p role="alert" className="notice error">
              {memory.error}{" "}
              {memory.data ? "Showing the last loaded records." : ""}
            </p>
          )}
          {memory.data?.graphStatus === "unavailable" && (
            <p className="notice error">
              Memory retrieval is unavailable. This does not mean your history
              is empty. Pending sources remain below.
            </p>
          )}
          {memory.data?.pendingRecords.map((record) => (
            <article className="memory-entry pending" key={record.id}>
              <span className="badge amber">Waiting for graph projection</span>
              <p>
                {String(
                  record.data.text ?? "Source stored; graph write pending.",
                )}
              </p>
              <SourceDetails record={record} />
              {retrySource(record, state.data.me.personId) && (
                <button
                  className="secondary"
                  disabled={!!mutation.pending}
                  onClick={() =>
                    void mutation.send(
                      retrySource(record, state.data.me.personId)!,
                    )
                  }
                >
                  Retry pending note
                </button>
              )}
            </article>
          ))}
          {memory.data?.records.map((record) => (
            <article className="memory-entry" key={record.id}>
              <div className="entry-meta">
                <span className="badge">
                  {String(record.data.kind ?? "note")}
                </span>
                <time>{dateLabel(record.createdAt)}</time>
              </div>
              <p className="preserve-lines">{String(record.data.text ?? "")}</p>
              {typeof record.data.sessionId === "string" && (
                <p className="subtle">
                  {state.data.sessions.find(
                    (s) => s.id === record.data.sessionId,
                  )?.title ?? record.data.sessionId}
                </p>
              )}
              <SourceDetails record={record} />
              <button
                className="text-button"
                onClick={() => openGraph(record.id, "me")}
              >
                See its graph path
                <ArrowRight size={14} />
              </button>
            </article>
          ))}
          {memory.data?.graphStatus === "ready" &&
            !memory.data.records.length &&
            !memory.data.pendingRecords.length && (
              <p className="empty-copy">
                No notes saved yet. Start with one idea you want to keep.
              </p>
            )}
          {!!memory.data?.encounters.length && (
            <>
              <h3>Confirmed encounters</h3>
              {memory.data.encounters.map((e) => (
                <article className="memory-entry" key={e.id}>
                  <strong>{e.peer.name}</strong>
                  <p>{e.context || "No shared context returned."}</p>
                  <span className="subtle">
                    {dateLabel(e.at)} · {e.source}
                  </span>
                  <button
                    className="text-button"
                    onClick={() => openGraph(e.peer.id, "me")}
                  >
                    Explore connection
                    <ArrowRight size={14} />
                  </button>
                </article>
              ))}
            </>
          )}
        </section>
      </div>
      <aside className="memory-sidebar">
        <h3>From a note to a connection</h3>
        <p>
          Your source stays in private storage. FalkorDB connects it to the
          people, topics and sessions you select.
        </p>
        <p>
          Notes are append-only for now. Editing or deleting a saved note is
          unavailable.
        </p>
        <button
          className="text-button"
          onClick={() => openGraph(state.data.me.personId, "me")}
        >
          Explore my graph
          <ArrowRight size={16} />
        </button>
      </aside>
    </div>
  );
}
