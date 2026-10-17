import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MessageItem } from "../message/MessageItem";
import { PlaceDecoration } from "./PlaceDecoration";
import { decorationLeft } from "./decorationImage";
import { createArt, paint } from "./lib/art";
import { encodeDoc } from "./lib/doc";
import { useAuthStore } from "../../stores/authStore";
import { useMessageStore } from "../../stores/messageStore";
import { useMessageMenuStore } from "../../stores/messageMenuStore";
import { useGuildStore } from "../../stores/guildStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUserStore } from "../../stores/userStore";
import type { Decoration, Message, User } from "../../types";

vi.mock("../../lib/api", () => ({
  api: { post: vi.fn(), get: vi.fn().mockResolvedValue({ data: { data: null } }), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  resolveMediaUrl: (url: string | null | undefined) => url ?? undefined,
  setToken: vi.fn(),
  setSessionHandlers: vi.fn(),
  refreshSession: vi.fn(),
  isTokenFresh: vi.fn(),
  startSessionKeeper: vi.fn(),
  stopSessionKeeper: vi.fn(),
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

// jsdom has no canvas: fake just enough for rasterizing.
vi.mock("./render", () => ({ drawArt: vi.fn() }));
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as unknown as HTMLCanvasElement["getContext"];
HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,AAAA");

const user = (id: string): User => ({ id, username: id, status: "online", createdAt: "2026-01-01T00:00:00Z" });

const art = paint(createArt(16), [[1, 1]], 1);

function decoration(id: string, authorId: string | null, x = 50): Decoration {
  return { id, messageId: "m1", authorId, doc: encodeDoc(art), x, y: 8, size: 64, createdAt: "2026-01-01T00:00:00Z" };
}

const baseMessage: Message = {
  id: "m1",
  channelId: "c1",
  guildId: "g1",
  author: user("other"),
  content: "hello",
  createdAt: "2026-01-01T00:00:00Z",
};

function setMessage(message: Message) {
  act(() => useMessageStore.setState({ messages: { c1: [message] } }));
}

function Row() {
  const message = useMessageStore((s) => s.messages.c1?.[0]);
  return message ? <MessageItem message={message} isGrouped={false} /> : null;
}

beforeEach(() => {
  useAuthStore.setState({ user: user("me") });
  useMessageMenuStore.setState({ openId: null, x: 0, y: 0 });
  useUserStore.setState({ users: {} });
  useGuildStore.setState({ guilds: [] });
  useSettingsStore.setState({ showDecorations: true });
  setMessage({ ...baseMessage, decorations: [] });
});

const decorationsShown = () => screen.queryAllByTestId("message-decoration");

describe("message decorations", () => {
  it("renders faintly behind the row without catching clicks", () => {
    setMessage({ ...baseMessage, decorations: [decoration("d1", "other", 100)] });
    render(<Row />);

    const [img] = decorationsShown();
    expect(img.style.opacity).toBe("0.35");
    expect(img.style.zIndex).toBe("-1");
    expect(img).toHaveClass("pointer-events-none");
    expect(img.style.left).toBe(decorationLeft(100, 64));
    // Rows must not create stacking contexts, or pieces would cover neighbouring rows' text.
    expect((document.querySelector("[data-message-id]") as HTMLElement).style.isolation).toBe("");
  });

  it("follows live add/remove events and survives message edits", () => {
    render(<Row />);
    act(() => useMessageStore.getState().applyDecoration("c1", decoration("d1", "other")));
    expect(decorationsShown()).toHaveLength(1);

    // An edit event carries no decorations; they must stay.
    act(() => useMessageStore.getState().updateMessage({ ...baseMessage, content: "edited", editedAt: "2026-01-02T00:00:00Z" }));
    expect(decorationsShown()).toHaveLength(1);

    act(() => useMessageStore.getState().removeDecoration("c1", "m1", "d1"));
    expect(decorationsShown()).toHaveLength(0);
  });

  it("is hidden when the viewer turned decorations off", () => {
    useSettingsStore.setState({ showDecorations: false });
    setMessage({ ...baseMessage, decorations: [decoration("d1", "other")] });
    render(<Row />);
    expect(decorationsShown()).toHaveLength(0);
  });

  it("offers removing only the viewer's own pieces on someone else's message", async () => {
    const deleteDecoration = vi.fn().mockResolvedValue(undefined);
    useMessageStore.setState({ deleteDecoration });
    setMessage({ ...baseMessage, decorations: [decoration("mine", "me"), decoration("theirs", "other")] });
    render(<Row />);

    fireEvent.contextMenu(document.querySelector(".group")!, { clientX: 10, clientY: 10 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove Decoration" }));

    expect(deleteDecoration).toHaveBeenCalledTimes(1);
    expect(deleteDecoration).toHaveBeenCalledWith("mine");
  });

  it("lets the message author remove every piece", async () => {
    setMessage({ ...baseMessage, author: user("me"), decorations: [decoration("a", "x"), decoration("b", "y")] });
    render(<Row />);
    fireEvent.contextMenu(document.querySelector(".group")!, { clientX: 10, clientY: 10 });
    expect(await screen.findByRole("menuitem", { name: "Remove 2 Decorations" })).toBeInTheDocument();
  });
});

describe("PlaceDecoration", () => {
  /** A list with two 40px rows at y=200 and y=240, 400px wide starting at x=100. */
  function setup(onPlace = vi.fn().mockResolvedValue(undefined)) {
    const list = document.createElement("div");
    const rect = (top: number, height: number) =>
      () => ({ left: 100, top, width: 400, height, right: 500, bottom: top + height, x: 100, y: top, toJSON: () => ({}) }) as DOMRect;
    list.getBoundingClientRect = rect(100, 400);
    for (const [id, top] of [["m1", 200], ["m2", 240]] as const) {
      const row = document.createElement("div");
      row.dataset.messageId = id;
      row.getBoundingClientRect = rect(top, 40);
      list.appendChild(row);
    }
    document.body.appendChild(list);
    const onCancel = vi.fn();
    render(<PlaceDecoration art={art} list={list} onPlace={onPlace} onCancel={onCancel} />);
    return { onPlace, onCancel, list, overlay: screen.getByRole("dialog", { name: "Place pixel art in chat" }) };
  }

  it("anchors to the message under the pointer, centered on it", async () => {
    const { onPlace, overlay } = setup();
    // Centered at (300, 250) with a 64px piece: top-left at (268, 218); row m2 starts at 240.
    fireEvent.click(overlay, { clientX: 300, clientY: 250 });
    await waitFor(() => expect(onPlace).toHaveBeenCalledWith({ messageId: "m2", x: 50, y: -22, size: 64 }));
  });

  it("uses the nearest message for gaps and the far ends, clamping x", async () => {
    const { onPlace, overlay } = setup();
    fireEvent.click(overlay, { clientX: 900, clientY: 150 }); // above the first row, past the right edge
    await waitFor(() => expect(onPlace).toHaveBeenCalledWith({ messageId: "m1", x: 100, y: -82, size: 64 }));
  });

  it("changes size with the buttons without placing", async () => {
    const { onPlace, overlay } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Larger" }));
    expect(onPlace).not.toHaveBeenCalled();
    fireEvent.click(overlay, { clientX: 300, clientY: 210 });
    await waitFor(() => expect(onPlace).toHaveBeenCalledWith(expect.objectContaining({ messageId: "m1", size: 96 })));
  });

  it("lets the wheel scroll the history underneath", () => {
    const { list, overlay } = setup();
    const seen = vi.fn();
    list.addEventListener("wheel", seen);
    fireEvent.wheel(overlay, { deltaY: 120 });
    expect(list.scrollTop).toBe(120);
    expect(seen).toHaveBeenCalled(); // the list learns it was a user scroll
  });

  it("shows the server's error and stays open", async () => {
    const onPlace = vi.fn().mockRejectedValue({ response: { data: { error: "this message already has 3 decorations" } } });
    const { overlay } = setup(onPlace);
    fireEvent.click(overlay, { clientX: 300, clientY: 210 });
    expect(await screen.findByText("this message already has 3 decorations")).toBeInTheDocument();
  });

  it("cancels on Escape", () => {
    const { onCancel } = setup();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
});
