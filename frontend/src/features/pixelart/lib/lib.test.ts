import { describe, it, expect } from "vitest";
import {
  createArt, floodFill, linePoints, mirrorPoints, paint, pixelPerfect, rectPoints, resize, type Point,
} from "./art";
import { decodeDoc, encodeDoc } from "./doc";
import { downscale, quantizeNewPalette, quantizeToPalette } from "./importImage";

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
    expect(back.size).toBe(32);
    expect(back.palette).toEqual(art.palette);
    expect(Array.from(back.pixels)).toEqual(Array.from(art.pixels));
  });

  it.each([
    ["wrong version", { ...encodeDoc(createArt(16)), v: 2 }],
    ["unsupported size", { ...encodeDoc(createArt(16)), width: 128, height: 128 }],
    ["too many colors", { ...encodeDoc(createArt(16)), palette: Array(33).fill("#000000") }],
    ["bad color", { ...encodeDoc(createArt(16)), palette: ["red"] }],
    ["wrong byte count", { ...encodeDoc(createArt(16)), frames: [btoa("abc")] }],
    ["index out of range", encodeDoc(paint(createArt(16, ["#000000"]), [[0, 0]], 2))],
  ])("rejects %s", (_, doc) => {
    expect(() => decodeDoc(doc)).toThrow();
  });
});

describe("downscale", () => {
  it("is exact for integer-scaled pixel art and keeps transparency", () => {
    // 4×4 source: left half opaque red, right half transparent → 2×2.
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) data.set([255, 0, 0, 255], (y * 4 + x) * 4);
    const out = downscale({ width: 4, height: 4, data }, 2, "cover");
    expect(Array.from(out.slice(0, 8))).toEqual([255, 0, 0, 255, 0, 0, 0, 0]);
  });

  it("letterboxes non-square images with contain", () => {
    const data = new Uint8ClampedArray(4 * 2 * 4).fill(255); // 4 wide, 2 tall, white
    const out = downscale({ width: 4, height: 2, data }, 4, "contain");
    expect(out[3]).toBe(0); // top row is letterbox
    expect(out[(1 * 4) * 4 + 3]).toBe(255); // second row is image
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
    const art = quantizeToPalette(rgba, 2, ["#ff0000", "#0000ff", "#ffffff"]);
    expect(Array.from(art.pixels)).toEqual([1, 2, 0, 3]);
  });

  it("builds a new palette no larger than k", () => {
    const art = quantizeNewPalette(rgba, 2, 2);
    expect(art.palette.length).toBeLessThanOrEqual(2);
    expect(art.pixels[2]).toBe(0);
    expect(art.pixels[0]).not.toBe(0);
  });

  it("keeps exact colors when there are few enough", () => {
    const art = quantizeNewPalette(rgba, 2, 8);
    expect(art.palette).toEqual(["#fa0a0a", "#0a0af0", "#ffffff"]);
  });
});
