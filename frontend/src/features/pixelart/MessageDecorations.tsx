import { useSettingsStore } from "../../stores/settingsStore";
import type { Decoration } from "../../types";
import { DECORATION_OPACITY, decorationLeft, docImageUrl } from "./decorationImage";

/**
 * Decorations drawn behind a message's content. The row must be an isolated
 * stacking context (`isolation: isolate`) so z-index -1 stays above the row's
 * own background but below its text.
 */
export function MessageDecorations({ decorations }: { decorations?: Decoration[] }) {
  const show = useSettingsStore((s) => s.showDecorations);
  if (!show || !decorations?.length) return null;
  return (
    <>
      {decorations.map((d) => {
        const url = docImageUrl(d.doc);
        if (!url) return null;
        return (
          <img
            key={d.id}
            src={url}
            alt=""
            aria-hidden="true"
            draggable={false}
            data-testid="message-decoration"
            className="absolute pointer-events-none select-none"
            style={{
              left: decorationLeft(d.x, d.size),
              top: d.y,
              width: d.size,
              height: d.size,
              opacity: DECORATION_OPACITY,
              imageRendering: "pixelated",
              zIndex: -1,
            }}
          />
        );
      })}
    </>
  );
}
