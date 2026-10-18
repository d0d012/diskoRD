import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SOUNDBOARD_SOUNDS } from "../../lib/soundboard";
import { api } from "../../lib/api";
import { useSoundboardStore, type GuildSound } from "../../stores/soundboardStore";
import { useGuildStore } from "../../stores/guildStore";
import { AddSound } from "./AddSound";

/** Must match soundboard.MaxGuildSounds on the server. */
const MAX_GUILD_SOUNDS = 64;

interface SoundboardProps { compact?: boolean }
export function Soundboard({ compact = false }: SoundboardProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const session = useSoundboardStore((s) => s.session);
  const guildId = useSoundboardStore((s) => s.guildId);
  return (
    <>
      <button ref={trigger} type="button" title="Soundboard" aria-label="Soundboard" aria-haspopup="dialog"
        aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)} className={`${compact ? "p-1" : "p-2"} shrink-0 rounded-full transition-colors hover:brightness-125`}
        style={{ color: open ? "var(--color-dc-header-primary)" : "var(--color-dc-interactive-normal)", backgroundColor: open ? "var(--color-dc-brand, #5865f2)" : "var(--color-dc-bg-tertiary)" }}>
        <svg width={compact ? 16 : 20} height={compact ? 16 : 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" />
          <rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" />
        </svg>
      </button>
      {open && createPortal(<SoundboardPopover key={session ? guildId ?? "dm" : "none"}
        id={id} trigger={trigger} onClose={(restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus(); }} />, document.body)}
    </>
  );
}

