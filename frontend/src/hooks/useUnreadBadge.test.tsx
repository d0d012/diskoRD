import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { useMessageStore } from "../stores/messageStore";
import { useFriendStore } from "../stores/friendStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useGuildStore } from "../stores/guildStore";
import { ServerSidebar } from "../components/layout/ServerSidebar";
import { createBadgeIcon, useOSBadge } from "./useOSBadge";
import { useUnreadTitle } from "./useUnreadTitle";
import { emitDMMessage } from "../lib/dmMessageEvent";
import type { Message } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(), UserAttentionType: { Informational: 2 },
}));
const badge = vi.fn();
const overlay = vi.fn();
const attention = vi.fn();
const fillText = vi.fn();
const context = { beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillText,
  fillStyle: "", font: "", textAlign: "", textBaseline: "" };

function setCount(count: number) {
  act(() => useMessageStore.setState({ unreadCounts: { dm: count } }));
}
function incomingDM() {
  act(() => emitDMMessage({ channelId: "dm", author: { id: "u" } } as Message));
}
async function tick(ms = 250) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(getCurrentWindow).mockReturnValue({ setBadgeCount: badge, setOverlayIcon: overlay,
    requestUserAttention: attention } as unknown as ReturnType<typeof getCurrentWindow>);
  badge.mockResolvedValue(undefined);
  overlay.mockResolvedValue(undefined);
  attention.mockResolvedValue(undefined);
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Macintosh");
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  useFriendStore.setState({ dms: [{ id: "dm", recipient: { id: "u", username: "friend", status: "online" }, createdAt: "" }], activeDMId: null });
  useMessageStore.setState({ unreadCounts: {}, mentionCounts: {}, channelGuilds: {}, unreadChannels: {} });
  useNotificationStore.setState({ mutedChannels: new Set(), mutedDmUsers: new Set() });
  useGuildStore.setState({ guilds: [], activeGuildId: null });
  document.title = "diskoRD";
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("home badge and title", () => {
  it("shows capped DM count and hides active/muted/zero DMs", () => {
    render(<ServerSidebar />);
    expect(screen.queryByLabelText(/unread direct messages/)).toBeNull();
    setCount(101);
    expect(screen.getByLabelText("101 unread direct messages")).toHaveTextContent("99+");
    act(() => useFriendStore.setState({ activeDMId: "dm" }));
    expect(screen.queryByLabelText(/unread direct messages/)).toBeNull();
    act(() => {
      useFriendStore.setState({ activeDMId: null });
      useNotificationStore.setState({ mutedDmUsers: new Set(["u"]) });
    });
    expect(screen.queryByLabelText(/unread direct messages/)).toBeNull();
    act(() => useNotificationStore.setState({ mutedDmUsers: new Set(), mutedChannels: new Set(["dm"]) }));
    expect(screen.queryByLabelText(/unread direct messages/)).toBeNull();
  });
  it("prefixes browser title with DM plus mentions, updates, and restores on unmount", () => {
    vi.mocked(isTauri).mockReturnValue(false);
    const { unmount } = renderHook(useUnreadTitle);
    setCount(3);
    act(() => useMessageStore.setState({ mentionCounts: { channel: 2 }, channelGuilds: { channel: "guild" } }));
    expect(document.title).toBe("(5) diskoRD");
    setCount(1);
    expect(document.title).toBe("(3) diskoRD");
    act(() => useNotificationStore.setState({ mutedChannels: new Set(["channel"]) }));
    setCount(0);
    expect(document.title).toBe("diskoRD");
    setCount(1);
    unmount();
    expect(document.title).toBe("diskoRD");
  });
  it("leaves desktop title alone", () => {
    renderHook(useUnreadTitle);
    setCount(2);
    expect(document.title).toBe("diskoRD");
  });
});

describe("OS badges", () => {
  it.each(["Macintosh", "Linux"])("debounces %s counts, ignores unchanged totals and clears at zero", async (ua) => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
    renderHook(useOSBadge);
    setCount(1);
    await tick(200);
    setCount(3);
    await tick(249);
    expect(badge).not.toHaveBeenCalled();
    await tick(1);
    expect(badge).toHaveBeenCalledExactlyOnceWith(3);
    setCount(3);
    await tick();
    expect(badge).toHaveBeenCalledTimes(1);
    setCount(0);
    await tick();
    expect(badge).toHaveBeenLastCalledWith(undefined);
    expect(overlay).not.toHaveBeenCalled();
  });
  it("uses PNG overlays on Windows and clears at zero", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Windows NT 10.0");
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,iVBORw==");
    renderHook(useOSBadge);
    setCount(9);
    await tick();
    expect(overlay).toHaveBeenCalledWith(new Uint8Array([137, 80, 78, 71]));
    expect(fillText).toHaveBeenCalledWith("9", 16, 17);
    fillText.mockClear();
    setCount(10);
    await tick();
    expect(fillText).not.toHaveBeenCalled();
    expect(context.fillStyle).toBe("#f23f43");
    setCount(0);
    await tick();
    expect(overlay).toHaveBeenLastCalledWith(undefined);
    expect(badge).not.toHaveBeenCalled();
  });
  it("makes no native calls in browser", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    renderHook(useOSBadge);
    setCount(2);
    incomingDM();
    await tick();
    expect(getCurrentWindow).not.toHaveBeenCalled();
  });
  it("requests informational attention only for new unmuted DMs while unfocused", () => {
    renderHook(useOSBadge);
    incomingDM();
    expect(attention).not.toHaveBeenCalled();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    // Even the selected DM requests attention when its window is unfocused.
    act(() => useFriendStore.setState({ activeDMId: "dm" }));
    incomingDM();
    expect(attention).toHaveBeenCalledExactlyOnceWith(UserAttentionType.Informational);
    act(() => useNotificationStore.setState({ mutedDmUsers: new Set(["u"]) }));
    incomingDM();
    act(() => useNotificationStore.setState({ mutedDmUsers: new Set() }));
    setCount(2);
    expect(attention).toHaveBeenCalledTimes(1);
    act(() => useNotificationStore.setState({ mutedChannels: new Set(["dm"]) }));
    incomingDM();
    expect(attention).toHaveBeenCalledTimes(1);
  });
  it("cancels pending sync on unmount", async () => {
    const { unmount } = renderHook(useOSBadge);
    setCount(3);
    unmount();
    await tick();
    expect(getCurrentWindow).not.toHaveBeenCalled();
  });
  it("catches failures and logs each operation once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    badge.mockRejectedValue(new Error("unsupported"));
    attention.mockRejectedValue(new Error("unsupported"));
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    renderHook(useOSBadge);
    setCount(1);
    incomingDM();
    await tick();
    setCount(2);
    incomingDM();
    await tick();
    expect(warn).toHaveBeenCalledTimes(2);
  });
  it("fails safely when canvas is unavailable", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(() => createBadgeIcon(1)).toThrow("Canvas unavailable");
  });
});
