import { useEffect, useRef, useState } from "react";
import { Mic, RefreshCw, Square } from "lucide-react";
import { request, requestId } from "../lib/api";
import { startCapture } from "../lib/audio";
import type { CocoState } from "../lib/useCoco";
import type { Job } from "../lib/types";
import {
  dateLabel,
  useMutation,
  useResource,
  type Clip,
} from "../lib/workspace";
import { MutationStatus } from "./MemoryWorkspace";

export function PrivateAudio({ token, id }: { token: string; id: string }) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const controller = useRef(new AbortController()),
    objectUrl = useRef("");
  useEffect(() => {
    controller.current = new AbortController();
    return () => {
      controller.current.abort();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, [token, id]);
  async function load() {
    setLoading(true);
    setError("");
    const signal = controller.current.signal;
    try {
      const blob = await request<Blob>(
        token,
        `/v1/recordings/${encodeURIComponent(id)}/audio`,
        { binary: true, signal },
      );
      if (!signal.aborted) {
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = URL.createObjectURL(blob);
        setUrl(objectUrl.current);
      }
    } catch (e) {
      if (!signal.aborted) setError((e as Error).message);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }
  return (
    <div className="private-audio">
      {url ? (
        <audio
          controls
          src={url}
          aria-label="Original recording"
          onError={() => setError("This browser could not play the recording.")}
        />
      ) : (
        <button
          className="secondary"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "Loading original audio…" : "Load original audio"}
        </button>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
    </div>
  );
}
export function Recordings({
  state,
  onSaved,
}: {
  state: CocoState;
  onSaved: () => void;
}) {
  const enabled = state.live && state.data.capabilities.shortRecording === true;
  const maxSeconds = Math.min(
    60,
    Math.max(1, Number(state.data.capabilities.maxRecordingSeconds) || 60),
  );
  const clips = useResource<{ recordings: Clip[] }>(
    state.token,
    "/v1/recordings",
    enabled,
  );
  const [recording, setRecording] = useState(false),
    [permission, setPermission] = useState(false),
    [seconds, setSeconds] = useState(0),
    [error, setError] = useState(""),
    [session, setSession] = useState(""),
    [jobId, setJobId] = useState("");
  const [draft, setDraft] = useState<{
    body: Blob;
    id: string;
    session: string;
  } | null>(null);
  const capture = useRef<Awaited<ReturnType<typeof startCapture>> | null>(null),
    alive = useRef(false),
    callback = useRef(onSaved);
  callback.current = onSaved;
  const mutation = useMutation<Job>(state.token, (job) => {
    setJobId(job.jobId);
    clips.refresh();
  });
  const job = useResource<Job>(state.token, `/v1/jobs/${jobId}`, !!jobId);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void capture.current?.cancel();
    };
  }, []);
  useEffect(() => {
    if (!recording) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);
  useEffect(() => {
    if (!jobId) return;
    if (job.data?.status === "completed") {
      setJobId("");
      setDraft(null);
      clips.refresh();
      callback.current();
      return;
    }
    if (job.data?.status === "failed") {
      clips.refresh();
      return;
    }
    const timer = setTimeout(job.refresh, job.error ? 8000 : 2000);
    return () => clearTimeout(timer);
  }, [jobId, job.data, job.error, job.refresh, clips.refresh]);
  useEffect(() => {
    if (
      !clips.data?.recordings.some((c) =>
        ["queued", "running"].includes(c.status),
      )
    )
      return;
    const timer = setTimeout(clips.refresh, 5000);
    return () => clearTimeout(timer);
  }, [clips.data, clips.refresh]);
  async function finish(save = true) {
    const active = capture.current;
    capture.current = null;
    setRecording(false);
    if (!active) return;
    try {
      const body = save ? await active.stop() : await active.cancel();
      if (body && alive.current) setDraft({ body, id: requestId(), session });
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  }
  async function record() {
    setPermission(true);
    setError("");
    try {
      const active = await startCapture(() => void finish(), maxSeconds);
      if (!alive.current) {
        await active.cancel();
        return;
      }
      capture.current = active;
      setRecording(true);
    } catch (e) {
      if (alive.current)
        setError(
          (e as Error).name === "NotAllowedError"
            ? "Microphone permission was denied. Allow it in browser settings, or write a note above."
            : (e as Error).message,
        );
    } finally {
      if (alive.current) setPermission(false);
    }
  }
  function upload() {
    if (!draft) return;
    setError("");
    void mutation.send({
      path: `/v1/recordings${draft.session ? `?sessionId=${encodeURIComponent(draft.session)}` : ""}`,
      body: draft.body,
      id: draft.id,
    });
  }
  const processing = !!jobId && job.data?.status !== "failed";
  return (
    <section className="editor-paper recording-workspace">
      <div className="section-heading">
        <h2>A short recording</h2>
        <span className="badge">Up to {maxSeconds} seconds</span>
      </div>
      <p>
        Capture with everyone's permission. Coco creates a private transcript
        and summary. Suggested actions remain text for you to review.
      </p>
      {!enabled && (
        <p className="notice">
          {state.live
            ? "Short recording is not enabled by the hosted API yet."
            : "Connect your badge to check recording availability."}{" "}
          Long session recording is unavailable.
        </p>
      )}
      <label className="form-label">
        Link to a session (optional)
        <select
          disabled={
            !enabled || recording || permission || !!draft || processing
          }
          value={session}
          onChange={(e) => setSession(e.target.value)}
        >
          <option value="">No session linked</option>
          {state.data.sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </label>
      {permission && (
        <p className="notice" role="status">
          Allow microphone access in your browser to begin.
        </p>
      )}
      {recording ? (
        <div className="recording-controls">
          <span className="record-light" />
          <strong role="status">
            Recording · {seconds}s / {maxSeconds}s
          </strong>
          <button className="secondary" onClick={() => void finish(false)}>
            Discard
          </button>
          <button className="primary" onClick={() => void finish()}>
            <Square size={14} />
            Stop recording
          </button>
        </div>
      ) : draft ? (
        <div className="notice">
          <div>
            <strong>
              {processing
                ? "Processing your recording…"
                : job.data?.status === "failed"
                  ? "Processing failed. Your original clip is still here."
                  : "Clip ready to save."}
            </strong>
            <p>
              {jobId
                ? `Job ${jobId.slice(0, 12)} · ${job.data?.status ?? "checking status"}`
                : "The clip stays in this tab until you save or discard it."}
            </p>
            <div className="button-row">
              <button
                className="primary"
                disabled={processing || !!mutation.pending}
                onClick={upload}
              >
                {job.data?.status === "failed"
                  ? "Retry same recording"
                  : "Save recording"}
              </button>
              <button
                className="secondary"
                disabled={processing || mutation.busy}
                onClick={() => {
                  setDraft(null);
                  setJobId("");
                  mutation.clear();
                }}
              >
                Discard local clip
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          className="secondary"
          disabled={!enabled || permission}
          onClick={() => void record()}
        >
          <Mic size={16} />
          Start recording
        </button>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <MutationStatus mutation={mutation} />
      {job.error && (
        <p className="notice error" role="alert">
          {job.error} Still checking the same job.
        </p>
      )}
      {job.data?.error && (
        <p className="notice error">{job.data.error.message}</p>
      )}
      <div className="section-heading">
        <h3>Saved recordings</h3>
        <button
          className="text-button"
          disabled={!enabled || clips.loading}
          onClick={clips.refresh}
        >
          <RefreshCw size={14} />
          Refresh recordings
        </button>
      </div>
      {clips.loading && !clips.data && <p role="status">Loading recordings…</p>}
      {clips.error && (
        <p className="notice error" role="alert">
          {clips.error}{" "}
          {clips.data ? "Showing the last loaded recordings." : ""}
        </p>
      )}
      {clips.data?.recordings.map((clip) => (
        <article key={clip.id} className="memory-entry">
          <div className="entry-meta">
            <span className="badge">{clip.status}</span>
            <time>{dateLabel(clip.createdAt)}</time>
          </div>
          <h3>{clip.result?.summary?.title ?? "Private recording"}</h3>
          {clip.sessionId && (
            <p className="subtle">
              {state.data.sessions.find((s) => s.id === clip.sessionId)
                ?.title ?? clip.sessionId}
            </p>
          )}
          {clip.error && <p className="notice error">{clip.error.message}</p>}
          {clip.result?.summary && (
            <>
              <p className="preserve-lines">{clip.result.summary.summary}</p>
              <span className="badge amber">
                Generated summary · review against the source
              </span>
              {clip.result.summary.keyPoints.length > 0 && (
                <>
                  <h4>Key points</h4>
                  {clip.result.summary.keyPoints.map((point, i) => (
                    <div key={i} className="quoted-point">
                      <p>{point.text}</p>
                      <blockquote>{point.quote}</blockquote>
                    </div>
                  ))}
                </>
              )}
              {clip.result.summary.suggestedActionItems.length > 0 && (
                <>
                  <h4>Suggested actions · not executed</h4>
                  {clip.result.summary.suggestedActionItems.map((point, i) => (
                    <div key={i} className="quoted-point">
                      <p>{point.text}</p>
                      <blockquote>{point.quote}</blockquote>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
          {clip.result?.transcript && (
            <details className="source-details">
              <summary>Review generated transcript</summary>
              <p className="preserve-lines">{clip.result.transcript}</p>
            </details>
          )}
          {clip.audioPath && <PrivateAudio token={state.token} id={clip.id} />}
          <details className="source-details">
            <summary>Recording source</summary>
            <p>Recording: {clip.id}</p>
            <p>Memory: {clip.result?.memoryId ?? "Not yet available"}</p>
            <p>
              Actions executed:{" "}
              {clip.result?.actionsExecuted === false
                ? "No"
                : clip.result?.actionsExecuted === true
                  ? "Yes, as reported by API"
                  : "Not returned"}
            </p>
          </details>
        </article>
      ))}
      {enabled && clips.data && !clips.data.recordings.length && (
        <p className="empty-copy">No recordings saved yet.</p>
      )}
    </section>
  );
}