interface PopoverProps { id: string; trigger: React.RefObject<HTMLButtonElement | null>; onClose: (restoreFocus?: boolean) => void }
function SoundboardPopover({ id, trigger, onClose }: PopoverProps) {
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<GuildSound | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { session, guildId, sounds, loading, catalogError, available, error, volume, setVolume, refresh } = useSoundboardStore();
  const guildName = useGuildStore((s) => s.guilds.find((g) => g.id === guildId)?.name) ?? "Server sounds";
  const canPlay = !!session && (preview || available);
  const matches = (name: string) => name.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim());

  useLayoutEffect(() => {
    const element = panel.current;
    const anchor = trigger.current;
    if (!element || !anchor) return;
    function position() {
      const rect = anchor!.getBoundingClientRect();
      const height = element!.offsetHeight;
      const width = element!.offsetWidth;
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      const above = rect.top - height - 8;
      const top = above >= 8 ? above : Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - height - 8));
      element!.style.left = `${left}px`;
      element!.style.top = `${top}px`;
    }
    position();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(position) : null;
    observer?.observe(element);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => { observer?.disconnect(); window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, [trigger]);
  useEffect(() => {
    search.current?.focus();
    void refresh();
  }, [refresh]);
  useEffect(() => {
    function outside(e: PointerEvent) {
      if (!panel.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) onClose();
    }
    function escape(e: KeyboardEvent) { if (e.key === "Escape") { e.stopPropagation(); onClose(true); } }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [onClose, trigger]);

  async function removeSound() {
    if (!removing || deleting || !guildId) return;
    setDeleting(true);
    try {
      await api.delete(`/guilds/${guildId}/sounds/${removing.id}`);
      setRemoving(null);
      await refresh();
    } catch { useSoundboardStore.setState({ error: "Couldn't remove that sound. Try again." }); }
    finally { setDeleting(false); }
  }
  function tile(sound: { id: string; name: string; emoji?: string; canDelete?: boolean }) {
    return (
      <div key={sound.id} className="relative group min-w-0">
        <button type="button" disabled={!canPlay} title={`${sound.name}${preview ? " · Only you" : " · Play for everyone"}`}
          className="w-full flex items-center gap-1.5 h-10 rounded-md px-2 text-xs transition-colors bg-white/5 hover:bg-white/15 active:bg-white/25 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-indigo-400"
          onClick={(e) => {
            e.currentTarget.animate?.([{ backgroundColor: "rgba(88,101,242,.6)" }, { backgroundColor: "rgba(255,255,255,.05)" }], { duration: 220 });
            void session?.play(sound.id, preview);
          }}>
          <span aria-hidden="true" className="text-lg shrink-0">{sound.emoji ?? "🔊"}</span><span className="truncate">{sound.name}</span>
        </button>
        {sound.canDelete && <button aria-label={`Remove ${sound.name}`} title="Remove sound"
          className="absolute -right-1 -top-1 w-4 h-4 rounded-full text-xs bg-[var(--color-dc-bg-tertiary)] opacity-0 group-hover:opacity-100 focus:opacity-100"
          onClick={() => setRemoving(sound as GuildSound)}>×</button>}
      </div>
    );
  }
  const builtins = SOUNDBOARD_SOUNDS.filter((s) => matches(s.name));
  const custom = sounds.filter((s) => matches(s.name));
  return (
    <div ref={panel} id={id} role="dialog" aria-modal="false" aria-label="Soundboard" className="fixed z-[10002] w-[368px] max-w-[calc(100vw-16px)] max-h-[calc(100dvh-16px)] flex flex-col rounded-xl shadow-2xl border border-white/10 overflow-hidden"
      style={{ backgroundColor: "var(--color-dc-bg-floating, #18191c)", color: "var(--color-dc-text-normal)" }}>
      <div className="flex items-center gap-2 p-3 pb-2">
        <input ref={search} aria-label="Search sounds" placeholder="Find a sound…" value={query} onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 rounded-md bg-black/25 px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-indigo-400" />
        <button onClick={() => onClose(true)} aria-label="Close soundboard" className="p-1 text-sm opacity-60 hover:opacity-100">✕</button>
      </div>
      <div className="overflow-y-auto min-h-0 px-3 pb-3 max-h-[320px]">
        {guildId && <section aria-label="Server sounds">
          <div className="flex items-center justify-between py-2 gap-2">
            <h3 className="text-[10px] font-bold uppercase tracking-wider truncate opacity-70">{guildName} · {sounds.length}/48</h3>
            <button onClick={() => { setAdding(!adding); setRemoving(null); }} disabled={sounds.length >= MAX_GUILD_SOUNDS}
              className="text-xs shrink-0 hover:underline disabled:opacity-40" title={sounds.length >= MAX_GUILD_SOUNDS ? "Remove a sound to make room" : "All members can add sounds"}>+ Add sound</button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">{custom.map(tile)}</div>
          {!sounds.length && !loading && !catalogError && <p className="text-xs opacity-60 py-2">Your server's inside jokes go here. Add the first sound!</p>}
          {loading && <p role="status" className="text-xs opacity-60 py-1">Loading sounds…</p>}
          {catalogError && <p role="alert" className="text-xs text-red-400 py-1">{catalogError} <button className="underline" onClick={() => void refresh()}>Retry</button></p>}
        </section>}
        <section aria-label="Built-in sounds">
          <div className="flex items-center justify-between py-2">
            <h3 className="text-[10px] font-bold uppercase tracking-wider opacity-70">diskoRD sounds</h3>
            <a href="/sounds/soundboard/CREDITS.txt" target="_blank" rel="noopener noreferrer" className="text-[10px] opacity-60 hover:opacity-100 hover:underline">Sound credits</a>
          </div>
          <div className="grid grid-cols-3 gap-1.5">{builtins.map(tile)}</div>
        </section>
        {!builtins.length && !custom.length && <p className="text-xs opacity-60 py-3">No sounds match “{query}”.</p>}
      </div>
      {adding && guildId && <div className="overflow-y-auto min-h-0"><AddSound key={guildId} guildId={guildId} onDone={(added) => { setAdding(false); if (added) setQuery(""); }} /></div>}
      {removing && <div className="p-3 text-xs border-t border-white/10 flex gap-2 items-center">
        <span className="flex-1 truncate">Remove “{removing.name}”?</span>
        <button disabled={deleting} className="text-red-400" onClick={() => void removeSound()}>Remove</button>
        <button disabled={deleting} onClick={() => setRemoving(null)}>Cancel</button>
      </div>}
      <div className="border-t border-white/10 px-3 py-2 flex items-center gap-2">
        <button aria-label="Preview sounds only for me" aria-pressed={preview} title="Preview mode — only you hear it" onClick={() => setPreview(!preview)}
          className={`rounded px-2 py-1 text-xs ${preview ? "bg-indigo-500/25 text-indigo-300" : "opacity-70 hover:opacity-100"}`}>🎧 Preview</button>
        <input aria-label="Soundboard volume" title={`Soundboard volume: ${Math.round(volume * 100)}% · Only affects you`} type="range" min="0" max="100" value={Math.round(volume * 100)}
          onChange={(e) => setVolume(Number(e.target.value) / 100)} className="min-w-0 flex-1 h-1 accent-indigo-400" />
        <button onClick={() => session?.stop()} aria-label="Stop sounds for me" title="Stop sounds for me" className="px-1 opacity-70 hover:opacity-100">■</button>
      </div>
      {(error || !session || (!available && !preview)) && <p role="status" className="px-3 pb-2 text-[11px] opacity-70">
        {error ?? (!session ? "Join voice or a call to play sounds." : "Connect, unmute and undeafen to play for everyone.")}
      </p>}
    </div>
  );
}
