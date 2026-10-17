import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MessageList } from "./MessageList";
import { useMessageStore } from "../../stores/messageStore";
import { useAuthStore } from "../../stores/authStore";
import type { Message, User } from "../../types";

vi.mock("../../lib/api", () => ({
  api: { post: vi.fn(), get: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  resolveMediaUrl: (url: string | null | undefined) => url ?? undefined,
  setToken: vi.fn(),
  setSessionHandlers: vi.fn(),
  refreshSession: vi.fn(),
  isTokenFresh: vi.fn(),
  startSessionKeeper: vi.fn(),
  stopSessionKeeper: vi.fn(),
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

const scrollIntoView = vi.fn();
Element.prototype.scrollIntoView = scrollIntoView;

function author(id: string): User {
  return { id, username: id, status: "online", createdAt: "2026-01-01T00:00:00Z" };
}

function makeMessages(count: number, authorId = "other"): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    channelId: "c1",
    guildId: "g1",
    author: author(authorId),
    content: `message ${i}`,
    // Far apart so messages don't group.
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, i * 10)).toISOString(),
  }));
}

function setMessages(msgs: Message[]) {
  act(() => {
    useMessageStore.setState({ messages: { c1: msgs }, hasMore: { c1: false } });
  });
}

/** Fakes a scroll container 5000px tall with a 500px viewport, scrolled to `scrollTop`. */
function scrollTo(scrollTop: number) {
  const el = screen.getByText("message 0").closest(".overflow-y-auto") as HTMLElement;
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: 5000 });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: 500 });
  el.scrollTop = scrollTop;
  fireEvent.scroll(el);
}

const jumpButton = () => screen.queryByRole("button", { name: "Jump to latest message" });

describe("MessageList jump to latest", () => {
  beforeEach(() => {
    scrollIntoView.mockClear();
    useAuthStore.setState({ user: author("me") });
    useMessageStore.setState({ fetchMessages: vi.fn().mockResolvedValue(undefined), messages: {}, hasMore: {} });
  });

  it("shows the button only when scrolled away from the bottom", () => {
    render(<MessageList channelId="c1" channelName="general" />);
    setMessages(makeMessages(60));

    scrollTo(4500); // at bottom
    expect(jumpButton()).toBeNull();

    scrollTo(1000); // far up
    expect(jumpButton()).toBeInTheDocument();
  });

  it("counts messages that arrive while scrolled up and jumps on click, even in short channels", () => {
    render(<MessageList channelId="c1" channelName="general" />);
    const msgs = makeMessages(10);
    setMessages(msgs);
    scrollTo(1000);
    scrollIntoView.mockClear();

    setMessages([...msgs, ...makeMessages(12).slice(10)]);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(jumpButton()).toHaveTextContent("2");

    fireEvent.click(jumpButton()!);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
    expect(jumpButton()).not.toHaveTextContent("2");
  });

  it("scrolls to the bottom when you send a message while scrolled up", () => {
    render(<MessageList channelId="c1" channelName="general" />);
    const msgs = makeMessages(60);
    setMessages(msgs);
    scrollTo(1000);
    scrollIntoView.mockClear();

    const mine = { ...makeMessages(61, "me")[60] };
    setMessages([...msgs, mine]);

    expect(scrollIntoView).toHaveBeenCalled();
    expect(jumpButton()).not.toHaveTextContent("1");
  });
});
