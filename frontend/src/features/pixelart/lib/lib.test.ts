import { describe, it, expect } from "vitest";
import {
  createArt, floodFill, linePoints, mirrorPoints, paint, pixelPerfect, rectPoints, resize, stampPoints, type Point,
} from "./art";
import { decodeDoc, encodeDoc } from "./doc";
import {
  detectPixelScale, quantizeNewPalette, renderImport, quantizeToPalette, resample, suggestImport, unscale, type Rgba,
} from "./importImage";

/** Renders an art's pixels as rows of digits for readable assertions. */
function rows(pixels: Uint8Array, size: number): string[] {
  return Array.from({ length: size }, (_, y) => Array.from(pixels.slice(y * size, (y + 1) * size)).join(""));
}

describe("linePoints", () => {
  it("includes both endpoints and has no gaps", () => {
    const points = linePoints(0, 0, 5, 2);
    expect(points[0]).toEqual([0, 0]);
    expect(points[points.length - 1]).toEqual([5, 2]);
    for (let i = 1; i < points.length; i++) {
      expect(Math.abs(points[i][0] - points[i - 1][0])).toBeLessThanOrEqual(1);
      expect(Math.abs(points[i][1] - points[i - 1][1])).toBeLessThanOrEqual(1);
    }
  });

  it("handles a single point", () => {
    expect(linePoints(3, 3, 3, 3)).toEqual([[3, 3]]);
  });
});

describe("rectPoints", () => {
  it("draws an outline without duplicates", () => {
    const art = paint(createArt(16), rectPoints(3, 2, 0, 0), 1);
    expect(rows(art.pixels, 16).slice(0, 4).map((r) => r.slice(0, 5))).toEqual(["11110", "10010", "11110", "00000"]);
    expect(new Set(rectPoints(0, 0, 3, 2).map((p) => p.join())).size).toBe(rectPoints(0, 0, 3, 2).length);
  });
});

describe("pixelPerfect", () => {
  it("removes L-shaped corners and duplicates", () => {
    const stroke: Point[] = [[0, 0], [1, 0], [1, 0], [1, 1], [2, 1]];
    expect(pixelPerfect(stroke)).toEqual([[0, 0], [1, 1], [2, 1]]);
  });

  it("keeps straight lines intact", () => {
    const stroke: Point[] = [[0, 0], [1, 0], [2, 0], [3, 0]];
    expect(pixelPerfect(stroke)).toEqual(stroke);
  });
});

describe("mirrorPoints", () => {
  it("mirrors horizontally", () => {
    expect(mirrorPoints([[0, 2]], 16)).toEqual([[0, 2], [15, 2]]);
  });
});

describe("floodFill", () => {
  it("fills only the connected region and respects walls", () => {
    // Vertical wall at x=2 splits the canvas.
    const walled = paint(createArt(16), linePoints(2, 0, 2, 15), 1);
    const filled = floodFill(walled, 0, 0, 2);
    const r = rows(filled.pixels, 16);
    expect(r[0].slice(0, 4)).toBe("2210");
    expect(r[15].slice(0, 4)).toBe("2210");
  });

  it("is a no-op when filling with the same value", () => {
    const art = createArt(16);
    expect(floodFill(art, 0, 0, 0)).toBe(art);
  });
});

describe("resize", () => {
  it("scales pixels with nearest neighbour", () => {
    const art = paint(createArt(16), [[0, 0]], 3);
    const big = resize(art, 32);
    expect(rows(big.pixels, 32).slice(0, 2).map((r) => r.slice(0, 3))).toEqual(["330", "330"]);
  });
});

