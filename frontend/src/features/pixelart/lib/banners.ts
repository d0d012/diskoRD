import type { Art } from "./art";

/**
 * Built-in profile banners, drawn in code at any banner resolution
 * (100×32 or 150×48). Coordinates are written for a 150×48 canvas and scaled,
 * so both sizes show the same scene; 150×48 has the finer detail.
 */

export const BUILTIN_BANNERS = [
  { id: "meadow", label: "Sunny meadow" },
  { id: "sunset", label: "Sunset peaks" },
  { id: "night", label: "Starry night" },
  { id: "snow", label: "Snowy pines" },
  { id: "beach", label: "Beach day" },
  { id: "city", label: "City dusk" },
] as const;

export type BuiltinBannerId = (typeof BUILTIN_BANNERS)[number]["id"];

export function isBuiltinBanner(id: string): id is BuiltinBannerId {
  return BUILTIN_BANNERS.some((b) => b.id === id);
}

/** Tiny deterministic PRNG so stars, windows and flowers land in the same place every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Canvas {
  readonly width: number;
  readonly height: number;
  readonly palette: string[];
  readonly pixels: Uint8Array;
  readonly k: number;

  constructor(width: number, height: number, palette: string[]) {
    this.width = width;
    this.height = height;
    this.palette = palette;
    this.pixels = new Uint8Array(width * height);
    this.k = width / 150;
  }

  /** Scales a 150×48-space coordinate to this canvas. */
  s(v: number): number {
    return Math.round(v * this.k);
  }

  set(x: number, y: number, c: number) {
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.pixels[y * this.width + x] = c;
  }

  get(x: number, y: number): number {
    return x >= 0 && y >= 0 && x < this.width && y < this.height ? this.pixels[y * this.width + x] : 0;
  }

  /** Rectangle in 150×48 space. */
  rect(x: number, y: number, w: number, h: number, c: number) {
    const x0 = this.s(x), y0 = this.s(y), x1 = this.s(x + w), y1 = this.s(y + h);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.set(xx, yy, c);
  }

  /** Filled disc in 150×48 space. */
  disc(cx: number, cy: number, r: number, c: number) {
    const X = cx * this.k, Y = cy * this.k, R = r * this.k;
    for (let y = Math.floor(Y - R); y <= Math.ceil(Y + R); y++) {
      for (let x = Math.floor(X - R); x <= Math.ceil(X + R); x++) {
        if ((x + 0.5 - X) ** 2 + (y + 0.5 - Y) ** 2 <= R * R) this.set(x, y, c);
      }
    }
  }

  /**
   * Vertical gradient from y0 to y1 through `colors`, with a checker dither
   * between neighbouring bands so it reads as smooth at low resolution.
   */
  gradient(y0: number, y1: number, colors: number[]) {
    const a = this.s(y0), b = this.s(y1);
    const span = Math.max(1, b - a);
    for (let y = a; y < b; y++) {
      const t = ((y - a) / span) * (colors.length - 1);
      const i = Math.floor(t);
      const frac = t - i;
      for (let x = 0; x < this.width; x++) {
        // Ordered dither: blend into the next band over the last third of each band.
        const next = frac > 0.66 || (frac > 0.33 && (x + y) % 2 === 0);
        this.set(x, y, colors[Math.min(colors.length - 1, next ? i + 1 : i)]);
      }
    }
  }

  /** Fills everything below a ridgeline f(x in 150-space) → y in 150-space. */
  ridge(f: (x: number) => number, c: number, bottom = 48) {
    const yb = this.s(bottom);
    for (let x = 0; x < this.width; x++) {
      const top = Math.round(f(x / this.k) * this.k);
      for (let y = Math.max(0, top); y < yb; y++) this.set(x, y, c);
    }
  }

  /** Pine tree with its base at (x, base) in 150-space, `h` tall. */
  pine(x: number, base: number, h: number, c: number, trunk: number, cap?: number) {
    const X = this.s(x), B = this.s(base), H = Math.max(4, this.s(h));
    for (let i = 0; i < H; i++) {
      const y = B - 2 - i;
      // Three stacked tiers that taper toward the top.
      const tier = (i % Math.max(2, Math.floor(H / 3))) / Math.max(2, Math.floor(H / 3));
      const half = Math.max(0, Math.round(((H - i) / H) * (H / 3.2) * (1 - tier * 0.45)));
      for (let dx = -half; dx <= half; dx++) this.set(X + dx, y, cap !== undefined && i > 0 && Math.abs(dx) === half && (i % 3 === 0) ? cap : c);
    }
    if (cap !== undefined) this.set(X, B - 2 - H, cap);
    this.set(X, B - 1, trunk);
    this.set(X, B - 2, trunk);
  }

  /** Round leafy tree with its base at (x, base) in 150-space. */
  tree(x: number, base: number, r: number, leaf: number, light: number, trunk: number) {
    this.rect(x - 0.7, base - r * 1.2, 1.4, r * 1.2, trunk);
    this.disc(x, base - r * 1.6, r, leaf);
    this.disc(x - r * 0.35, base - r * 1.95, r * 0.45, light);
  }

  /** Puffy cloud in 150-space. */
  cloud(x: number, y: number, w: number, c: number, shade: number) {
    this.rect(x, y, w, 2.4, shade);
    this.rect(x + w * 0.05, y - 1.6, w * 0.9, 2.4, c);
    this.disc(x + w * 0.3, y - 2, w * 0.18, c);
    this.disc(x + w * 0.62, y - 2.6, w * 0.22, c);
  }

  toArt(): Art {
    return { width: this.width, height: this.height, palette: [...this.palette], pixels: this.pixels };
  }
}

