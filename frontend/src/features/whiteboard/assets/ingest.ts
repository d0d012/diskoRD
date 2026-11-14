import { MAX_OBJECTS_PER_BOARD, MAX_REFERENCED_ASSETS_PER_BOARD } from '../contract';
import type {
  BoardStore, ImageObject, ObjectId, Point, Runtime, SyncAdapter, UploadedAsset, UserId,
} from '../contract';
import { createChange, safeDispatch, topRanks } from '../input/objects';
import type { SessionStore } from '../state';
import {
  IMAGE_MESSAGES, checkImageFile, checkImageSize, decodeImageSize, defaultDisplaySize, layoutRow, rowExtent, runPool,
} from './files';
import type { ImageSize } from './files';

/** Uploads run this many at a time. */
export const UPLOAD_CONCURRENCY = 3;

export interface ImageIngestOptions {
  readonly adapter: SyncAdapter;
  readonly store: BoardStore;
  readonly session: SessionStore;
  readonly runtime: Runtime;
  readonly userId: UserId;
  readonly notify: (kind: string, message: string) => void;
  /** Size of the visible board area in CSS pixels; defaults to the window. */
  readonly getViewportSize?: () => { readonly width: number; readonly height: number } | null;
  /** Natural size of an image blob; defaults to decoding it in an <img> (tests inject this). */
  readonly decode?: (file: Blob) => Promise<ImageSize>;
}

export interface AddFilesOptions {
  /** World-space top-left of the first image; default centres the row in the visible area. */
  readonly at?: Point;
  /** Crisp pixels; default `session.styleDefaults.imagePixelated`. */
  readonly pixelated?: boolean;
}

export interface ImageIngest {
  addFiles(files: readonly Blob[], options?: AddFilesOptions): Promise<void>;
  /** Cancels in-flight work (results are dropped) and clears every placeholder. */
  dispose(): void;
}

const FULL_CROP = { x: 0, y: 0, w: 1, h: 1 } as const;
/** Kind used for every notice from this pipeline: the action was refused or failed. */
const NOTICE_KIND = 'refused';
const FALLBACK_MESSAGE = 'The image could not be uploaded. Try again.';

