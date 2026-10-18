import { describe, it, expect } from "vitest";
import { BUILTIN_BANNERS, builtinBanner, isBuiltinBanner } from "./banners";
import { decodeDoc, encodeDoc } from "./doc";

describe("built-in banners", () => {
  it.each(BUILTIN_BANNERS.map((b) => b.id))("%s draws every pixel at both banner sizes", (id) => {
    for (const [w, h] of [[150, 48], [100, 32]] as const) {
      const art = builtinBanner(id, w, h);
      expect([art.width, art.height]).toEqual([w, h]);
      expect(art.pixels.every((p) => p >= 1 && p <= art.palette.length)).toBe(true);
      // Valid as a doc, so it can be opened in the editor and saved.
      expect(decodeDoc(encodeDoc(art)).pixels).toEqual(art.pixels);
    }
  });

  it("knows its ids", () => {
    expect(isBuiltinBanner("meadow")).toBe(true);
    expect(isBuiltinBanner("lava")).toBe(false);
  });
});
