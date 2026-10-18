import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { api } from "../../../lib/api";
import { useAuthStore } from "../../../stores/authStore";
import { usePixelArtStore } from "../../../stores/pixelArtStore";
import { useShowcaseOverlayStore } from "../../../stores/showcaseOverlayStore";
import { useUserStore } from "../../../stores/userStore";
import { ShowcaseMuseumHost } from "./ShowcaseMuseum";
import { createArt, paint } from "../lib/art";
import { encodeDoc } from "../lib/doc";
import type { PixelArtPiece } from "../../../types";

vi.mock("../../../lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
  resolveMediaUrl: (url: string | null | undefined) => url ?? undefined,
  setToken: vi.fn(),
  setSessionHandlers: vi.fn(),
  refreshSession: vi.fn(),
  isTokenFresh: vi.fn(),
  startSessionKeeper: vi.fn(),
  stopSessionKeeper: vi.fn(),
  SessionExpiredError: class SessionExpiredError extends Error {},
}));
vi.mock("../render", () => ({ drawArt: vi.fn(), artToPng: vi.fn(), shareScale: () => 8, loadImageRgba: vi.fn(), downloadBlob: vi.fn() }));
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn(), fillRect: vi.fn() })) as unknown as HTMLCanvasElement["getContext"];
HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,AAAA");

const mocked = vi.mocked(api);

function pieces(owner: string, titles: string[]): PixelArtPiece[] {
  return titles.map((title, i) => ({
    id: `p${i}`,
    ownerId: owner,
    title,
    doc: encodeDoc(paint(createArt(16), [[i, i]], 1)),
    showcasePosition: i,
    remixOf: null,
    remixAuthor: null,
    createdAt: "",
    updatedAt: "",
  }));
}

function serve(showcase: PixelArtPiece[], banner: { builtin: string } | null = null) {
  mocked.get.mockImplementation(async (url: string) =>
    url === "/users/me/pixel-arts" ? { data: { data: showcase } } : { data: { data: { showcase, buddies: [], banner } } });
}

const caseNames = () => screen.getAllByRole("button", { name: /^View / }).map((b) => b.getAttribute("aria-label"));

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: { id: "me", username: "me", status: "online", createdAt: "" } });
  useUserStore.setState({ users: { friend: { id: "friend", username: "deniz" } } });
  usePixelArtStore.setState({ gallery: null, profiles: {} });
  useShowcaseOverlayStore.setState({ userId: null });
  mocked.put.mockResolvedValue({ data: { data: "ok" } });
});

describe("ShowcaseMuseum", () => {
  it("opens from the store with the first piece as the hero and the rest in cases", async () => {
    serve(pieces("friend", ["Hero", "Two", "Three"]), { builtin: "night" });
    render(<ShowcaseMuseumHost />);
    expect(screen.queryByRole("dialog")).toBeNull();

    useShowcaseOverlayStore.getState().open("friend");
    expect(await screen.findByRole("dialog", { name: "deniz's showcase" })).toBeInTheDocument();
    await waitFor(() => expect(caseNames()).toEqual(["View Hero", "View Two", "View Three"]));
    expect(screen.queryByRole("button", { name: "Arrange" })).toBeNull(); // not your showcase
  });

  it("opens a piece in the full-size viewer, and Escape closes viewer then museum", async () => {
    serve(pieces("friend", ["Hero", "Two"]));
    render(<ShowcaseMuseumHost />);
    useShowcaseOverlayStore.getState().open("friend");

    fireEvent.click(await screen.findByRole("button", { name: "View Two" }));
    expect(screen.getByRole("dialog", { name: "Two" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Two" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "deniz's showcase" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "deniz's showcase" })).toBeNull();
  });

  it("lets the owner drag cases into a new order and saves it", async () => {
    serve(pieces("me", ["A", "B", "C"]));
    render(<ShowcaseMuseumHost />);
    useShowcaseOverlayStore.getState().open("me");
    const museum = await screen.findByRole("dialog", { name: "Your showcase" });
    await waitFor(() => expect(caseNames()).toHaveLength(3));

    fireEvent.click(within(museum).getByRole("button", { name: "Arrange" }));
    const cases = museum.querySelectorAll(".museum-case");
    fireEvent.dragStart(cases[2]);
    fireEvent.dragOver(cases[0]);
    fireEvent.drop(cases[0]);
    expect(caseNames()).toEqual(["View C", "View A", "View B"]);

    fireEvent.click(within(museum).getByRole("button", { name: "Save order" }));
    await waitFor(() => expect(mocked.put).toHaveBeenCalledWith("/users/me/showcase", { ids: ["p2", "p0", "p1"] }));
  });

  it("Escape while arranging cancels the new order instead of closing", async () => {
    serve(pieces("me", ["A", "B"]));
    render(<ShowcaseMuseumHost />);
    useShowcaseOverlayStore.getState().open("me");
    const museum = await screen.findByRole("dialog", { name: "Your showcase" });
    await waitFor(() => expect(caseNames()).toHaveLength(2));

    fireEvent.click(within(museum).getByRole("button", { name: "Arrange" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(within(museum).queryByRole("button", { name: "Save order" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Your showcase" })).toBeInTheDocument();
    expect(mocked.put).not.toHaveBeenCalled();
  });

  it("invites the owner to put art on display when empty", async () => {
    serve([]);
    render(<ShowcaseMuseumHost />);
    useShowcaseOverlayStore.getState().open("me");
    expect(await screen.findByText("Nothing on display yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Put art on display" })).toBeInTheDocument();
  });
});