interface Item {
  readonly file: Blob;
  natural: ImageSize;
  size: { w: number; h: number };
  at: Point;
  placeholder: ImageObject | null;
  previewUrl: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : FALLBACK_MESSAGE;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * The single ingestion path for picker, paste and drop. Per file: validate on
 * the client, show a local placeholder in the runtime preview (never in the
 * store), upload, then dispatch exactly ONE image create and swap the
 * placeholder out in the same task.
 */
export function createImageIngest(options: ImageIngestOptions): ImageIngest {
  const { adapter, store, session, runtime, userId, notify } = options;
  const decode = options.decode ?? decodeImageSize;
  const placeholders = new Map<ObjectId, ImageObject>();
  /** Every placeholder object ever shown, so a stale one is never mistaken for someone else's preview. */
  const issued = new WeakSet<object>();
  let disposed = false;
  /** Uploads accepted but not yet created: they count against the object limit. */
  let inFlight = 0;
  let syncing = false;

  /* The preview is the input controller's too; whenever it replaces it, put ours back. */
  function syncPreview(): void {
    if (syncing) return;
    const preview = runtime.getPreview();
    const mine = [...placeholders.values()];
    const present = preview.objects.filter(object => placeholders.get(object.id) === object);
    const foreign = preview.objects.filter(object => !issued.has(object));
    if (present.length === mine.length && foreign.length + present.length === preview.objects.length) return;
    syncing = true;
    try {
      runtime.setPreview({ ...preview, objects: [...foreign, ...mine] });
    } finally {
      syncing = false;
    }
  }
  const unsubscribePreview = runtime.subscribePreview(syncPreview);

  function visibleWorld(): { w: number; h: number; centre: Point } {
    const size = options.getViewportSize?.();
    const width = size && size.width > 0 ? size.width : window.innerWidth;
    const height = size && size.height > 0 ? size.height : window.innerHeight;
    const zoom = runtime.getCamera().zoom;
    return { w: width / zoom, h: height / zoom, centre: runtime.screenToWorld({ x: width / 2, y: height / 2 }) };
  }

  function referencedAssets(): number {
    const ids = new Set<string>();
    for (const object of store.getObjectsInRank()) if (object.kind === 'image') ids.add(object.assetId);
    return ids.size;
  }

  function releasePlaceholder(item: Item): void {
    if (item.placeholder) placeholders.delete(item.placeholder.id);
    item.placeholder = null;
    if (item.previewUrl) URL.revokeObjectURL?.(item.previewUrl);
    item.previewUrl = '';
  }

  function placeholderFor(item: Item, pixelated: boolean): ImageObject {
    item.previewUrl = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(item.file) : '';
    const placeholder: ImageObject = {
      id: crypto.randomUUID(), kind: 'image', rank: topRanks(store, 1, false)[0], version: 0, createdBy: userId,
      x: item.at.x, y: item.at.y, w: item.size.w, h: item.size.h,
      assetId: crypto.randomUUID(), url: item.previewUrl, width: item.natural.width, height: item.natural.height,
      crop: FULL_CROP, pixelated,
    };
    issued.add(placeholder);
    return placeholder;
  }

  function create(item: Item, asset: UploadedAsset, pixelated: boolean, created: ObjectId[]): void {
    const object: ImageObject = {
      id: crypto.randomUUID(), kind: 'image', rank: topRanks(store, 1, false)[0], version: 0, createdBy: userId,
      x: item.at.x, y: item.at.y, w: item.size.w, h: item.size.h,
      assetId: asset.id, url: asset.url, width: asset.width, height: asset.height,
      crop: FULL_CROP, pixelated,
    };
    const dispatched = safeDispatch(store, [createChange(object)], 'Add image', notify);
    releasePlaceholder(item);
    syncPreview();
    if (dispatched === null) return;
    created.push(object.id);
    session.setSelectedIds([...created]);
  }

  async function addFiles(files: readonly Blob[], addOptions: AddFilesOptions = {}): Promise<void> {
    if (disposed || files.length === 0) return;
    const pixelated = addOptions.pixelated ?? session.getState().styleDefaults.imagePixelated;
    const messages = new Set<string>();
    const report = (message: string) => {
      if (disposed || messages.has(message)) return;
      messages.add(message);
      notify(NOTICE_KIND, message);
    };

    // 1. Validate and measure (cheap, local).
    const accepted: Item[] = [];
    await runPool(files, UPLOAD_CONCURRENCY, async file => {
      const problem = checkImageFile(file);
      if (problem) return report(problem);
      let natural: ImageSize;
      try {
        natural = await decode(file);
      } catch (error) {
        return report(errorMessage(error));
      }
      const sizeProblem = checkImageSize(natural);
      if (sizeProblem) return report(sizeProblem);
      accepted.push({ file, natural, size: { w: 0, h: 0 }, at: { x: 0, y: 0 }, placeholder: null, previewUrl: '' });
    });
    if (disposed || accepted.length === 0) return;
    // Concurrent decoding may finish out of order; keep the user's file order.
    accepted.sort((a, b) => files.indexOf(a.file) - files.indexOf(b.file));

    // Board capacity, before any bytes leave the machine.
    const room = MAX_OBJECTS_PER_BOARD - store.getObjectIds().length - inFlight;
    const assetRoom = MAX_REFERENCED_ASSETS_PER_BOARD - referencedAssets() - inFlight;
    if (room < accepted.length) report(`${IMAGE_MESSAGES.boardFull} (at most ${MAX_OBJECTS_PER_BOARD} objects)`);
    else if (assetRoom < accepted.length) report(`${IMAGE_MESSAGES.tooManyAssets} (max ${MAX_REFERENCED_ASSETS_PER_BOARD})`);
    const batch = accepted.slice(0, Math.max(0, Math.min(room, assetRoom)));
    if (batch.length === 0) return;

    // 2. Layout and placeholders.
    const visible = visibleWorld();
    for (const item of batch) item.size = defaultDisplaySize(item.natural, visible);
    const extent = rowExtent(batch.map(item => item.size));
    const origin = addOptions.at ?? { x: visible.centre.x - extent.w / 2, y: visible.centre.y - extent.h / 2 };
    layoutRow(batch.map(item => item.size), origin).forEach((at, index) => { batch[index].at = at; });
    for (const item of batch) {
      item.placeholder = placeholderFor(item, pixelated);
      placeholders.set(item.placeholder.id, item.placeholder);
    }
    inFlight += batch.length;
    syncPreview();

    // 3. Upload, then ONE create per image.
    const created: ObjectId[] = [];
    try {
      await runPool(batch, UPLOAD_CONCURRENCY, async item => {
        try {
          if (disposed) return;
          const asset = await adapter.uploadAsset(item.file);
          if (disposed) return;
          create(item, asset, pixelated, created);
        } catch (error) {
          if (!isAbort(error)) report(errorMessage(error));
        } finally {
          inFlight--;
          releasePlaceholder(item);
          if (!disposed) syncPreview();
        }
      });
    } finally {
      syncPreview();
    }
  }

  return {
    addFiles,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribePreview();
      const preview = runtime.getPreview();
      for (const placeholder of placeholders.values()) {
        if (placeholder.url) URL.revokeObjectURL?.(placeholder.url);
      }
      const rest = preview.objects.filter(object => !issued.has(object));
      placeholders.clear();
      if (rest.length !== preview.objects.length) runtime.setPreview({ ...preview, objects: rest });
    },
  };
}
