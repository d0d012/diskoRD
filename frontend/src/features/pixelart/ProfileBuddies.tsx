import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MAX_BUDDIES, usePixelArtStore } from "../../stores/pixelArtStore";
import type { ProfileBuddy } from "../../types";
import { ArtThumb } from "./ArtThumb";
import { Icon } from "./Icon";
import { BUDDY_MAX_HEIGHT as MAX_HEIGHT, BUDDY_MIN_HEIGHT as MIN_HEIGHT, buddyWidth, snapHeight, trimmedImage } from "./decorationImage";
import type { PixelArtDoc } from "./lib/doc";

const MAX_Y = 1000;

type PlacedBuddy = ProfileBuddy & { doc: PixelArtDoc };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function BuddySprite({ buddy, index, selected, editing, onPointerDown }: {
  buddy: PlacedBuddy;
  index: number;
  selected?: boolean;
  editing?: boolean;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const img = useMemo(() => trimmedImage(buddy.doc), [buddy.doc]);
  if (!img) return null;
  const width = buddyWidth(buddy.doc, buddy.height);
  const crisp = buddy.height % img.height === 0;
  return (
    <div
      data-testid="profile-buddy"
      onPointerDown={onPointerDown}
      className={editing ? "absolute touch-none" : "absolute pointer-events-none buddy-idle"}
      style={{
        left: `calc(${buddy.x}% - ${(width * buddy.x) / 100}px)`,
        // Never below the card's bottom edge, however short the card gets.
        top: `min(${buddy.y}px, calc(100% - ${buddy.height}px))`,
        width,
        height: buddy.height,
        zIndex: buddy.front ? 3 : 1,
        cursor: editing ? "grab" : undefined,
        outline: selected ? "2px dashed #fff" : editing ? "1px dashed rgba(255,255,255,0.45)" : undefined,
        outlineOffset: 2,
        animationDelay: `${index * -0.37}s`,
      }}
    >
      <img
        src={img.url}
        alt=""
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          imageRendering: crisp ? "pixelated" : "auto",
          transform: buddy.flip ? "scaleX(-1)" : undefined,
        }}
      />
    </div>
  );
}

interface LayerProps {
  userId: string;
  isSelf: boolean;
  /** Arrange mode: buddies are draggable and the toolbar is shown next to the card. */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  /** The card element, for drag bounds and toolbar placement. */
  cardRef: React.RefObject<HTMLElement | null>;
}

