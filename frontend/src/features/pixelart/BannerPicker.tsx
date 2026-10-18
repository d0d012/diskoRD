import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePixelArtStore } from "../../stores/pixelArtStore";
import type { ProfileBannerArt } from "../../types";
import { Icon } from "./Icon";
import { PixelArtEditor } from "./PixelArtEditor";
import { bannerArt } from "./bannerArt";
import { docImageUrl } from "./decorationImage";
import { createArt, findPreset, type Art } from "./lib/art";
import { BUILTIN_BANNERS } from "./lib/banners";
import { decodeDoc, encodeDoc, type PixelArtDoc } from "./lib/doc";
import { placeBeside } from "./placeBeside";

function BannerThumb({ doc, selected, label, onClick }: { doc: PixelArtDoc | null; selected: boolean; label: string; onClick: () => void }) {
  const url = useMemo(() => (doc ? docImageUrl(doc) : null), [doc]);
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={selected}
      title={label}
      className="relative rounded-md overflow-hidden transition-transform hover:scale-[1.03]"
      style={{ width: 150, height: 48, outline: selected ? "2px solid var(--color-dc-brand)" : "1px solid rgba(255,255,255,0.08)", outlineOffset: selected ? 2 : 0 }}
    >
      {url && <img src={url} alt="" draggable={false} style={{ width: 150, height: 48, imageRendering: "pixelated" }} />}
    </button>
  );
}

function sameBanner(a: ProfileBannerArt | null | undefined, b: ProfileBannerArt | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.builtin || b.builtin) return a.builtin === b.builtin;
  return !!a.doc && !!b.doc && a.doc.frames[0] === b.doc.frames[0];
}

/** Banner chooser shown beside your own profile card. */
export function BannerPicker({ userId, cardRef, onClose }: {
  userId: string;
  cardRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const current = usePixelArtStore((s) => s.profiles[userId]?.banner ?? null);
  const gallery = usePixelArtStore((s) => s.gallery);
  const loadGallery = usePixelArtStore((s) => s.loadGallery);
  const setBanner = usePixelArtStore((s) => s.setBanner);
  const [drawing, setDrawing] = useState<Art | null>(null);
  const [error, setError] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!gallery) loadGallery().catch(() => {});
  }, [gallery, loadGallery]);

  useLayoutEffect(() => {
    placeBeside(panelRef.current, cardRef.current);
  });

  // Escape closes the picker (the editor handles its own Escape while open).
  useEffect(() => {
    if (drawing) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drawing, onClose]);

  async function choose(banner: ProfileBannerArt | null) {
    setError("");
    try {
      await setBanner(userId, banner);
    } catch (err) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Couldn't change your banner.");
    }
  }

  function startDrawing() {
    const doc = bannerArt(current);
    // Start from the current banner so tweaking a built-in is one click away.
    setDrawing(doc ? decodeDoc(doc) : createArt(150, 48));
  }

  const ownBanners = (gallery ?? []).filter((a) => findPreset(a.doc.width, a.doc.height)?.banner);
  const muted = { color: "var(--color-dc-text-muted)" };
  const pill = { backgroundColor: "var(--color-dc-bg-secondary)", color: "var(--color-dc-text-normal)" };

  return (
    <>
      {createPortal(
        <div
          ref={panelRef}
          data-avatar-lightbox
          role="dialog"
          aria-label="Choose banner"
          className="fixed z-[10001] w-[336px] rounded-xl p-3 shadow-2xl flex flex-col gap-3 text-sm"
          style={{ left: -9999, top: 0, backgroundColor: "var(--color-dc-bg-floating)", color: "var(--color-dc-text-normal)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="flex items-baseline justify-between">
            <span className="font-semibold">Banner</span>
            <button onClick={onClose} aria-label="Close" className="w-6 h-6 rounded flex items-center justify-center hover:bg-[var(--color-dc-bg-modifier-hover)]" style={muted}>
              <Icon name="close" size={14} />
            </button>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={muted}>Scenes</p>
            <div className="grid grid-cols-2 gap-2">
              {BUILTIN_BANNERS.map((b) => (
                <BannerThumb
                  key={b.id}
                  label={b.label}
                  doc={bannerArt({ builtin: b.id })}
                  selected={sameBanner(current, { builtin: b.id })}
                  onClick={() => void choose({ builtin: b.id })}
                />
              ))}
            </div>
          </div>

          {ownBanners.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={muted}>From My art</p>
              <div className="grid grid-cols-2 gap-2 max-h-28 overflow-y-auto">
                {ownBanners.map((a) => (
                  <BannerThumb
                    key={a.id}
                    label={a.title || "Untitled banner"}
                    doc={a.doc}
                    selected={sameBanner(current, { doc: a.doc })}
                    onClick={() => void choose({ doc: a.doc })}
                  />
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-xs" style={{ color: "var(--color-dc-red, #ed4245)" }}>{error}</p>}
          <div className="flex gap-1.5">
            <button onClick={startDrawing} className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-md text-xs font-medium" style={{ backgroundColor: "var(--color-dc-brand)", color: "#fff" }}>
              <Icon name="brush" size={14} />
              {current ? "Edit or draw your own" : "Draw your own"}
            </button>
            {current && (
              <button onClick={() => void choose(null)} className="px-3 h-8 rounded-md text-xs" style={pill} title="Back to your banner color">
                Remove
              </button>
            )}
          </div>
          <p className="text-[11px]" style={muted}>Banners are 100 × 32 or 150 × 48 pixels and show on your profile card.</p>
        </div>,
        document.body,
      )}
      {drawing && (
        <PixelArtEditor
          initial={{ art: drawing }}
          primaryAction={{
            label: "Use as banner",
            subtitle: "Shows on your profile card",
            icon: "gallery",
            run: async (art) => {
              if (!findPreset(art.width, art.height)?.banner) return "Switch the canvas to a Banner size first.";
              await setBanner(userId, { doc: encodeDoc(art) });
              setDrawing(null);
            },
          }}
          onClose={() => setDrawing(null)}
        />
      )}
    </>
  );
}
