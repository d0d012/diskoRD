import { MAX_ZOOM, MIN_ZOOM } from '../contract/limits';
import type { Camera, Point, Rect } from '../contract/types';

/**
 * Camera math for the board viewport. Screen coordinates are viewport-local
 * CSS pixels (callers subtract DOM bounds first); world coordinates are board
 * units. The transform is `screen = world * zoom + (x, y)`.
 *
 * All functions are pure: they never mutate their inputs and return fresh
 * objects. World positions are never rounded to pixels.
 */

export function screenToWorld(screen: Point, camera: Camera): Point {
  return {
    x: (screen.x - camera.x) / camera.zoom,
    y: (screen.y - camera.y) / camera.zoom,
  };
}

export function worldToScreen(world: Point, camera: Camera): Point {
  return {
    x: world.x * camera.zoom + camera.x,
    y: world.y * camera.zoom + camera.y,
  };
}

/**
 * Return a camera with the requested zoom, clamped to [MIN_ZOOM, MAX_ZOOM],
 * that keeps the world point currently under `screen` fixed on screen.
 */
export function zoomAt(camera: Camera, screen: Point, zoom: number): Camera {
  const next = clampZoom(zoom);
  const world = screenToWorld(screen, camera);
  return {
    x: screen.x - world.x * next,
    y: screen.y - world.y * next,
    zoom: next,
  };
}

/** Clamp a zoom factor to the contract limits. */
export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Fit `bounds` into `viewport` with a `padding` (screen CSS pixels) on every
 * side, centering the result. The returned camera is clamped to the zoom
 * limits. `viewport.x`/`viewport.y` are the screen position of the viewport's
 * top-left corner (usually {x: 0, y: 0}).
 */
export function fitToBounds(bounds: Rect, viewport: Rect, padding: number): Camera {
  const pad = Math.max(0, padding);
  const availableW = Math.max(1, viewport.w - pad * 2);
  const availableH = Math.max(1, viewport.h - pad * 2);

  let zoom: number;
  if (bounds.w <= 0 && bounds.h <= 0) {
    zoom = MAX_ZOOM;
  } else if (bounds.w <= 0) {
    zoom = availableH / bounds.h;
  } else if (bounds.h <= 0) {
    zoom = availableW / bounds.w;
  } else {
    zoom = Math.min(availableW / bounds.w, availableH / bounds.h);
  }
  zoom = clampZoom(zoom);

  const centerX = viewport.x + viewport.w / 2;
  const centerY = viewport.y + viewport.h / 2;
  const worldCenterX = bounds.x + bounds.w / 2;
  const worldCenterY = bounds.y + bounds.h / 2;

  return {
    x: centerX - worldCenterX * zoom,
    y: centerY - worldCenterY * zoom,
    zoom,
  };
}

/** The world-space rectangle visible through `viewport` under `camera`. */
export function visibleWorldRect(camera: Camera, viewport: Rect): Rect {
  const topLeft = screenToWorld({ x: viewport.x, y: viewport.y }, camera);
  return {
    x: topLeft.x,
    y: topLeft.y,
    w: viewport.w / camera.zoom,
    h: viewport.h / camera.zoom,
  };
}
