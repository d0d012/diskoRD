import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import type { TrimmedImage } from "./decorationImage";

/** CSS downscales retain smooth filtering, regardless of display density. */
export function sharpScale(width: number, height: number, cssW: number, cssH: number, dpr: number) {
  const x = cssW * dpr / width;
  const y = cssH * dpr / height;
  const downscale = cssW < width || cssH < height;
  const exact = !downscale && [x, y].every((n) => Math.abs(n - Math.round(n)) < 1e-8);
  return { k: downscale || exact ? 1 : Math.max(1, Math.ceil(Math.max(x, y))), imageRendering: exact ? "pixelated" as const : "auto" as const };
}

const cache = new Map<string, string>();
const CACHE_LIMIT = 64;

/** Nearest-neighbour pre-enlargement, then browser bilinear downsampling. */
export function sharpArt(image: TrimmedImage, cssW: number, cssH: number, dpr: number) {
  const { k, imageRendering } = sharpScale(image.width, image.height, cssW, cssH, dpr);
  if (k === 1) return { url: image.url, imageRendering };
  const key = `${image.url}|${image.width}x${image.height}|${k}`;
  let url = cache.get(key);
  if (url) {
    cache.delete(key);
    cache.set(key, url);
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = image.width * k;
    canvas.height = image.height * k;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { url: image.url, imageRendering };
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image.canvas, 0, 0, canvas.width, canvas.height);
    url = canvas.toDataURL("image/png");
    cache.set(key, url);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  }
  return { url, imageRendering };
}

export function useDevicePixelRatio() {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    // Re-arm for the new resolution after moving between screens or zooming.
    const media = window.matchMedia?.(`(resolution: ${dpr}dppx)`);
    const update = () => setDpr(window.devicePixelRatio || 1);
    media?.addEventListener("change", update);
    window.addEventListener("resize", update);
    update();
    return () => {
      media?.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, [dpr]);
  return dpr;
}

export function useSharpArtUrl(image: TrimmedImage | null, cssW: number, cssH: number) {
  const dpr = useDevicePixelRatio();
  return image ? sharpArt(image, cssW, cssH, dpr) : { url: undefined, imageRendering: "auto" as const };
}

export function snapDevicePixel(value: number, dpr: number) {
  return Math.round(value * dpr) / dpr;
}

/** Observe layout only on mount/resize, never on scroll or animation frames. */
export function useArtContainer(ref: RefObject<HTMLElement | null>, parent = false) {
  const [box, setBox] = useState<{ width: number; height: number; left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const element = parent ? ref.current?.offsetParent as HTMLElement | null : ref.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setBox({ width: element.clientWidth || rect.width, height: element.clientHeight || rect.height, left: rect.left + element.clientLeft, top: rect.top + element.clientTop });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [ref, parent]);
  return box;
}
