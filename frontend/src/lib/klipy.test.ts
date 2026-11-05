import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { createKlipyClient, isKlipyMediaUrl, klipyConfigured, klipyCustomerId, parseItem, parsePage, previewMedia, sendMedia } from "./klipy";

const response = { result: true, data: { data: [], current_page: 1, has_next: true } };
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => response })); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("KLIPY direct client", () => {
  it("builds direct trending/search/items/share URLs and hashes the non-PII customer id", async () => {
    Object.defineProperty(navigator, "language", { configurable: true, value: "tr-TR" });
    const client = createKlipyClient("abc", "test/key");
    await client.trending(2);
    let url = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
    expect(url.origin).toBe("https://api.klipy.com");
    expect(url.pathname).toBe("/api/v1/test%2Fkey/gifs/trending");
    expect(Object.fromEntries(url.searchParams)).toEqual({ page: "2", per_page: "24", customer_id: "ba7816bf8f01cfea414140de5dae2223", locale: "tr", content_filter: "medium" });
    expect(await klipyCustomerId("abc")).toBe("ba7816bf8f01cfea414140de5dae2223");
    await client.search("cats & dogs");
    url = new URL(vi.mocked(fetch).mock.calls[1][0] as string);
    expect(url.pathname).toMatch(/\/gifs\/search$/); expect(url.searchParams.get("q")).toBe("cats & dogs");
    await client.items(["cat-a", "dog_b"]);
    url = new URL(vi.mocked(fetch).mock.calls[2][0] as string); expect(url.searchParams.get("slugs")).toBe("cat-a,dog_b");
    await client.share("cat-a", "cats & dogs");
    expect(vi.mocked(fetch).mock.calls[3][0]).toMatch(/\/gifs\/share\/cat-a$/);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[3][1]!.body as string)).toEqual({ customer_id: await klipyCustomerId("abc"), q: "cats & dogs" });
    await client.share("cat-a"); expect(JSON.parse(vi.mocked(fetch).mock.calls[4][1]!.body as string)).not.toHaveProperty("q");
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ cache: "no-store", credentials: "omit" });
    await expect(client.items(Array(51).fill("cat"))).rejects.toThrow("50");
  });
  it("aborts previous in-flight searches and accepts caller cancellation", async () => {
    const client = createKlipyClient("abc", "test");
    await client.search("old"); const first = vi.mocked(fetch).mock.calls[0][1]!.signal!;
    const controller = new AbortController(); await client.search("new", 1, controller.signal);
    expect(first.aborted).toBe(true);
    const second = vi.mocked(fetch).mock.calls[1][1]!.signal!; controller.abort(); expect(second.aborted).toBe(true);
  });
  it("handles API errors and missing configuration", async () => {
    vi.stubEnv("VITE_KLIPY_API_KEY", ""); expect(klipyConfigured()).toBe(false);
    await expect(createKlipyClient("abc").trending()).rejects.toThrow("GIFs not configured");
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    await expect(createKlipyClient("abc", "test").trending()).rejects.toThrow("Unable to load KLIPY");
  });
});
describe("tolerant media parsing", () => {
  it("preserves all slots and their order, even ads/nulls and malformed media", () => {
    const page = parsePage({ result: true, data: { data: [{ slug: "first" }, { type: "ad" }, null, { slug: "last", file: { sm: { webp: { url: "javascript:bad" } } } }], has_next: true } });
    expect(page.items.map(i => i.slug)).toEqual(["first", undefined, undefined, "last"]);
    expect(page.hasNext).toBe(true); expect(previewMedia(page.items[3])).toBeUndefined();
    expect(parsePage(null).items).toEqual([]); expect(() => parsePage({ result: false })).toThrow();
  });
  it("selects small webp previews and md GIF sends without modifying signed URLs", () => {
    const url = "https://static1.klipy.com/a.gif?sig=a%2Fb&x=1";
    const item = parseItem({ slug: "cat", file: { md: { gif: { url, width: 300, height: 200 } }, sm: { webp: { url: "https://static.klipy.com/s.webp", width: 120, height: 80 } } } });
    expect(sendMedia(item)?.url).toBe(url); expect(previewMedia(item)?.url).toContain("s.webp");
    expect(sendMedia(parseItem({ file: { hd: { webp: { url } } } }))?.url).toBe(url);
    expect(parseItem({ file: { sm: { gif: { url, width: -2, height: "bad" } } } }).file.sm?.gif?.width).toBeUndefined();
    expect(isKlipyMediaUrl(url)).toBe(true); expect(isKlipyMediaUrl("https://static.klipy.com.evil.org/a.gif")).toBe(false);
  });
});
