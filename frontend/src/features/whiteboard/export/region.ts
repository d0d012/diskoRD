import type { BoardObject, ObjectId, Rect } from '../contract';
import { getBounds, objectsInsideFrame, unionBounds } from '../core';

/**
 * Which part of the board an export covers. "frame" clips to a single selected
 * frame and renders only the objects whose centre is inside it (the same
 * spatial containment the board uses for frame dragging). "selection" renders
 * the current selection. "board" renders everything visible.
 */
export type ExportMode = 'frame' | 'selection' | 'board';

export interface ExportRegion {
  readonly mode: ExportMode;
  /** Content bounds in world units; the export origin is this plus padding. */
  readonly bounds: Rect;
  /** World-space clip rect (frame mode only); everything outside is cut off. */
  readonly clip: Rect | null;
  /** Objects to render, in rank order. */
  readonly objects: readonly BoardObject[];
  /** Frame label for frame exports, otherwise the channel name. */
  readonly name: string;
}

export interface ExportRegionInput {
  /** Visible board objects in rank order. */
  readonly objects: readonly BoardObject[];
  readonly selectedIds: readonly ObjectId[];
  readonly channelName: string;
}

function finiteBounds(bounds: Rect): boolean {
  return Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.w) && Number.isFinite(bounds.h);
}

/**
 * Pure region selection. Returns null when there is nothing to export (no
 * objects for the chosen mode, or non-finite bounds).
 */
export function exportRegion(input: ExportRegionInput): ExportRegion | null {
  const { objects, selectedIds, channelName } = input;
  const selected = objects.filter(object => selectedIds.includes(object.id));

  if (selected.length === 1 && selected[0].kind === 'frame') {
    const frame = selected[0];
    const ids = new Set(objectsInsideFrame(frame, objects));
    const contents = objects.filter(object => ids.has(object.id));
    const bounds = { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
    if (contents.length === 0 || !finiteBounds(bounds)) return null;
    return { mode: 'frame', bounds, clip: bounds, objects: contents, name: frame.label.trim() || channelName };
  }

  if (selected.length > 0) {
    const bounds = unionBounds(selected.map(getBounds));
    if (!finiteBounds(bounds)) return null;
    return { mode: 'selection', bounds, clip: null, objects: selected, name: channelName };
  }

  if (objects.length === 0) return null;
  const bounds = unionBounds(objects.map(getBounds));
  if (!finiteBounds(bounds)) return null;
  return { mode: 'board', bounds, clip: null, objects, name: channelName };
}
