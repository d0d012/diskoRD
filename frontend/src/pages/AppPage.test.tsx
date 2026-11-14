import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AppPage } from "./AppPage";
import { useGuildStore } from "../stores/guildStore";
import type { Channel } from "../types";

vi.mock("../features/whiteboard/WhiteboardChannel", () => ({
  WhiteboardChannel: ({ channelId }: { channelId: string }) => <div data-testid="board-host">{channelId}</div>,
}));
vi.mock("../components/layout/MainLayout", () => ({
  MainLayout: ({ children, showMembers = true }: { children: React.ReactNode; showMembers?: boolean }) => (
    <div>{children}{showMembers && <div data-testid="members-panel" />}</div>
  ),
}));
vi.mock("../components/layout/TitleBar", () => ({ TitleBar: () => null }));
vi.mock("../hooks/useGateway", () => ({ useGateway: vi.fn(), sendGatewayTyping: vi.fn() }));
vi.mock("../hooks/useVoice", () => ({ useVoice: () => ({ participants: [], connectionState: "disconnected" }) }));
vi.mock("../features/message/MessageList", () => ({ MessageList: () => <div data-testid="message-list" /> }));
vi.mock("../features/message/MessageInput", () => ({ MessageInput: () => <input aria-label="message" /> }));
vi.mock("../features/friend/FriendsPage", () => ({ FriendsPage: () => null }));
vi.mock("../features/friend/DMConversation", () => ({ DMConversation: () => null }));
vi.mock("../features/voice/VoicePanel", () => ({ VoicePanel: () => <div data-testid="voice-panel" /> }));
vi.mock("../features/voice/GlobalVoiceAudio", () => ({ GlobalVoiceAudio: () => null }));
vi.mock("../features/notification/NotificationToast", () => ({ NotificationToastContainer: () => null }));
vi.mock("../features/call/IncomingCallOverlay", () => ({ IncomingCallOverlay: () => null }));
vi.mock("../features/pixelart/museum/ShowcaseMuseum", () => ({ ShowcaseMuseumHost: () => null }));
vi.mock("../features/call/OutgoingCallOverlay", () => ({ OutgoingCallOverlay: () => null }));
vi.mock("../features/call/DMCallPanel", () => ({ DMCallPanel: () => null }));
vi.mock("../features/voice/VoiceCallViewHost", () => ({ VoiceCallViewHost: () => null }));

const channels = [
  { id: "t1", guildId: "g1", name: "general", type: "text", position: 0 },
  { id: "b1", guildId: "g1", name: "sprint-board", type: "whiteboard", position: 1 },
] as Channel[];

beforeEach(() => {
  useGuildStore.setState({
    activeGuildId: "g1", activeChannelId: "b1", channels: { g1: channels },
    fetchGuilds: vi.fn() as never,
  });
});

describe("AppPage board channels", () => {
  it("renders the board host instead of the chat view", async () => {
    render(<AppPage />);
    expect((await screen.findByTestId("board-host")).textContent).toBe("b1");
    expect(screen.queryByTestId("message-list")).toBeNull();
    expect(screen.queryByLabelText("message")).toBeNull();
  });

  it("hides the members panel by default and toggles it from the header", async () => {
    render(<AppPage />);
    await screen.findByTestId("board-host");
    expect(screen.queryByTestId("members-panel")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Toggle members" }));
    expect(screen.getByTestId("members-panel")).toBeInTheDocument();
  });

  it("keeps the chat view and members panel for text channels", () => {
    useGuildStore.setState({ activeChannelId: "t1" });
    render(<AppPage />);
    expect(screen.getByTestId("message-list")).toBeInTheDocument();
    expect(screen.getByTestId("members-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("board-host")).toBeNull();
  });
});
