import { useMemo } from "react";
import type { PixelArtDoc } from "./lib/doc";
import { fitScale, trimmedImage } from "./decorationImage";
import { useSharpArtUrl } from "./sharpScale";

/**
 * A piece fitted into a size×size box, trimmed to its visible pixels. Enlarges
 * by whole numbers so pixels stay crisp; shrinks smoothly so details don't break.
 */
export function ArtThumb({ doc, size, alt = "" }: { doc: PixelArtDoc; size: number; alt?: string }) {
  const image = useMemo(() => trimmedImage(doc), [doc]);
  const scale = image ? fitScale(image.width, image.height, size, size) : 1;
  const sharp = useSharpArtUrl(image, (image?.width ?? 0) * scale, (image?.height ?? 0) * scale);
  if (!image) return <span style={{ width: size, height: size }} />;
  return (
    <img
      src={sharp.url}
      alt={alt}
      draggable={false}
      className="drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)]"
      style={{
        width: image.width * scale,
        height: image.height * scale,
        imageRendering: sharp.imageRendering,
      }}
    />
  );
}
