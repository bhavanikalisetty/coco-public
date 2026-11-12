import { test } from "node:test";
import assert from "node:assert/strict";
import { ReplyPlayer, type Playback } from "../src/lib/replyPlayer";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function setup() {
  const states: Playback[] = [],
    loaded: string[] = [],
    released: string[] = [];
  let plays = 0,
    paused = 0,
    blocked = false;
  const media = {
    src: "",
    onended: null as (() => void) | null,
    onerror: null as (() => void) | null,
    play: async () => {
      plays++;
      if (blocked) throw new DOMException("Blocked", "NotAllowedError");
    },
    pause: () => {
      paused++;
    },
  };
  const player = new ReplyPlayer(
    media,
    async (reply) => {
      loaded.push(reply.audioId);
      return `blob:${reply.audioId}`;
    },
    (state) => states.push(state),
    (url) => released.push(url),
  );
  return {
    player,
    media,
    states,
    loaded,
    released,
    plays: () => plays,
    paused: () => paused,
    block: (value: boolean) => {
      blocked = value;
    },
  };
}
test("completed replies speak once, queue in order, and share one player", async () => {
  const t = setup();
  t.player.enqueue({ id: "typed", audioId: "a1" });
  t.player.enqueue({ id: "proactive", audioId: "a2" });
  t.player.enqueue({ id: "typed", audioId: "a1" });
  await flush();
  assert.deepEqual(t.loaded, ["a1"]);
  assert.equal(t.states.at(-1)?.status, "playing");
  t.media.onended?.();
  await flush();
  assert.deepEqual(t.loaded, ["a1", "a2"]);
  assert.equal(t.plays(), 2);
  assert.deepEqual(t.released, ["blob:a1"]);
  t.player.dispose();
});
test("mute stops active audio and suppresses queued and later replies without replay on unmute", async () => {
  const t = setup();
  t.player.enqueue({ id: "first", audioId: "a1" });
  await flush();
  t.player.enqueue({ id: "queued", audioId: "a2" });
  t.player.setMuted(true);
  t.player.enqueue({ id: "muted", audioId: "a3" });
  t.player.play({ id: "muted", audioId: "a3" });
  t.player.setMuted(false);
  t.player.enqueue({ id: "muted", audioId: "a3" });
  await flush();
  assert.deepEqual(t.loaded, ["a1"]);
  assert.equal(t.states.at(-1)?.status, "idle");
  assert.ok(t.paused() > 0);
  t.player.enqueue({ id: "next", audioId: "a4" });
  await flush();
  assert.deepEqual(t.loaded, ["a1", "a4"]);
  t.player.dispose();
});
test("blocked autoplay offers manual playback using the already loaded audio", async () => {
  const t = setup();
  t.block(true);
  const reply = { id: "typed", audioId: "a1" };
  t.player.enqueue(reply);
  await flush();
  assert.equal(t.states.at(-1)?.status, "blocked");
  assert.match(t.states.at(-1)?.error ?? "", /Tap Hear Coco/);
  t.block(false);
  t.player.play(reply);
  assert.equal(
    t.plays(),
    2,
    "manual play must run inside the click gesture, before another fetch",
  );
  await flush();
  assert.deepEqual(t.loaded, ["a1"]);
  assert.equal(t.states.at(-1)?.status, "playing");
  t.player.dispose();
});
test("stop during loading cancels playback and releases a late audio URL", async () => {
  let finish!: (url: string) => void,
    signal!: AbortSignal,
    plays = 0;
  const released: string[] = [],
    states: Playback[] = [];
  const player = new ReplyPlayer(
    {
      src: "",
      play: async () => {
        plays++;
      },
      pause() {},
      onended: null,
      onerror: null,
    },
    (_reply, current) => {
      signal = current;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    (state) => states.push(state),
    (url) => released.push(url),
  );
  player.enqueue({ id: "first", audioId: "a1" });
  player.stop();
  assert.equal(signal.aborted, true);
  finish("blob:late");
  await flush();
  assert.equal(plays, 0);
  assert.deepEqual(released, ["blob:late"]);
  assert.equal(states.at(-1)?.status, "idle");
  player.dispose();
});

test("a failed audio download does not prevent the next reply from speaking", async () => {
  const states: Playback[] = [];
  let plays = 0;
  const player = new ReplyPlayer(
    {
      src: "",
      play: async () => {
        plays++;
      },
      pause() {},
      onended: null,
      onerror: null,
    },
    async (reply) => {
      if (reply.id === "failed") throw new Error("Unavailable");
      return "blob:next";
    },
    (state) => states.push(state),
    () => {},
  );
  player.enqueue({ id: "failed", audioId: "missing" });
  await flush();
  assert.equal(states.at(-1)?.status, "error");
  player.enqueue({ id: "next", audioId: "available" });
  await flush();
  assert.equal(plays, 1);
  assert.deepEqual(states.at(-1), { id: "next", status: "playing" });
  player.dispose();
});
