import { MAX_COLORS, findPreset, type Art } from "./art";

/** Portable file format (`.pixel.json`), also what the gallery will store server side. */
export interface PixelArtDoc {
  v: 1;
  width: number;
  height: number;
  /** "#rrggbb"; pixel value k refers to palette[k - 1], 0 is transparent. */
  palette: string[];
  /** base64 of width*height palette indices; one frame until animation lands. */
  frames: string[];
}

const HEX = /^#[0-9a-f]{6}$/i;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeDoc(art: Art): PixelArtDoc {
  return { v: 1, width: art.width, height: art.height, palette: [...art.palette], frames: [toBase64(art.pixels)] };
}

/** Parses and validates a doc; throws an Error with a user-facing message. */
export function decodeDoc(input: unknown): Art {
  const doc = input as Partial<PixelArtDoc> | null;
  if (!doc || doc.v !== 1) throw new Error("Not a diskoRD pixel art file.");
  const { width, height } = doc;
  if (typeof width !== "number" || typeof height !== "number" || !findPreset(width, height)) {
    throw new Error("Unsupported canvas size.");
  }
  const palette = doc.palette;
  if (!Array.isArray(palette) || palette.length < 1 || palette.length > MAX_COLORS || !palette.every((c) => typeof c === "string" && HEX.test(c))) {
    throw new Error("Invalid palette.");
  }
  if (!Array.isArray(doc.frames) || doc.frames.length < 1 || typeof doc.frames[0] !== "string") {
    throw new Error("Missing pixel data.");
  }
  let pixels: Uint8Array;
  try {
    pixels = fromBase64(doc.frames[0]);
  } catch {
    throw new Error("Corrupt pixel data.");
  }
  if (pixels.length !== width * height || pixels.some((p) => p > palette.length)) {
    throw new Error("Corrupt pixel data.");
  }
  return { width, height, palette: palette.map((c) => c.toLowerCase()), pixels };
}
