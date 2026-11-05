import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageInput } from "./MessageInput";
import { useMessageStore } from "../../stores/messageStore";
vi.mock("./GifPicker", () => ({ GifPicker: ({ onSend, onClose }: { onSend: (url: string) => Promise<void>; onClose: () => void }) => <div role="dialog" aria-label="GIF picker"><button onClick={() => void onSend("https://static.klipy.com/a.gif?sig=1")}>Send test GIF</button><button onClick={onClose}>Close picker</button></div> }));
const sendMessage = vi.fn();
beforeEach(() => {
  sendMessage.mockReset().mockResolvedValue(undefined);
  useMessageStore.setState({ sendMessage, typingUsers: {}, replyingTo: null });
});
afterEach(() => vi.unstubAllEnvs());
describe("composer GIF integration", () => {
  it("disables the GIF button when no client key is configured", () => {
    vi.stubEnv("VITE_KLIPY_API_KEY", "");
    render(<MessageInput channelId="c1" guildId="g1" channelName="general" onTyping={vi.fn()} />);
    expect(screen.getByRole("button", { name: "GIFs not configured" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "GIFs not configured" })).toHaveAttribute("title", "GIFs not configured");
  });
  it("keeps active reply when sending a GIF, closes the picker, and preserves drafted text", async () => {
    vi.stubEnv("VITE_KLIPY_API_KEY", "test");
    useMessageStore.setState({ replyingTo: { channelId: "c1", message: { id: "reply", author: { username: "alice" }, content: "hello" } as any } });
    render(<MessageInput channelId="c1" guildId="g1" channelName="general" onTyping={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Open GIF picker" }));
    fireEvent.click(screen.getByRole("button", { name: "Send test GIF" }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith("c1", "https://static.klipy.com/a.gif?sig=1", "reply"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("draft");
    expect(useMessageStore.getState().replyingTo).toBeNull();
  });
});
