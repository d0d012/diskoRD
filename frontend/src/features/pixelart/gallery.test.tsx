import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { api } from "../../lib/api";
import { usePixelArtStore } from "../../stores/pixelArtStore";
import { PixelArtEditor } from "./PixelArtEditor";
import { GalleryPicker } from "./GalleryDialogs";
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
  artToPng: vi.fn(),
  shareScale: () => 16,
  loadImageRgba: vi.fn(),
  downloadBlob: vi.fn(),
}));
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as unknown as HTMLCanvasElement["getContext"];
HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,AAAA");
Element.prototype.setPointerCapture = vi.fn();

const mocked = vi.mocked(api);

function piece(id: string, title: string, showcasePosition: number | null, remixAuthor: string | null = null): PixelArtPiece {
  return {
    id,
    ownerId: "me",
    title,
    doc: encodeDoc(paint(createArt(16), [[2, 2]], 1)),
    showcasePosition,
    remixOf: remixAuthor ? "src" : null,
    remixAuthor: remixAuthor ? { id: "u2", username: remixAuthor } : null,
    createdAt: "2026-10-18T00:00:00Z",
    updatedAt: "2026-10-18T00:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  usePixelArtStore.setState({ gallery: null, profiles: {} });
});

describe("GalleryPicker", () => {
  it("lists pieces, shows remix credit, and toggles one onto the profile", async () => {
    mocked.get.mockResolvedValue({ data: { data: [piece("a", "Hamster", 0), piece("b", "Frog", null, "deniz")] } });
    mocked.put.mockResolvedValue({ data: { data: "ok" } });
    render(<GalleryPicker onOpen={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByText("Hamster")).toBeInTheDocument();
    expect(screen.getByText("Remix of @deniz")).toBeInTheDocument();
    expect(screen.getByText(/1\/15 on profile/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show on profile" }));
    await waitFor(() => expect(mocked.put).toHaveBeenCalledWith("/users/me/showcase", { ids: ["a", "b"] }));
    expect(await screen.findByText(/2\/15 on profile/)).toBeInTheDocument();
  });

  it("asks before deleting", async () => {
    mocked.get.mockResolvedValue({ data: { data: [piece("a", "Hamster", null)] } });
    mocked.delete.mockResolvedValue({ data: { data: "ok" } });
    render(<GalleryPicker onOpen={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete Hamster" }));
    expect(mocked.delete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith("/users/me/pixel-arts/a"));
    await waitFor(() => expect(screen.queryByText("Hamster")).toBeNull());
  });
});

describe("editor gallery flow", () => {
  function drawSomething() {
    const canvas = screen.getByTestId("pixel-canvas");
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 448, height: 448 }) as DOMRect;
    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 20, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 20, clientY: 20, button: 0, pointerId: 1 });
  }

  it("saves a new piece and adds it to the profile", async () => {
    mocked.get.mockResolvedValue({ data: { data: [] } });
    mocked.post.mockResolvedValue({ data: { data: piece("new", "Lil hamster", null) } });
    mocked.put.mockResolvedValue({ data: { data: "ok" } });
    render(<PixelArtEditor onClose={vi.fn()} />);
    drawSomething();

    // With no send/stick action, saving is the main footer action.
    // Top bar icon and footer action share the name; the footer one is last.
    const saveButtons = screen.getAllByRole("button", { name: "Save to gallery" });
    expect(saveButtons).toHaveLength(2);
    fireEvent.click(saveButtons[saveButtons.length - 1]);
    const dialog = await screen.findByRole("dialog", { name: "Save to gallery" });
    fireEvent.change(within(dialog).getByPlaceholderText("Lil hamster"), { target: { value: "Lil hamster" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith("/users/me/pixel-arts", expect.objectContaining({ title: "Lil hamster", remixOf: null })));
    await waitFor(() => expect(mocked.put).toHaveBeenCalledWith("/users/me/showcase", { ids: ["new"] }));
    expect(await screen.findByText(/Saved and added to your profile/)).toBeInTheDocument();
  });

  it("saves a remix with credit to the source", async () => {
    mocked.get.mockResolvedValue({ data: { data: [] } });
    mocked.post.mockResolvedValue({ data: { data: piece("mine", "", null, "deniz") } });
    mocked.put.mockResolvedValue({ data: { data: "ok" } });
    render(<PixelArtEditor initial={{ art: paint(createArt(16), [[1, 1]], 1), remixOf: "src-id" }} onClose={vi.fn()} />);

    expect(screen.getByText("Keeps credit to the original")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Save to gallery" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith("/users/me/pixel-arts", expect.objectContaining({ remixOf: "src-id" })));
  });

  it("opens a saved piece from My art and then saves changes to it", async () => {
    mocked.get.mockResolvedValue({ data: { data: [piece("a", "Hamster", 0)] } });
    mocked.patch.mockResolvedValue({ data: { data: piece("a", "Hamster", 0) } });
    render(<PixelArtEditor onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "My art" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open Hamster" }));
    expect(screen.queryByRole("dialog", { name: "My art" })).toBeNull();

    fireEvent.keyDown(window, { key: "s", metaKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Save to gallery" });
    expect(within(dialog).getByRole("button", { name: "Save as copy" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith("/users/me/pixel-arts/a", expect.objectContaining({ title: "Hamster" })));
  });

  it("Escape in a dialog closes only the dialog", async () => {
    mocked.get.mockResolvedValue({ data: { data: [] } });
    const onClose = vi.fn();
    render(<PixelArtEditor onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "My art" }));
    await screen.findByRole("dialog", { name: "My art" });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "My art" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});
