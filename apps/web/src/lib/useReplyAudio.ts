import { useEffect, useRef, useState } from "react";
import { request } from "./api";
import { ReplyPlayer, type Playback, type SpokenReply } from "./replyPlayer";
import type { Turn } from "./types";

export function useReplyAudio(token: string, turns: Turn[]) {
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem("coco-voice-muted") === "true";
    } catch {
      return false;
    }
  });
  const [playback, setPlayback] = useState<Playback>({ status: "idle" });
  const player = useRef<ReplyPlayer | undefined>(undefined);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  useEffect(() => {
    const current = new ReplyPlayer(
      new Audio(),
      async (reply, signal) => {
        const blob = await request<Blob>(
          token,
          `/v1/audio/${encodeURIComponent(reply.audioId)}`,
          { binary: true, signal, retry: false },
        );
        return URL.createObjectURL(blob);
      },
      setPlayback,
      URL.revokeObjectURL,
    );
    current.setMuted(mutedRef.current);
    player.current = current;
    return () => {
      current.dispose();
      player.current = undefined;
    };
  }, [token]);
  useEffect(() => {
    if (!token) return;
    for (const turn of [...turns].sort((a, b) => a.createdAt - b.createdAt)) {
      if (turn.job?.status === "completed" && turn.job.result?.audioId)
        player.current?.enqueue({
          id: turn.requestId,
          audioId: turn.job.result.audioId,
        });
    }
  }, [token, turns]);
  return {
    muted,
    playback,
    play: (reply: SpokenReply) => player.current?.play(reply),
    stop: () => player.current?.stop(),
    toggleMute: () => {
      const next = !muted;
      player.current?.setMuted(next);
      setMuted(next);
      try {
        localStorage.setItem("coco-voice-muted", String(next));
      } catch {
        /* The current preference still works without storage. */
      }
    },
  };
}
