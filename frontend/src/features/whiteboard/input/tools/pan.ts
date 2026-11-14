import type { Gesture, PointerSample, ToolContext } from '../types';

/**
 * Hand tool, Space-drag and middle-drag: move the camera with the pointer in
 * screen space. Camera writes go through the Runtime only; nothing is
 * dispatched.
 */
export function createPanGesture(ctx: ToolContext, start: PointerSample): Gesture {
  const { runtime } = ctx;
  const origin = runtime.getCamera();
  let done = false;

  function apply(sample: PointerSample): void {
    runtime.setCamera({
      x: origin.x + (sample.screen.x - start.screen.x),
      y: origin.y + (sample.screen.y - start.screen.y),
      zoom: origin.zoom,
    });
  }

  return {
    kind: 'panning',
    move(sample) {
      if (!done) apply(sample);
    },
    end(sample) {
      if (done) return;
      done = true;
      apply(sample);
    },
    cancel() {
      // Panning is view state, not a write: keep wherever the camera got to.
      done = true;
    },
  };
}
