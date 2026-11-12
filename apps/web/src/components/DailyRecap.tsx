import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Copy, RefreshCw } from "lucide-react";
import { ApiError, request, requestId } from "../lib/api";
import {
  newestRecaps,
  recapReview,
  recapReviewKey,
  writeRecap,
  type RecapCreation,
  type RecapDraft,
  type RecapList,
} from "../lib/recaps";
import type { Graph } from "../lib/types";
import type { CocoState } from "../lib/useCoco";
import { dateLabel } from "../lib/workspace";
import { RecapPublishing } from "./RecapPublishing";
import { RecapSchedule } from "./RecapSchedule";
import { SourceProvenance } from "./SourceProvenance";

export function DailyRecap({
  state,
  openSourceGraph,
}: {
  state: CocoState;
  openSourceGraph: (graph: Graph, id: string) => void;
}) {
  if (!state.live || state.demo || state.data.capabilities.recaps !== true) {
    return (
      <section className="editor-paper editorial">
        <span className="eyebrow">DAILY RECAP</span>
        <h2>A day worth writing about.</h2>
        <p>
          Your recap draws on your saved notes and confirmed encounters. Review
          the sources and edit the words before approving a version.
        </p>
        <p className="notice">
          {!state.live || state.demo
            ? "Connect your own account to use private daily recaps."
            : "Daily recaps are unavailable right now."}
        </p>
        <button className="secondary" disabled>
          Draft my day
        </button>
        <p className="subtle">Publishing is unavailable.</p>
      </section>
    );
  }
  return (
    <RecapWorkspace
      key={`${state.token}:${state.data.me.personId}`}
      token={state.token}
      ownerId={state.data.me.personId}
      publishEnabled={
        state.data.capabilities.recapsPublishing === true &&
        state.data.me.personId === "person_maya"
      }
      openSourceGraph={openSourceGraph}
    />
  );
}

