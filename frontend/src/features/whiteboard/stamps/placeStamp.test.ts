import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageObject, SyncAdapter, UploadedAsset } from '../contract';
import { createHarness, imageObject, USER } from '../input/testUtils';
import type { Harness } from '../input/testUtils';
import { STAMP_PNG_SIZE, STAMP_WORLD_SIZE, STAMPS, stampCells } from './stamps';
import type { StampDef } from './stamps';
import { createStampPlacer, pixelsMatchStamp } from './placeStamp';
import type { StampPlacer } from './placeStamp';

let h: Harness;
let uploads: UploadedAsset[];

function adapter(): SyncAdapter {
  return {
    uploadAsset: async () => {
      const asset: UploadedAsset = {
        id: crypto.randomUUID(),
        url: `/uploads/board-assets/${uploads.length}.png`,
        width: STAMP_PNG_SIZE,
        height: STAMP_PNG_SIZE,
      };
      uploads.push(asset);
      return asset;
    },
  } as unknown as SyncAdapter;
}

/** A 64×64 RGBA render of a stamp, as the nearest-neighbour PNG would decode. */
function pixelsForStamp(stamp: StampDef): Uint8ClampedArray {
  const data = new Uint8ClampedArray(STAMP_PNG_SIZE * STAMP_PNG_SIZE * 4);
  const rgb = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
  ];
  for (const cell of stampCells(stamp)) {
    const [r, g, b] = rgb(cell.colour);
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        const offset = ((cell.y * 4 + dy) * STAMP_PNG_SIZE + cell.x * 4 + dx) * 4;
        data[offset] = r; data[offset + 1] = g; data[offset + 2] = b; data[offset + 3] = 255;
      }
    }
  }
  return data;
}

function place(stamps: StampPlacer, id: string, x: number, y: number) {
  return stamps.place(id, { x, y });
}

beforeEach(() => {
  uploads = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(), fillStyle: '', imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) {
    callback(new Blob(['png'], { type: 'image/png' }));
  });
  h = createHarness();
});

afterEach(() => { vi.restoreAllMocks(); });

describe('pixelsMatchStamp', () => {
  it('matches a stamp render and rejects another stamp', () => {
    const stamp = STAMPS[0];
    const other = STAMPS[1];
    expect(pixelsMatchStamp(pixelsForStamp(stamp), stamp)).toBe(true);
    expect(pixelsMatchStamp(pixelsForStamp(other), stamp)).toBe(false);
  });

  it('rejects short buffers', () => {
    expect(pixelsMatchStamp(new Uint8ClampedArray(4), STAMPS[0])).toBe(false);
  });
});

describe('createStampPlacer', () => {
  it('places a 64×64 pixelated image centred at the click point and uploads once', async () => {
    const stamps = createStampPlacer({
      adapter: adapter(), store: h.store, session: h.session, runtime: h.runtime, userId: USER,
      notify: vi.fn(),
    });

    const first = await place(stamps, 'star', 100, 200);
    const second = await place(stamps, 'star', 300, 400);

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(uploads).toHaveLength(1); // reused the cached asset
    const objects = h.store.getObjectsInRank().filter((object): object is ImageObject => object.kind === 'image');
    expect(objects).toHaveLength(2);
    expect(objects[0]).toMatchObject({
      x: 100 - STAMP_WORLD_SIZE / 2, y: 200 - STAMP_WORLD_SIZE / 2,
      w: STAMP_WORLD_SIZE, h: STAMP_WORLD_SIZE, pixelated: true, width: STAMP_PNG_SIZE, height: STAMP_PNG_SIZE,
    });
    expect(objects[0].assetId).toBe(objects[1].assetId);
    stamps.dispose();
  });

  it('reuses an existing stamp asset after reload by pixel content', async () => {
    const existing = imageObject({
      pixelated: true, width: STAMP_PNG_SIZE, height: STAMP_PNG_SIZE,
      url: '/uploads/board-assets/existing.png', assetId: 'aaaaaaaa-0000-4000-8000-000000000001',
    });
    h = createHarness([existing]);
    const stamp = STAMPS[0];
    const stamps = createStampPlacer({
      adapter: adapter(), store: h.store, session: h.session, runtime: h.runtime, userId: USER,
      notify: vi.fn(),
      loadPixels: async () => pixelsForStamp(stamp),
    });

    const id = await place(stamps, stamp.id, 10, 10);

    expect(id).toBeTruthy();
    expect(uploads).toHaveLength(0); // recognised the existing asset
    const placed = h.store.getObjectsInRank().find(object => object.kind === 'image' && object.id === id) as ImageObject;
    expect(placed.assetId).toBe((existing as ImageObject).assetId);
    expect(placed.url).toBe('/uploads/board-assets/existing.png');
    stamps.dispose();
  });

  it('reports upload failures and creates nothing', async () => {
    const notify = vi.fn();
    const failing: SyncAdapter = {
      uploadAsset: async () => { throw new Error('That image is too large (max 8 MB)'); },
    } as unknown as SyncAdapter;
    const stamps = createStampPlacer({
      adapter: failing, store: h.store, session: h.session, runtime: h.runtime, userId: USER, notify,
    });

    const id = await place(stamps, 'frog', 0, 0);

    expect(id).toBeNull();
    expect(h.store.getObjectIds()).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith('refused', 'That image is too large (max 8 MB)');
    stamps.dispose();
  });
});
