import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { prepareSound } from "../../lib/soundboardUpload";
import { useSoundboardStore } from "../../stores/soundboardStore";
import { useVoiceStore } from "../../stores/voiceStore";

interface Props { guildId: string; onDone: (added?: boolean) => void }
export function AddSound({ guildId, onDone }: Props) {
  const [name, setName] = useState("");
  const [prepared, setPrepared] = useState<(Awaited<ReturnType<typeof prepareSound>> & { url: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const volume = useSoundboardStore((s) => s.volume);
  const deafened = useVoiceStore((s) => s.isDeafened);
  const audio = useRef<HTMLAudioElement>(null);
  const revision = useRef(0);
  const sending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { revision.current++; controller.current?.abort(); }, []);
  useEffect(() => {
    const player = audio.current;
    return () => { player?.pause(); if (prepared) URL.revokeObjectURL(prepared.url); };
  }, [prepared]);
  useEffect(() => {
    if (audio.current) {
      audio.current.volume = volume;
      if (deafened) audio.current.pause();
    }
  }, [volume, deafened, prepared]);

  async function select(file?: File) {
    if (!file) return;
    const current = ++revision.current;
    setBusy(true); setError(null); setPrepared(null);
    try {
      const result = await prepareSound(file);
      if (revision.current !== current) return;
      setPrepared({ ...result, url: URL.createObjectURL(result.blob) });
      setName(file.name.replace(/\.[^.]+$/, "").slice(0, 32));
    } catch (err) {
      if (revision.current === current) setError(err instanceof Error ? err.message : "Couldn't read that file.");
    } finally { if (revision.current === current) setBusy(false); }
  }
  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!prepared || !name.trim() || busy || sending.current) return;
    const current = revision.current;
    sending.current = true;
    controller.current = new AbortController();
    setBusy(true); setError(null);
    audio.current?.pause();
    try {
      await api.post(`/guilds/${guildId}/sounds`, { name: name.trim(), audio: prepared.audio }, { signal: controller.current.signal });
      if (revision.current !== current) return;
      await useSoundboardStore.getState().refresh();
      if (revision.current === current) onDone(true);
    } catch (err) {
      if (revision.current === current) {
        const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
        setError(message ?? "Couldn't upload. Check your connection and try again.");
      }
    } finally {
      sending.current = false;
      if (revision.current === current) setBusy(false);
    }
  }
  return (
    <form onSubmit={upload} className="p-3 flex flex-col gap-3 border-t border-white/10">
      <div className="flex items-center justify-between text-sm font-semibold">
        <span>Add a server sound</span><button type="button" onClick={() => onDone()} aria-label="Cancel adding sound" className="px-2">✕</button>
      </div>
      <p className="text-xs opacity-70">Anyone in this server can add sounds. Up to 5 seconds · 8 MB input.</p>
      <input aria-label="Audio file" type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a" disabled={busy}
        className="text-xs w-full file:mr-2 file:rounded file:border-0 file:px-2 file:py-1 file:bg-white/10 file:text-inherit"
        onChange={(e) => void select(e.target.files?.[0])} />
      <div className="flex gap-2">
        <input aria-label="Sound name" required maxLength={32} value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Give it a name" disabled={busy} className="min-w-0 flex-1 rounded px-2 py-1 text-sm bg-black/20" />
        <button type="button" disabled={!prepared || busy || deafened} className="px-2 text-xs disabled:opacity-40"
          onClick={() => { if (audio.current) { audio.current.currentTime = 0; void audio.current.play().catch(() => setError("Couldn't preview audio.")); } }}>Preview</button>
      </div>
      {prepared && <audio ref={audio} src={prepared.url} />}
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      <button type="submit" disabled={!prepared || !name.trim() || busy}
        className="rounded py-1.5 text-sm font-medium disabled:opacity-40" style={{ backgroundColor: "var(--color-dc-brand, #5865f2)", color: "white" }}>
        {busy ? (sending.current ? "Adding…" : "Preparing…") : "Add sound"}
      </button>
    </form>
  );
}
