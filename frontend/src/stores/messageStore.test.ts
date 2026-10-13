import { describe, it, expect, beforeEach, vi } from "vitest";
import { useMessageStore } from "./messageStore";
import { useAuthStore } from "./authStore";
import { api } from "../lib/api";
import type { Message } from "../types";

vi.mock("../lib/api", () => ({
  api: {
    put: vi.fn(),
    delete: vi.fn(),
    post: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
  },
  setToken: vi.fn(),
  setSessionHandlers: vi.fn(),
  refreshSession: vi.fn(),
  isTokenFresh: vi.fn(),
  startSessionKeeper: vi.fn(),
  stopSessionKeeper: vi.fn(),
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

const put = vi.mocked(api.put);
const del = vi.mocked(api.delete);
const get = vi.mocked(api.get);

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function reaction(messageId: string, channelId: string, emoji: string) {
  const msg = useMessageStore.getState().messages[channelId]?.find((m) => m.id === messageId);
  return (msg?.reactions ?? []).find((r) => r.emoji === emoji);
}

const mockMsg: Message = {
  id: "m1",
  channelId: "c1",
  author: { id: "u1", username: "author", status: "online", createdAt: "2026-01-01T00:00:00Z" },
  content: "hello",
  createdAt: "2026-01-01T00:00:00Z",
  reactions: [],
};

beforeEach(() => {
  useMessageStore.setState({
    messages: {},
    unreadChannels: {},
    hasMore: {},
    typingUsers: {},
    unreadCounts: {},
    channelGuilds: {},
    mentionCounts: {},
  });
  useAuthStore.setState({
    user: { id: "u1", username: "me", status: "online", createdAt: "2026-01-01T00:00:00Z" },
    accessToken: "mock-token",
  });
  put.mockReset();
  del.mockReset();
  get.mockReset();
});

describe("messageStore fetchMessages", () => {
  it("treats a null item list as an empty channel", async () => {
    get.mockResolvedValueOnce({ data: { data: { items: null, hasMore: false } } });

    await expect(useMessageStore.getState().fetchMessages("c1")).resolves.toBeUndefined();

    expect(useMessageStore.getState().messages.c1).toEqual([]);
  });
});

describe("messageStore reactions", () => {
  it("toggleReaction encodes the emoji in the URL and adds optimistically", async () => {
    useMessageStore.getState().addMessage(mockMsg, "c1");
    put.mockResolvedValueOnce({});

    await useMessageStore.getState().toggleReaction("m1", "c1", "💪");

    expect(put).toHaveBeenCalledWith(`/messages/m1/reactions/${encodeURIComponent("💪")}`);
    const r = reaction("m1", "c1", "💪");
    expect(r?.count).toBe(1);
    expect(r?.selfReacted).toBe(true);
  });

  it("reverts an optimistic add when the request fails", async () => {
    useMessageStore.getState().addMessage(mockMsg, "c1");
    put.mockRejectedValueOnce(new Error("nope"));

    await useMessageStore.getState().toggleReaction("m1", "c1", "👍");

    expect(reaction("m1", "c1", "👍")).toBeUndefined();
    expect(useMessageStore.getState().messages.c1[0].reactions).toHaveLength(0);
  });

  it("reverts an optimistic remove when the request fails", async () => {
    useMessageStore.getState().addMessage(
      { ...mockMsg, reactions: [{ emoji: "👍", count: 2, selfReacted: true }] },
      "c1"
    );
    del.mockRejectedValueOnce(new Error("nope"));

    await useMessageStore.getState().toggleReaction("m1", "c1", "👍");

    const r = reaction("m1", "c1", "👍");
    expect(r?.count).toBe(2);
    expect(r?.selfReacted).toBe(true);
  });

  it("REACTION_ADD from another user sets the server count and keeps selfReacted", () => {
    useMessageStore.getState().addMessage(
      { ...mockMsg, reactions: [{ emoji: "👍", count: 1, selfReacted: true }] },
      "c1"
    );

    useMessageStore.getState().applyReactionEvent("m1", "c1", "👍", 4, "other-user", "add");

    const r = reaction("m1", "c1", "👍");
    expect(r?.count).toBe(4);
    expect(r?.selfReacted).toBe(true);
  });

  it("REACTION_ADD from the current user marks selfReacted", () => {
    useMessageStore.getState().addMessage(mockMsg, "c1");

    useMessageStore.getState().applyReactionEvent("m1", "c1", "🎉", 3, "u1", "add");

    const r = reaction("m1", "c1", "🎉");
    expect(r?.count).toBe(3);
    expect(r?.selfReacted).toBe(true);
  });

  it("REACTION_REMOVE from the current user clears selfReacted but keeps the count", () => {
    useMessageStore.getState().addMessage(
      { ...mockMsg, reactions: [{ emoji: "🎉", count: 3, selfReacted: true }] },
      "c1"
    );

    useMessageStore.getState().applyReactionEvent("m1", "c1", "🎉", 2, "u1", "remove");

    const r = reaction("m1", "c1", "🎉");
    expect(r?.count).toBe(2);
    expect(r?.selfReacted).toBe(false);
  });

  it("REACTION_REMOVE with count 0 removes the chip", () => {
    useMessageStore.getState().addMessage(
      { ...mockMsg, reactions: [{ emoji: "👍", count: 1, selfReacted: true }] },
      "c1"
    );

    useMessageStore.getState().applyReactionEvent("m1", "c1", "👍", 0, "other-user", "remove");

    expect(reaction("m1", "c1", "👍")).toBeUndefined();
  });

  it("does not roll back over a newer authoritative event", async () => {
    useMessageStore.getState().addMessage(mockMsg, "c1");
    const pending = deferred<unknown>();
    put.mockReturnValueOnce(pending.promise);

    const toggling = useMessageStore.getState().toggleReaction("m1", "c1", "👍");
    // Another user's reaction lands while our request is still in flight.
    useMessageStore.getState().applyReactionEvent("m1", "c1", "👍", 4, "other-user", "add");

    pending.reject(new Error("nope"));
    await toggling;

    const r = reaction("m1", "c1", "👍");
    expect(r?.count).toBe(4);
    expect(r?.selfReacted).toBe(false);
  });
});
