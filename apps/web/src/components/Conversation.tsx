import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Mic,
  Square,
  Volume2,
  VolumeX,
  X,
  LoaderCircle,
  ChevronDown,
  Network,
} from "lucide-react";
import { Coco } from "./Coco";
import { startCapture } from "../lib/audio";
import type { CocoState } from "../lib/useCoco";
import { answerGraph, safeTrace } from "../lib/evidence";
import type { Graph, Turn } from "../lib/types";
import { userMessage } from "../lib/incomingJobs";
import { MeetingProposal } from "./MeetingProposal";
export function Conversation({
  state,
  onConnect,
  onEvidence,
  onGraph,
}: {
  state: CocoState;
  onConnect: () => void;
  onEvidence: (graph: Graph) => void;
  onGraph: (scope: string) => void;
}) {
  const [text, setText] = useState(""),
    [recording, setRecording] = useState(false),
    [permission, setPermission] = useState(false),
    [error, setError] = useState(""),
    [seconds, setSeconds] = useState(0);
  const capture = useRef<Awaited<ReturnType<typeof startCapture>> | null>(null),
    cancelled = useRef(false),
    end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
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
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state.turns.at(-1)?.job?.status, state.turns.length]);
  const finish = async (save = true) => {
    const current = capture.current;
    capture.current = null;
    setRecording(false);
    if (!current) return;
    try {
      const wav = save ? await current.stop() : await current.cancel();
      if (wav && !cancelled.current) await state.submit("Voice request", wav);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const record = async () => {
    if (!state.canVoice) {
      onConnect();
      return;
    }
    state.replyAudio.stop();
    setError("");
    setPermission(true);
    try {
      const active = await startCapture(() => void finish());
      if (cancelled.current) {
        await active.cancel();
        return;
      }
      capture.current = active;
      setRecording(true);
    } catch (e) {
      setError(
        (e as Error).name === "NotAllowedError"
          ? "Microphone access was denied. Enable it in your browser settings, or type below."
          : (e as Error).message,
      );
    } finally {
      if (!cancelled.current) setPermission(false);
    }
  };
  const send = () => {
    if (!state.canChat) {
      onConnect();
      return;
    }
    if (!text.trim() || state.busy) return;
    void state.submit(text.trim());
    setText("");
  };
  return (
    <section className="conversation" aria-label="Talk to Coco">
      <div className="conversation-head">
        <Coco
          small
          state={recording ? "listening" : state.busy ? "thinking" : "idle"}
        />
        <div>
          <h2>Ask Coco</h2>
          <span className="subtle">
            {recording
              ? "Listening to you"
              : state.busy
                ? "Working on your request"
                : "Your little conference companion"}
          </span>
        </div>
        <span className={`status-dot ${state.live ? "online" : ""}`} />
      </div>
      <div className="reply-voice-controls">
        <button
          className="text-button"
          aria-pressed={state.replyAudio.muted}
          onClick={state.replyAudio.toggleMute}
        >
          {state.replyAudio.muted ? (
            <VolumeX size={15} />
          ) : (
            <Volume2 size={15} />
          )}
          {state.replyAudio.muted ? "Voice muted" : "Voice on"}
        </button>
        {["loading", "playing"].includes(state.replyAudio.playback.status) && (
          <button className="text-button" onClick={state.replyAudio.stop}>
            <Square size={14} /> Stop speaking
          </button>
        )}
      </div>
      <div className="conversation-scroll" aria-live="polite">
        {!state.turns.length ? (
          <div className="conversation-welcome">
            <p>
              More good conversations.
              <br />
              Less figuring out where to go.
            </p>
            <span>
              Ask about your next session, find a coffee buddy, or explore a
              connection.
            </span>
            <div className="suggestions">
              {[
                "What session should I go to next?",
                "Who shares my interests?",
              ].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() =>
                    state.canChat ? void state.submit(prompt) : onConnect()
                  }
                  disabled={state.busy || (state.live && !state.canChat)}
                >
                  {prompt}
                  <ArrowUp size={15} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          state.turns.map((turn) => (
            <TurnView
              key={turn.requestId}
              turn={turn}
              voice={state.replyAudio}
              account={{
                token: state.token,
                personId: state.data.me.personId,
                allowed: state.live && !state.demo,
              }}
              onEvidence={onEvidence}
              onGraph={onGraph}
              retry={() => void state.submit(turn.prompt, turn.body, turn)}
            />
          ))
        )}
        <div ref={end} />
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {state.live && !state.canChat && (
        <p className="notice">
          Chat is not enabled for this session. Explore the conference graph or
          connect your own account.
          <button className="text-button" onClick={onConnect}>
            Account connection
          </button>
        </p>
      )}
      {permission && (
        <p className="notice" role="status">
          Allow microphone access in your browser to start a voice turn.
        </p>
      )}
      {recording ? (
        <div className="recording-controls">
          <span className="record-light" />
          <strong>Listening · {seconds}s / 15s</strong>
          <button
            className="icon-button"
            aria-label="Discard recording"
            onClick={() => void finish(false)}
          >
            <X size={18} />
          </button>
          <button className="primary" onClick={() => void finish()}>
            <Square size={14} />
            Send voice
          </button>
        </div>
      ) : (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <button
            type="button"
            className="mic-button"
            aria-label="Start voice request"
            disabled={
              state.busy ||
              permission ||
              (state.live && !state.canVoice) ||
              state.data.capabilities.voice === false
            }
            onClick={() => void record()}
          >
            <Mic size={20} />
          </button>
          <input
            aria-label="Message Coco"
            placeholder="Ask Coco anything about your day…"
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={recording || (state.live && !state.canChat)}
          />
          <button
            className="send-button"
            type="submit"
            aria-label="Send message"
            disabled={
              !text.trim() || state.busy || (state.live && !state.canChat)
            }
          >
            <ArrowUp size={20} />
          </button>
        </form>
      )}
      <p className="composer-note">
        {state.live && !state.canChat
          ? "Guest access · no chat or private account actions"
          : state.live
            ? "Tap the mic to start, then send. Up to 15 seconds. AI-generated voice."
            : "Preview only. Choose a profile to check available features."}
      </p>
    </section>
  );
}
function TurnView({
  turn,
  voice,
  account,
  retry,
  onEvidence,
  onGraph,
}: {
  turn: Turn;
  voice: CocoState["replyAudio"];
  account: { token: string; personId: string; allowed: boolean };
  retry: () => void;
  onEvidence: (graph: Graph) => void;
  onGraph: (scope: string) => void;
}) {
  const playback =
    voice.playback.id === turn.requestId ? voice.playback : undefined;
  const result = turn.job?.result;
  const prompt = userMessage(turn);
  const evidence = answerGraph(result?.trace, result?.graphEvidence);
  const graphTools =
    result?.trace?.filter(
      (entry) =>
        entry.status === "completed" &&
        [
          "recommend_sessions",
          "find_introductions",
          "my_memory",
          "company_crm",
        ].includes(entry.tool),
    ) ?? [];
  return (
    <article className="turn">
      {prompt !== undefined && <p className="user-message">{prompt}</p>}
      {prompt === undefined && (
        <span className="eyebrow">A note from Coco</span>
      )}
      {turn.pending ||
      (!turn.pollStopped &&
        turn.job &&
        ["queued", "running"].includes(turn.job.status)) ? (
        <p className="thinking">
          <LoaderCircle size={16} />
          {turn.pending
            ? "Sending your request…"
            : turn.job?.status === "queued"
              ? "Queued with Coco…"
              : "Coco is thinking…"}
          {Date.now() - turn.createdAt > 30000 && (
            <span>This is taking longer. Your request is still active.</span>
          )}
        </p>
      ) : null}
      {turn.error && (
        <div className="notice error" role="alert">
          {turn.error}
          {!turn.origin && !turn.requestId.startsWith("badge_") && (
            <button onClick={retry}>Retry same request</button>
          )}
        </div>
      )}
      {turn.job?.status === "failed" && (
        <p className="notice error">
          {turn.job.error?.message ?? "Coco could not finish this turn."} You
          can send a new request.
        </p>
      )}
      {result?.text && <p className="coco-message">{result.text}</p>}
      {result?.meeting && (
        <MeetingProposal reply={result.meeting} {...account} />
      )}
      {evidence && (
        <div className="answer-evidence">
          <span>
            FalkorDB · evidence used this turn · {evidence.nodes.length} records
            · {evidence.edges.length} connections
            {evidence.partial ? " · partial evidence" : ""}
          </span>
          <button className="text-button" onClick={() => onEvidence(evidence)}>
            <Network size={15} />
            Explore evidence from this turn
          </button>
        </div>
      )}
      {!evidence && graphTools.length > 0 && (
        <div className="answer-evidence">
          <span>
            Queried FalkorDB ·{" "}
            {graphTools.map((t) => t.tool.replaceAll("_", " ")).join(", ")}
          </span>
          <p>The exact graph paths are unavailable in this response.</p>
          <button
            className="text-button"
            onClick={() =>
              onGraph(
                graphTools.some((t) => t.tool === "company_crm")
                  ? "company"
                  : "me",
              )
            }
          >
            <Network size={15} />
            Explore the live graph
          </button>
        </div>
      )}
      {result?.audioId && (
        <div className="audio-reply">
          <button
            className="text-button"
            disabled={voice.muted || playback?.status === "loading"}
            onClick={() =>
              playback?.status === "playing"
                ? voice.stop()
                : voice.play({ id: turn.requestId, audioId: result.audioId! })
            }
          >
            <Volume2 size={16} />
            {playback?.status === "loading"
              ? "Loading audio…"
              : playback?.status === "playing"
                ? "Stop speaking"
                : "Hear Coco"}
          </button>
        </div>
      )}
      {(playback?.error || result?.audioError) && (
        <p className="subtle" role="status">
          {playback?.error || result?.audioError}
        </p>
      )}
      {turn.job && (
        <details className="trace">
          <summary>
            Job {turn.job.jobId.slice(0, 8)} · {turn.job.status}
            <ChevronDown size={13} />
          </summary>
          <p className="mono">{turn.job.jobId}</p>
          {result?.trace?.map((entry, i) => (
            <div key={i}>
              <strong>{entry.tool}</strong> <span>{entry.status}</span>
              {entry.output && (
                <pre>{JSON.stringify(safeTrace(entry.output), null, 2)}</pre>
              )}
            </div>
          ))}
        </details>
      )}
    </article>
  );
}
