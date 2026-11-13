import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MAX_GALLERY, MAX_SHOWCASE, showcaseOrder, usePixelArtStore } from "../../stores/pixelArtStore";
import type { PixelArtPiece } from "../../types";
import { ArtThumb } from "./ArtThumb";
import { Icon } from "./Icon";

function apiError(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

function Modal({ label, width, onClose, children }: { label: string; width: number; onClose: () => void; children: React.ReactNode }) {
  // Escape closes only this dialog, not the editor underneath.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div
      className="dc-modal-backdrop-in fixed inset-0 z-[10003] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.72)" }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="dc-modal-in max-w-full max-h-full overflow-auto rounded-xl p-5"
        style={{ width, backgroundColor: "var(--color-dc-bg-primary)", border: "1px solid var(--color-dc-bg-modifier-selected)", color: "var(--color-dc-text-normal)" }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

const muted = { color: "var(--color-dc-text-muted)" };
const secondaryButton = { backgroundColor: "var(--color-dc-bg-secondary)", color: "var(--color-dc-text-normal)" };

/** "My art": pick a saved piece to open, toggle it on the profile, or delete it. */
export function GalleryPicker({ onOpen, onClose }: { onOpen: (piece: PixelArtPiece) => void; onClose: () => void }) {
  const gallery = usePixelArtStore((s) => s.gallery);
  const loadGallery = usePixelArtStore((s) => s.loadGallery);
  const setShowcase = usePixelArtStore((s) => s.setShowcase);
  const deleteArt = usePixelArtStore((s) => s.deleteArt);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    loadGallery().catch((err) => setError(apiError(err, "Couldn't load your art.")));
  }, [loadGallery]);

  const showcase = gallery ? showcaseOrder(gallery) : [];

  async function toggleShowcase(piece: PixelArtPiece) {
    const on = piece.showcasePosition !== null;
    if (!on && showcase.length >= MAX_SHOWCASE) {
      setError(`Your profile shows at most ${MAX_SHOWCASE} pieces.`);
      return;
    }
    setError("");
    try {
      await setShowcase(on ? showcase.filter((id) => id !== piece.id) : [...showcase, piece.id]);
    } catch (err) {
      setError(apiError(err, "Couldn't update your profile."));
    }
  }

  async function remove(id: string) {
    setConfirmDelete(null);
    try {
      await deleteArt(id);
    } catch (err) {
      setError(apiError(err, "Couldn't delete it."));
    }
  }

  return (
    <Modal label="My art" width={640} onClose={onClose}>
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-base font-semibold" style={{ color: "var(--color-dc-header-primary)" }}>My art</h3>
        <span className="text-xs tabular-nums" style={muted}>
          {gallery?.length ?? 0}/{MAX_GALLERY} saved · {showcase.length}/{MAX_SHOWCASE} on profile
        </span>
      </div>
      <p className="text-xs mb-4" style={muted}>Open a piece to keep working on it. Pieces with a star are shown on your profile.</p>

      {gallery === null ? (
        <p className="text-sm py-10 text-center" style={muted}>Loading…</p>
      ) : gallery.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm font-medium">Nothing saved yet</p>
          <p className="text-xs mt-1" style={muted}>Use Save in the editor to keep your art here.</p>
        </div>
      ) : (
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(108px, 1fr))" }}>
          {gallery.map((piece) => {
            const onProfile = piece.showcasePosition !== null;
            return (
              <div key={piece.id} className="group relative rounded-lg p-2 flex flex-col gap-1.5" style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}>
                <button
                  onClick={() => onOpen(piece)}
                  className="dc-press h-20 rounded-md flex items-center justify-center"
                  style={{ background: "repeating-conic-gradient(#3a3c42 0% 25%, #2e3035 0% 50%) 0 0 / 12px 12px" }}
                  aria-label={`Open ${piece.title || "untitled"}`}
                  title="Open in editor"
                >
                  <ArtThumb doc={piece.doc} size={72} />
                </button>
                <div className="flex items-center gap-1 min-w-0">
                  <span className="text-xs truncate flex-1" title={piece.title}>{piece.title || "Untitled"}</span>
                  <button
                    onClick={() => void toggleShowcase(piece)}
                    aria-label={onProfile ? "Remove from profile" : "Show on profile"}
                    aria-pressed={onProfile}
                    title={onProfile ? "Shown on your profile" : "Show on your profile"}
                    className="dc-press w-6 h-6 rounded flex items-center justify-center text-sm hover:bg-dc-bg-modifier-hover transition-colors"
                    style={{ color: onProfile ? "var(--color-dc-idle)" : "var(--color-dc-text-muted)" }}
                  >
                    {onProfile ? "★" : "☆"}
                  </button>
                </div>
                {piece.remixAuthor && (
                  <span className="text-[10px] truncate" style={muted}>Remix of @{piece.remixAuthor.username}</span>
                )}
                {confirmDelete === piece.id ? (
                  <div className="absolute inset-0 rounded-lg flex flex-col items-center justify-center gap-2 p-2" style={{ backgroundColor: "rgba(17,18,20,0.92)" }}>
                    <span className="text-xs">Delete this piece?</span>
                    <div className="flex gap-1">
                      <button onClick={() => setConfirmDelete(null)} className="dc-press px-2 h-7 rounded text-xs hover:brightness-110" style={secondaryButton}>Keep</button>
                      <button onClick={() => void remove(piece.id)} className="dc-press px-2 h-7 rounded text-xs text-white hover:brightness-110" style={{ backgroundColor: "var(--color-dc-red, #ed4245)" }}>Delete</button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(piece.id)}
                    aria-label={`Delete ${piece.title || "untitled"}`}
                    className="dc-press absolute top-1 right-1 w-6 h-6 rounded items-center justify-center flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                    style={{ backgroundColor: "rgba(0,0,0,0.6)", color: "#fff" }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="text-xs mt-3" style={{ color: "var(--color-dc-red, #ed4245)" }}>{error}</p>}
      <div className="-mx-5 -mb-5 px-5 py-4 flex justify-end mt-4 border-t border-white/5 bg-dc-bg-secondary">
        <button onClick={onClose} className="dc-press px-4 h-9 rounded-md text-sm hover:brightness-110 transition-colors" style={secondaryButton}>Close</button>
      </div>
    </Modal>
  );
}

export interface SaveTarget {
  /** Gallery id when the editor holds a saved piece. */
  id: string | null;
  title: string;
  remixOf: string | null;
}

/** Save the editor's art: new piece, changes to the open one, or a copy. */
export function SaveDialog({ target, onSave, onClose }: {
  target: SaveTarget;
  onSave: (input: { title: string; showOnProfile: boolean; asCopy: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const gallery = usePixelArtStore((s) => s.gallery);
  const loadGallery = usePixelArtStore((s) => s.loadGallery);
  const [title, setTitle] = useState(target.title);
  const existing = gallery?.find((a) => a.id === target.id) ?? null;
  const onProfileAlready = existing?.showcasePosition != null;
  const showcaseCount = gallery ? showcaseOrder(gallery).length : 0;
  const showcaseFull = showcaseCount >= MAX_SHOWCASE && !onProfileAlready;
  const [showOnProfile, setShowOnProfile] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!gallery) loadGallery().catch(() => {});
  }, [gallery, loadGallery]);

  async function save(asCopy: boolean) {
    setBusy(true);
    setError("");
    try {
      await onSave({ title: title.trim(), showOnProfile: showOnProfile && !showcaseFull, asCopy });
      onClose();
    } catch (err) {
      setError(apiError(err, "Couldn't save. Try again."));
      setBusy(false);
    }
  }

  const updating = !!target.id && !!existing;

  return (
    <Modal label="Save to gallery" width={360} onClose={onClose}>
      <h3 className="text-base font-semibold mb-4" style={{ color: "var(--color-dc-header-primary)" }}>
        {updating ? "Save changes" : "Save to My art"}
      </h3>
      <label className="flex flex-col gap-1.5 mb-3">
        <span className="text-xs font-semibold uppercase tracking-wide" style={muted}>Title</span>
        <input
          autoFocus
          value={title}
          maxLength={40}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !busy) void save(false); }}
          placeholder="Lil hamster"
          className="h-10 rounded-md px-3 text-sm outline-none border border-black/30 focus:border-dc-brand focus:shadow-[0_0_0_2px_rgba(88,101,242,0.25)] transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none"
          style={{ backgroundColor: "var(--color-dc-bg-tertiary)", color: "var(--color-dc-text-normal)" }}
        />
      </label>
      {!onProfileAlready && (
        <label className="flex items-center gap-2 text-sm mb-1" style={{ opacity: showcaseFull ? 0.5 : 1 }}>
          <input type="checkbox" checked={showOnProfile && !showcaseFull} disabled={showcaseFull} onChange={(e) => setShowOnProfile(e.target.checked)} />
          Show on my profile
        </label>
      )}
      <p className="text-xs mb-4" style={muted}>
        {onProfileAlready
          ? "This piece is on your profile; changes show there too."
          : showcaseFull
            ? `Your profile already shows ${MAX_SHOWCASE} pieces.`
            : "Profile pieces are visible to everyone."}
        {target.remixOf ? " It keeps credit to the original artist." : ""}
      </p>
      {error && <p className="text-xs mb-3" style={{ color: "var(--color-dc-red, #ed4245)" }}>{error}</p>}
      <div className="-mx-5 -mb-5 px-5 py-4 flex justify-end gap-2 border-t border-white/5 bg-dc-bg-secondary">
        <button onClick={onClose} className="dc-press px-3 h-9 rounded-md text-sm hover:brightness-110 transition-colors" style={secondaryButton}>Cancel</button>
        {updating && (
          <button onClick={() => void save(true)} disabled={busy} className="dc-press px-3 h-9 rounded-md text-sm hover:brightness-110 transition-colors disabled:opacity-50" style={secondaryButton}>Save as copy</button>
        )}
        <button onClick={() => void save(false)} disabled={busy} className="dc-btn-primary dc-press px-4 h-9 rounded-md text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Saving…" : updating ? "Save changes" : "Save"}
        </button>
      </div>
    </Modal>
  );
}