function meadow(c: Canvas) {
  // 1 sky dark, 2 sky, 3 sky light, 4 sun, 5 sun glow, 6 cloud, 7 cloud shade,
  // 8 far hill, 9 hill, 10 near hill, 11 tree, 12 tree light, 13 trunk, 14 flower red, 15 flower yellow
  c.rect(0, 0, 150, 48, 3); // base fill (sky light) so no pixel is left transparent
  c.gradient(0, 30, [1, 2, 3]);
  c.disc(118, 10, 7, 5);
  c.disc(118, 10, 5, 4);
  c.cloud(18, 11, 22, 6, 7);
  c.cloud(62, 7, 15, 6, 7);
  c.cloud(88, 17, 12, 6, 7);
  c.ridge((x) => 27 + Math.sin(x / 17) * 3 + Math.sin(x / 7) * 1, 8);
  c.ridge((x) => 32 + Math.sin(x / 23 + 1.3) * 3.2, 9);
  c.ridge((x) => 39 + Math.sin(x / 31 + 2) * 2, 10);
  c.tree(16, 33, 4, 11, 12, 13);
  c.tree(27, 31, 3, 11, 12, 13);
  c.tree(132, 34, 4.5, 11, 12, 13);
  const r = rng(7);
  for (let i = 0; i < c.s(40); i++) {
    const x = Math.floor(r() * c.width), y = c.s(40) + Math.floor(r() * (c.height - c.s(40)));
    if (c.get(x, y) === 10) c.set(x, y, r() > 0.5 ? 14 : 15);
  }
}

function sunset(c: Canvas) {
  // 1 violet, 2 magenta, 3 rose, 4 orange, 5 gold, 6 sun, 7 far peaks, 8 near peaks, 9 lake, 10 lake glint, 11 bird
  c.rect(0, 0, 150, 48, 9); // base fill (lake) so no pixel is left transparent
  c.gradient(0, 34, [1, 2, 3, 4, 5]);
  c.disc(75, 33, 12, 6);
  c.ridge((x) => 26 + Math.abs(((x * 1.3) % 30) - 15) * 0.55 + Math.sin(x / 5) * 0.8, 7, 38);
  c.ridge((x) => 31 + Math.abs(((x * 0.9 + 11) % 40) - 20) * 0.45, 8, 38);
  c.rect(0, 38, 150, 10, 9);
  for (let y = 39; y < 48; y += 2) c.rect(75 - (48 - y) * 0.9, y, (48 - y) * 1.8, 1, 10);
  for (const [bx, by] of [[30, 9], [36, 7], [42, 10]] as const) {
    c.set(c.s(bx) - 1, c.s(by), 11); c.set(c.s(bx), c.s(by) + 1, 11); c.set(c.s(bx) + 1, c.s(by), 11);
  }
}

