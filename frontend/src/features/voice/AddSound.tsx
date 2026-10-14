import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { computePeaks, decodeSoundFile, MAX_SOUND_SECONDS, renderSoundClip } from "../../lib/soundboardUpload";
import { useSoundboardStore } from "../../stores/soundboardStore";
import { useVoiceStore } from "../../stores/voiceStore";
import { SoundTrimmer } from "./SoundTrimmer";

interface Props { guildId: string; onDone: (added?: boolean) => void }
interface Source { buffer: AudioBuffer; peaks: Float32Array }

export function AddSound({ guildId, onDone }: Props) {
  const [name, setName] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const volume = useSoundboardStore((s) => s.volume);
  const deafened = useVoiceStore((s) => s.isDeafened);
  const revision = useRef(0);
  const sending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const preview = useRef<{ context: AudioContext; node: AudioBufferSourceNode | null; gain: GainNode | null; frame: number } | null>(null);

  function stopPreview() {
    const p = preview.current;
    if (!p) return;
    cancelAnimationFrame(p.frame);
    if (p.node) {
      p.node.onended = null;
      try { p.node.stop(); } catch { /* already stopped */ }
      p.node = null;
    }
    setPlayhead(null);
  }

  useEffect(() => () => {
    revision.current++;
    controller.current?.abort();
    stopPreview();
    void preview.current?.context.close();
    preview.current = null;
  }, []);
  useEffect(() => { if (preview.current?.gain) preview.current.gain.gain.value = volume; }, [volume]);
  useEffect(() => { if (deafened) stopPreview(); }, [deafened]);

  async function select(file?: File) {
    if (!file) return;
    const current = ++revision.current;
    stopPreview();
    setBusy(true); setError(null); setSource(null);
    try {
      const buffer = await decodeSoundFile(file);
      if (revision.current !== current) return;
      setSource({ buffer, peaks: computePeaks(buffer) });
      setRange([0, Math.min(MAX_SOUND_SECONDS, buffer.duration)]);
      setName(file.name.replace(/\.[^.]+$/, "").slice(0, 32));
    } catch (err) {
      if (revision.current === current) setError(err instanceof Error ? err.message : "Couldn't read that file.");
    } finally { if (revision.current === current) setBusy(false); }
  }

  function changeRange(start: number, end: number) {
    stopPreview();
    setRange([start, end]);
  }

  function togglePreview() {
    if (!source) return;
    if (playhead !== null) { stopPreview(); return; }
    try {
      if (!preview.current) preview.current = { context: new AudioContext(), node: null, gain: null, frame: 0 };
      const p = preview.current;
      void p.context.resume();
      const [start, end] = range;
      const node = p.context.createBufferSource();
      node.buffer = source.buffer;
      const gain = p.context.createGain();
      gain.gain.value = volume;
      node.connect(gain).connect(p.context.destination);
      const startedAt = p.context.currentTime;
      node.onended = () => stopPreview();
      node.start(0, start, end - start);
      p.node = node;
      p.gain = gain;
      const tick = () => {
        setPlayhead(Math.min(end, start + (p.context.currentTime - startedAt)));
        p.frame = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setError("Couldn't preview audio.");
    }
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!source || !name.trim() || busy || sending.current) return;
    const current = revision.current;
    sending.current = true;
    controller.current = new AbortController();
    stopPreview();
    setBusy(true); setUploading(true); setError(null);
    try {
      const clip = await renderSoundClip(source.buffer, range[0], range[1]);
      if (revision.current !== current) return;
      await api.post(`/guilds/${guildId}/sounds`, { name: name.trim(), audio: clip.audio }, { signal: controller.current.signal });
      if (revision.current !== current) return;
      await useSoundboardStore.getState().refresh();
      if (revision.current === current) onDone(true);
    } catch (err) {
      if (revision.current === current) {
        const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
        setError(message ?? (err instanceof Error && !("response" in err) ? err.message : "Couldn't upload. Check your connection and try again."));
      }
    } finally {
      sending.current = false;
      if (revision.current === current) { setBusy(false); setUploading(false); }
    }
  }

  return (
    <form onSubmit={upload} className="p-3 flex flex-col gap-3 border-t border-white/10">
      <div className="flex items-center justify-between text-sm font-semibold">
        <span>Add a server sound</span><button type="button" onClick={() => onDone()} aria-label="Cancel adding sound" className="px-2">✕</button>
      </div>
      <p className="text-xs opacity-70">Anyone in this server can add sounds. Pick up to {MAX_SOUND_SECONDS} seconds from any clip · 8 MB input.</p>
      <input aria-label="Audio file" type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a" disabled={busy}
        className="text-xs w-full file:mr-2 file:rounded file:border-0 file:px-2 file:py-1 file:bg-white/10 file:text-inherit"
        onChange={(e) => void select(e.target.files?.[0])} />
      {source && (
        <SoundTrimmer
          duration={source.buffer.duration}
          peaks={source.peaks}
          start={range[0]}
          end={range[1]}
          onChange={changeRange}
          playhead={playhead}
          disabled={busy}
        />
      )}
      <div className="flex gap-2">
        <input aria-label="Sound name" required maxLength={32} value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Give it a name" disabled={busy} className="min-w-0 flex-1 rounded px-2 py-1 text-sm bg-black/20" />
        <button type="button" disabled={!source || busy || deafened} className="px-2 text-xs disabled:opacity-40 w-14"
          onClick={togglePreview}>{playhead !== null ? "Stop" : "Preview"}</button>
      </div>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      <button type="submit" disabled={!source || !name.trim() || busy}
        className="rounded py-1.5 text-sm font-medium disabled:opacity-40" style={{ backgroundColor: "var(--color-dc-brand, #5865f2)", color: "white" }}>
        {busy ? (uploading ? "Adding…" : "Preparing…") : "Add sound"}
      </button>
    </form>
  );
}
