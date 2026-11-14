import type { Camera, Runtime, RuntimePreview } from '../contract';
import { clampZoom, screenToWorld, worldToScreen } from '../core';

/** No DOM, timers or React: subscribers own scheduling and lifecycle. */
export function createRuntime(initial: Partial<Camera> = {}): Runtime {
  const finite = (value: number | undefined, fallback: number) => (value !== undefined && Number.isFinite(value) ? value : fallback);
  let camera: Camera = Object.freeze({ x: finite(initial.x, 0), y: finite(initial.y, 0), zoom: clampZoom(finite(initial.zoom, 1)) });
  let preview: RuntimePreview = Object.freeze({ objects: Object.freeze([]), hiddenIds: Object.freeze([]), marquee: null });
  const cameras = new Set<(camera: Camera) => void>();
  const previews = new Set<(preview: RuntimePreview) => void>();
  return {
    getCamera: () => camera,
    setCamera(next) {
      // A NaN/Infinity camera would poison every later transform; keep the last good one.
      if (!Number.isFinite(next.x) || !Number.isFinite(next.y) || !Number.isFinite(next.zoom)) return;
      const zoom = clampZoom(next.zoom);
      if (camera.x === next.x && camera.y === next.y && camera.zoom === zoom) return;
      camera = Object.freeze({ x: next.x, y: next.y, zoom });
      for (const listener of [...cameras]) listener(camera);
    },
    subscribeCamera(listener) { cameras.add(listener); return () => { cameras.delete(listener); }; },
    screenToWorld: point => screenToWorld(point, camera),
    worldToScreen: point => worldToScreen(point, camera),
    getPreview: () => preview,
    setPreview(next) {
      preview = Object.freeze({ objects: Object.freeze([...next.objects]), hiddenIds: Object.freeze([...next.hiddenIds]), marquee: next.marquee && Object.freeze({ ...next.marquee }) });
      for (const listener of [...previews]) listener(preview);
    },
    subscribePreview(listener) { previews.add(listener); return () => { previews.delete(listener); }; },
  };
}
