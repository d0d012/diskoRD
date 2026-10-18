import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../../lib/api";
import { usePixelArtStore } from "../../stores/pixelArtStore";
import { useShowcaseOverlayStore } from "../../stores/showcaseOverlayStore";
import { ProfileShowcase } from "./ProfileShowcase";
import { createArt, paint } from "./lib/art";
import { encodeDoc } from "./lib/doc";
import type { PixelArtPiece } from "../../types";

vi.mock("../../lib/api", () => ({
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
vi.mock("./render", () => ({
  drawArt: vi.fn(),
  artToPng: vi.fn(async () => new Blob(["png"])),
  shareScale: () => 8,
  loadImageRgba: vi.fn(),
  downloadBlob: vi.fn(),
}));
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as unknown as HTMLCanvasElement["getContext"];
HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,AAAA");

const mocked = vi.mocked(api);

function pieces(n: number, owner = "friend"): PixelArtPiece[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    ownerId: owner,
    title: `Piece ${i}`,
    doc: encodeDoc(paint(createArt(16), [[i % 16, 1]], 1)),
    showcasePosition: i,
    remixOf: null,
    remixAuthor: i === 1 ? { id: "x", username: "deniz" } : null,
    createdAt: "2026-10-18T00:00:00Z",
    updatedAt: "2026-10-18T00:00:00Z",
  }));
}

function serve(showcase: PixelArtPiece[]) {
  mocked.get.mockResolvedValue({ data: { data: { showcase, buddies: [] } } });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  usePixelArtStore.setState({ gallery: null, profiles: {} });
});

describe("ProfileShowcase", () => {
  it("shows up to five tiles and expands the rest with +N", async () => {
    serve(pieces(9));
    render(<ProfileShowcase userId="friend" isSelf={false} />);

    expect(await screen.findByRole("button", { name: "View Piece 0" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^View Piece/ })).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Show 5 more" }));
    expect(screen.getAllByRole("button", { name: /^View Piece/ })).toHaveLength(9);
    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.getAllByRole("button", { name: /^View Piece/ })).toHaveLength(4);
  });

  it("renders nothing for someone else's empty showcase, an add tile for your own", async () => {
    serve([]);
    const { container, unmount } = render(<ProfileShowcase userId="friend" isSelf={false} />);
    await waitFor(() => expect(mocked.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    unmount();

    render(<ProfileShowcase userId="me" isSelf />);
    expect(await screen.findByRole("button", { name: /Add your pixel art/ })).toBeInTheDocument();
  });

  it("opens the viewer, steps with the arrow keys, and shows remix credit", async () => {
    serve(pieces(3));
    const onOverlayChange = vi.fn();
    render(<ProfileShowcase userId="friend" isSelf={false} onOverlayChange={onOverlayChange} />);

    fireEvent.click(await screen.findByRole("button", { name: "View Piece 0" }));
    expect(screen.getByRole("dialog", { name: "Piece 0" })).toBeInTheDocument();
    expect(onOverlayChange).toHaveBeenLastCalledWith(true);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    const second = screen.getByRole("dialog", { name: "Piece 1" });
    expect(second).toHaveTextContent("Remixed from @deniz");
    expect(second).toHaveTextContent("2 of 3");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Piece 1" })).toBeNull();
    expect(onOverlayChange).toHaveBeenLastCalledWith(false);
  });

  it("remixes someone else's piece into the editor with credit", async () => {
    serve(pieces(2));
    mocked.post.mockResolvedValue({ data: { data: { ...pieces(1, "me")[0], id: "copy" } } });
    mocked.put.mockResolvedValue({ data: { data: "ok" } });
    render(<ProfileShowcase userId="friend" isSelf={false} />);

    fireEvent.click(await screen.findByRole("button", { name: "View Piece 0" }));
    fireEvent.click(screen.getByRole("button", { name: /Remix/ }));
    expect(screen.getByRole("dialog", { name: "Pixel art" })).toBeInTheDocument();
    expect(screen.getByText("Keeps credit to the original")).toBeInTheDocument();
  });

  it("offers Edit and reordering instead of Remix on your own pieces", async () => {
    serve(pieces(2, "me"));
    render(<ProfileShowcase userId="me" isSelf />);
    fireEvent.click(await screen.findByRole("button", { name: "View Piece 0" }));
    expect(screen.queryByRole("button", { name: /Remix/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Edit/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Move →/ })).toBeInTheDocument();
  });

  it("View all opens the showcase museum", async () => {
    serve(pieces(2));
    render(<ProfileShowcase userId="friend" isSelf={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "View all →" }));
    expect(useShowcaseOverlayStore.getState().userId).toBe("friend");
  });
});

