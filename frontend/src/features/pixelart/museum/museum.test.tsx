import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { api } from "../../../lib/api";
import { useAuthStore } from "../../../stores/authStore";
import { usePixelArtStore } from "../../../stores/pixelArtStore";
import { useShowcaseOverlayStore } from "../../../stores/showcaseOverlayStore";
import { useUserStore } from "../../../stores/userStore";
import { reorderPiece, ShowcaseMuseumHost } from "./ShowcaseMuseum";
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
const pointer = { pointerId: 1, button: 0, isPrimary: true };
const hitTest = vi.fn();
const originalHitTest = Object.getOwnPropertyDescriptor(document, "elementFromPoint");

function caseFor(title: string) {
  return screen.getByRole("button", { name: `View ${title}` }).closest(".museum-case") as HTMLDivElement;
}

function moveOver(title: string, pointerId = 1) {
  hitTest.mockReturnValue(screen.getByRole("button", { name: `View ${title}` }));
  fireEvent.pointerMove(window, { pointerId, clientX: 10, clientY: 20 });
}

async function arrangeMuseum() {
  serve(pieces("me", ["A", "B", "C"]));
  const view = render(<ShowcaseMuseumHost />);
  useShowcaseOverlayStore.getState().open("me");
  const museum = await screen.findByRole("dialog", { name: "Your showcase" });
  await waitFor(() => expect(caseNames()).toHaveLength(3));
  fireEvent.click(within(museum).getByRole("button", { name: "Arrange" }));
  return { museum, ...view };
}

beforeEach(() => {
  vi.clearAllMocks();
  hitTest.mockReset();
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hitTest });
  useAuthStore.setState({ user: { id: "me", username: "me", status: "online", createdAt: "" } });
  useUserStore.setState({ users: { friend: { id: "friend", username: "deniz" } } });
  usePixelArtStore.setState({ gallery: null, profiles: {} });
  useShowcaseOverlayStore.setState({ userId: null });
  mocked.put.mockResolvedValue({ data: { data: "ok" } });
});

afterEach(() => {
  if (originalHitTest) Object.defineProperty(document, "elementFromPoint", originalHitTest);
  else Reflect.deleteProperty(document, "elementFromPoint");
});

describe("reorderPiece", () => {
  it("moves an item to the requested position without mutating the original", () => {
    const items = ["A", "B", "C"];
    expect(reorderPiece(items, 2, 0)).toEqual(["C", "A", "B"]);
    expect(items).toEqual(["A", "B", "C"]);
  });
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
    const { museum } = await arrangeMuseum();
    fireEvent.pointerDown(caseFor("C"), pointer);
    moveOver("A");
    fireEvent.pointerUp(window, pointer);
    expect(caseNames()).toEqual(["View C", "View A", "View B"]);

    fireEvent.click(within(museum).getByRole("button", { name: "Save order" }));
    await waitFor(() => expect(mocked.put).toHaveBeenCalledWith("/users/me/showcase", { ids: ["p2", "p0", "p1"] }));
  });

  it("keeps dragging the same item through two consecutive moves and a hero remount", async () => {
    await arrangeMuseum();
    const originalCase = caseFor("C");
    fireEvent.pointerDown(originalCase, pointer);
    moveOver("A");
    expect(originalCase).not.toBeInTheDocument();
    expect(caseNames()).toEqual(["View C", "View A", "View B"]);
    expect(caseFor("C")).toHaveStyle({ opacity: "0.4" });

    moveOver("A");
    expect(caseNames()).toEqual(["View A", "View C", "View B"]);
    expect(caseFor("C")).toHaveStyle({ opacity: "0.4" });
    expect(caseFor("A")).toHaveStyle({ opacity: "1" });
    fireEvent.pointerUp(window, pointer);
  });

  it.each(["A", "C"])("pointerup ends dragging %s after moving to/from slot 0", async (title) => {
    await arrangeMuseum();
    const originalCase = caseFor(title);
    fireEvent.pointerDown(originalCase, pointer);
    moveOver(title === "A" ? "C" : "A");
    expect(originalCase).not.toBeInTheDocument();
    expect(caseFor(title)).toHaveStyle({ opacity: "0.4" });
    const reordered = caseNames();

    fireEvent.pointerUp(window, pointer);
    expect(caseFor(title)).toHaveStyle({ opacity: "1" });
    moveOver("B");
    expect(caseNames()).toEqual(reordered);
  });

  it.each(["pointercancel", "blur"])("ends the drag on window %s", async (event) => {
    await arrangeMuseum();
    fireEvent.pointerDown(caseFor("C"), pointer);
    moveOver("A");
    if (event === "blur") fireEvent.blur(window);
    else fireEvent.pointerCancel(window, pointer);
    expect(caseFor("C")).toHaveStyle({ opacity: "1" });
    moveOver("B");
    expect(caseNames()).toEqual(["View C", "View A", "View B"]);
  });

  it("ignores other pointers and hits outside this museum", async () => {
    await arrangeMuseum();
    fireEvent.pointerDown(caseFor("C"), pointer);
    moveOver("A", 2);
    fireEvent.pointerUp(window, { pointerId: 2 });
    expect(caseFor("C")).toHaveStyle({ opacity: "0.4" });
    const outsider = document.createElement("div");
    outsider.className = "museum-case";
    outsider.dataset.index = "0";
    document.body.append(outsider);
    try {
      hitTest.mockReturnValue(outsider);
      fireEvent.pointerMove(window, pointer);
      expect(caseNames()).toEqual(["View A", "View B", "View C"]);
      moveOver("A");
      expect(caseNames()).toEqual(["View C", "View A", "View B"]);
    } finally {
      outsider.remove();
      fireEvent.pointerUp(window, pointer);
    }
  });

  it.each(["Cancel", "Escape", "Save order"])("resets an active drag on %s", async (action) => {
    const { museum } = await arrangeMuseum();
    fireEvent.pointerDown(caseFor("C"), pointer);
    moveOver("A");
    if (action === "Escape") fireEvent.keyDown(window, { key: "Escape" });
    else fireEvent.click(within(museum).getByRole("button", { name: action }));
    expect(caseFor("C")).toHaveStyle({ opacity: "1" });
    const reordered = caseNames();
    moveOver("B");
    expect(caseNames()).toEqual(reordered);
    await waitFor(() => expect(within(museum).getByRole("button", { name: "Arrange" })).toBeInTheDocument());
    fireEvent.click(within(museum).getByRole("button", { name: "Arrange" }));
    moveOver("B");
    expect(caseFor("C")).toHaveStyle({ opacity: "1" });
    fireEvent.pointerDown(caseFor("C"), pointer);
    expect(caseFor("C")).toHaveStyle({ opacity: "0.4" });
    fireEvent.pointerUp(window, pointer);
  });

  it("removes window drag listeners on unmount", async () => {
    const { unmount } = await arrangeMuseum();
    const remove = vi.spyOn(window, "removeEventListener");
    fireEvent.pointerDown(caseFor("C"), pointer);
    unmount();
    for (const event of ["pointermove", "pointerup", "pointercancel", "blur"]) {
      expect(remove).toHaveBeenCalledWith(event, expect.any(Function));
    }
    remove.mockRestore();
  });

  it.each([{ button: 2 }, { isPrimary: false }])("ignores non-primary gestures %j", async (overrides) => {
    await arrangeMuseum();
    fireEvent.pointerDown(caseFor("C"), { ...pointer, ...overrides });
    moveOver("A");
    expect(caseNames()).toEqual(["View A", "View B", "View C"]);
    expect(caseFor("C")).toHaveStyle({ opacity: "1" });
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
