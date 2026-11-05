import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MessageInput } from "./MessageInput";
import { useMessageStore } from "../../stores/messageStore";
import { useAuthStore } from "../../stores/authStore";
import { useFriendStore } from "../../stores/friendStore";
import { useUserStore } from "../../stores/userStore";
import { api } from "../../lib/api";
import { clearMentionRosterCache } from "./useMentionCandidates";

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

const sendMessage = vi.fn();
const uploadImage = vi.fn();

function renderInput() {
  render(<MessageInput channelId="c1" guildId="g1" channelName="general" onTyping={vi.fn()} />);
  return screen.getByPlaceholderText("Message #general") as HTMLTextAreaElement;
}

describe("MessageInput", () => {
  beforeEach(() => {
    clearMentionRosterCache();
    sendMessage.mockReset().mockResolvedValue(undefined);
    uploadImage.mockReset().mockResolvedValue(undefined);
    useMessageStore.setState({ sendMessage, uploadImage, typingUsers: {} });
    useAuthStore.setState({ user: null });
    useFriendStore.setState({ dms: [] });
    useUserStore.setState({ users: {} });
    vi.mocked(api.get).mockReset().mockResolvedValue({ data: { data: [
      { id: "alice", username: "alice", displayName: "Alice Wonderland" },
      { id: "bob", username: "bobby", displayName: "Bob Builder" },
      { id: "carol", username: "carol", displayName: "Carol" },
    ] } });
  });

  it("keeps focus after sending so the next message can be typed right away", async () => {
    const textarea = renderInput();
    textarea.focus();

    fireEvent.change(textarea, { target: { value: "merhaba" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith("c1", "merhaba"));
    expect(document.activeElement).toBe(textarea);
    expect(textarea).not.toBeDisabled();
  });

  it("filters guild members by username and display name, case-insensitively", async () => {
    const textarea = renderInput();
    fireEvent.change(textarea, { target: { value: "hello @BUİL" } });
    expect(await screen.findByRole("option", { name: /Bob Builder/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /alice/ })).not.toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/guilds/g1/members"));
    fireEvent.change(textarea, { target: { value: "@ALI" } });
    expect(screen.getByRole("option", { name: /alice/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /bobby/ })).not.toBeInTheDocument();
    fireEvent.change(textarea, { target: { value: "@unknown" } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("navigates with arrows and inserts with Enter without sending", async () => {
    const textarea = renderInput();
    fireEvent.change(textarea, { target: { value: "hello @" } });
    await screen.findByRole("listbox");
    expect(screen.getByRole("option", { name: /alice/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: /carol/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /bobby/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(textarea).toHaveValue("hello @bobby ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(sendMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(textarea.selectionStart).toBe(13));
    expect(textarea).toHaveFocus();
  });

  it("selects with Tab and mouse click, preserving surrounding text", async () => {
    const textarea = renderInput();
    fireEvent.change(textarea, { target: { value: "@al" } });
    await screen.findByRole("listbox");
    fireEvent.keyDown(textarea, { key: "Tab" });
    expect(textarea).toHaveValue("@alice ");
    fireEvent.change(textarea, { target: { value: "hi @bo and bye" } });
    textarea.setSelectionRange(6, 6);
    fireEvent.select(textarea);
    const option = await screen.findByRole("option", { name: /bobby/ });
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    expect(textarea).toHaveValue("hi @bobby and bye");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("dismisses on Escape and blur, and does not trigger inside email addresses", async () => {
    const textarea = renderInput();
    fireEvent.change(textarea, { target: { value: "@" } });
    await screen.findByRole("listbox");
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.select(textarea);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.change(textarea, { target: { value: "@a" } });
    await screen.findByRole("listbox");
    fireEvent.blur(textarea);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.change(textarea, { target: { value: "email@al" } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("uses only the current DM participants, including self, without querying guild members", async () => {
    useAuthStore.setState({ user: { id: "self", username: "myself", displayName: "Me", status: "online", createdAt: "now" } });
    useFriendStore.setState({ dms: [
      { id: "dm1", recipient: { id: "bob", username: "bobby", status: "online" }, createdAt: "now" },
      { id: "dm2", recipient: { id: "other", username: "outsider", status: "online" }, createdAt: "now" },
    ] });
    render(<MessageInput channelId="dm1" guildId="" channelName="bobby" onTyping={vi.fn()} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "@" } });
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("option", { name: /myself/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /bobby/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /outsider/ })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("never shows the previous guild roster after switching channels", async () => {
    const { rerender } = render(<MessageInput channelId="c1" guildId="g1" channelName="general" onTyping={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "@" } });
    await screen.findByRole("listbox");
    vi.mocked(api.get).mockResolvedValue({ data: { data: [{ id: "new", username: "newmember" }] } });
    rerender(<MessageInput channelId="c2" guildId="g2" channelName="other" onTyping={vi.fn()} />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "@n" } });
    expect(await screen.findByRole("option", { name: /newmember/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /alice/ })).not.toBeInTheDocument();
  });

  it("uploads an image pasted from the clipboard", async () => {
    const textarea = renderInput();
    const image = new File(["png"], "image.png", { type: "image/png" });

    fireEvent.paste(textarea, { clipboardData: { files: [image] } });

    await waitFor(() => expect(uploadImage).toHaveBeenCalledWith("c1", image));
  });

  it("leaves plain text pastes alone", () => {
    const textarea = renderInput();

    fireEvent.paste(textarea, { clipboardData: { files: [] } });

    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("rejects pasted image types the server does not accept", async () => {
    const textarea = renderInput();
    const image = new File(["tiff"], "image.tiff", { type: "image/tiff" });

    fireEvent.paste(textarea, { clipboardData: { files: [image] } });

    expect(uploadImage).not.toHaveBeenCalled();
    expect(await screen.findByText(/Only JPEG, PNG, GIF and WebP/)).toBeInTheDocument();
  });
});
