import { useRef } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import type { Decoration } from "../../types";
import { DEFAULT_DECORATION_OPACITY, decorationLeft } from "./decorationImage";
import { SharpArtImage } from "./SharpArtImage";
import { snapDevicePixel, useArtContainer, useDevicePixelRatio } from "./sharpScale";

function DecorationSprite({ decoration: d }: { decoration: Decoration }) {
  // A zero-size marker does not establish a stacking context or affect row layout.
  const ref = useRef<HTMLSpanElement>(null);
  const box = useArtContainer(ref, true);
  const dpr = useDevicePixelRatio();
  return <>
    <span ref={ref} className="absolute pointer-events-none" aria-hidden="true" />
    <SharpArtImage
      doc={d.doc} width={d.size} height={d.size}
      alt="" aria-hidden="true" draggable={false}
      data-testid="message-decoration" data-decoration
      className="absolute pointer-events-none select-none"
      style={{
        left: box ? snapDevicePixel(box.left + (box.width - d.size) * d.x / 100, dpr) - box.left : decorationLeft(d.x, d.size),
        top: box ? snapDevicePixel(box.top + d.y, dpr) - box.top : d.y,
        opacity: (d.opacity || DEFAULT_DECORATION_OPACITY) / 100,
        zIndex: -1,
      }}
    />
  </>;
}

/** Behind every message row; never create a per-row stacking context. */
export function MessageDecorations({ decorations }: { decorations?: Decoration[] }) {
  const show = useSettingsStore((s) => s.showDecorations);
  if (!show || !decorations?.length) return null;
  return <>{decorations.map((d) => <DecorationSprite key={d.id} decoration={d} />)}</>;
}
