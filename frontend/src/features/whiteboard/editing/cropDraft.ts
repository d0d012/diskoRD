import type { ImageObject, Point, Rect, ResizeHandleId } from '../contract';
import { cropFromSourceRect, displayedSourceRect, resizeCrop } from '../core/crop';

/** A local draft only: never enters the board store before Done. */
export type CropDraft = Pick<ImageObject, 'x' | 'y' | 'w' | 'h' | 'crop' | 'pixelated'>;

export function sourceWorldRect(draft: CropDraft, image: ImageObject): Rect {
  const source = displayedSourceRect(draft.crop, draft, image);
  return { ...source, x: draft.x + source.x, y: draft.y + source.y };
}

function withCrop(draft: CropDraft, source: Rect, crop: Rect): CropDraft {
  return {
    ...draft, crop,
    x: source.x + crop.x * source.w, y: source.y + crop.y * source.h,
    w: crop.w * source.w, h: crop.h * source.h,
  };
}

/** Keep the displayed source fixed; only the visible bounds change. */
export function resizeCropDraft(draft: CropDraft, image: ImageObject, handle: ResizeHandleId, world: Point): CropDraft {
  const crop = resizeCrop(draft.crop, handle, { x: world.x - draft.x, y: world.y - draft.y }, draft);
  return withCrop(draft, sourceWorldRect(draft, image), crop);
}

/** Keep the window fixed and slide the source under it. Core clamps at its edges. */
export function panCropDraft(draft: CropDraft, image: ImageObject, delta: Point): CropDraft {
  const source = displayedSourceRect(draft.crop, draft, image);
  // Constrain the displayed translation first: clampCrop alone would trim the
  // width/height at the far edge instead of preserving this fixed crop window.
  const moved = {
    ...source,
    x: Math.max(draft.w - source.w, Math.min(0, source.x + delta.x)),
    y: Math.max(draft.h - source.h, Math.min(0, source.y + delta.y)),
  };
  const crop = cropFromSourceRect(moved, draft);
  return { ...draft, crop };
}

export function resetCropDraft(draft: CropDraft, image: ImageObject): CropDraft {
  return withCrop(draft, sourceWorldRect(draft, image), { x: 0, y: 0, w: 1, h: 1 });
}
