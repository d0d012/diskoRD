import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MembersPanel } from "./MembersPanel";
import { useGuildStore } from "../../stores/guildStore";
import { usePresenceStore } from "../../stores/presenceStore";
import { useUserStore } from "../../stores/userStore";
import { useAuthStore } from "../../stores/authStore";
import type { Member } from "../../types";

const get = vi.fn();

vi.mock("../../lib/api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
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

const members: Member[] = [
  { id: "m-online", username: "OnlineGuy", role: "member", roles: [], joinedAt: "2026-01-01T00:00:00Z", status: "online" },
  { id: "m-idle", username: "AwayGuy", role: "member", roles: [], joinedAt: "2026-01-01T00:00:00Z", status: "online" },
  { id: "m-dnd", username: "BusyGuy", role: "member", roles: [], joinedAt: "2026-01-01T00:00:00Z", status: "online" },
  { id: "m-offline", username: "OfflineGuy", role: "member", roles: [], joinedAt: "2026-01-01T00:00:00Z", status: "offline" },
];

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((url: string) => {
    if (url.endsWith("/members")) return Promise.resolve({ data: { data: members } });
    if (url.endsWith("/roles")) return Promise.resolve({ data: { data: [] } });
    return Promise.resolve({ data: { data: [] } });
  });
  useGuildStore.setState({ activeGuildId: "g1", roles: {}, guilds: [], channels: {}, activeChannelId: null });
  usePresenceStore.setState({ statuses: { "m-idle": "idle", "m-dnd": "dnd", "m-offline": "offline" } });
  useUserStore.setState({ users: {} });
  useAuthStore.setState({ user: { id: "me", username: "me", status: "online", createdAt: "2026-01-01T00:00:00Z" } });
});

describe("MembersPanel grouping", () => {
  it("counts idle and dnd members as online and only offline as offline", async () => {
    render(<MembersPanel />);

    await waitFor(() => expect(screen.getByText(/Online — 3/)).toBeInTheDocument());
    expect(screen.getByText(/Offline — 1/)).toBeInTheDocument();
    expect(screen.getByText("AwayGuy")).toBeInTheDocument();
    expect(screen.getByText("BusyGuy")).toBeInTheDocument();
    expect(screen.getByText("OfflineGuy")).toBeInTheDocument();
  });
});
