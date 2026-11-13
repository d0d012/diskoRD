import "@fontsource/silkscreen/400.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuthStore } from "../../../stores/authStore";
import { usePixelArtStore } from "../../../stores/pixelArtStore";
import { useShowcaseOverlayStore } from "../../../stores/showcaseOverlayStore";
import { useUserStore } from "../../../stores/userStore";
import type { PixelArtPiece } from "../../../types";
import { GalleryPicker } from "../GalleryDialogs";
import { PixelArtEditor } from "../PixelArtEditor";
import { ShowcaseViewer } from "../ProfileShowcase";
import { bannerArt } from "../bannerArt";
import { fitScale } from "../decorationImage";
import { SharpArtImage } from "../SharpArtImage";
import { decodeDoc } from "../lib/doc";
import { MUSEUM as M, carpetTile, floorTile, glassStreaks, glintBand, lampTile, spotlight, wainscotTile, wallTile } from "./museumArt";
import "./museum.css";

const FONT = "'Silkscreen', ui-monospace, monospace";
/** Glass case inner sizes in room pixels. */
const HERO_BOX = 72;
const CASE_BOX = 44;
const FLOOR = 10;
const WAINSCOT = 24;

export function reorderPiece<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Room zoom: every room pixel is S CSS pixels, so the whole room stays crisp. */
function roomScale(): number {
  return Math.max(2, Math.min(4, Math.floor(Math.min(window.innerWidth / 300, window.innerHeight / 210))));
}

function pixelated(url: string, w: number, h: number, S: number): React.CSSProperties {
  return { backgroundImage: `url(${url})`, backgroundSize: `${w * S}px ${h * S}px`, imageRendering: "pixelated" };
}

/** Brass button in the room's style. */
function BrassButton({ S, children, onClick, active, label }: { S: number; children: React.ReactNode; onClick: () => void; active?: boolean; label?: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className="museum-btn"
      style={{
        fontFamily: FONT,
        fontSize: 4 * S,
        lineHeight: 1,
        color: M.ink,
        backgroundColor: active ? M.brassLight : M.brass,
        padding: `${2 * S}px ${3 * S}px`,
        border: `${S}px solid ${M.brassDark}`,
        boxShadow: `inset 0 ${S}px 0 ${M.brassLight}, inset 0 -${S}px 0 ${M.brassDark}`,
      }}
    >
      {children}
    </button>
  );
}

function Plaque({ S, piece, wide }: { S: number; piece: PixelArtPiece; wide?: boolean }) {
  const meta = piece.remixAuthor ? `remix of @${piece.remixAuthor.username}` : `${piece.doc.width} x ${piece.doc.height}`;
  return (
    <div
      style={{
        fontFamily: FONT,
        backgroundColor: M.brass,
        color: M.ink,
        border: `${S}px solid ${M.brassDark}`,
        boxShadow: `inset 0 ${S}px 0 ${M.brassLight}`,
        padding: `${S}px ${2 * S}px`,
        maxWidth: "100%",
        textAlign: "center",
        lineHeight: 1.15,
      }}
    >
      <div className="truncate" style={{ fontSize: (wide ? 5 : 4) * S }}>{piece.title || "Untitled"}</div>
      <div className="truncate" style={{ fontSize: 3 * S, opacity: 0.75 }}>{meta}</div>
    </div>
  );
}

