import { describe, expect, it } from 'vitest';
import type { ImageObject, ResizeHandleId } from '../contract';
import { displayedSourceRect, MIN_CROP_SIZE, resizeCrop } from '../core/crop';
import { panCropDraft, resetCropDraft, resizeCropDraft, sourceWorldRect } from './cropDraft';

const image: ImageObject = {
  id: 'image', kind: 'image', createdBy: 'me', version: 1, rank: '1:a0',
  x: 100, y: 200, w: 200, h: 100, assetId: 'asset', url: '/uploads/test.png',
  width: 800, height: 400, crop: { x: .25, y: .25, w: .5, h: .5 }, pixelated: false,
};

describe('crop draft core wiring', () => {
  it.each<ResizeHandleId>(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'])('uses resizeCrop for the %s handle and preserves source scale', handle => {
    const pointer = { x: 250, y: 275 };
    const expected = resizeCrop(image.crop, handle, { x: pointer.x - image.x, y: pointer.y - image.y }, image);
    const draft = resizeCropDraft(image, image, handle, pointer);
    expect(draft.crop).toEqual(expected);
    expect(sourceWorldRect(draft, image)).toEqual(sourceWorldRect(image, image));
    expect(draft.w).toBe(expected.w * 400);
    expect(draft.h).toBe(expected.h * 200);
  });

  it('enforces the core minimum and never flips', () => {
    const draft = resizeCropDraft(image, image, 'nw', { x: 1e4, y: 1e4 });
    expect(draft.crop.w).toBeCloseTo(MIN_CROP_SIZE);
    expect(draft.crop.h).toBeCloseTo(MIN_CROP_SIZE);
  });

  it('pans under fixed bounds, clamping at both source edges without shrinking', () => {
    for (const delta of [{ x: 1e4, y: 1e4 }, { x: -1e4, y: -1e4 }]) {
      const draft = panCropDraft(image, image, delta);
      expect(draft).toMatchObject({ x: 100, y: 200, w: 200, h: 100 });
      expect(draft.crop.w).toBe(.5);
      expect(draft.crop.h).toBe(.5);
      expect(draft.crop.x).toBeCloseTo(delta.x > 0 ? 0 : .5);
      expect(draft.crop.y).toBeCloseTo(delta.y > 0 ? 0 : .5);
      const source = displayedSourceRect(draft.crop, draft, image);
      expect(source.x).toBeLessThanOrEqual(0);
      expect(source.x + source.w).toBeGreaterThanOrEqual(draft.w);
    }
  });

  it('resets to the full source at the same scale and world position', () => {
    const reset = resetCropDraft(image, image);
    expect(reset).toMatchObject({ x: 0, y: 150, w: 400, h: 200, crop: { x: 0, y: 0, w: 1, h: 1 } });
    expect(sourceWorldRect(reset, image)).toEqual(sourceWorldRect(image, image));
  });
});
