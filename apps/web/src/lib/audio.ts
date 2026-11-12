export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const length = Math.floor((samples.length * 16000) / sampleRate);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) =>
    [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const from = Math.floor((i * sampleRate) / 16000),
      to = Math.min(
        samples.length,
        Math.max(from + 1, Math.floor(((i + 1) * sampleRate) / 16000)),
      );
    let sum = 0;
    for (let j = from; j < to; j++) sum += samples[j];
    const value = Math.max(-1, Math.min(1, sum / (to - from)));
    view.setInt16(44 + i * 2, value < 0 ? value * 32768 : value * 32767, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
export async function startCapture(onLimit: () => void, maxSeconds = 15) {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error(
      "Microphone access needs HTTPS and a supported browser. You can type your request instead.",
    );
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    video: false,
  });
  let context: AudioContext | undefined;
  const nodes: AudioNode[] = [];
  const release = async () => {
    stream.getTracks().forEach((track) => track.stop());
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        /* Already disconnected. */
      }
    }
    if (context && context.state !== "closed")
      await context.close().catch(() => {});
  };
  try {
    context = new AudioContext();
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    nodes.push(source);
    const processor = context.createScriptProcessor(4096, 1, 1);
    nodes.push(processor);
    const mute = context.createGain();
    nodes.push(mute);
    mute.gain.value = 0;
    const chunks: Float32Array[] = [];
    let size = 0;
    let closed = false;
    processor.onaudioprocess = (event) => {
      const chunk = event.inputBuffer.getChannelData(0).slice();
      chunks.push(chunk);
      size += chunk.length;
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    const rate = context.sampleRate;
    const timer = setTimeout(onLimit, maxSeconds * 1000);
    const finish = async (save: boolean) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      processor.onaudioprocess = null;
      await release();
      if (!save) return;
      const samples = new Float32Array(size);
      let index = 0;
      for (const chunk of chunks) {
        samples.set(chunk, index);
        index += chunk.length;
      }
      if (samples.length < rate * 0.25)
        throw new Error(
          "That was too short. Record at least a moment of speech.",
        );
      return encodeWav(samples.slice(0, rate * maxSeconds), rate);
    };
    return { stop: () => finish(true), cancel: () => finish(false) };
  } catch (error) {
    await release();
    throw error;
  }
}
