import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { api } from "../../lib/api";
import { usePixelArtStore } from "../../stores/pixelArtStore";
import { ProfileBuddies } from "./ProfileBuddies";
import { snapHeight } from "./decorationImage";
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
vi.mock("./render", () => ({ drawArt: vi.fn(), artToPng: vi.fn(), shareScale: () => 8, loadImageRgba: vi.fn(), downloadBlob: vi.fn() }));
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as unknown as HTMLCanvasElement["getContext"];
HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,AAAA");
Element.prototype.setPointerCapture = vi.fn();

const mocked = vi.mocked(api);
// A 16×16 canvas with an 8×8 character: trimmed size is 8×8.
const doc = encodeDoc(paint(createArt(16), Array.from({ length: 64 }, (_, i) => [4 + (i % 8), 4 + Math.floor(i / 8)] as const), 1));

function galleryPiece(id: string, title: string): PixelArtPiece {
  return { id, ownerId: "me", title, doc, showcasePosition: null, remixOf: null, remixAuthor: null, createdAt: "", updatedAt: "" };
}

function Card({ startEditing = false }: { startEditing?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(startEditing);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <ProfileBuddies userId="me" isSelf editing={editing} onEditingChange={setEditing} cardRef={ref} />
      <span data-testid="editing">{String(editing)}</span>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  usePixelArtStore.setState({ gallery: null, profiles: {} });
});

describe("snapHeight", () => {
  it("snaps to whole-number zooms of the trimmed art when close", () => {
    expect(snapHeight(doc, 47)).toBe(48); // 8 × 6
    expect(snapHeight(doc, 18)).toBe(16);
    // A 16px-tall piece: 24 is 8px from both 16 and 32, so it stays as asked.
    const tall = encodeDoc(paint(createArt(16), Array.from({ length: 16 }, (_, i) => [0, i] as const), 1));
    expect(snapHeight(tall, 24)).toBe(24);
    expect(snapHeight(tall, 30)).toBe(32);
  });
});

describe("ProfileBuddies", () => {
  it("draws buddies behind or in front, never past the card's bottom", () => {
    usePixelArtStore.setState({
      profiles: { me: { showcase: [], banner: null, buddies: [
        { artId: "a", doc, x: 10, y: 900, height: 48, flip: true, front: false },
        { artId: "b", doc, x: 90, y: 10, height: 32, flip: false, front: true },
      ] } },
    });
    render(<Card />);
    const [back, front] = screen.getAllByTestId("profile-buddy");
    expect(back.style.zIndex).toBe("1");
    expect(front.style.zIndex).toBe("3");
    // (top uses CSS min() to stay inside the card; jsdom can't parse it, the browser check covers it.)
    expect(back.querySelector("img")!.style.transform).toBe("scaleX(-1)");
    expect(back).toHaveClass("pointer-events-none");
  });

  it("adds a buddy from the gallery, adjusts it and saves", async () => {
    usePixelArtStore.setState({ profiles: { me: { showcase: [], buddies: [], banner: null } } });
    mocked.get.mockImplementation(async (url: string) =>
      url === "/users/me/pixel-arts"
        ? { data: { data: [galleryPiece("art1", "Hamster")] } }
        : { data: { data: { showcase: [], buddies: [] } } });
    mocked.put.mockResolvedValue({ data: { data: "ok" } });
    render(<Card startEditing />);

    fireEvent.click(screen.getByRole("button", { name: "+ Add buddy" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Hamster" }));
    expect(screen.getAllByTestId("profile-buddy")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Flip" }));
    fireEvent.click(screen.getByRole("button", { name: "Behind" })); // → in front
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocked.put).toHaveBeenCalledWith("/users/me/buddies", {
      buddies: [expect.objectContaining({ artId: "art1", height: 48, flip: true, front: true })],
    }));
    await waitFor(() => expect(screen.getByTestId("editing")).toHaveTextContent("false"));
  });

  it("caps buddies at five and Escape cancels without saving", async () => {
    usePixelArtStore.setState({
      gallery: [galleryPiece("art1", "Hamster")],
      profiles: { me: { showcase: [], banner: null, buddies: Array.from({ length: 5 }, (_, i) => ({ artId: "art1", doc, x: i * 20, y: 0, height: 32, flip: false, front: false })) } },
    });
    render(<Card startEditing />);
    expect(screen.getByRole("button", { name: "+ Add buddy" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Remove buddy" }));
    expect(screen.getAllByTestId("profile-buddy")).toHaveLength(4);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("editing")).toHaveTextContent("false");
    expect(screen.getAllByTestId("profile-buddy")).toHaveLength(5); // draft discarded
    expect(mocked.put).not.toHaveBeenCalled();
  });
});
