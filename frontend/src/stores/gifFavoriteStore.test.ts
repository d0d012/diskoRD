import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { useAuthStore } from "./authStore";
import { useGifFavoriteStore } from "./gifFavoriteStore";
vi.mock("../lib/api", () => ({ api: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock("./authStore", async () => {
  const { create } = await import("zustand");
  return { useAuthStore: create(() => ({ user: null })) };
});
const favorite = { slug: "cat", width: 300, height: 200, createdAt: "2026-01-01T00:00:00Z" };
beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: null });
  useAuthStore.setState({ user: { id: "user" } as any });
  useGifFavoriteStore.setState({ userId: "user", favorites: [], loaded: false, pending: {}, error: "" });
  vi.mocked(api.put).mockResolvedValue({ data: { data: "ok" } });
  vi.mocked(api.delete).mockResolvedValue({ data: { data: "ok" } });
});
describe("GIF favorites store", () => {
  it("loads all cursor pages once per account and shares concurrent loads", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: { data: { items: [favorite], hasMore: true, nextCursor: "next" } } }).mockResolvedValueOnce({ data: { data: { items: [{ ...favorite, slug: "dog" }], hasMore: false } } });
    const [a, b] = await Promise.all([useGifFavoriteStore.getState().load(), useGifFavoriteStore.getState().load()]);
    expect(a).toEqual(b); expect(a.map(f => f.slug)).toEqual(["cat", "dog"]);
    await useGifFavoriteStore.getState().load(); expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.get).toHaveBeenLastCalledWith("/users/me/gif-favorites", { params: { limit: 100, cursor: "next" } });
    useAuthStore.setState({ user: null }); expect(useGifFavoriteStore.getState().favorites).toEqual([]);
  });
  it("optimistically adds and rolls back a failed request", async () => {
    useGifFavoriteStore.setState({ loaded: true });
    let reject!: (reason: unknown) => void;
    vi.mocked(api.put).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const pending = useGifFavoriteStore.getState().toggle("cat", 300, 200);
    await Promise.resolve();
    expect(useGifFavoriteStore.getState().isFavorite("cat")).toBe(true);
    reject({ response: { data: { error: "500 GIF limit" } } });
    await expect(pending).rejects.toBeTruthy();
    expect(useGifFavoriteStore.getState().isFavorite("cat")).toBe(false);
    expect(useGifFavoriteStore.getState().error).toBe("500 GIF limit");
  });
  it("removes favorites idempotently and restores them on failure", async () => {
    useGifFavoriteStore.setState({ loaded: true, favorites: [favorite] });
    vi.mocked(api.delete).mockRejectedValueOnce(new Error("offline"));
    await expect(useGifFavoriteStore.getState().toggle("cat")).rejects.toThrow("offline");
    expect(useGifFavoriteStore.getState().favorites).toEqual([favorite]);
    await useGifFavoriteStore.getState().toggle("cat");
    expect(useGifFavoriteStore.getState().favorites).toEqual([]);
  });
});
