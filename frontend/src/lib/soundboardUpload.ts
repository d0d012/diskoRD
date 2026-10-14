/** Longest guild sound, in seconds. Must match backend soundboard.MaxAudioBytes. */
export const MAX_SOUND_SECONDS = 15;
const SAMPLE_RATE = 24000;
const MAX_SAMPLES = MAX_SOUND_SECONDS * SAMPLE_RATE;
/** Canonical mono PCM16 WAV size of the longest allowed sound (44-byte header). */
export const MAX_SOUND_WAV_BYTES = 44 + MAX_SAMPLES * 2;
const TOO_LONG = `Choose a sound up to ${MAX_SOUND_SECONDS} seconds long.`;

// Normalize in the browser so the server can validate a tiny, deterministic format.
// Input stays local until the member presses Add sound.
export function encodeSoundWav(samples: Float32Array): Uint8Array {
  if (!samples.length || samples.length > MAX_SAMPLES) throw new Error(TOO_LONG);
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  function text(at: number, value: string) { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i); }
  text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVEfmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples.length * 2, true);
  // Peak limit keeps custom clips from dwarfing the built-ins; volume remains listener-owned.
  let peak = 0;
  for (const sample of samples) if (Number.isFinite(sample)) peak = Math.max(peak, Math.abs(sample));
  const scale = peak > 0.35 ? 0.35 / peak : 1;
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.round((Number.isFinite(sample) ? sample : 0) * scale * 32767), true));
  return bytes;
}
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
/** Longest input the trimmer accepts; decoding longer files costs too much memory. */
export const MAX_INPUT_SECONDS = 300;
/** Resolution of the waveform peaks returned by computePeaks, in seconds per bucket. */
export const PEAK_RESOLUTION = 0.05;

/** Decodes a local file for trimming. Nothing leaves the browser. */
export async function decodeSoundFile(file: File): Promise<AudioBuffer> {
  if (file.size > 8 * 1024 * 1024) throw new Error("Choose an audio file smaller than 8 MB.");
  if (!file.size) throw new Error("That file is empty.");
  const context = new AudioContext();
  try {
    let decoded: AudioBuffer;
    try { decoded = await context.decodeAudioData(await file.arrayBuffer()); }
    catch { throw new Error("Couldn't read that audio. Try an MP3, WAV or Ogg file."); }
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) throw new Error("That file has no audio.");
    if (decoded.duration > MAX_INPUT_SECONDS) throw new Error(`Choose a file shorter than ${MAX_INPUT_SECONDS / 60} minutes.`);
    return decoded;
  } finally { await context.close(); }
}

/** Max absolute sample per PEAK_RESOLUTION bucket across all channels, for drawing the waveform. */
export function computePeaks(buffer: AudioBuffer): Float32Array {
  const perBucket = Math.max(1, Math.round(buffer.sampleRate * PEAK_RESOLUTION));
  const peaks = new Float32Array(Math.ceil(buffer.length / perBucket));
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const value = Math.abs(data[i]);
      const bucket = (i / perBucket) | 0;
      if (value > peaks[bucket]) peaks[bucket] = value;
    }
  }
  return peaks;
}

const FADE_SECONDS = 0.008;

/** Renders [start, end) of a decoded file to the canonical upload format, with short fades so cuts don't click. */
export async function renderSoundClip(buffer: AudioBuffer, start: number, end: number): Promise<{ audio: string; duration: number; blob: Blob }> {
  const from = Math.max(0, Math.min(start, buffer.duration));
  const length = Math.min(MAX_SAMPLES, Math.round((Math.min(end, buffer.duration) - from) * SAMPLE_RATE));
  if (length <= 0) throw new Error("Select a part of the sound to add.");
  const duration = length / SAMPLE_RATE;
  const offline = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  const gain = offline.createGain();
  const fade = Math.min(FADE_SECONDS, duration / 4);
  gain.gain.setValueAtTime(0, 0);
  gain.gain.linearRampToValueAtTime(1, fade);
  gain.gain.setValueAtTime(1, duration - fade);
  gain.gain.linearRampToValueAtTime(0, duration);
  source.connect(gain).connect(offline.destination);
  source.start(0, from, duration);
  const rendered = await offline.startRendering();
  const bytes = encodeSoundWav(rendered.getChannelData(0));
  return { audio: toBase64(bytes), duration, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "audio/wav" }) };
}