function night(c: Canvas) {
  // 1 deep, 2 navy, 3 indigo, 4 star, 5 star dim, 6 moon, 7 moon shade, 8 far hills, 9 pines, 10 firefly
  c.rect(0, 0, 150, 48, 9); // base fill (pines) so no pixel is left transparent
  c.gradient(0, 44, [1, 2, 3]);
  const r = rng(42);
  for (let i = 0; i < c.s(70); i++) {
    const x = Math.floor(r() * c.width), y = Math.floor(r() * c.s(32));
    c.set(x, y, r() > 0.7 ? 4 : 5);
  }
  c.disc(120, 11, 6, 6);
  c.disc(122.5, 9.5, 5, 7);
  c.ridge((x) => 33 + Math.sin(x / 13) * 2.5 + Math.sin(x / 5) * 0.8, 8);
  for (let x = 2; x < 150; x += 7) c.pine(x + ((x * 7) % 4), 48, 10 + ((x * 13) % 7), 9, 9);
  for (let i = 0; i < 9; i++) c.set(Math.floor(r() * c.width), c.s(36) + Math.floor(r() * c.s(8)), 10);
}

function snow(c: Canvas) {
  // 1 sky top, 2 sky, 3 sky low, 4 mountain, 5 mountain snow, 6 snow, 7 snow shade, 8 pine, 9 pine snow, 10 trunk, 11 flake
  c.rect(0, 0, 150, 48, 6); // base fill (snow) so no pixel is left transparent
  c.gradient(0, 36, [1, 2, 3]);
  c.ridge((x) => 14 + Math.abs(((x + 20) % 60) - 30) * 0.5, 4, 40);
  c.ridge((x) => 14 + Math.abs(((x + 20) % 60) - 30) * 0.5 + 3, 5, 40);
  c.ridge((x) => 17 + Math.abs(((x + 20) % 60) - 30) * 0.5, 4, 40);
  c.ridge((x) => 36 + Math.sin(x / 19) * 2, 7);
  c.ridge((x) => 38 + Math.sin(x / 19) * 2, 6);
  for (const [x, h] of [[12, 16], [22, 12], [104, 14], [116, 18], [128, 11], [140, 15]] as const) c.pine(x, 44, h, 8, 10, 9);
  const r = rng(3);
  for (let i = 0; i < c.s(60); i++) {
    const x = Math.floor(r() * c.width), y = Math.floor(r() * c.s(36));
    if (c.get(x, y) <= 3) c.set(x, y, 11);
  }
}

function beach(c: Canvas) {
  // 1 sky, 2 sky light, 3 sun, 4 cloud, 5 sea deep, 6 sea, 7 foam, 8 sand, 9 sand shade, 10 palm leaf, 11 palm dark, 12 trunk
  c.rect(0, 0, 150, 48, 8); // base fill (sand) so no pixel is left transparent
  c.gradient(0, 26, [1, 2]);
  c.disc(28, 9, 5, 3);
  c.cloud(70, 9, 18, 4, 2);
  c.cloud(112, 6, 12, 4, 2);
  c.rect(0, 26, 150, 9, 5);
  c.rect(0, 30, 150, 6, 6);
  for (let x = 0; x < 150; x += 9) c.rect(x, 29 + ((x / 9) % 2), 4, 1, 7);
  c.ridge((x) => 36 + Math.sin(x / 11) * 1.2, 7, 38);
  c.ridge((x) => 37 + Math.sin(x / 11) * 1.2, 8);
  c.ridge((x) => 44 + Math.sin(x / 8) * 1, 9);
  // Palm: a curved trunk and a fan of leaves.
  for (let i = 0; i < 18; i++) c.rect(120 + Math.sin(i / 7) * 4, 40 - i, 1.4, 1, 12);
  const top = [123.5, 22] as const;
  for (const [dx, dy] of [[-9, 3], [-6, 5], [7, 3], [9, 6], [0, -3], [-4, -2], [4, -2]] as const) {
    for (let t = 0; t <= 1; t += 0.1) c.rect(top[0] + dx * t, top[1] + dy * t + Math.sin(t * 3) * 1.2, 1.4, 1, t > 0.6 ? 11 : 10);
  }
}