function RecapWorkspace({
  token,
  ownerId,
  publishEnabled,
  openSourceGraph,
}: {
  token: string;
  ownerId: string;
  publishEnabled: boolean;
  openSourceGraph: (graph: Graph, id: string) => void;
}) {
  const [drafts, setDrafts] = useState<RecapDraft[]>([]);
  const [active, setActive] = useState<RecapDraft>();
  const [text, setText] = useState("");
  const [instructions, setInstructions] = useState("");
  const [pendingCreate, setPendingCreate] = useState<RecapCreation>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [publishAvailable, setPublishAvailable] = useState(false);
  const [mustReload, setMustReload] = useState(false);
  const [recoveredText, setRecoveredText] = useState("");
  const controller = useRef(new AbortController());
  const locked = useRef(false);
  const dirty = !!active && text !== active.text;
  const latest = drafts.find((d) => d.id === active?.id);
  const changedElsewhere =
    !!active &&
    !!latest &&
    (recapReviewKey(active) !== recapReviewKey(latest) ||
      active.updatedAt !== latest.updatedAt ||
      active.status !== latest.status);

  function select(draft: RecapDraft | undefined) {
    setActive(draft);
    setText(draft?.text ?? "");
    setMustReload(false);
    setNotice("");
    setError("");
  }
  function remember(draft: RecapDraft) {
    setDrafts((values) =>
      newestRecaps([draft, ...values.filter((d) => d.id !== draft.id)]),
    );
    select(draft);
  }
  useEffect(() => {
    const initial = new AbortController();
    controller.current = initial;
    setBusy("Loading your recaps…");
    request<RecapList>(token, "/v1/recaps", {
      signal: initial.signal,
      retry: false,
    })
      .then((data) => {
        if (initial.signal.aborted) return;
        setDrafts(newestRecaps(data.drafts));
        setPublishAvailable(data.publishAvailable === true);
        select(newestRecaps(data.drafts)[0]);
        setLoaded(true);
      })
      .catch((e) => {
        if (!initial.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!initial.signal.aborted) setBusy("");
      });
    return () => initial.abort();
  }, [token]);

  async function run(
    label: string,
    action: (signal: AbortSignal) => Promise<void>,
  ) {
    if (locked.current || busy) return;
    locked.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action(controller.current.signal);
    } finally {
      locked.current = false;
      if (!controller.current.signal.aborted) setBusy("");
    }
  }
  async function refresh(reloadCurrent = false) {
    await run("Loading your recaps…", async (signal) => {
      try {
        const data = await request<RecapList>(token, "/v1/recaps", {
          signal,
          retry: false,
        });
        if (signal.aborted) return;
        setDrafts(newestRecaps(data.drafts));
        setPublishAvailable(data.publishAvailable === true);
        setLoaded(true);
        if (reloadCurrent && active) {
          const updated = data.drafts.find((d) => d.id === active.id);
          if (!updated) {
            setMustReload(true);
            setError(
              "This draft is no longer available. Your text is still here to copy.",
            );
            return;
          }
          if (dirty) setRecoveredText(text);
          select(updated);
          setNotice(
            dirty
              ? "Loaded the saved version. Your unsaved text is kept below."
              : "Loaded the latest saved version. Review it before approval.",
          );
        } else if (!active) select(newestRecaps(data.drafts)[0]);
      } catch (e) {
        if (!signal.aborted)
          setError(
            `${(e as Error).message}${loaded ? " Showing the last loaded drafts." : ""}`,
          );
      }
    });
  }
  async function create() {
    const body = pendingCreate ?? {
      requestId: requestId(),
      ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
    };
    await run("Writing from your saved memories…", async (signal) => {
      setPendingCreate(body);
      try {
        const draft = await writeRecap(token, { kind: "create", body }, signal);
        if (signal.aborted) return;
        remember(draft);
        setPendingCreate(undefined);
        setLoaded(true);
        setNotice(
          "Draft ready. Review the text and sources before approving it.",
        );
      } catch (e) {
        if (signal.aborted) return;
        const definite =
          e instanceof ApiError &&
          e.status >= 400 &&
          e.status < 500 &&
          e.status !== 408 &&
          e.status !== 429 &&
          e.code !== "RECAP_BUSY";
        if (definite) setPendingCreate(undefined);
        setError(
          `${(e as Error).message}${definite ? "" : " The draft may have been saved. Retrying uses the same request."}`,
        );
      }
    });
  }
  async function save(action: "edit" | "approve" | "decline") {
    const approve = action === "approve";
    if (
      !active ||
      mustReload ||
      changedElsewhere ||
      (action !== "edit" && dirty)
    )
      return;
    await run(
      approve
        ? "Approving this version…"
        : action === "decline"
          ? "Keeping this recap private…"
          : "Saving a new version…",
      async (signal) => {
        try {
          const draft = await writeRecap(
            token,
            action !== "edit"
              ? { kind: action, id: active.id, ...recapReview(active) }
              : {
                  kind: "edit",
                  id: active.id,
                  revision: active.revision,
                  text,
                },
            signal,
          );
          if (signal.aborted) return;
          remember(draft);
          setNotice(
            approve
              ? `Version ${draft.revision} approved. Nothing has been published.`
              : action === "decline"
                ? "Posting declined. Your recap stays private."
                : `Version ${draft.revision} saved. Review and approve this version when ready.`,
          );
        } catch (e) {
          if (signal.aborted) return;
          setMustReload(true);
          setError(
            e instanceof ApiError && e.status === 409
              ? "This draft changed elsewhere. Reload the saved version before editing or approving it. Your text will be kept below."
              : `${(e as Error).message} Reload the saved version to check whether the change was stored. Your text will be kept below.`,
          );
        }
      },
    );
  }
  async function openSource(id: string) {
    if (dirty) return;
    await run("Loading this source’s graph…", async (signal) => {
      try {
        const graph = await request<Graph>(token, "/v1/graph?view=me", {
          signal,
          retry: false,
        });
        if (signal.aborted) return;
        const node = graph.nodes.find(
          (n) => n.id === id || n.properties.id === id,
        );
        if (!node) {
          setNotice(
            "This source is not available in your graph yet. Its saved text is still available below.",
          );
          return;
        }
        openSourceGraph(graph, node.id);
      } catch (e) {
        if (!signal.aborted)
          setError(
            "Could not load this source’s graph. " + (e as Error).message,
          );
      }
    });
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      if (!controller.current.signal.aborted) setNotice("Text copied.");
    } catch {
      if (!controller.current.signal.aborted)
        setNotice(
          "Copy is unavailable in this browser. Select the text and copy it manually.",
        );
    }
  }
  const blocked = !!busy || mustReload || changedElsewhere;
  return (
    <section className="editor-paper recap-workspace" aria-label="Daily recap">
      <div className="section-heading">
        <span className="eyebrow">DAILY RECAP</span>
        <button
          className="text-button"
          disabled={!!busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} />
          Refresh drafts
        </button>
      </div>
      <h2>A day worth writing about.</h2>
      <p>
        Start with your saved notes and confirmed encounters. Review the
        sources, make it sound like you, then approve a version.
      </p>
      <form
        className="workspace-form recap-create"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label>
          What should the recap focus on? (optional)
          <textarea
            rows={2}
            value={instructions}
            maxLength={1000}
            placeholder="An idea that stayed with you, or a conversation you want to remember…"
            disabled={!!busy || !!pendingCreate}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </label>
        <button className="secondary" disabled={!!busy || dirty || !loaded}>
          {pendingCreate ? "Retry draft request" : "Draft my day"}
        </button>
        {dirty && (
          <p className="subtle">
            Save or discard your edits before starting another draft.
          </p>
        )}
      </form>
      {busy && (
        <p className="notice" role="status">
          {busy}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {loaded && !drafts.length && !active && (
        <p className="empty-copy">
          No recap yet. Draft your day when you have a few memories to draw on.
        </p>
      )}
      {!!drafts.length && (
        <label className="form-label recap-picker">
          Saved recaps
          <select
            value={active?.id ?? ""}
            disabled={!!busy || dirty}
            onChange={(e) =>
              select(drafts.find((d) => d.id === e.target.value))
            }
          >
            {drafts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.day || dateLabel(d.createdAt)} · Version {d.revision} ·{" "}
                {d.status === "approved" ? "Approved" : "Needs review"}
              </option>
            ))}
          </select>
        </label>
      )}
      {active && (
        <>
          <div className="recap-version">
            <span className="badge">Version {active.revision}</span>
            <span
              className={`badge ${dirty || active.status !== "approved" ? "amber" : ""}`}
            >
              {dirty
                ? "Unsaved edits"
                : active.status === "approved"
                  ? "Approved"
                  : "Needs review"}
            </span>
            {!publishEnabled && <span className="subtle">Not published</span>}
            {active.postDecision === "declined" && !dirty && (
              <span className="badge">Posting declined</span>
            )}
          </div>
          {(mustReload || changedElsewhere) && (
            <div className="notice">
              {changedElsewhere && (
                <p>
                  A newer saved version is available. Review it before making
                  another change.
                </p>
              )}
              <button
                className="secondary"
                disabled={!!busy}
                onClick={() => void refresh(true)}
              >
                Reload saved version
              </button>
            </div>
          )}
          <label className="form-label" htmlFor="recap-text">
            Recap text
          </label>
          <textarea
            id="recap-text"
            className="recap-text"
            rows={12}
            value={text}
            disabled={!!busy}
            maxLength={2200}
            onChange={(e) => {
              setText(e.target.value);
              setNotice("");
            }}
          />
          <div className="draft-meta">
            <span>Updated {dateLabel(active.updatedAt)}</span>
            {active.edited && <span>Edited by you</span>}
            {active.approvedAt && !dirty && active.status === "approved" && (
              <span>Approved {dateLabel(active.approvedAt)}</span>
            )}
          </div>
          {dirty && (
            <p className="subtle">
              Saving creates a new version and clears the previous approval.
            </p>
          )}
          <div className="button-row recap-actions">
            <button
              className="secondary"
              disabled={blocked || !dirty || !text.trim()}
              onClick={() => void save("edit")}
            >
              Save new version
            </button>
            <button
              className="primary"
              disabled={blocked || dirty || active.status === "approved"}
              onClick={() => void save("approve")}
            >
              <Check size={15} />
              Approve version {active.revision}
            </button>
            <button
              className="secondary"
              disabled={!text.trim()}
              onClick={() => void copy(text)}
            >
              <Copy size={15} />
              Copy text
            </button>
            {dirty && (
              <button
                className="text-button"
                disabled={!!busy}
                onClick={() => {
                  setText(active.text);
                  setNotice("Unsaved edits discarded.");
                }}
              >
                Discard edits
              </button>
            )}
          </div>
          <RecapPublishing
            key={recapReviewKey(active)}
            token={token}
            ownerId={ownerId}
            draft={active}
            available={publishEnabled && publishAvailable}
            disabled={blocked || dirty}
            onDecline={() => void save("decline")}
            onBusy={(value) => setBusy(value ? "Checking publication…" : "")}
            onConflict={() => {
              setMustReload(true);
              setError(
                "This draft changed before posting. Reload the saved version and review it again.",
              );
            }}
          />
          {active.projection === "pending" && (
            <p className="notice">
              Your draft is saved. Its graph connections are still updating.
            </p>
          )}
          <section className="recap-evidence" aria-label="Recap sources">
            <h3>What this draft draws on</h3>
            <p className="subtle">
              These sources came with the draft. Your edits may add claims they
              do not support.
            </p>
            {!active.sources.length && (
              <p>No source records were returned for this draft.</p>
            )}
            {active.sources.map((source, index) => (
              <article className="recap-source" key={source.id}>
                <div className="entry-meta">
                  <strong>
                    {index + 1}.{" "}
                    {source.kind === "Encounter"
                      ? "Confirmed encounter"
                      : "Saved memory"}
                  </strong>
                  <time>{dateLabel(source.at)}</time>
                </div>
                <SourceProvenance
                  properties={{ source: source.kind, isDemo: source.isDemo }}
                />
                {active.citations
                  .filter((c) => c.sourceId === source.id)
                  .map((citation, n) => (
                    <blockquote key={n}>{citation.quote}</blockquote>
                  ))}
                <details className="source-details">
                  <summary>Read full source</summary>
                  <p className="preserve-lines">{source.text}</p>
                  <p className="subtle">Source {source.id}</p>
                </details>
                <button
                  className="text-button"
                  disabled={dirty || !!busy}
                  onClick={() => void openSource(source.id)}
                >
                  See in my graph
                  <ArrowRight size={14} />
                </button>
              </article>
            ))}
            {active.citations
              .filter((c) => !active.sources.some((s) => s.id === c.sourceId))
              .map((citation, index) => (
                <article className="recap-source" key={`missing-${index}`}>
                  <span className="badge amber">Source unavailable</span>
                  <blockquote>{citation.quote}</blockquote>
                  <p className="subtle">
                    The draft cites {citation.sourceId}, but its source record
                    was not returned.
                  </p>
                </article>
              ))}
          </section>
        </>
      )}
      <RecapSchedule token={token} />
      {recoveredText && (
        <details className="recap-recovery" open>
          <summary>Your unsaved text before reload</summary>
          <textarea
            aria-label="Recovered unsaved text"
            readOnly
            rows={5}
            value={recoveredText}
          />
          <button
            className="text-button"
            onClick={() => void copy(recoveredText)}
          >
            <Copy size={14} />
            Copy unsaved text
          </button>
          <button className="text-button" onClick={() => setRecoveredText("")}>
            Dismiss saved copy
          </button>
        </details>
      )}
    </section>
  );
}
