import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UserProfileCard } from "./UserProfileCard";
import { useAuthStore } from "../../stores/authStore";
import { useUserStore } from "../../stores/userStore";
import { usePresenceStore } from "../../stores/presenceStore";
import { useGuildStore } from "../../stores/guildStore";
import type { User } from "../../types";

vi.mock("../../lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: { data: null } }),
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

const rect = {
  top: 0,
  left: 0,
  right: 10,
  bottom: 10,
  width: 10,
  height: 10,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

const me: User = {
  id: "me",
  username: "alice",
  displayName: "Alice",
  status: "online",
  preferredStatus: "online",
  createdAt: "2020-10-13T00:00:00Z",
};

beforeEach(() => {
  useAuthStore.setState({ user: me });
  useUserStore.setState({ users: {} });
  usePresenceStore.setState({ statuses: {} });
  useGuildStore.setState({ roles: {} });
});

describe("UserProfileCard", () => {
  it("hides About me and Roles when empty, and shows Edit Profile for self", () => {
    render(<UserProfileCard userId="me" anchorRect={rect} preferredSide="right" onClose={() => {}} />);

    expect(screen.queryByText("About me")).toBeNull();
    expect(screen.queryByText("Roles")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit Profile" })).toBeInTheDocument();
  });

  it("shows a message input for other users", () => {
    useUserStore.setState({ users: { other: { id: "other", username: "bob" } } });

    render(<UserProfileCard userId="other" anchorRect={rect} preferredSide="right" onClose={() => {}} />);

    expect(screen.getByPlaceholderText("Message @bob")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Profile" })).toBeNull();
  });

  it("shows About me when the user has a bio", () => {
    useUserStore.setState({ users: { other: { id: "other", username: "bob", bio: "Hello there" } } });

    render(<UserProfileCard userId="other" anchorRect={rect} preferredSide="right" onClose={() => {}} />);

    expect(screen.getByText("About me")).toBeInTheDocument();
    expect(screen.getByText("Hello there")).toBeInTheDocument();
  });

  it("opens the avatar lightbox and closes only it on Escape", () => {
    const onClose = vi.fn();
    useUserStore.setState({ users: { other: { id: "other", username: "bob", avatarUrl: "/uploads/avatars/other/a.webp" } } });

    render(<UserProfileCard userId="other" anchorRect={rect} preferredSide="right" onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "View avatar" }));
    expect(screen.getByRole("dialog", { name: "bob's avatar" })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("dialog", { name: "bob's avatar" }).querySelector("img")!);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "bob's avatar" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("has no lightbox button without an uploaded avatar", () => {
    useUserStore.setState({ users: { other: { id: "other", username: "bob" } } });

    render(<UserProfileCard userId="other" anchorRect={rect} preferredSide="right" onClose={() => {}} />);

    expect(screen.queryByRole("button", { name: "View avatar" })).toBeNull();
  });
});
