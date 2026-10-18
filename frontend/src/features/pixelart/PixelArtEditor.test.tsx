import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PixelArtEditor } from "./PixelArtEditor";
import type { Art } from "./lib/art";

const drawn: Art[] = [];
vi.mock("./render", () => ({
  drawArt: (_canvas: HTMLCanvasElement, art: Art) => drawn.push(art),
  artToPng: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
  shareScale: (art: Art) => 512 / art.size,
  loadImageRgba: vi.fn(),
  downloadBlob: vi.fn(),
}));

Element.prototype.setPointerCapture = vi.fn();

/** The canvas is 448px; at 32×32 each cell is 14px. */
function pointer(type: "pointerDown" | "pointerMove" | "pointerUp", cellX: number, cellY: number, button = 0) {
  const canvas = screen.getByTestId("pixel-canvas");
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 448, height: 448 }) as DOMRect;
  fireEvent[type](canvas, { clientX: cellX * 14 + 7, clientY: cellY * 14 + 7, button, pointerId: 1 });
}

const lastArt = () => drawn[drawn.length - 1];
const at = (x: number, y: number) => lastArt().pixels[y * lastArt().size + x];

describe("PixelArtEditor", () => {
  beforeEach(() => {
    drawn.length = 0;
    localStorage.clear();
  });

  it("draws a connected pencil stroke and undoes it", () => {
    render(<PixelArtEditor onSend={vi.fn()} onClose={vi.fn()} />);
    pointer("pointerDown", 0, 0);
    pointer("pointerMove", 5, 0); // gap between samples gets filled
    pointer("pointerUp", 5, 0);
    expect([0, 1, 2, 3, 4, 5].map((x) => at(x, 0))).toEqual([1, 1, 1, 1, 1, 1]);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(at(3, 0)).toBe(0);
  });

  it("mirrors strokes and erases with the right button", () => {
    render(<PixelArtEditor onSend={vi.fn()} onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: "m" });
    pointer("pointerDown", 1, 2);
    pointer("pointerUp", 1, 2);
    expect(at(1, 2)).toBe(1);
    expect(at(30, 2)).toBe(1);

    pointer("pointerDown", 1, 2, 2);
    pointer("pointerUp", 1, 2, 2);
    expect(at(1, 2)).toBe(0);
  });

  it("keeps a draft between openings", () => {
    const { unmount } = render(<PixelArtEditor onSend={vi.fn()} onClose={vi.fn()} />);
    pointer("pointerDown", 4, 4);
    pointer("pointerUp", 4, 4);
    unmount();

    drawn.length = 0;
    render(<PixelArtEditor onSend={vi.fn()} onClose={vi.fn()} />);
    expect(at(4, 4)).toBe(1);
  });

  it("sends the art as a PNG and closes", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<PixelArtEditor onSend={onSend} onClose={onClose} />);

    const sendButton = screen.getByRole("button", { name: "Send to chat" });
    expect(sendButton).toBeDisabled(); // empty canvas

    pointer("pointerDown", 3, 3);
    pointer("pointerUp", 3, 3);
    fireEvent.click(sendButton);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const file = onSend.mock.calls[0][0] as File;
    expect(file.type).toBe("image/png");
    expect(file.name).toBe("pixel-art.png");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<PixelArtEditor onSend={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("offers placing in chat next to sending", () => {
    const onPlace = vi.fn();
    render(<PixelArtEditor onSend={vi.fn()} onPlace={onPlace} onClose={vi.fn()} />);
    pointer("pointerDown", 2, 2);
    pointer("pointerUp", 2, 2);

    fireEvent.click(screen.getByRole("button", { name: "Place in chat" }));
    expect(onPlace).toHaveBeenCalledWith(expect.objectContaining({ size: 32 }));
    expect(screen.getByRole("button", { name: "Send to chat" })).toBeInTheDocument();
  });

  it("paints brush-sized squares and previews the brush under the cursor", () => {
    render(<PixelArtEditor onSend={vi.fn()} onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: "]" });
    fireEvent.keyDown(window, { key: "]" }); // brush 3
    pointer("pointerMove", 10, 10);
    expect(screen.getByTestId("brush-preview").style.width).toBe(screen.getByTestId("brush-preview").style.height);

    pointer("pointerDown", 10, 10);
    pointer("pointerUp", 10, 10);
    for (const [x, y] of [[9, 9], [10, 10], [11, 11], [9, 11]]) expect(at(x, y)).toBe(1);
    expect(at(12, 10)).toBe(0);
  });

  it("zooms in and back to fit", () => {
    render(<PixelArtEditor onSend={vi.fn()} onClose={vi.fn()} />);
    const canvas = screen.getByTestId("pixel-canvas");
    const fitWidth = parseFloat(canvas.style.width);

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(parseFloat(canvas.style.width)).toBeGreaterThan(fitWidth);

    fireEvent.keyDown(window, { key: "0" });
    expect(parseFloat(canvas.style.width)).toBe(fitWidth);
  });

  it("offers every canvas size up to 256", () => {
    render(<PixelArtEditor onSend={vi.fn()} onClose={vi.fn()} />);
    const options = Array.from(screen.getByRole("combobox").querySelectorAll("option")).map((o) => o.value);
    expect(options).toEqual(["16", "32", "64", "128", "256"]);
  });
});
