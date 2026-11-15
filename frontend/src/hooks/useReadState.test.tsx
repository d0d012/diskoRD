import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { useMessageStore } from "../stores/messageStore";
import { useGuildStore } from "../stores/guildStore";
import { useFriendStore } from "../stores/friendStore";
import { applyReadState, seedReadStates, useReadState } from "./useReadState";
import type { Channel, Message } from "../types";

vi.mock("../lib/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/api")>(),
  api: { post: vi.fn().mockResolvedValue({}) },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  useGuildStore.setState({ activeGuildId: null, activeChannelId: null, channels: {} });
  useFriendStore.setState({ activeDMId: null });
  useMessageStore.setState({ messages: {} });
  seedReadStates([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const snapshot = [
  { channelId: "guild", guildId: "g", unread: true, mentionCount: 2 },
  { channelId: "dm", unread: true, mentionCount: 4 },
];

describe("server read-state synchronization", () => {
  it("replaces stale client state and restores DM counts and guild routing", () => {
    seedReadStates([{ channelId: "stale", unread: true, mentionCount: 1 }]);
    seedReadStates(snapshot);
    const state = useMessageStore.getState();
    expect(state.unreadChannels).toEqual({ guild: true, dm: true });
    expect(state.mentionCounts).toEqual({ guild: 2, dm: 4 });
    expect(state.unreadCounts).toEqual({ dm: 4 });
    expect(state.channelGuilds).toEqual({ guild: "g" });
  });
  it("applies remote acknowledgements without echoing an HTTP ack", () => {
    seedReadStates(snapshot);
    applyReadState("dm", "2026-01-01T00:00:00Z");
    expect(useMessageStore.getState().unreadChannels.dm).toBe(false);
    expect(useMessageStore.getState().mentionCounts.dm).toBe(0);
    expect(api.post).not.toHaveBeenCalled();
  });
  it("preserves messages newer than a remote ack and ignores stale updates", () => {
    seedReadStates(snapshot);
    useMessageStore.setState({ messages: { dm: [{ id: "new", channelId: "dm", author: { id: "other" }, createdAt: "2026-01-03T00:00:00Z" } as Message] } });
    applyReadState("dm", "2026-01-02T00:00:00Z");
    expect(useMessageStore.getState().unreadCounts.dm).toBe(1);
    applyReadState("dm", "2026-01-04T00:00:00Z");
    applyReadState("dm", "2026-01-01T00:00:00Z");
    expect(useMessageStore.getState().unreadCounts.dm).toBe(0);
  });
  it("keeps selected but unfocused DMs unread and excludes own/duplicate messages", () => {
    const message = { id: "live", channelId: "dm", author: { id: "other" }, createdAt: "2026-01-01T00:00:00Z" } as Message;
    const add = useMessageStore.getState().addMessage;
    add(message, "dm", "me");
    add(message, "dm", "me");
    add({ ...message, id: "own", author: { ...message.author, id: "me" } }, "dm", "me");
    expect(useMessageStore.getState().unreadCounts.dm).toBe(1);
    expect(useMessageStore.getState().mentionCounts.dm).toBe(1);
    expect(api.post).not.toHaveBeenCalled();
  });
  it("waits for focus before reading the selected DM", () => {
    seedReadStates(snapshot);
    useFriendStore.setState({ activeDMId: "dm" });
    renderHook(useReadState);
    expect(api.post).not.toHaveBeenCalled();
    expect(useMessageStore.getState().unreadChannels.dm).toBe(true);
    vi.mocked(document.hasFocus).mockReturnValue(true);
    act(() => window.dispatchEvent(new Event("focus")));
    expect(useMessageStore.getState().unreadChannels.dm).toBeUndefined();
    expect(api.post).toHaveBeenCalledWith("/channels/dm/ack", {}, expect.anything());
  });
  it("does not acknowledge a whiteboard or a hidden DM behind a guild", () => {
    vi.mocked(document.hasFocus).mockReturnValue(true);
    useGuildStore.setState({ activeGuildId: "g", activeChannelId: "board", channels: { g: [{ id: "board", type: "whiteboard" } as Channel] } });
    useFriendStore.setState({ activeDMId: "dm" });
    renderHook(useReadState);
    expect(api.post).not.toHaveBeenCalled();
  });
});
