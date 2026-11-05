import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { parseItem } from "../../lib/klipy";
import { useAuthStore } from "../../stores/authStore";
import { useGifFavoriteStore } from "../../stores/gifFavoriteStore";
import { GifPicker } from "./GifPicker";
const client = vi.hoisted(() => ({ trending: vi.fn(), search: vi.fn(), items: vi.fn(), share: vi.fn(), abortSearch: vi.fn() }));
vi.mock("../../lib/klipy", async importOriginal => ({ ...await importOriginal<typeof import("../../lib/klipy")>(), createKlipyClient: () => client }));
vi.mock("../../lib/api", () => ({ api: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock("../../stores/authStore", async () => {
  const { create } = await import("zustand"); return { useAuthStore: create(() => ({ user: { id: "user" } })) };
});
function item(slug: string) {
  return parseItem({ slug, title: slug, file: { sm: { webp: { url: `https://static.klipy.com/${slug}.webp`, width: 120, height: 80 } }, md: { gif: { url: `https://static.klipy.com/${slug}.gif?sig=a%2Fb`, width: 300, height: 200 } } } });
}
function mount() {
  const onSend = vi.fn().mockResolvedValue(undefined); const onClose = vi.fn();
  render(<GifPicker onSend={onSend} onClose={onClose} triggerRef={createRef()} />);
  return { onSend, onClose };
}
beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: { id: "user" } as any });
  useGifFavoriteStore.setState({ userId: "user", loaded: true, favorites: [], pending: {}, error: "" });
  client.trending.mockResolvedValue({ items: [item("cat"), item("dog")], currentPage: 1, hasNext: false });
  client.search.mockResolvedValue({ items: [item("found")], currentPage: 1, hasNext: false });
  client.share.mockResolvedValue(undefined);
  vi.mocked(api.put).mockResolvedValue({ data: { data: "ok" } });
  vi.mocked(api.delete).mockResolvedValue({ data: { data: "ok" } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("KLIPY GIF picker", () => {
  it("shows branding/search and debounces search by 300 ms", async () => {
    mount(); expect(screen.getByPlaceholderText("Search KLIPY")).toHaveFocus();
    expect(screen.getByText("Powered by KLIPY")).toBeInTheDocument();
    await screen.findByRole("button", { name: "Send cat" });
    vi.useFakeTimers();
    fireEvent.change(screen.getByPlaceholderText("Search KLIPY"), { target: { value: "cats" } });
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(299); }); expect(client.search).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(client.search).toHaveBeenCalledWith("cats", 1, expect.any(AbortSignal));
    expect(screen.getByRole("button", { name: "Send found" })).toBeInTheDocument();
  });
  it("toggles stars without sending and sends the untouched full GIF URL on tile activation", async () => {
    const { onSend } = mount();
    await screen.findByRole("button", { name: "Send cat" });
    fireEvent.click(screen.getAllByRole("button", { name: "Add to favorites" })[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove from favorites" })).toHaveAttribute("aria-pressed", "true"));
    expect(api.put).toHaveBeenCalledWith("/users/me/gif-favorites/cat", { width: 300, height: 200 });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send cat" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("https://static.klipy.com/cat.gif?sig=a%2Fb"));
    expect(client.share).toHaveBeenCalledWith("cat", undefined);
  });
  it("restores favorites through items in ≤50 batches and preserves newest-first order", async () => {
    const saved = Array.from({ length: 51 }, (_, i) => ({ slug: `gif${i}`, createdAt: new Date(100000 - i).toISOString() }));
    useGifFavoriteStore.setState({ loaded: false });
    vi.mocked(api.get).mockResolvedValue({ data: { data: { items: saved, hasMore: false } } });
    client.items.mockImplementation(async (slugs: string[]) => slugs.map(item).reverse());
    mount(); fireEvent.click(screen.getByRole("tab", { name: /Favorites/ }));
    await screen.findByRole("button", { name: "Send gif50" });
    const tiles = screen.getAllByRole("button", { name: /^Send gif/ });
    expect(tiles[0]).toHaveAccessibleName("Send gif0"); expect(tiles[50]).toHaveAccessibleName("Send gif50");
    expect(client.items.mock.calls.every(([slugs]) => slugs.length <= 50)).toBe(true);
    expect(api.get).toHaveBeenCalledTimes(1);
  });
  it("closes on Escape/outside pointer and does not drop non-GIF slots", async () => {
    client.trending.mockResolvedValue({ items: [item("cat"), { title: "Advertisement", file: {} }, item("dog")], currentPage: 1, hasNext: false });
    const { onClose } = mount(); await screen.findByRole("button", { name: "Send cat" });
    expect(screen.getByRole("button", { name: "Send Advertisement" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: /^Send/ }).map(b => b.getAttribute("aria-label"))).toEqual(["Send cat", "Send Advertisement", "Send dog"]);
    fireEvent.keyDown(document, { key: "Escape" }); expect(onClose).toHaveBeenCalledOnce();
    fireEvent.pointerDown(document.body); expect(onClose).toHaveBeenCalledTimes(2);
  });
  it("paginates from the intersection sentinel and appends provider order", async () => {
    let intersect!: (entries: { isIntersecting: boolean }[]) => void;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: typeof intersect) { intersect = callback; }
      observe() {} disconnect() {}
    });
    client.trending.mockResolvedValueOnce({ items: [item("first")], currentPage: 1, hasNext: true }).mockResolvedValueOnce({ items: [item("second")], currentPage: 2, hasNext: false });
    mount(); await screen.findByRole("button", { name: "Send first" });
    await waitFor(() => expect(intersect).toBeTypeOf("function"));
    act(() => intersect([{ isIntersecting: true }]));
    await screen.findByRole("button", { name: "Send second" });
    expect(client.trending).toHaveBeenLastCalledWith(2, expect.any(AbortSignal));
    expect(screen.getAllByRole("button", { name: /^Send/ }).map(b => b.getAttribute("aria-label"))).toEqual(["Send first", "Send second"]);
  });
  it("shows recoverable errors and empty favorites", async () => {
    client.trending.mockRejectedValueOnce(new Error("offline")); mount();
    await screen.findByRole("alert"); fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("button", { name: "Send cat" });
    fireEvent.click(screen.getByRole("tab", { name: /Favorites/ }));
    await screen.findByText("No favorite GIFs yet. Star a GIF to save it.");
  });
});