function city(c: Canvas) {
  // 1 dusk top, 2 dusk, 3 dusk low, 4 glow, 5 moon, 6 far buildings, 7 buildings, 8 window lit, 9 window warm, 10 street
  c.rect(0, 0, 150, 48, 10); // base fill (street) so no pixel is left transparent
  c.gradient(0, 40, [1, 2, 3, 4]);
  c.disc(26, 10, 4.5, 5);
  const r = rng(11);
  let x = 0;
  while (x < 150) {
    const w = 6 + Math.floor(r() * 8), h = 10 + Math.floor(r() * 14);
    c.rect(x, 40 - h - 6, w, h + 6, 6);
    x += w - 1;
  }
  x = -3;
  while (x < 150) {
    const w = 7 + Math.floor(r() * 9), h = 12 + Math.floor(r() * 20);
    c.rect(x, 44 - h, w, h, 7);
    for (let wy = 44 - h + 2; wy < 42; wy += 3) {
      for (let wx = x + 1.5; wx < x + w - 1; wx += 2.5) if (r() > 0.45) c.rect(wx, wy, 1, 1, r() > 0.5 ? 8 : 9);
    }
    x += w + (r() > 0.6 ? 1 : 0);
  }
  c.rect(0, 44, 150, 4, 10);
}

const SCENES: Record<BuiltinBannerId, { palette: string[]; draw: (c: Canvas) => void }> = {
  meadow: {
    palette: ["#4aa3df", "#7cc4ef", "#b5e1f7", "#ffe76a", "#fff3b0", "#ffffff", "#d7eaf5", "#8fcf7a", "#5fae4e", "#3f8a3a", "#2e6b30", "#4f9f45", "#6d4c41", "#e5484d", "#ffd23f"],
    draw: meadow,
  },
  sunset: {
    palette: ["#3b2a63", "#7a2f73", "#c2416b", "#f0794e", "#f6b25b", "#ffe08a", "#5b2d5e", "#2c1a3a", "#4a2b52", "#f6b25b", "#1a1022"],
    draw: sunset,
  },
  night: {
    palette: ["#070b1f", "#111a3d", "#1f2b5c", "#fff6c9", "#8f9bd1", "#f5f0d0", "#111a3d", "#18234a", "#0a1024", "#d8f36a"],
    draw: night,
  },
  snow: {
    palette: ["#8fb4d8", "#b7d1ea", "#dbe9f6", "#7d8fa6", "#f4f8fc", "#f4f8fc", "#c9d8e8", "#1f4d3a", "#e8f1f8", "#5d4037", "#ffffff"],
    draw: snow,
  },
  beach: {
    palette: ["#38a9e0", "#8fd3f4", "#ffe066", "#ffffff", "#1f6fb2", "#2a93c9", "#e9f7fb", "#f2d39b", "#d9b778", "#3fa34d", "#2a7a37", "#8d6e4a"],
    draw: beach,
  },
  city: {
    palette: ["#1d1640", "#3b2a6b", "#7a3f8a", "#e07a6a", "#fff2c4", "#2a2350", "#16122e", "#ffd76a", "#ff9f5a", "#0d0b1d"],
    draw: city,
  },
};

const cache = new Map<string, Art>();

/** The built-in scene at the given banner resolution (150×48 by default). */
export function builtinBanner(id: BuiltinBannerId, width = 150, height = 48): Art {
  const key = `${id}:${width}x${height}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const scene = SCENES[id];
  const canvas = new Canvas(width, height, scene.palette);
  scene.draw(canvas);
  const art = canvas.toArt();
  cache.set(key, art);
  return art;
}
