import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageObject, SyncAdapter, UploadedAsset } from '../contract';
import { MAX_IMAGE_BYTES } from '../contract';
import { USER, createHarness } from '../input/testUtils';
import type { Harness } from '../input/testUtils';
import { createImageIngest } from './ingest';
import type { ImageIngest } from './ingest';
import { BATCH_GAP, defaultDisplaySize, layoutRow, rowExtent } from './files';

interface Upload {
  readonly file: Blob;
  resolve(asset?: Partial<UploadedAsset>): void;
  reject(error: Error): void;
}

let h: Harness;
let ingest: ImageIngest;
let uploads: Upload[];
let notify: ReturnType<typeof vi.fn<(kind: string, message: string) => void>>;
let sizes: Map<Blob, { width: number; height: number }>;
let active: number;
let peak: number;

function png(name = 'a.png', size = 10): File {
  const file = new File([new Uint8Array(size)], name, { type: 'image/png' });
  sizes.set(file, { width: 200, height: 100 });
  return file;
}

function adapter(): SyncAdapter {
  return {
    uploadAsset: (file: Blob) => new Promise<UploadedAsset>((resolve, reject) => {
      active++;
      peak = Math.max(peak, active);
      uploads.push({
        file,
        resolve: asset => { active--; resolve({ id: crypto.randomUUID(), url: `/uploads/board-assets/${uploads.length}.png`, width: 200, height: 100, ...asset }); },
        reject: error => { active--; reject(error); },
      });
    }),
  } as unknown as SyncAdapter;
}

function setup(viewport = { width: 1000, height: 800 }): void {
  h = createHarness();
  ingest = createImageIngest({
    adapter: adapter(), store: h.store, session: h.session, runtime: h.runtime, userId: USER,
    notify, getViewportSize: () => viewport,
    decode: async file => {
      const size = sizes.get(file);
      if (!size) throw new Error('That image could not be read');
      return size;
    },
  });
}

