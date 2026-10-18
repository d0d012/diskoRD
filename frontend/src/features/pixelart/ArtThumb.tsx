import { useMemo } from "react";
import type { PixelArtDoc } from "./lib/doc";
import { fitScale, trimmedImage } from "./decorationImage";

/**
 * A piece fitted into a size×size box, trimmed to its visible pixels. Enlarges
 * by whole numbers so pixels stay crisp; shrinks smoothly so details don't break.
 */
export function ArtThumb({ doc, size, alt = "" }: { doc: PixelArtDoc; size: number; alt?: string }) {
  const image = useMemo(() => trimmedImage(doc), [doc]);
  if (!image) return <span style={{ width: size, height: size }} />;
  const scale = fitScale(image.width, image.height, size, size);
  return (
    <img
      src={image.url}
      alt={alt}
      draggable={false}
      style={{
        width: image.width * scale,
        height: image.height * scale,
        imageRendering: scale >= 1 ? "pixelated" : "auto",
      }}
    />
  );
}