describe("doc", () => {
  it("round-trips losslessly", () => {
    const art = paint(createArt(32), linePoints(0, 0, 31, 31), 5);
    const back = decodeDoc(JSON.parse(JSON.stringify(encodeDoc(art))));
    expect([back.width, back.height]).toEqual([32, 32]);
    expect(back.palette).toEqual(art.palette);
    expect(Array.from(back.pixels)).toEqual(Array.from(art.pixels));
  });

  it.each([
    ["wrong version", { ...encodeDoc(createArt(16)), v: 2 }],
    ["unsupported size", { ...encodeDoc(createArt(16)), width: 512, height: 512 }],
    ["too many colors", { ...encodeDoc(createArt(16)), palette: Array(65).fill("#000000") }],
    ["bad color", { ...encodeDoc(createArt(16)), palette: ["red"] }],
    ["wrong byte count", { ...encodeDoc(createArt(16)), frames: [btoa("abc")] }],
    ["index out of range", encodeDoc(paint(createArt(16, 16, ["#000000"]), [[0, 0]], 2))],
  ])("rejects %s", (_, doc) => {
    expect(() => decodeDoc(doc)).toThrow();
  });
});

/** Builds an image from rows of single-letter colors ("." = transparent). */
function image(rows: string[], scale = 1): Rgba {
  const colors: Record<string, number[]> = { r: [255, 0, 0, 255], g: [0, 255, 0, 255], b: [0, 0, 255, 255], w: [255, 255, 255, 255], ".": [0, 0, 0, 0] };
  const height = rows.length * scale;
  const width = rows[0].length * scale;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(colors[rows[Math.floor(y / scale)][Math.floor(x / scale)]], (y * width + x) * 4);
  }
  return { width, height, data };
}

describe("resample", () => {
  it("is exact for integer-scaled pixel art and keeps transparency", () => {
    const out = resample(image(["r.", "r."], 2), 2, 2, "cover");
    expect(Array.from(out.slice(0, 8))).toEqual([255, 0, 0, 255, 0, 0, 0, 0]);
  });

  it("letterboxes non-square images with contain", () => {
    const out = resample(image(["wwww", "wwww"]), 4, 4, "contain");
    expect(out[3]).toBe(0); // top row is letterbox
    expect(out[(1 * 4) * 4 + 3]).toBe(255); // second row is image
  });

  it("sharp sampling never invents in-between colors", () => {
    // 3×3 checker scaled to 2×2: smoothing would blend, sharp picks real pixels.
    const src = image(["rbr", "brb", "rbr"]);
    const isBlend = (px: Uint8ClampedArray) => px[0] > 0 && px[2] > 0; // red and blue mixed
    expect(isBlend(resample(src, 2, 2, "contain", true).slice(0, 4))).toBe(false);
    expect(isBlend(resample(src, 2, 2, "contain", false).slice(0, 4))).toBe(true);
  });

  it("copies pixels 1:1 and centers them with actual", () => {
    const out = resample(image(["rg", "bw"]), 4, 4, "actual");
    expect(Array.from(out.slice((1 * 4 + 1) * 4, (1 * 4 + 1) * 4 + 4))).toEqual([255, 0, 0, 255]);
    expect(out[3]).toBe(0); // corner stays transparent
  });
});

