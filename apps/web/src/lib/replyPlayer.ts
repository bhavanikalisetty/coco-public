export type SpokenReply = { id: string; audioId: string };
export type Playback = {
  id?: string;
  status: "idle" | "loading" | "playing" | "blocked" | "error";
  error?: string;
};
type Media = Pick<
  HTMLAudioElement,
  "src" | "play" | "pause" | "onended" | "onerror"
>;

// One player for every conversation surface; completed replies never replay on a rerender.
export class ReplyPlayer {
  private seen = new Set<string>();
  private queue: SpokenReply[] = [];
  private controller?: AbortController;
  private currentUrl = "";
  private muted = false;
  private state: Playback = { status: "idle" };
  constructor(
    private media: Media,
    private load: (reply: SpokenReply, signal: AbortSignal) => Promise<string>,
    private changed: (state: Playback) => void,
    private release: (url: string) => void,
  ) {
    media.onended = () => {
      if (!this.currentUrl) return;
      this.clearMedia();
      this.update({ status: "idle" });
      this.next();
    };
    media.onerror = () => {
      if (!this.currentUrl) return;
      const id = this.state.id;
      this.clearMedia();
      this.update({
        id,
        status: "error",
        error: "Voice playback failed. Try Hear Coco again.",
      });
    };
  }
  private update(state: Playback) {
    this.state = state;
    this.changed(state);
  }
  private clearMedia() {
    this.controller?.abort();
    this.media.pause();
    if (this.currentUrl) this.release(this.currentUrl);
    this.currentUrl = "";
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) this.stop();
  }
  enqueue(reply: SpokenReply) {
    if (this.seen.has(reply.id)) return;
    this.seen.add(reply.id);
    if (this.muted) return;
    this.queue.push(reply);
    if (["idle", "blocked", "error"].includes(this.state.status)) this.next();
  }
  private next() {
    const reply = this.queue.shift();
    if (reply && !this.muted) void this.start(reply);
  }
  play(reply: SpokenReply) {
    if (this.muted) return;
    if (this.state.id === reply.id && this.currentUrl && this.controller) {
      this.queue = [];
      void this.resume(reply, this.controller.signal);
      return;
    }
    this.stop();
    this.seen.add(reply.id);
    void this.start(reply);
  }
  private async start(reply: SpokenReply) {
    this.clearMedia();
    const controller = new AbortController();
    this.controller = controller;
    this.update({ id: reply.id, status: "loading" });
    try {
      const url = await this.load(reply, controller.signal);
      if (controller.signal.aborted) {
        this.release(url);
        return;
      }
      this.currentUrl = url;
      this.media.src = url;
      await this.resume(reply, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      const blocked = (error as Error).name === "NotAllowedError";
      this.update({
        id: reply.id,
        status: blocked ? "blocked" : "error",
        error: blocked
          ? "Tap Hear Coco to play this reply."
          : "Voice is unavailable right now. Try Hear Coco again.",
      });
    }
  }
  private async resume(reply: SpokenReply, signal: AbortSignal) {
    try {
      await this.media.play();
      if (!signal.aborted) this.update({ id: reply.id, status: "playing" });
    } catch (error) {
      if (signal.aborted) return;
      const blocked = (error as Error).name === "NotAllowedError";
      this.update({
        id: reply.id,
        status: blocked ? "blocked" : "error",
        error: blocked
          ? "Tap Hear Coco to play this reply."
          : "Voice playback failed. Try Hear Coco again.",
      });
    }
  }
  stop() {
    this.queue = [];
    this.clearMedia();
    this.update({ status: "idle" });
  }
  dispose() {
    this.stop();
    this.media.onended = null;
    this.media.onerror = null;
  }
}
