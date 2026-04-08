import { describe, it, expect, beforeEach, vi } from "vitest";
import { useMessageStore } from "./messageStore";
import { useAuthStore } from "./authStore";
import type { Message } from "../types";

vi.mock("../lib/api", () => ({
  api: {
    put: vi.fn(),
    delete: vi.fn(),
    post: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
  },
}));

describe("messageStore reactions", () => {
  beforeEach(() => {
    // Reset Zustand store state
    useMessageStore.setState({ messages: {}, unreadChannels: {}, hasMore: {}, typingUsers: {} });
    
    // Mock user struct
    useAuthStore.setState({
      user: {
        id: "u1",
        username: "testuser",
        status: "online",
        createdAt: "2026-01-01T00:00:00Z"
      },
      accessToken: "mock-token",
    });
  });

  const mockMsg: Message = {
    id: "m1",
    channelId: "c1",
    author: { id: "a1", username: "author", status: "online", createdAt: "2026-01-01T00:00:00Z" },
    content: "hello",
    createdAt: "2026-01-01T00:00:00Z",
    reactions: []
  };

  it("addReaction adds a new reaction", () => {
    useMessageStore.getState().addMessage(mockMsg, "c1");
    useMessageStore.getState().addReaction("m1", "c1", { emoji: "👍", count: 1, selfReacted: false });

    const state = useMessageStore.getState();
    const msg = state.messages["c1"].find(m => m.id === "m1");
    expect(msg?.reactions).toHaveLength(1);
    expect(msg?.reactions![0].emoji).toBe("👍");
    expect(msg?.reactions![0].count).toBe(1);
  });

  it("addReaction increments count of existing emoji", () => {
    useMessageStore.getState().addMessage(mockMsg, "c1");
    useMessageStore.getState().addReaction("m1", "c1", { emoji: "👍", count: 1, selfReacted: false });
    useMessageStore.getState().addReaction("m1", "c1", { emoji: "👍", count: 2, selfReacted: true });

    const state = useMessageStore.getState();
    const msg = state.messages["c1"].find(m => m.id === "m1");
    expect(msg?.reactions).toHaveLength(1);
    expect(msg?.reactions![0].count).toBe(2);
    expect(msg?.reactions![0].selfReacted).toBe(true);
  });

  it("removeReaction decrements count", () => {
    useMessageStore.getState().addMessage(mockMsg, "c1");
    useMessageStore.getState().addReaction("m1", "c1", { emoji: "👍", count: 2, selfReacted: true });
    
    // Removing a self reaction (by user "u1")
    useMessageStore.getState().removeReaction("m1", "c1", "👍", "u1");

    const state = useMessageStore.getState();
    const msg = state.messages["c1"].find(m => m.id === "m1");
    expect(msg?.reactions).toHaveLength(1);
    expect(msg?.reactions![0].count).toBe(1);
    expect(msg?.reactions![0].selfReacted).toBe(false); // since u1 was the self user
  });

  it("removeReaction removes entry when count reaches zero", () => {
    useMessageStore.getState().addMessage(mockMsg, "c1");
    useMessageStore.getState().addReaction("m1", "c1", { emoji: "❤️", count: 1, selfReacted: true });
    
    useMessageStore.getState().removeReaction("m1", "c1", "❤️", "u1");

    const state = useMessageStore.getState();
    const msg = state.messages["c1"].find(m => m.id === "m1");
    expect(msg?.reactions).toHaveLength(0); // or undefined/empty array depending on implementation
  });
});