describe("pixel art detection", () => {
  it("finds the block size of upscaled pixel art and undoes it losslessly", () => {
    const sprite = ["r.g", "bwb", ".r."];
    const big = image(sprite, 8);
    expect(detectPixelScale(big)).toBe(8);
    expect(Array.from(unscale(big, 8).data)).toEqual(Array.from(image(sprite).data));
  });

  it("returns 1 for images without uniform blocks", () => {
    expect(detectPixelScale(image(["rg", "bw"]))).toBe(1);
  });

  it("suggests a 1:1 import on the smallest canvas that fits", () => {
    const s = suggestImport(image(Array(40).fill("rg".repeat(20)), 4)); // 40×40 sprite at ×4
    expect(s).toMatchObject({ scale: 4, width: 64, height: 64, fit: "actual", sharp: true });
    expect(s.source.width).toBe(40);
  });

  it("suggests smooth scaling for large photos", () => {
    // 300 wide gradient-ish noise: no blocks, too big for 1:1 at 256.
    const data = new Uint8ClampedArray(300 * 300 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([i % 251, (i / 4) % 241, 7, 255], i);
    expect(suggestImport({ width: 300, height: 300, data })).toMatchObject({ scale: 1, width: 64, height: 64, fit: "contain", sharp: false });
  });
});

describe("renderImport", () => {
  it("reproduces upscaled pixel art exactly with the suggested settings", () => {
    const sprite = ["r.gb", "bwwr", ".rg.", "wbbw"];
    const suggestion = suggestImport(image(sprite, 16)); // a 4×4 sprite saved at 64×64
    const { art } = renderImport({ ...suggestion, thumb: null, palette: "new", colors: "all" }, []);
    expect([art.width, art.height]).toEqual([16, 16]);
    // Every source pixel lands 1:1 (centered) with its exact color.
    const hex: Record<string, string> = { r: "#ff0000", g: "#00ff00", b: "#0000ff", w: "#ffffff" };
    sprite.forEach((row, y) => [...row].forEach((ch, x) => {
      const v = art.pixels[(y + 6) * 16 + (x + 6)];
      if (ch === ".") expect(v).toBe(0);
      else expect(art.palette[v - 1]).toBe(hex[ch]);
    }));
  });
});

describe("rectangular canvases", () => {
  it("creates, fills and resizes banners", () => {
    const banner = createArt(100, 32);
    expect(banner.pixels).toHaveLength(3200);
    const filled = floodFill(banner, 99, 31, 2);
    expect(filled.pixels.every((p) => p === 2)).toBe(true);
    const detailed = resize(paint(banner, [[99, 31]], 1), 150, 48);
    expect([detailed.width, detailed.height]).toEqual([150, 48]);
    expect(detailed.pixels[47 * 150 + 149]).toBe(1);
  });

  it("round-trips banner docs and rejects odd shapes", () => {
    const art = paint(createArt(150, 48), [[149, 0]], 1);
    const back = decodeDoc(JSON.parse(JSON.stringify(encodeDoc(art))));
    expect([back.width, back.height]).toEqual([150, 48]);
    expect(() => decodeDoc({ ...encodeDoc(createArt(100, 32)), width: 100, height: 40 })).toThrow();
  });

  it("crops a square image to fill a banner", () => {
    // 4×4: top half red, bottom half blue; a 4×2 cover crop keeps the middle rows.
    const src = image(["rrrr", "rrrr", "bbbb", "bbbb"]);
    const out = resample(src, 4, 2, "cover", true);
    expect(Array.from(out.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(out.slice(4 * 4, 4 * 4 + 4))).toEqual([0, 0, 255, 255]);
  });
});

describe("stampPoints", () => {
  it("expands points into brush squares", () => {
    expect(stampPoints([[5, 5]], 1)).toEqual([[5, 5]]);
    expect(stampPoints([[5, 5]], 3)).toHaveLength(9);
    expect(stampPoints([[5, 5]], 2)).toEqual([[5, 5], [6, 5], [5, 6], [6, 6]]);
  });
});

describe("quantize", () => {
  const rgba = new Uint8ClampedArray([
    250, 10, 10, 255, // near red
    10, 10, 240, 255, // near blue
    0, 0, 0, 0, // transparent
    255, 255, 255, 255, // white
  ]);

  it("maps to the nearest palette color", () => {
    const art = quantizeToPalette(rgba, 2, 2, ["#ff0000", "#0000ff", "#ffffff"]);
    expect(Array.from(art.pixels)).toEqual([1, 2, 0, 3]);
  });

  it("builds a new palette no larger than k", () => {
    const art = quantizeNewPalette(rgba, 2, 2, 2);
    expect(art.palette.length).toBeLessThanOrEqual(2);
    expect(art.pixels[2]).toBe(0);
    expect(art.pixels[0]).not.toBe(0);
  });

  it("keeps a rare but distinct color when reducing", () => {
    // 98 reds of slightly different shades and one blue pixel; k=2 must keep the blue.
    const px: number[] = [];
    for (let i = 0; i < 98; i++) px.push(200 + (i % 50), 0, 0, 255);
    px.push(0, 0, 255, 255, 0, 0, 0, 0);
    const art = quantizeNewPalette(new Uint8ClampedArray(px), 10, 10, 2);
    expect(art.palette.some((c) => c === "#0000ff")).toBe(true);
  });

  it("keeps exact colors when there are few enough", () => {
    const art = quantizeNewPalette(rgba, 2, 2, 8);
    expect([...art.palette].sort()).toEqual(["#0a0af0", "#fa0a0a", "#ffffff"]);
  });
});
