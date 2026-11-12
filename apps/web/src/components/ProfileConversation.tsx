import { useEffect, useRef, useState } from "react";
import { ArrowUp, Mic, Square, X } from "lucide-react";
import { request } from "../lib/api";
import { startCapture } from "../lib/audio";
import type { Registration } from "../lib/access";
import { Coco } from "./Coco";

export function ProfileConversation({
  available,
  draft,
  disabled,
  onDraft,
  onBusy,
}: {
  available: boolean;
  draft: Registration;
  disabled: boolean;
  onDraft: (draft: Partial<Registration>) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [reply, setReply] = useState(
    "Tell me your name, what you work on and the kinds of events you want to attend. You can add your email and LinkedIn URL below.",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [permission, setPermission] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [audioUrl, setAudioUrl] = useState("");
  const current = useRef(draft);
  current.current = draft;
  const capture = useRef<Awaited<ReturnType<typeof startCapture>> | null>(null);
  const controller = useRef(new AbortController());
  useEffect(() => {
    controller.current = new AbortController();
    return () => {
      controller.current.abort();
      void capture.current?.cancel();
    };
  }, []);
  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );
  useEffect(() => {
    onBusy(busy || recording || permission);
    return () => onBusy(false);
  }, [busy, recording, permission, onBusy]);
  useEffect(() => {
    if (!recording) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);
  async function understand(value: string, speak = false) {
    const result = await request<{
      draft: Partial<Registration>;
      reply: string;
      missingFields: string[];
      audio?: { mimeType: string; base64: string };
    }>("", "/v1/demo/onboarding/text", {
      method: "POST",
      body: { text: value, draft: current.current, speak },
      signal: controller.current.signal,
      retry: false,
    });
    if (controller.current.signal.aborted) return;
    onDraft(result.draft);
    setReply(result.reply);
    setText("");
    if (result.audio?.mimeType === "audio/wav") {
      const bytes = Uint8Array.from(atob(result.audio.base64), (c) =>
        c.charCodeAt(0),
      );
      setAudioUrl(
        URL.createObjectURL(new Blob([bytes], { type: "audio/wav" })),
      );
    }
  }
  async function send() {
    if (!available || !text.trim() || busy || disabled) return;
    setBusy(true);
    setError("");
    setAudioUrl("");
    try {
      await understand(text.trim());
    } catch (e) {
      if (!controller.current.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.current.signal.aborted) setBusy(false);
    }
  }
  async function finish(save = true) {
    const active = capture.current;
    capture.current = null;
    setRecording(false);
    if (!active) return;
    setBusy(save);
    try {
      const wav = save ? await active.stop() : await active.cancel();
      if (!wav || controller.current.signal.aborted) return;
      const result = await request<{ transcript: string }>(
        "",
        "/v1/demo/onboarding/voice",
        {
          method: "POST",
          body: wav,
          signal: controller.current.signal,
          retry: false,
        },
      );
      if (controller.current.signal.aborted) return;
      setText(result.transcript);
      await understand(result.transcript, true);
    } catch (e) {
      if (!controller.current.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.current.signal.aborted) setBusy(false);
    }
  }
  async function record() {
    if (!available || busy || disabled) return;
    setError("");
    setAudioUrl("");
    setPermission(true);
    try {
      const active = await startCapture(() => void finish(), 30);
      if (controller.current.signal.aborted) {
        await active.cancel();
        return;
      }
      capture.current = active;
      setRecording(true);
    } catch (e) {
      if (!controller.current.signal.aborted)
        setError(
          (e as Error).name === "NotAllowedError"
            ? "Microphone access was denied. You can type below or fill in your profile."
            : (e as Error).message,
        );
    } finally {
      if (!controller.current.signal.aborted) setPermission(false);
    }
  }
  return (
    <section
      className="profile-conversation"
      aria-label="Create a profile with Coco"
    >
      <div className="conversation-head">
        <Coco
          small
          state={recording ? "listening" : busy ? "thinking" : "idle"}
        />
        <div>
          <h3>Tell Coco about yourself.</h3>
          <span className="subtle">
            Talk or type, then review your profile below.
          </span>
        </div>
      </div>
      <p className="coco-profile-reply" aria-live="polite">
        {reply}
      </p>
      {audioUrl && (
        <div>
          <audio controls autoPlay src={audioUrl} />
          <p className="subtle">Coco’s AI-generated voice</p>
        </div>
      )}
      {recording ? (
        <div className="recording-controls">
          <span role="status">Listening · {seconds}s / 30s</span>
          <button className="secondary" onClick={() => void finish()}>
            <Square size={15} />
            Use recording
          </button>
          <button
            className="icon-button"
            aria-label="Discard profile recording"
            onClick={() => void finish(false)}
          >
            <X size={17} />
          </button>
        </div>
      ) : (
        <>
          <button
            className="secondary"
            disabled={!available || disabled || busy || permission}
            onClick={() => void record()}
          >
            <Mic size={16} />
            {permission ? "Allow microphone access…" : "Talk to Coco"}
          </button>
          <label className="form-label" htmlFor="profile-message">
            Or type a message
          </label>
          <textarea
            id="profile-message"
            rows={3}
            maxLength={4000}
            value={text}
            disabled={!available || disabled || busy || permission}
            placeholder="I’m Sam. I build voice agents and want to meet people working on accessible design…"
            onChange={(e) => setText(e.target.value)}
          />
          <button
            className="text-button"
            disabled={
              !available || disabled || busy || permission || !text.trim()
            }
            onClick={() => void send()}
          >
            Fill my profile
            <ArrowUp size={15} />
          </button>
        </>
      )}
      {busy && <p role="status">Coco is filling your profile…</p>}
      {!available && (
        <p className="notice">
          Conversational signup is unavailable right now. You can fill in your
          profile below.
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error} You can continue with the form below.
        </p>
      )}
      <p className="subtle">
        Your profile is created only after you review the details and select
        Create my profile.
      </p>
    </section>
  );
}
