import { useMemo, type ImgHTMLAttributes } from "react";
import { docImage } from "./decorationImage";
import type { PixelArtDoc } from "./lib/doc";
import { useSharpArtUrl } from "./sharpScale";

/** Shared display path for full-canvas art (trimmed art uses the same hook). */
export function SharpArtImage({ doc, width, height, style, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height"> & { doc: PixelArtDoc; width: number; height: number }) {
  const image = useMemo(() => docImage(doc), [doc]);
  const sharp = useSharpArtUrl(image, width, height);
  if (!sharp.url) return null;
  return <img {...props} src={sharp.url} style={{ ...style, width, height, imageRendering: sharp.imageRendering }} />;
}