/** One piece on display: spotlight, glass case with reflections, marble pedestal with a plaque. */
function Vitrine({ piece, index, S, box, hero, arranging, dragging, onOpen, onPointerDown }: {
  piece: PixelArtPiece;
  index: number;
  S: number;
  box: number;
  hero?: boolean;
  arranging: boolean;
  dragging: boolean;
  onOpen: () => void;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const inner = box * S;
  const artScale = fitScale(piece.doc.width, piece.doc.height, inner - 6 * S, inner - 6 * S);
  const lampGap = hero ? 18 : 12;
  // Light falls from the lamp onto the top of the case and fades out before
  // it reaches the art, so the piece itself stays clean.
  const coneW = box + 14;
  const coneH = lampGap + 3 + Math.floor(box * 0.3);
  const pedestalW = box + 10;
  const pedestalH = hero ? 34 : 28;
  const glint = glintBand(box);

  return (
    <div
      className="museum-case relative flex flex-col items-center flex-shrink-0"
      data-index={index}
      onPointerDown={onPointerDown}
      style={{ width: pedestalW * S, opacity: dragging ? 0.4 : 1, cursor: arranging ? "grab" : "pointer", touchAction: arranging ? "none" : undefined }}
    >
      <div aria-hidden="true" style={{ width: 12 * S, height: 5 * S, ...pixelated(lampTile(), 12, 5, S) }} />
      <div
        aria-hidden="true"
        className="museum-light absolute pointer-events-none"
        style={{ top: 5 * S, left: "50%", transform: "translateX(-50%)", width: coneW * S, height: coneH * S, zIndex: 2, mixBlendMode: "screen", opacity: 0.32, ...pixelated(spotlight(coneW, coneH), coneW, coneH, S) }}
      />
      <button
        onClick={arranging ? undefined : onOpen}
        aria-label={`View ${piece.title || "untitled pixel art"}`}
        className="museum-glass relative block"
        style={{ marginTop: lampGap * S, width: inner + 2 * S, cursor: arranging ? "grab" : "zoom-in", outline: arranging ? `${S}px dashed ${M.brassLight}` : undefined, outlineOffset: S }}
      >
        <div style={{ height: 3 * S, backgroundColor: M.brass, boxShadow: `inset 0 ${S}px 0 ${M.brassLight}, inset 0 -${S}px 0 ${M.brassDark}` }} />
        <div
          className="relative overflow-hidden flex items-center justify-center"
          style={{
            height: inner,
            borderLeft: `${S}px solid ${M.glassEdge}`,
            borderRight: `${S}px solid ${M.glassEdge}`,
            backgroundColor: "rgba(191,230,242,0.07)",
            backgroundImage: "radial-gradient(circle at 50% 35%, rgba(88,101,242,0.12), rgba(0,0,0,0.16) 75%)",
            boxShadow: "inset 0 2px 6px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.05)",
          }}
        >
          <SharpArtImage
            doc={piece.doc} width={piece.doc.width * artScale} height={piece.doc.height * artScale}
            alt=""
            draggable={false}
            style={{ filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.5))" }}
          />
          <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={pixelated(glassStreaks(box, box), box, box, S)} />
          <div
            aria-hidden="true"
            className="museum-glint absolute inset-0 pointer-events-none"
            style={{ ...pixelated(glint, box + 8, box, S), backgroundRepeat: "no-repeat", backgroundPositionX: -(box + 8) * S }}
          />
        </div>
        <div style={{ height: 2 * S, backgroundColor: M.brassDark }} />
      </button>
      <div className="flex flex-col items-center" style={{ width: pedestalW * S }}>
        <div style={{ width: "100%", height: 3 * S, backgroundColor: M.brass, boxShadow: `inset 0 ${S}px 0 ${M.brassLight}, inset 0 -${S}px 0 ${M.brassDark}` }} />
        <div
          className="flex items-start justify-center"
          style={{
            width: (pedestalW - 4) * S,
            height: pedestalH * S,
            paddingTop: 3 * S,
            backgroundColor: M.marble,
            boxShadow: `inset ${S}px 0 0 #fff8ec, inset -${2 * S}px 0 0 ${M.marbleDark}, inset 0 -${S}px 0 ${M.marbleShade}`,
          }}
        >
          <div style={{ width: (pedestalW - 10) * S }}>
            <Plaque S={S} piece={piece} wide={hero} />
          </div>
        </div>
        <div style={{ width: pedestalW * S, height: 2 * S, backgroundColor: M.marbleDark }} />
      </div>
    </div>
  );
}

/** Wall, wainscot and floor behind a row of cases. */
function Gallery({ S, children, carpet }: { S: number; children: React.ReactNode; carpet?: boolean }) {
  return (
    <div className="relative" style={{ paddingTop: 8 * S }}>
      <div aria-hidden="true" className="absolute left-0 right-0" style={{ bottom: FLOOR * S, height: WAINSCOT * S, ...pixelated(wainscotTile(), 16, 24, S) }} />
      <div aria-hidden="true" className="absolute left-0 right-0 bottom-0" style={{ height: FLOOR * S, ...pixelated(floorTile(), 16, 8, S) }} />
      {carpet && (
        <div
          aria-hidden="true"
          className="absolute bottom-0 left-1/2 -translate-x-1/2"
          style={{ width: (HERO_BOX + 40) * S, height: (FLOOR - 2) * S, borderTop: `${S}px solid ${M.carpetEdge}`, ...pixelated(carpetTile(), 8, 4, S) }}
        />
      )}
      <div className="relative flex items-end justify-center flex-wrap" style={{ gap: `0 ${10 * S}px`, paddingBottom: (FLOOR - 4) * S, paddingLeft: 6 * S, paddingRight: 6 * S }}>
        {children}
      </div>
    </div>
  );
}

function VelvetRope({ S, side }: { S: number; side: "left" | "right" }) {
  return (
    <div aria-hidden="true" className="flex items-end flex-shrink-0" style={{ flexDirection: side === "left" ? "row" : "row-reverse", alignSelf: "flex-end", marginBottom: 0 }}>
      <div className="flex flex-col items-center" style={{ width: 4 * S }}>
        <div style={{ width: 4 * S, height: 3 * S, backgroundColor: M.brassLight }} />
        <div style={{ width: 2 * S, height: 22 * S, backgroundColor: M.brass, boxShadow: `inset -${S}px 0 0 ${M.brassDark}` }} />
        <div style={{ width: 6 * S, height: 2 * S, backgroundColor: M.brassDark }} />
      </div>
      <div style={{ width: 14 * S, height: 4 * S, marginBottom: 18 * S, borderBottom: `${2 * S}px solid ${M.velvet}`, borderRadius: `0 0 ${8 * S}px ${8 * S}px` }} />
    </div>
  );
}

/** Full-screen pixel art museum of a user's showcase. */
export function ShowcaseMuseum({ userId, onClose }: { userId: string; onClose: () => void }) {
  const profile = usePixelArtStore((s) => s.profiles[userId]);
  const loadProfile = usePixelArtStore((s) => s.loadProfile);
  const setShowcase = usePixelArtStore((s) => s.setShowcase);
  const me = useAuthStore((s) => s.user);
  const user = useUserStore((s) => s.users[userId]);
  const isSelf = me?.id === userId;
  const name = (isSelf ? me?.displayName ?? me?.username : user?.displayName ?? user?.username) ?? "Someone";

  const [S, setS] = useState(roomScale);
  const [viewer, setViewer] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ piece: PixelArtPiece | null; remix: boolean } | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [order, setOrder] = useState<PixelArtPiece[] | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const dragFromRef = useRef<number | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const museumRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  const finishDrag = useCallback(() => {
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
    dragFromRef.current = null;
    setDragFrom(null);
  }, []);

  useEffect(() => {
    loadProfile(userId).catch(() => setError("Couldn't load this showcase."));
  }, [userId, loadProfile]);

  useEffect(() => {
    const onResize = () => setS(roomScale());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const overlayOpen = viewer !== null || editing !== null || galleryOpen;
  useEffect(() => {
    if (overlayOpen) return; // the viewer/editor/gallery handle their own Escape
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (order) {
        finishDrag();
        setOrder(null);
      } else onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [overlayOpen, order, onClose, finishDrag]);

  const pieces = order ?? profile?.showcase ?? [];
  const arranging = order !== null;
  // Also end any gesture started while a save was pending, or on unmount.
  useEffect(() => {
    if (arranging) return finishDrag;
  }, [arranging, finishDrag]);

  const [hero, ...rest] = pieces;
  const banner = profile ? bannerArt(profile.banner) : null;
  const bannerZoom = banner ? Math.max(1, Math.floor((150 * S) / banner.width)) : 1;

  function startDrag(index: number, e: React.PointerEvent<HTMLDivElement>) {
    if (!arranging || e.button !== 0 || !e.isPrimary || dragFromRef.current !== null) return;
    e.preventDefault();
    const pointerId = e.pointerId;
    dragFromRef.current = index;
    setDragFrom(index);

    // Slot 0 has a different parent, so reordering can unmount the pressed case.
    // Keep the gesture on window rather than capturing it on that case.
    function onMove(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      const from = dragFromRef.current;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-index]");
      if (from === null || !target || !museumRef.current?.contains(target)) return;
      const to = Number(target.getAttribute("data-index"));
      if (!Number.isInteger(to) || to < 0 || to >= pieces.length || from === to) return;
      dragFromRef.current = to;
      setDragFrom(to);
      setOrder((current) => current ? reorderPiece(current, from, to) : current);
    }
    function onEnd(event: PointerEvent) {
      if (event.pointerId === pointerId) finishDrag();
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    window.addEventListener("blur", finishDrag);
    dragCleanupRef.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("blur", finishDrag);
    };
  }

  async function saveOrder() {
    finishDrag();
    if (!order) return;
    setError("");
    try {
      await setShowcase(order.map((p) => p.id));
      await loadProfile(userId);
      setOrder(null);
    } catch {
      setError("Couldn't save the new order.");
    }
  }

  function vitrine(piece: PixelArtPiece, index: number, isHero = false) {
    return (
      <Vitrine
        key={piece.id}
        piece={piece}
        index={index}
        S={S}
        box={isHero ? HERO_BOX : CASE_BOX}
        hero={isHero}
        arranging={arranging}
        dragging={dragFrom === index}
        onOpen={() => setViewer(index)}
        onPointerDown={(e) => startDrag(index, e)}
      />
    );
  }

  return createPortal(
    <div
      ref={museumRef}
      role="dialog"
      aria-modal="true"
      aria-label={isSelf ? "Your showcase" : `${name}'s showcase`}
      className="showcase-museum dc-modal-backdrop-in fixed inset-0 z-[10001] overflow-y-auto"
      style={{ ...pixelated(wallTile(), 8, 8, S), backgroundColor: M.wall, fontFamily: FONT, "--museum-step": `${S}px`, "--museum-glint-from": `${-(CASE_BOX + 8) * S}px`, "--museum-glint-to": `${HERO_BOX * S}px` } as React.CSSProperties}
    >
      {/* Header: brass name sign and controls */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3" style={{ padding: `${3 * S}px ${6 * S}px`, backgroundColor: "rgba(20,12,24,0.88)", borderBottom: `${S}px solid ${M.brassDark}` }}>
        <div style={{ fontSize: 5 * S, color: M.brassLight, letterSpacing: S / 2 }} className="truncate">
          {isSelf ? "Your showcase" : `${name}'s showcase`}
          <span style={{ fontSize: 3 * S, color: M.brass, marginLeft: 3 * S }}>{pieces.length}/15</span>
        </div>
        <div className="flex items-center" style={{ gap: 2 * S }}>
          {isSelf && !arranging && pieces.length > 1 && <BrassButton S={S} onClick={() => setOrder([...(profile?.showcase ?? [])])}>Arrange</BrassButton>}
          {isSelf && arranging && (
            <>
              <BrassButton S={S} onClick={() => { finishDrag(); setOrder(null); }}>Cancel</BrassButton>
              <BrassButton S={S} active onClick={() => void saveOrder()}>Save order</BrassButton>
            </>
          )}
          {isSelf && !arranging && <BrassButton S={S} onClick={() => setGalleryOpen(true)}>My art</BrassButton>}
          <BrassButton S={S} onClick={onClose} label="Close showcase">X</BrassButton>
        </div>
      </div>

      {arranging && (
        <p className="text-center" style={{ fontSize: 4 * S, color: M.brassLight, padding: `${3 * S}px 0 0` }}>
          Drag the cases into a new order. The first one gets the big case.
        </p>
      )}
      {error && <p className="text-center" style={{ fontSize: 4 * S, color: "#ff8a8a", padding: `${2 * S}px 0` }}>{error}</p>}

      {/* Banner hung as a painting */}
      {banner && (
        <div className="flex justify-center" style={{ paddingTop: 8 * S }}>
          <div style={{ padding: 3 * S, backgroundColor: M.brass, border: `${S}px solid ${M.brassDark}`, boxShadow: `inset 0 ${S}px 0 ${M.brassLight}, 0 ${2 * S}px 0 rgba(0,0,0,0.35)` }}>
            <SharpArtImage doc={banner} width={banner.width * bannerZoom} height={banner.height * bannerZoom} alt="" draggable={false} style={{ display: "block", border: `${S}px solid ${M.brassDark}` }} />
          </div>
        </div>
      )}

      {!profile ? (
        <p className="text-center" style={{ fontSize: 5 * S, color: M.brassLight, paddingTop: 30 * S }}>Opening the doors…</p>
      ) : pieces.length === 0 ? (
        <Gallery S={S}>
          <div className="flex flex-col items-center" style={{ paddingBottom: 4 * S, gap: 4 * S }}>
            <p style={{ fontSize: 5 * S, color: M.brassLight }}>Nothing on display yet</p>
            {isSelf && <BrassButton S={S} onClick={() => setGalleryOpen(true)}>Put art on display</BrassButton>}
            <div style={{ width: 40 * S, height: 24 * S, backgroundColor: M.marble, boxShadow: `inset ${S}px 0 0 #fff8ec, inset -${2 * S}px 0 0 ${M.marbleDark}` }} />
          </div>
        </Gallery>
      ) : (
        <>
          <Gallery S={S} carpet>
            <VelvetRope S={S} side="left" />
            {hero && vitrine(hero, 0, true)}
            <VelvetRope S={S} side="right" />
          </Gallery>
          {rest.length > 0 && <Gallery S={S}>{rest.map((p, i) => vitrine(p, i + 1))}</Gallery>}
          <div style={{ height: 16 * S }} />
        </>
      )}

      {viewer !== null && pieces[viewer] && (
        <ShowcaseViewer
          pieces={pieces}
          index={viewer}
          isSelf={isSelf}
          onIndex={setViewer}
          onRemix={(piece) => { setViewer(null); setEditing({ piece, remix: !isSelf }); }}
          onClose={() => setViewer(null)}
        />
      )}
      {editing && (
        <PixelArtEditor
          initial={editing.piece ? {
            art: decodeDoc(editing.piece.doc),
            title: editing.piece.title,
            galleryId: editing.remix ? null : editing.piece.id,
            remixOf: editing.remix ? editing.piece.id : editing.piece.remixOf,
          } : undefined}
          onClose={() => { setEditing(null); void loadProfile(userId).catch(() => {}); }}
        />
      )}
      {galleryOpen && (
        <GalleryPicker
          onOpen={(piece) => { setGalleryOpen(false); setEditing({ piece, remix: false }); }}
          onClose={() => { setGalleryOpen(false); void loadProfile(userId).catch(() => {}); }}
        />
      )}
    </div>,
    document.body,
  );
}

/** Mounted once at the app root; shows the museum when someone opens a showcase. */
export function ShowcaseMuseumHost() {
  const userId = useShowcaseOverlayStore((s) => s.userId);
  const close = useShowcaseOverlayStore((s) => s.close);
  if (!userId) return null;
  return <ShowcaseMuseum key={userId} userId={userId} onClose={close} />;
}
