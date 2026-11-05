import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ImageLightbox } from "./ImageLightbox";

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

beforeEach(() => vi.stubGlobal("PointerEvent", TestPointerEvent));
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const onClose = vi.fn();
  render(<ImageLightbox images={[{ src: "/pixel.png", alt: "pixel art" }]} index={0} onClose={onClose} />);
  const image = screen.getByRole("img") as HTMLImageElement;
  const stage = image.parentElement!;
  stage.setPointerCapture = vi.fn();
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
  Object.defineProperties(image, {
    offsetWidth: { value: 800 }, offsetHeight: { value: 600 },
    naturalWidth: { value: 800 }, naturalHeight: { value: 600 },
  });
  return { image, stage, onClose };
}

function pointer(target: HTMLElement, kind: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel", id: number, x: number, y = 300) {
  fireEvent[kind](target, { pointerId: id, clientX: x, clientY: y, button: 0, bubbles: true });
}

describe("ImageLightbox gestures", () => {
  it("double-click zooms at the click point, pans with capture, clamps and resets", () => {
    const { image, stage, onClose } = setup();
    fireEvent.doubleClick(image, { clientX: 600, clientY: 300 });
    expect(image.style.transform).toBe("translate(-200px, 0px) scale(2)");
    expect(image.style.imageRendering).toBe("pixelated");
    expect(image.style.cursor).toBe("grab");
    pointer(image, "pointerDown", 1, 600);
    expect(stage.setPointerCapture).toHaveBeenCalledWith(1);
    expect(image.style.cursor).toBe("grabbing");
    pointer(stage, "pointerMove", 1, 900);
    expect(image.style.transform).toBe("translate(100px, 0px) scale(2)");
    pointer(stage, "pointerMove", 1, 3000);
    expect(image.style.transform).toBe("translate(400px, 0px) scale(2)");
    pointer(stage, "pointerUp", 1, 3000);
    fireEvent.click(stage);
    expect(onClose).not.toHaveBeenCalled();
    expect(image.style.cursor).toBe("grab");
    fireEvent.doubleClick(image, { clientX: 600, clientY: 300 });
    expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("handles wheel and ctrl-wheel at the cursor, prevents browser zoom, and clamps 1–8x", () => {
    const { image } = setup();
    const event = new WheelEvent("wheel", { deltaY: -Math.log(2) / 0.01, clientX: 600, clientY: 300, ctrlKey: true, bubbles: true, cancelable: true });
    fireEvent(image, event);
    expect(event.defaultPrevented).toBe(true);
    expect(image.style.transform).toBe("translate(-200px, 0px) scale(2)");
    fireEvent.wheel(image, { deltaY: -10000, clientX: 400, clientY: 300 });
    expect(image.style.transform).toContain("scale(8)");
    fireEvent.wheel(image, { deltaY: 10000, clientX: 400, clientY: 300, ctrlKey: true });
    expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("pinches with two touch pointers and continues panning after one lifts", () => {
    const { image, stage } = setup();
    pointer(image, "pointerDown", 1, 300);
    pointer(image, "pointerDown", 2, 500);
    pointer(stage, "pointerMove", 2, 700);
    expect(image.style.transform).toBe("translate(100px, 0px) scale(2)");
    pointer(stage, "pointerUp", 2, 700);
    pointer(stage, "pointerMove", 1, 350);
    expect(image.style.transform).toBe("translate(150px, 0px) scale(2)");
    pointer(stage, "pointerCancel", 1, 350);
    expect(image.style.cursor).toBe("grab");
  });

  it("renders small images upscaled by the avatar preset with nearest-neighbor pixels", () => {
    render(<ImageLightbox images={[{ src: "/small.png", alt: "Small avatar" }]} index={0} onClose={() => {}} variant="avatar" />);
    const image = screen.getByRole("img") as HTMLImageElement;
    Object.defineProperties(image, {
      offsetWidth: { value: 512 }, offsetHeight: { value: 512 },
      naturalWidth: { value: 32 }, naturalHeight: { value: 32 },
    });
    fireEvent.load(image);
    expect(image.style.imageRendering).toBe("pixelated");
  });

  it("closes on a genuine stage backdrop click", () => {
    const { stage, onClose } = setup();
    pointer(stage, "pointerDown", 1, 0, 0);
    pointer(stage, "pointerUp", 1, 0, 0);
    fireEvent.click(stage);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
