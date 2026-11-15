import { assetDisplayUrl } from '../assets/displayUrl';
import type {
  BoardStore, ImageObject, ObjectId, Point, Runtime, SyncAdapter, UploadedAsset, UserId,
} from '../contract';
import { createChange, safeDispatch, topRanks } from '../input/objects';
import type { BoardNotify, SessionStore } from '../state';
import { STAMP_PNG_SIZE, STAMP_SIZE, STAMP_WORLD_SIZE, STAMPS, rasterizeStamp, stampColourAt } from './stamps';
import type { StampDef } from './stamps';

/**
 * Places pixel-art stamps as ordinary `image` objects. A stamp is rasterized
 * to a 64×64 nearest-neighbour PNG, uploaded through the existing board asset
 * path, and created with `pixelated: true`. Assets are reused so repeated
 * stamps never re-upload: a per-board in-memory map is the primary cache, and
 * after a reload existing stamp assets are recognised by pixel content (the
 * only cheap signal available — image objects carry no stamp tag).
 */

export interface StampPlacerOptions {
  readonly adapter: SyncAdapter;
  readonly store: BoardStore;
  readonly session: SessionStore;
  readonly runtime: Runtime;
  readonly userId: UserId;
  readonly notify: BoardNotify;
  /** Decodes an existing image object's 64×64 RGBA for content matching (tests inject this). */
  readonly loadPixels?: (object: ImageObject) => Promise<Uint8ClampedArray | null>;
}

export interface StampPlacer {
  place(stampId: string, at: Point): Promise<ObjectId | null>;
  dispose(): void;
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Whether the loaded 64×64 RGBA is this stamp's nearest-neighbour render. */
export function pixelsMatchStamp(rgba: Uint8ClampedArray, stamp: StampDef): boolean {
  if (rgba.length !== STAMP_PNG_SIZE * STAMP_PNG_SIZE * 4) return false;
  for (let y = 0; y < STAMP_SIZE; y++) {
    for (let x = 0; x < STAMP_SIZE; x++) {
      const colour = stampColourAt(stamp, x, y);
      const offset = (y * 4 * STAMP_PNG_SIZE + x * 4) * 4;
      const alpha = rgba[offset + 3];
      if (colour === null) {
        if (alpha >= 32) return false;
        continue;
      }
      if (alpha < 200) return false;
      const [r, g, b] = hexToRgb(colour);
      if (Math.abs(rgba[offset] - r) > 12 || Math.abs(rgba[offset + 1] - g) > 12 || Math.abs(rgba[offset + 2] - b) > 12) {
        return false;
      }
    }
  }
  return true;
}

async function decodePixels(object: ImageObject): Promise<Uint8ClampedArray | null> {
  if (typeof Image === 'undefined') return null;
  const source = new Image();
  await new Promise<void>((resolve, reject) => {
    source.onload = () => resolve();
    source.onerror = () => reject(new Error('That image could not be read.'));
    source.src = assetDisplayUrl(object.url);
  });
  const canvas = document.createElement('canvas');
  canvas.width = STAMP_PNG_SIZE;
  canvas.height = STAMP_PNG_SIZE;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0, STAMP_PNG_SIZE, STAMP_PNG_SIZE);
  return context.getImageData(0, 0, STAMP_PNG_SIZE, STAMP_PNG_SIZE).data;
}

const FULL_CROP = { x: 0, y: 0, w: 1, h: 1 } as const;

function isStampSized(object: ImageObject): boolean {
  return object.pixelated && object.width === STAMP_PNG_SIZE && object.height === STAMP_PNG_SIZE &&
    object.crop.x === 0 && object.crop.y === 0 && object.crop.w === 1 && object.crop.h === 1;
}

export function createStampPlacer(options: StampPlacerOptions): StampPlacer {
  const { adapter, store, session, userId, notify } = options;
  const loadPixels = options.loadPixels ?? decodePixels;
  const cache = new Map<string, UploadedAsset>();
  const pending = new Map<string, Promise<UploadedAsset>>();
  let disposed = false;

  async function assetFor(stamp: StampDef): Promise<UploadedAsset> {
    const cached = cache.get(stamp.id);
    if (cached) return cached;

    // Reload recognition: reuse an existing stamp asset whose pixels match.
    const candidates = store.getObjectsInRank().filter(
      (object): object is ImageObject => object.kind === 'image' && isStampSized(object),
    );
    for (const candidate of candidates) {
      let pixels: Uint8ClampedArray | null = null;
      try {
        pixels = await loadPixels(candidate);
      } catch {
        pixels = null;
      }
      if (pixels && pixelsMatchStamp(pixels, stamp)) {
        const asset: UploadedAsset = { id: candidate.assetId, url: candidate.url, width: candidate.width, height: candidate.height };
        cache.set(stamp.id, asset);
        return asset;
      }
    }

    let upload = pending.get(stamp.id);
    if (!upload) {
      upload = (async () => {
        const blob = await rasterizeStamp(stamp);
        const asset = await adapter.uploadAsset(blob);
        cache.set(stamp.id, asset);
        return asset;
      })();
      pending.set(stamp.id, upload);
      upload.then(
        () => { if (pending.get(stamp.id) === upload) pending.delete(stamp.id); },
        () => { if (pending.get(stamp.id) === upload) pending.delete(stamp.id); },
      );
    }
    return upload;
  }

  function createImage(asset: UploadedAsset, at: Point, stamp: StampDef): ObjectId | null {
    const [rank] = topRanks(store, 1, false);
    const object: ImageObject = {
      id: crypto.randomUUID(), kind: 'image', rank, version: 0, createdBy: userId,
      x: at.x - STAMP_WORLD_SIZE / 2, y: at.y - STAMP_WORLD_SIZE / 2, w: STAMP_WORLD_SIZE, h: STAMP_WORLD_SIZE,
      assetId: asset.id, url: asset.url, width: asset.width, height: asset.height,
      crop: FULL_CROP, pixelated: true,
    };
    const opId = safeDispatch(store, [createChange(object)], `Stamp ${stamp.name}`, notify);
    if (opId === null) return null;
    session.setSelectedIds([object.id]);
    return object.id;
  }

  return {
    async place(stampId, at) {
      if (disposed) return null;
      const stamp = STAMPS.find(item => item.id === stampId);
      if (!stamp) return null;
      let asset: UploadedAsset;
      try {
        asset = await assetFor(stamp);
      } catch (error) {
        notify('refused', error instanceof Error && error.message ? error.message : 'The stamp could not be placed.');
        return null;
      }
      if (disposed) return null;
      return createImage(asset, at, stamp);
    },
    dispose() {
      disposed = true;
      pending.clear();
    },
  };
}
