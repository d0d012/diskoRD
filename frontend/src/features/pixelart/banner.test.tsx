import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { api } from "../../lib/api";
import { usePixelArtStore } from "../../stores/pixelArtStore";
import { BannerPicker } from "./BannerPicker";
import { ProfileBanner } from "./ProfileBanner";
import { createArt, paint } from "./lib/art";
import { encodeDoc } from "./lib/doc";

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
vi.mock("./render", () => ({ drawArt: vi.fn(), artToPng: vi.fn(), shareScale: () => 2, loadImageRgba: vi.fn(), downloadBlob: vi.fn() }));
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as unknown as HTMLCanvasElement["getContext"];
HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,AAAA");
Element.prototype.setPointerCapture = vi.fn();

const mocked = vi.mocked(api);
const myBanner = encodeDoc(paint(createArt(100, 32), [[5, 5]], 1));

function Picker({ onClose = vi.fn() }: { onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref}>
      <BannerPicker userId="me" cardRef={ref} onClose={onClose} />
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  usePixelArtStore.setState({ gallery: null, profiles: { me: { showcase: [], buddies: [], banner: null } } });
  mocked.get.mockResolvedValue({
    data: { data: [{ id: "b1", ownerId: "me", title: "My hills", doc: myBanner, showcasePosition: null, remixOf: null, remixAuthor: null, createdAt: "", updatedAt: "" }] },
  });
  mocked.put.mockResolvedValue({ data: { data: "ok" } });
  mocked.delete.mockResolvedValue({ data: { data: "ok" } });
});

describe("ProfileBanner", () => {
  it("shows the plain color until a pixel banner is set", () => {
    const { rerender } = render(<ProfileBanner userId="me" color="#123456" />);
    expect(screen.queryByTestId("pixel-banner")).toBeNull();

    usePixelArtStore.setState({ profiles: { me: { showcase: [], buddies: [], banner: { builtin: "night" } } } });
    rerender(<ProfileBanner userId="me" color="#123456" />);
    const img = screen.getByTestId("pixel-banner");
    expect(img.style.width).toBe("300px");
    expect(img.style.imageRendering).toBe("pixelated");
  });
});

describe("BannerPicker", () => {
  it("sets a built-in scene and marks it selected", async () => {
    render(<Picker />);
    fireEvent.click(screen.getByRole("button", { name: "Starry night" }));
    await waitFor(() => expect(mocked.put).toHaveBeenCalledWith("/users/me/banner", { builtin: "night" }));
    expect(await screen.findByRole("button", { name: "Starry night", pressed: true })).toBeInTheDocument();
  });

  it("offers banner-shaped pieces from My art", async () => {
    render(<Picker />);
    fireEvent.click(await screen.findByRole("button", { name: "My hills" }));
    await waitFor(() => expect(mocked.put).toHaveBeenCalledWith("/users/me/banner", { doc: myBanner }));
  });

  it("removes the banner", async () => {
    usePixelArtStore.setState({ profiles: { me: { showcase: [], buddies: [], banner: { builtin: "city" } } } });
    render(<Picker />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith("/users/me/banner"));
  });

  it("draws a custom banner from the current one and uses it", async () => {
    usePixelArtStore.setState({ profiles: { me: { showcase: [], buddies: [], banner: { builtin: "beach" } } } });
    render(<Picker />);
    fireEvent.click(screen.getByRole("button", { name: /Edit or draw your own/ }));
    expect(screen.getByRole("combobox", { name: "Canvas size" })).toHaveValue("150x48");

    fireEvent.click(screen.getByRole("button", { name: "Use as banner" }));
    await waitFor(() => expect(mocked.put).toHaveBeenCalledWith("/users/me/banner", { doc: expect.objectContaining({ width: 150, height: 48 }) }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Pixel art" })).toBeNull());
    // Editing a banner never touches the chat drawing draft.
    expect(localStorage.getItem("diskord.pixelart.draft")).toBeNull();
  });

  it("refuses a non-banner canvas", async () => {
    usePixelArtStore.setState({ profiles: { me: { showcase: [], buddies: [], banner: { builtin: "meadow" } } } });
    render(<Picker />);
    fireEvent.click(screen.getByRole("button", { name: /draw your own/i }));
    fireEvent.change(screen.getByRole("combobox", { name: "Canvas size" }), { target: { value: "32x32" } });
    fireEvent.click(screen.getByRole("button", { name: "Use as banner" }));
    expect(await screen.findByText("Switch the canvas to a Banner size first.")).toBeInTheDocument();
    expect(mocked.put).not.toHaveBeenCalled();
  });
});