/** Lets awaited decode/upload continuations run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

function images(): ImageObject[] {
  return h.store.getObjectsInRank().filter((object): object is ImageObject => object.kind === 'image');
}

beforeEach(() => {
  uploads = [];
  sizes = new Map();
  notify = vi.fn();
  active = 0;
  peak = 0;
  URL.createObjectURL = vi.fn(() => 'blob:placeholder');
  URL.revokeObjectURL = vi.fn();
  setup();
});
afterEach(() => {
  ingest.dispose();
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
});

describe('display size maths', () => {
  it('never upscales and fits at most 40% of the visible area', () => {
    expect(defaultDisplaySize({ width: 50, height: 40 }, { w: 1000, h: 800 })).toEqual({ w: 50, h: 40 });
    expect(defaultDisplaySize({ width: 4000, height: 1000 }, { w: 1000, h: 800 })).toEqual({ w: 400, h: 100 });
    expect(defaultDisplaySize({ width: 1000, height: 4000 }, { w: 1000, h: 800 })).toEqual({ w: 80, h: 320 });
  });

  it('lays a row out left to right with a 16-unit gap', () => {
    const row = [{ w: 100, h: 50 }, { w: 40, h: 90 }, { w: 10, h: 10 }];
    expect(BATCH_GAP).toBe(16);
    expect(layoutRow(row, { x: 5, y: 7 })).toEqual([{ x: 5, y: 7 }, { x: 121, y: 7 }, { x: 177, y: 7 }]);
    expect(rowExtent(row)).toEqual({ w: 100 + 40 + 10 + 32, h: 90 });
  });
});

describe('validation (nothing is uploaded or shown)', () => {
  async function refuse(file: Blob, message: string): Promise<void> {
    await ingest.addFiles([file]);
    expect(notify).toHaveBeenCalledExactlyOnceWith('refused', message);
    expect(uploads).toHaveLength(0);
    expect(h.runtime.getPreview().objects).toHaveLength(0);
    expect(h.dispatch).not.toHaveBeenCalled();
  }

  it('refuses SVG', async () => {
    await refuse(new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }), 'SVG images are not supported');
  });
  it('refuses SVG by extension when the type is missing', async () => {
    await refuse(new File(['<svg/>'], 'a.svg'), 'SVG images are not supported');
  });
  it('refuses non-images', async () => {
    await refuse(new File(['x'], 'a.pdf', { type: 'application/pdf' }), 'That file is not an image');
  });
  it('refuses empty files', async () => {
    await refuse(png('e.png', 0), 'That file is empty');
  });
  it('refuses files over 8 MB', async () => {
    await refuse(png('big.png', MAX_IMAGE_BYTES + 1), 'That image is too large (max 8 MB)');
  });
  it('refuses images over 16 megapixels', async () => {
    const file = png();
    sizes.set(file, { width: 5000, height: 4000 });
    await refuse(file, 'That image is too large (max 16 megapixels)');
  });
  it('refuses images that cannot be decoded', async () => {
    await refuse(new File(['x'], 'broken.png', { type: 'image/png' }), 'That image could not be read');
  });

  it('keeps going with the valid files and says each problem once', async () => {
    const good = png();
    const bad = [new File(['x'], 'a.svg', { type: 'image/svg+xml' }), new File(['x'], 'b.svg', { type: 'image/svg+xml' })];
    const run = ingest.addFiles([bad[0], good, bad[1]]);
    await flush();
    expect(uploads).toHaveLength(1);
    uploads[0].resolve();
    await run;
    expect(notify).toHaveBeenCalledExactlyOnceWith('refused', 'SVG images are not supported');
    expect(images()).toHaveLength(1);
  });
});

describe('placeholder then exactly one create', () => {
  it('shows a local placeholder (never a store object), then swaps it for one create', async () => {
    const file = png();
    const run = ingest.addFiles([file], { at: { x: 40, y: 60 } });
    await flush();
    const [placeholder] = h.runtime.getPreview().objects as ImageObject[];
    expect(placeholder).toMatchObject({ kind: 'image', x: 40, y: 60, w: 200, h: 100, url: 'blob:placeholder' });
    expect(images()).toHaveLength(0);
    expect(h.dispatch).not.toHaveBeenCalled();

    uploads[0].resolve({ id: '11111111-1111-4111-8111-111111111111', url: '/uploads/board-assets/x.png', width: 640, height: 320 });
    await run;
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.runtime.getPreview().objects).toHaveLength(0);
    const [image] = images();
    expect(image).toMatchObject({
      kind: 'image', x: 40, y: 60, w: 200, h: 100, createdBy: USER, version: 0,
      assetId: '11111111-1111-4111-8111-111111111111', url: '/uploads/board-assets/x.png', width: 640, height: 320,
      crop: { x: 0, y: 0, w: 1, h: 1 }, pixelated: false,
    });
    expect(image.rank.startsWith('1:')).toBe(true);
    expect(h.session.getState().selectedIds).toEqual([image.id]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:placeholder');
    expect(notify).not.toHaveBeenCalled();
  });

  it('lands on top of existing objects', async () => {
    const run = ingest.addFiles([png()], { at: { x: 0, y: 0 } });
    await flush();
    uploads[0].resolve();
    await run;
    const run2 = ingest.addFiles([png()], { at: { x: 0, y: 0 } });
    await flush();
    uploads[1].resolve();
    await run2;
    const [first, second] = images();
    expect(first.rank < second.rank).toBe(true);
  });

  it('takes the crisp-pixels flag from the options, else from the session default', async () => {
    let run = ingest.addFiles([png()], { at: { x: 0, y: 0 }, pixelated: true });
    await flush();
    uploads[0].resolve();
    await run;
    h.session.setStyleDefaults({ imagePixelated: true });
    run = ingest.addFiles([png()], { at: { x: 0, y: 0 } });
    await flush();
    uploads[1].resolve();
    await run;
    run = ingest.addFiles([png()], { at: { x: 0, y: 0 }, pixelated: false });
    await flush();
    uploads[2].resolve();
    await run;
    expect(images().map(image => image.pixelated)).toEqual([true, true, false]);
  });

  it('centres a default placement in the visible area, scaled to at most 40% of it', async () => {
    h.runtime.setCamera({ x: 100, y: 50, zoom: 2 }); // visible world: 500 x 400
    const file = png();
    sizes.set(file, { width: 4000, height: 1000 });
    const run = ingest.addFiles([file]);
    await flush();
    uploads[0].resolve();
    await run;
    const [image] = images();
    expect(image.w).toBeCloseTo(200); // 40% of 500
    expect(image.h).toBeCloseTo(50);
    const centre = h.runtime.screenToWorld({ x: 500, y: 400 });
    expect(image.x + image.w / 2).toBeCloseTo(centre.x);
    expect(image.y + image.h / 2).toBeCloseTo(centre.y);
  });

  it('keeps its placeholders when the input controller replaces the preview', async () => {
    const run = ingest.addFiles([png()], { at: { x: 0, y: 0 } });
    await flush();
    const [placeholder] = h.runtime.getPreview().objects;
    h.runtime.setPreview({ objects: [], hiddenIds: [], marquee: { x: 0, y: 0, w: 5, h: 5 } });
    expect(h.runtime.getPreview().objects).toEqual([placeholder]);
    expect(h.runtime.getPreview().marquee).toEqual({ x: 0, y: 0, w: 5, h: 5 });
    uploads[0].resolve();
    await run;
    expect(h.runtime.getPreview().objects).toHaveLength(0);
    expect(h.runtime.getPreview().marquee).not.toBeNull(); // foreign state is left alone
  });
});

describe('failure', () => {
  it('removes the placeholder, creates nothing and tells the user', async () => {
    const run = ingest.addFiles([png()], { at: { x: 0, y: 0 } });
    await flush();
    expect(h.runtime.getPreview().objects).toHaveLength(1);
    uploads[0].reject(new Error('That image is too large (max 8 MB)'));
    await run;
    expect(h.runtime.getPreview().objects).toHaveLength(0);
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledExactlyOnceWith('refused', 'That image is too large (max 8 MB)');
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('a failed file does not stop its siblings, and repeated messages show once', async () => {
    const run = ingest.addFiles([png('a'), png('b'), png('c')], { at: { x: 0, y: 0 } });
    await flush();
    uploads[0].reject(new Error('Slow down'));
    uploads[1].reject(new Error('Slow down'));
    uploads[2].resolve();
    await run;
    expect(images()).toHaveLength(1);
    expect(notify).toHaveBeenCalledExactlyOnceWith('refused', 'Slow down');
  });
});

describe('batches', () => {
  it('lays files out in a row with a 16-unit gap from `at`, in file order', async () => {
    const files = [png('a'), png('b'), png('c')];
    sizes.set(files[1], { width: 100, height: 100 });
    const run = ingest.addFiles(files, { at: { x: 10, y: 20 } });
    await flush();
    const placeholders = h.runtime.getPreview().objects;
    expect(placeholders.map(object => [object.x, object.y])).toEqual([[10, 20], [226, 20], [342, 20]]);
    uploads.forEach(upload => upload.resolve());
    await flush();
    uploads.forEach(upload => upload.resolve());
    await run;
    expect(images().map(image => image.x)).toEqual([10, 226, 342]);
    expect(h.session.getState().selectedIds).toHaveLength(3);
  });

  it('uploads at most 3 at a time', async () => {
    const run = ingest.addFiles(Array.from({ length: 7 }, (_, i) => png(`f${i}`)), { at: { x: 0, y: 0 } });
    await flush();
    expect(uploads).toHaveLength(3);
    for (let done = 0; done < 7; done++) {
      uploads[done].resolve();
      await flush();
    }
    await run;
    expect(peak).toBe(3);
    expect(images()).toHaveLength(7);
  });
});

describe('dispose', () => {
  it('clears placeholders and drops results that arrive later', async () => {
    const run = ingest.addFiles([png(), png('b')], { at: { x: 0, y: 0 } });
    await flush();
    expect(h.runtime.getPreview().objects).toHaveLength(2);
    ingest.dispose();
    expect(h.runtime.getPreview().objects).toHaveLength(0);
    uploads.forEach(upload => upload.resolve());
    await run;
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.runtime.getPreview().objects).toHaveLength(0);
    await ingest.addFiles([png('c')]);
    expect(uploads).toHaveLength(2);
    expect(notify).not.toHaveBeenCalled();
  });
});
