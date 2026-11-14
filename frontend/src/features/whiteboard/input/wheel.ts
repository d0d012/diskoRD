import type { Camera, Point, Rect } from '../contract';
import { fitToBounds, getBounds, unionBounds, zoomAt } from '../core';
import type { BoardObject } from '../contract';

/** WheelEvent.deltaMode values. */
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
/** Pixels per wheel "line" (Firefox reports lines for mouse wheels). */
export const WHEEL_LINE_PX = 16;
/** Exponential zoom per normalised pixel of wheel delta. */
export const WHEEL_ZOOM_SPEED = 0.01;
/** Per-event clamp so a coarse mouse notch is one comfortable step (~×1.5). */
export const WHEEL_ZOOM_MAX_DELTA = 40;
/** Screen padding for zoom-to-fit. */
export const FIT_PADDING_PX = 48;

export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

/** Deltas in CSS pixels whatever the device's deltaMode. */
export function normalizeWheel(event: WheelInput, pageHeight: number): Point {
  const scale = event.deltaMode === DOM_DELTA_LINE ? WHEEL_LINE_PX
    : event.deltaMode === DOM_DELTA_PAGE ? Math.max(1, pageHeight) : 1;
  let x = event.deltaX * scale;
  let y = event.deltaY * scale;
  // Shift + vertical mouse wheel scrolls horizontally (browsers do this inconsistently).
  if (event.shiftKey && x === 0) {
    x = y;
    y = 0;
  }
  return { x, y };
}

/**
 * Next camera for a wheel event at `screen`. Ctrl/Meta (and the Ctrl-wheel that
 * Chromium/Firefox synthesise for trackpad pinch) zooms around the cursor;
 * otherwise the board pans.
 */
export function cameraForWheel(camera: Camera, event: WheelInput, screen: Point, pageHeight: number): Camera {
  const delta = normalizeWheel(event, pageHeight);
  if (event.ctrlKey || event.metaKey) {
    // Zoom follows the dominant axis (Shift may have moved it to x).
    const raw = Math.abs(delta.y) >= Math.abs(delta.x) ? delta.y : delta.x;
    const step = Math.max(-WHEEL_ZOOM_MAX_DELTA, Math.min(WHEEL_ZOOM_MAX_DELTA, raw));
    return zoomAt(camera, screen, camera.zoom * Math.exp(-step * WHEEL_ZOOM_SPEED));
  }
  return { x: camera.x - delta.x, y: camera.y - delta.y, zoom: camera.zoom };
}

/** Zoom-to-fit (Shift+1). Null when the board is empty. */
export function cameraToFit(objects: readonly BoardObject[], viewport: Rect): Camera | null {
  if (objects.length === 0) return null;
  return fitToBounds(unionBounds(objects.map(getBounds)), viewport, FIT_PADDING_PX);
}
