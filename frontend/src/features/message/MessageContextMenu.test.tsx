import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MessageItem } from "./MessageItem";
import { useAuthStore } from "../../stores/authStore";
import { useMessageStore } from "../../stores/messageStore";
import { useMessageMenuStore } from "../../stores/messageMenuStore";
import { useGuildStore } from "../../stores/guildStore";
import { useUserStore } from "../../stores/userStore";
import type { Message } from "../../types";

vi.mock("../../lib/api", () => ({
  api: {
    put: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    post: vi.fn(),
    get: vi.fn().mockResolvedValue({ data: { data: null } }),
    patch: vi.fn(),
  },
  resolveMediaUrl: (url: string | null | undefined) => url ?? undefined,
  setToken: vi.fn(),
  setSessionHandlers: vi.fn(),
  refreshSession: vi.fn(),
  isTokenFresh: vi.fn(),
  startSessionKeeper: vi.fn(),
  stopSessionKeeper: vi.fn(),
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

const baseMessage: Message = {
  id: "m1",
  channelId: "c1",
  guildId: "g1",
  author: { id: "me", username: "me", status: "online", createdAt: "2026-01-01T00:00:00Z" },
  content: "hello world",
  createdAt: "2026-01-01T00:00:00Z",
};

function renderMessage(message: Message) {
  return render(<MessageItem message={message} isGrouped={false} />);
}

function openMenu(container: HTMLElement) {
  const row = container.querySelector(".group") as HTMLElement;
  fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
}

beforeEach(() => {
  useAuthStore.setState({
    user: { id: "me", username: "me", status: "online", createdAt: "2026-01-01T00:00:00Z" },
    accessToken: "mock-token",
  });
  useMessageStore.setState({
    messages: { c1: [baseMessage] },
    unreadChannels: {},
    hasMore: {},
    typingUsers: {},
    unreadCounts: {},
    channelGuilds: {},
    mentionCounts: {},
  });
  useMessageMenuStore.setState({ openId: null, x: 0, y: 0 });
  useUserStore.setState({ users: {} });
  useGuildStore.setState({ guilds: [] });
});

describe("MessageItem hover stability", () => {
  it("does not render the add-reaction button on hover when there are no reactions", () => {
    renderMessage({ ...baseMessage, reactions: [] });

    expect(screen.queryByTitle("Add Reaction")).toBeNull();
    fireEvent.mouseEnter(document.querySelector(".group")!);
    expect(screen.queryByTitle("Add Reaction")).toBeNull();
  });

  it("keeps the add-reaction button when reactions exist", () => {
    renderMessage({ ...baseMessage, reactions: [{ emoji: "👍", count: 1, selfReacted: false }] });
    expect(screen.getByTitle("Add Reaction")).toBeInTheDocument();
  });
});

describe("MessageContextMenu", () => {
  it("opens on right-click and shows Edit/Delete for own messages", async () => {
    const { container } = renderMessage(baseMessage);
    openMenu(container);

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Edit Message/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Delete Message/ })).toBeInTheDocument();
  });

  it("shows Delete but not Edit for a guild owner on someone else's message", async () => {
    useGuildStore.setState({
      guilds: [{ id: "g1", name: "G", ownerId: "me", createdAt: "2026-01-01T00:00:00Z" }],
    });
    const { container } = renderMessage({
      ...baseMessage,
      author: { id: "other", username: "other", status: "online", createdAt: "2026-01-01T00:00:00Z" },
    });
    openMenu(container);

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Delete Message/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Edit Message/ })).toBeNull();
  });

  it("hides Delete in a DM with another user", async () => {
    const { container } = renderMessage({
      ...baseMessage,
      guildId: undefined,
      author: { id: "other", username: "other", status: "online", createdAt: "2026-01-01T00:00:00Z" },
    });
    openMenu(container);

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Delete Message/ })).toBeNull();
  });

  it("asks for confirmation before deleting", async () => {
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    useMessageStore.setState({ deleteMessage });
    const { container } = renderMessage(baseMessage);
    openMenu(container);

    fireEvent.click(await screen.findByRole("menuitem", { name: /Delete Message/ }));
    expect(await screen.findByRole("dialog", { name: "Delete Message" })).toBeInTheDocument();
    expect(deleteMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteMessage).toHaveBeenCalledWith("m1", "c1");
  });

  it("deletes immediately on Shift+click without a dialog", async () => {
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    useMessageStore.setState({ deleteMessage });
    const { container } = renderMessage(baseMessage);
    openMenu(container);

    fireEvent.click(await screen.findByRole("menuitem", { name: /Delete Message/ }), { shiftKey: true });

    expect(deleteMessage).toHaveBeenCalledWith("m1", "c1");
    expect(screen.queryByRole("dialog", { name: "Delete Message" })).toBeNull();
  });

  it("quick reaction toggles the reaction and closes the menu", async () => {
    const toggleReaction = vi.fn().mockResolvedValue(undefined);
    useMessageStore.setState({ toggleReaction });
    const { container } = renderMessage(baseMessage);
    openMenu(container);

    fireEvent.click(await screen.findByRole("menuitem", { name: "React with 👍" }));

    expect(toggleReaction).toHaveBeenCalledWith("m1", "c1", "👍");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("does not open on right-click when text is selected", () => {
    const { container } = renderMessage(baseMessage);
    const textNode = screen.getByText("hello world");
    const selection = {
      isCollapsed: false,
      toString: () => "hello",
      anchorNode: textNode,
    } as unknown as Selection;
    const spy = vi.spyOn(window, "getSelection").mockReturnValue(selection);

    openMenu(container);

    expect(screen.queryByRole("menu")).toBeNull();
    spy.mockRestore();
  });
});
