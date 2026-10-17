import { useSettingsStore } from "../../stores/settingsStore";
import type { Decoration } from "../../types";
import { DEFAULT_DECORATION_OPACITY, decorationLeft, docImageUrl } from "./decorationImage";

/**
 * Decorations anchored to a message, drawn behind the whole message list. They
 * rely on the list wrapper being the stacking context (`isolation: isolate`) and
 * on rows not creating their own, so z-index -1 lands behind every row.
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
            data-decoration
            className="absolute pointer-events-none select-none"
            style={{
              left: decorationLeft(d.x, d.size),
              top: d.y,
              width: d.size,
              height: d.size,
              opacity: (d.opacity || DEFAULT_DECORATION_OPACITY) / 100,
              imageRendering: "pixelated",
              zIndex: -1,
            }}
          />
        );
      })}
    </>
  );
}