/** Buddies drawn on a profile card, plus arrange mode for the card's owner. */
export function ProfileBuddies({ userId, editing, onEditingChange, cardRef }: LayerProps) {
  const profile = usePixelArtStore((s) => s.profiles[userId]);
  const saved = profile?.buddies ?? [];
  const [draft, setDraft] = useState<PlacedBuddy[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const dragRef = useRef<{ index: number; dx: number; dy: number } | null>(null);

  useEffect(() => {
    if (editing) {
      setDraft(saved.map((b) => ({ ...b })));
      setSelected(saved.length ? 0 : null);
    } else {
      setDraft(null);
      setSelected(null);
    }
    // Only when entering/leaving arrange mode; later profile refreshes don't reset the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const buddies = draft ?? saved;
  if (!editing && buddies.length === 0) return null;

  function update(index: number, change: Partial<PlacedBuddy>) {
    setDraft((d) => d && d.map((b, i) => (i === index ? { ...b, ...change } : b)));
  }

  function startDrag(index: number, e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setSelected(index);
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = { index, dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onDragMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const card = cardRef.current;
    if (!drag || !card || !draft) return;
    const b = draft[drag.index];
    const width = buddyWidth(b.doc, b.height);
    const rect = card.getBoundingClientRect();
    const left = clamp(e.clientX - rect.left - drag.dx, 0, rect.width - width);
    const top = clamp(e.clientY - rect.top - drag.dy, 0, Math.min(MAX_Y, rect.height - b.height));
    update(drag.index, {
      x: rect.width > width ? Math.round((left / (rect.width - width)) * 100) : 0,
      y: Math.round(top),
    });
  }

  return (
    <>
      <div
        className="absolute inset-0"
        style={{ pointerEvents: editing ? "auto" : "none", zIndex: editing ? 4 : undefined }}
        onPointerMove={editing ? onDragMove : undefined}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerDown={editing ? () => setSelected(null) : undefined}
        data-testid="buddy-layer"
      >
        {buddies.map((b, i) => (
          <BuddySprite
            key={`${b.artId}-${i}`}
            buddy={b}
            index={i}
            editing={editing}
            selected={editing && selected === i}
            onPointerDown={editing ? (e) => startDrag(i, e) : undefined}
          />
        ))}
      </div>
      {editing && draft && (
        <BuddyToolbar
          cardRef={cardRef}
          buddies={draft}
          selected={selected}
          onSelect={setSelected}
          onChange={update}
          onAdd={(doc, artId) => {
            const height = snapHeight(doc, 48);
            // Stagger new buddies across the banner so they don't land on top of each other.
            const x = 15 + ((draft.length * 23) % 75);
            setDraft((d) => d && [...d, { artId, doc, x, y: Math.max(0, 88 - height), height, flip: false, front: false }]);
            setSelected(draft.length);
          }}
          onRemove={(index) => {
            setDraft((d) => d && d.filter((_, i) => i !== index));
            setSelected(null);
          }}
          onCancel={() => onEditingChange(false)}
          onSave={async () => {
            await usePixelArtStore.getState().setBuddies(draft.map(({ artId, x, y, height, flip, front }) => ({ artId, x, y, height, flip, front })));
            await usePixelArtStore.getState().loadProfile(userId);
            onEditingChange(false);
          }}
        />
      )}
      <style>{`
        .buddy-idle { animation: buddy-bob 1.8s ease-in-out infinite alternate; }
        @keyframes buddy-bob { from { transform: translateY(0); } to { transform: translateY(-3px); } }
        @media (prefers-reduced-motion: reduce) { .buddy-idle { animation: none; } }
      `}</style>
    </>
  );
}

function BuddyToolbar({ cardRef, buddies, selected, onSelect, onChange, onAdd, onRemove, onCancel, onSave }: {
  cardRef: React.RefObject<HTMLElement | null>;
  buddies: PlacedBuddy[];
  selected: number | null;
  onSelect: (index: number | null) => void;
  onChange: (index: number, change: Partial<PlacedBuddy>) => void;
  onAdd: (doc: PixelArtDoc, artId: string) => void;
  onRemove: (index: number) => void;
  onCancel: () => void;
  onSave: () => Promise<void>;
}) {
  const gallery = usePixelArtStore((s) => s.gallery);
  const loadGallery = usePixelArtStore((s) => s.loadGallery);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!gallery) loadGallery().catch(() => setError("Couldn't load your art."));
  }, [gallery, loadGallery]);

  // Escape leaves arrange mode without closing the profile card.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCancel();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  // Sit beside the card (left if there's no room on the right).
  useLayoutEffect(() => {
    const card = cardRef.current?.getBoundingClientRect();
    const width = toolbarRef.current?.offsetWidth ?? 240;
    const el = toolbarRef.current;
    if (!card || !el) return;
    const right = card.right + 10;
    const left = right + width > window.innerWidth - 8 ? Math.max(8, card.left - width - 10) : right;
    // Written straight to the element: a measurement, not render state.
    el.style.left = `${left}px`;
    el.style.top = `${Math.max(8, card.top)}px`;
  }, [cardRef, picking]);

  const current = selected !== null ? buddies[selected] : null;
  const muted = { color: "var(--color-dc-text-muted)" };
  const pill = { backgroundColor: "var(--color-dc-bg-secondary)", color: "var(--color-dc-text-normal)" };
  const full = buddies.length >= MAX_BUDDIES;

  async function save() {
    setBusy(true);
    setError("");
    try {
      await onSave();
    } catch (err) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Couldn't save your buddies.");
      setBusy(false);
    }
  }

  return createPortal(
    <div
      ref={toolbarRef}
      data-avatar-lightbox
      role="dialog"
      aria-label="Arrange buddies"
      className="fixed z-[10001] w-60 rounded-xl p-3 shadow-2xl flex flex-col gap-3 text-sm"
      style={{ left: -9999, top: 0, backgroundColor: "var(--color-dc-bg-floating)", color: "var(--color-dc-text-normal)", border: "1px solid rgba(255,255,255,0.06)" }}
    >
      <div>
        <div className="flex items-baseline justify-between">
          <span className="font-semibold">Buddies</span>
          <span className="text-xs tabular-nums" style={muted}>{buddies.length}/{MAX_BUDDIES}</span>
        </div>
        <p className="text-xs mt-0.5" style={muted}>Drag them anywhere on your card.</p>
      </div>

      {buddies.length > 0 && (
        <div className="flex gap-1.5 flex-wrap" role="radiogroup" aria-label="Your buddies">
          {buddies.map((b, i) => (
            <button
              key={`${b.artId}-${i}`}
              role="radio"
              aria-checked={selected === i}
              aria-label={`Buddy ${i + 1}`}
              onClick={() => onSelect(i)}
              className="w-10 h-10 rounded-md flex items-center justify-center"
              style={{ backgroundColor: "var(--color-dc-bg-tertiary)", outline: selected === i ? "2px solid var(--color-dc-brand)" : undefined }}
            >
              <ArtThumb doc={b.doc} size={30} />
            </button>
          ))}
        </div>
      )}

      {current && selected !== null && (
        <div className="flex flex-col gap-2 rounded-lg p-2" style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}>
          <label className="flex items-center gap-2 text-xs" style={muted}>
            Size
            <input
              type="range"
              min={MIN_HEIGHT}
              max={MAX_HEIGHT}
              value={current.height}
              onChange={(e) => onChange(selected, { height: snapHeight(current.doc, Number(e.target.value)) })}
              className="flex-1 accent-[var(--color-dc-brand)]"
              aria-label="Buddy size"
            />
            <span className="w-9 text-right tabular-nums">{current.height}px</span>
          </label>
          <div className="flex gap-1">
            <button onClick={() => onChange(selected, { flip: !current.flip })} aria-pressed={current.flip} className="flex-1 h-7 rounded text-xs" style={current.flip ? { backgroundColor: "var(--color-dc-brand)", color: "#fff" } : pill}>
              Flip
            </button>
            <button
              onClick={() => onChange(selected, { front: !current.front })}
              className="flex-1 h-7 rounded text-xs"
              style={pill}
              title={current.front ? "Drawn over your card's text" : "Peeks out from behind your card's boxes"}
            >
              {current.front ? "In front" : "Behind"}
            </button>
            <button onClick={() => onRemove(selected)} aria-label="Remove buddy" className="w-8 h-7 rounded flex items-center justify-center" style={{ color: "var(--color-dc-red, #ed4245)", backgroundColor: "var(--color-dc-bg-tertiary)" }}>
              <Icon name="trash" size={14} />
            </button>
          </div>
        </div>
      )}

      {picking ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs" style={muted}>Pick from My art</span>
          {gallery && gallery.length > 0 ? (
            <div className="grid grid-cols-5 gap-1 max-h-40 overflow-y-auto">
              {gallery.map((a) => (
                <button
                  key={a.id}
                  onClick={() => { onAdd(a.doc, a.id); setPicking(false); }}
                  title={a.title || "Untitled"}
                  aria-label={`Add ${a.title || "untitled"}`}
                  className="w-10 h-10 rounded-md flex items-center justify-center hover:brightness-125"
                  style={{ backgroundColor: "var(--color-dc-bg-tertiary)" }}
                >
                  <ArtThumb doc={a.doc} size={30} />
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs" style={muted}>Save some art in the editor first.</p>
          )}
          <button onClick={() => setPicking(false)} className="h-7 rounded text-xs" style={pill}>Back</button>
        </div>
      ) : (
        <button onClick={() => setPicking(true)} disabled={full} className="h-8 rounded-md text-xs font-medium disabled:opacity-40" style={pill} title={full ? `At most ${MAX_BUDDIES} buddies` : undefined}>
          + Add buddy
        </button>
      )}

      {error && <p className="text-xs" style={{ color: "var(--color-dc-red, #ed4245)" }}>{error}</p>}
      <div className="flex gap-1.5 justify-end">
        <button onClick={onCancel} className="px-3 h-8 rounded-md text-xs" style={pill}>Cancel</button>
        <button onClick={() => void save()} disabled={busy} className="px-3 h-8 rounded-md text-xs font-medium text-white disabled:opacity-50" style={{ backgroundColor: "var(--color-dc-brand)" }}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
