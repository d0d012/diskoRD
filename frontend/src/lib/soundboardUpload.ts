// Normalize in the browser so the server can validate a tiny, deterministic format.
// Input stays local until the member presses Add sound.
export function encodeSoundWav(samples: Float32Array): Uint8Array {
  if (!samples.length || samples.length > 120000) throw new Error("Choose a sound up to 5 seconds long.");
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  function text(at: number, value: string) { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i); }
  text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVEfmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true); view.setUint32(28, 48000, true);
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
export async function prepareSound(file: File): Promise<{ audio: string; duration: number; blob: Blob }> {
  if (file.size > 8 * 1024 * 1024) throw new Error("Choose an audio file smaller than 8 MB.");
  if (!file.size) throw new Error("That file is empty.");
  const context = new AudioContext();
  try {
    let decoded: AudioBuffer;
    try { decoded = await context.decodeAudioData(await file.arrayBuffer()); }
    catch { throw new Error("Couldn't read that audio. Try an MP3, WAV or Ogg file."); }
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > 5) throw new Error("Choose a sound up to 5 seconds long.");
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 24000), 24000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const bytes = encodeSoundWav(rendered.getChannelData(0));
    return { audio: toBase64(bytes), duration: decoded.duration, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "audio/wav" }) };
  } finally { await context.close(); }
}
