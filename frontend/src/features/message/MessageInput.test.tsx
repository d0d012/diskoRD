import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MessageInput } from "./MessageInput";
import { useMessageStore } from "../../stores/messageStore";
import type { Message } from "../../types";

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
    sendMessage.mockReset().mockResolvedValue(undefined);
    uploadImage.mockReset().mockResolvedValue(undefined);
    useMessageStore.setState({ sendMessage, uploadImage, typingUsers: {}, replyingTo: null });
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

  const parent = { id: "parent", channelId: "c1", author: { id: "u1", username: "alice" }, content: "hello", createdAt: "2025-01-01" } as Message;

  it("shows reply target, cancels with Escape, and sends with the parent id", async () => {
    const textarea = renderInput();
    act(() => useMessageStore.getState().startReply(parent));
    expect(screen.getByText(/Replying to/)).toHaveTextContent("Replying to alice");
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByText(/Replying to/)).not.toBeInTheDocument();
    act(() => useMessageStore.getState().startReply(parent));
    fireEvent.change(textarea, { target: { value: "my reply" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith("c1", "my reply", "parent"));
    await waitFor(() => expect(useMessageStore.getState().replyingTo).toBeNull());
  });

  it("retains the reply target after a failed send and cancels via button", async () => {
    sendMessage.mockRejectedValueOnce(new Error("offline"));
    const textarea = renderInput();
    act(() => useMessageStore.getState().startReply(parent));
    fireEvent.change(textarea, { target: { value: "retry" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(textarea).toHaveValue("retry"));
    expect(useMessageStore.getState().replyingTo?.message.id).toBe("parent");
    fireEvent.click(screen.getByRole("button", { name: "Cancel reply" }));
    expect(useMessageStore.getState().replyingTo).toBeNull();
  });

  it("does not show another channel's reply in this composer", () => {
    renderInput();
    act(() => useMessageStore.getState().startReply({ ...parent, channelId: "other" }));
    expect(screen.queryByText(/Replying to/)).not.toBeInTheDocument();
  });

  it("clears the reply when the channel changes", () => {
    const { rerender } = render(
      <MessageInput channelId="c1" guildId="g1" channelName="general" onTyping={vi.fn()} />
    );
    act(() => useMessageStore.getState().startReply(parent));
    expect(useMessageStore.getState().replyingTo).not.toBeNull();

    rerender(
      <MessageInput channelId="c2" guildId="g1" channelName="general2" onTyping={vi.fn()} />
    );

    expect(useMessageStore.getState().replyingTo).toBeNull();
  });

  it("uploads an image pasted from the clipboard", async () => {
    const textarea = renderInput();
    const image = new File(["png"], "image.png", { type: "image/png" });

    fireEvent.paste(textarea, { clipboardData: { files: [image] } });

    await waitFor(() => expect(uploadImage).toHaveBeenCalledWith("c1", image));
  });

  it("includes the reply id on image uploads", async () => {
    const textarea = renderInput();
    act(() => useMessageStore.getState().startReply(parent));
    const image = new File(["png"], "image.png", { type: "image/png" });
    fireEvent.paste(textarea, { clipboardData: { files: [image] } });
    await waitFor(() => expect(uploadImage).toHaveBeenCalledWith("c1", image, "", "parent"));
    await waitFor(() => expect(useMessageStore.getState().replyingTo).toBeNull());
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
