import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MessageInput } from "./MessageInput";
import { useMessageStore } from "../../stores/messageStore";

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
    useMessageStore.setState({ sendMessage, uploadImage, typingUsers: {} });
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
