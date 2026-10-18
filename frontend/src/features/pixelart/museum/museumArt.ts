/**
 * Pixel art pieces of the showcase museum, generated as tiny images in "room
 * pixels". CSS scales them by the room zoom with image-rendering: pixelated,
 * so the whole room stays crisp at any zoom and costs a few KB.
 */

type Draw = (set: (x: number, y: number, color: string) => void) => void;

const cache = new Map<string, string>();

function paint(key: string, width: number, height: number, draw: Draw): string {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let url = "";
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      draw((x, y, color) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      });
      url = canvas.toDataURL("image/png");
    }
  } catch {
    url = "";
  }
  cache.set(key, url);
  return url;
}

export const MUSEUM = {
  wall: "#2b1d33",
  wallStripe: "#32233b",
  wallFleck: "#3b2945",
  woodDark: "#3a2418",
  wood: "#4e3020",
  woodLight: "#6e4529",
  woodRail: "#8a5a34",
  baseboard: "#24150d",
  floorA: "#221f29",
  floorB: "#2c2835",
  floorVein: "#3a3545",
  brass: "#c9a24a",
  brassLight: "#f0d27a",
  brassDark: "#8a6a22",
  marble: "#e8e2d6",
  marbleShade: "#c9c1b2",
  marbleDark: "#a39a8a",
  marbleVein: "#d6cebf",
  glassEdge: "#bfe6f2",
  light: "#ffe9b0",
  velvet: "#9b1c2e",
  velvetLight: "#c4293f",
  carpet: "#7d1424",
  carpetEdge: "#c9a24a",
  ink: "#3b2a08",
} as const;

const M = MUSEUM;

/** 8×8 wallpaper: soft vertical stripe and a small damask fleck. */
export function wallTile(): string {
  return paint("wall", 8, 8, (set) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) set(x, y, x === 0 || x === 4 ? M.wallStripe : M.wall);
    set(2, 2, M.wallFleck); set(1, 3, M.wallFleck); set(3, 3, M.wallFleck); set(2, 4, M.wallFleck);
    set(6, 6, M.wallFleck);
  });
}

/** 16×24 wood wainscot: top rail, a raised panel, baseboard. */
export function wainscotTile(): string {
  return paint("wainscot", 16, 24, (set) => {
    for (let y = 0; y < 24; y++) for (let x = 0; x < 16; x++) set(x, y, M.wood);
    for (let x = 0; x < 16; x++) { set(x, 0, M.woodRail); set(x, 1, M.woodLight); set(x, 2, M.woodDark); }
    for (let y = 5; y < 19; y++) { set(2, y, M.woodLight); set(13, y, M.woodDark); }
    for (let x = 2; x < 14; x++) { set(x, 5, M.woodLight); set(x, 18, M.woodDark); }
    for (let y = 7; y < 17; y++) for (let x = 4; x < 12; x++) set(x, y, (x + y) % 7 === 0 ? M.woodLight : M.woodDark);
    for (let y = 21; y < 24; y++) for (let x = 0; x < 16; x++) set(x, y, M.baseboard);
    for (let x = 0; x < 16; x++) set(x, 20, M.woodDark);
  });
}

/** 16×8 polished marble checker with a few veins. */
export function floorTile(): string {
  return paint("floor", 16, 8, (set) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) set(x, y, x < 8 ? M.floorA : M.floorB);
    set(2, 2, M.floorVein); set(3, 3, M.floorVein); set(4, 3, M.floorVein); set(11, 5, M.floorVein); set(12, 4, M.floorVein);
    for (let x = 0; x < 16; x++) set(x, 0, M.floorVein);
  });
}

/** 8×4 red carpet with brass trim, tiled under the hero piece. */
export function carpetTile(): string {
  return paint("carpet", 8, 4, (set) => {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) set(x, y, M.carpet);
    set(1, 1, M.velvet); set(5, 2, M.velvet);
  });
}

/**
 * A spotlight cone `width` × `height` room pixels, narrow at the top and fanning
 * out downward: a sparse checker dither of warm light that thins with distance.
 * Meant to be laid over the case with screen blending.
 */
export function spotlight(width: number, height: number): string {
  return paint(`spot:${width}x${height}`, width, height, (set) => {
    const cx = (width - 1) / 2;
    for (let y = 0; y < height; y++) {
      const t = y / Math.max(1, height - 1);
      const half = 2 + (width / 2 - 2) * t;
      for (let x = Math.ceil(cx - half); x <= Math.floor(cx + half); x++) {
        // Checker near the lamp, then every other row, then a quarter: light falling off.
        const keep = t < 0.3 ? (x + y) % 2 === 0 : t < 0.65 ? (x + y) % 2 === 0 && y % 2 === 0 : (x + y) % 4 === 0 && y % 2 === 0;
        if (keep) set(x, y, M.light);
      }
    }
  });
}

/** 12×5 brass ceiling lamp. */
export function lampTile(): string {
  return paint("lamp", 12, 5, (set) => {
    set(5, 0, M.brassDark); set(6, 0, M.brassDark);
    for (let x = 3; x <= 8; x++) set(x, 1, M.brassLight);
    for (let x = 2; x <= 9; x++) { set(x, 2, M.brass); set(x, 3, M.brassDark); }
    for (let x = 3; x <= 8; x++) set(x, 4, M.light);
  });
}

/** Static reflections on a pane of glass `width` × `height` room pixels: two staircase streaks. */
export function glassStreaks(width: number, height: number): string {
  return paint(`glass:${width}x${height}`, width, height, (set) => {
    const streak = (offset: number, thickness: number, color: string) => {
      for (let y = 0; y < height; y++) {
        for (let t = 0; t < thickness; t++) set(offset + t + Math.floor((height - y) * 0.6), y, color);
      }
    };
    streak(Math.floor(width * 0.08), 3, "rgba(255,255,255,0.16)");
    streak(Math.floor(width * 0.08) + 5, 1, "rgba(255,255,255,0.10)");
    // A short bright corner highlight.
    for (let i = 0; i < 4; i++) set(width - 3 - i, 2 + i, "rgba(255,255,255,0.35)");
  });
}

/** A moving glint band (repeats horizontally), `height` room pixels tall. */
export function glintBand(height: number): string {
  const width = height + 8;
  return paint(`glint:${height}`, width, height, (set) => {
    for (let y = 0; y < height; y++) {
      const x = Math.floor((height - y) * 0.6);
      set(x, y, "rgba(255,255,255,0.45)");
      set(x + 1, y, "rgba(255,255,255,0.30)");
    }
  });
}
