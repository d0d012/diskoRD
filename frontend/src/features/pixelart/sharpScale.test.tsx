import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sharpArt, sharpScale, snapDevicePixel, useSharpArtUrl } from "./sharpScale";

function image(url = "native-art") {
  return { url, width: 64, height: 64, canvas: document.createElement("canvas") };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("sharp scaling", () => {
  it.each([
    [100, 100, 1, 2, "auto"],
    [100, 100, 2, 4, "auto"],
    [128, 128, 1, 1, "pixelated"],
    [128, 128, 2, 1, "pixelated"],
    [96, 96, 2, 1, "pixelated"],
    [100, 150, 1, 3, "auto"],
    [32, 32, 1, 1, "auto"],
    [32, 32, 2, 1, "auto"],
  ])("64px art at %s×%s DPR %s", (w, h, dpr, k, imageRendering) => {
    expect(sharpScale(64, 64, w, h, dpr)).toEqual({ k, imageRendering });
  });

  it("pre-enlarges without smoothing, reuses the URL and bounds its LRU", () => {
    const ctx = { drawImage: vi.fn(), imageSmoothingEnabled: true };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const encode = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (this: HTMLCanvasElement) { return `upscaled-${this.width}x${this.height}`; });
    const art = image("cache-test");
    expect(sharpArt(art, 100, 100, 1)).toEqual({ url: "upscaled-128x128", imageRendering: "auto" });
    expect(ctx.imageSmoothingEnabled).toBe(false);
    expect(ctx.drawImage).toHaveBeenCalledWith(art.canvas, 0, 0, 128, 128);
    sharpArt(art, 110, 110, 1);
    expect(encode).toHaveBeenCalledTimes(1);
    // Exact multiples and shrinking don't allocate a canvas.
    expect(sharpArt(art, 128, 128, 1).url).toBe(art.url);
    expect(sharpArt(art, 32, 32, 2)).toEqual({ url: art.url, imageRendering: "auto" });
    expect(encode).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 64; i++) sharpArt(image(`eviction-${i}`), 100, 100, 1);
    sharpArt(art, 100, 100, 1);
    expect(encode).toHaveBeenCalledTimes(66);
  });

  it("recomputes on size and resolution changes, re-arms and cleans listeners", () => {
    const listeners: Array<() => void> = [];
    const remove = vi.fn();
    const match = vi.fn(() => ({
      addEventListener: (_: string, callback: () => void) => listeners.push(callback),
      removeEventListener: remove,
    }) as unknown as MediaQueryList);
    vi.stubGlobal("matchMedia", match);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (this: HTMLCanvasElement) { return `hook-${this.width}`; });
    vi.stubGlobal("devicePixelRatio", 1);
    const art = image("hook-native");
    const { result, rerender, unmount } = renderHook(({ size }) => useSharpArtUrl(art, size, size), { initialProps: { size: 100 } });
    expect(result.current.url).toBe("hook-128");
    vi.stubGlobal("devicePixelRatio", 2);
    act(() => listeners[0]());
    expect(result.current.url).toBe("hook-256");
    expect(match).toHaveBeenLastCalledWith("(resolution: 2dppx)");
    rerender({ size: 128 });
    expect(result.current).toEqual({ url: art.url, imageRendering: "pixelated" });
    unmount();
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("snaps device pixels including fractional densities", () => {
    expect(snapDevicePixel(10.3, 1)).toBe(10);
    expect(snapDevicePixel(10.3, 2)).toBe(10.5);
    expect(snapDevicePixel(10.3, 1.25) * 1.25).toBe(13);
  });
});
