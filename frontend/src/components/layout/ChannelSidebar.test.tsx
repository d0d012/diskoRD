import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChannelSidebar } from "./ChannelSidebar";
import { useGuildStore } from "../../stores/guildStore";
import { useAuthStore } from "../../stores/authStore";
import type { Channel } from "../../types";

vi.mock("../../lib/api", () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: { data: [] } })), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
  resolveMediaUrl: (url: string | null | undefined) => url ?? undefined,
  setToken: vi.fn(), setSessionHandlers: vi.fn(), refreshSession: vi.fn(), isTokenFresh: vi.fn(),
  startSessionKeeper: vi.fn(), stopSessionKeeper: vi.fn(),
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

const channels: Channel[] = [
  { id: "t1", guildId: "g1", name: "general", type: "text", position: 0 },
  { id: "v1", guildId: "g1", name: "lounge", type: "voice", position: 1 },
  { id: "b1", guildId: "g1", name: "sprint-board", type: "whiteboard", position: 2 },
] as Channel[];

beforeEach(() => {
  useAuthStore.setState({ user: { id: "me", username: "me", status: "online", createdAt: "2026-01-01T00:00:00Z" } } as never);
  useGuildStore.setState({
    guilds: [{ id: "g1", name: "Guild", ownerId: "me" }] as never,
    activeGuildId: "g1", activeChannelId: "t1", channels: { g1: channels },
  });
});

describe("ChannelSidebar", () => {
  it("renders a separate Boards section with the board channel", () => {
    render(<ChannelSidebar />);
    expect(screen.getByText("Boards")).toBeInTheDocument();
    expect(screen.getByText("sprint-board")).toBeInTheDocument();
    expect(screen.getByText("general")).toBeInTheDocument();
    expect(screen.getByText("lounge")).toBeInTheDocument();
  });

  it("hides the Boards section for a non-owner when the guild has no boards", () => {
    useAuthStore.setState({ user: { id: "other", username: "o", status: "online", createdAt: "2026-01-01T00:00:00Z" } } as never);
    useGuildStore.setState({ channels: { g1: channels.slice(0, 2) } });
    render(<ChannelSidebar />);
    expect(screen.queryByText("Boards")).toBeNull();
  });
});
