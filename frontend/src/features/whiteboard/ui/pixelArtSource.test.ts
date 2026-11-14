import { describe, expect, it, vi } from 'vitest';
import { createPixelArtSource } from './pixelArtSource';
import type { GalleryImage } from './pixelArtSource';

const piece: GalleryImage = {
  id: 'art', title: 'A transparent pixel',
  doc: { v: 1, width: 16, height: 16, palette: ['#ff0000'], frames: [btoa('\x01' + '\x00'.repeat(255)), btoa('\x00'.repeat(256))] },
};

describe('pixel art source', () => {
  it('lists via the injected gallery boundary', async () => {
    const list = vi.fn().mockResolvedValue([piece]);
    expect(await createPixelArtSource({ list }).list()).toEqual([piece]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('decodes frame zero and exports at integer 512px scale, retaining transparency', async () => {
    const png = new Blob(['png'], { type: 'image/png' });
    const render = vi.fn().mockResolvedValue(png);
    const result = await createPixelArtSource({ render }).rasterize(piece);
    expect(result).toBe(png);
    expect(render).toHaveBeenCalledTimes(1);
    const [art, scale] = render.mock.calls[0];
    expect(scale).toBe(32);
    expect(art.width * scale).toBe(512);
    expect(art.pixels[0]).toBe(1);
    expect(art.pixels[1]).toBe(0);
    expect(art.palette).toEqual(['#ff0000']);
  });

  it('keeps non-square artwork at a whole-number scale near 512px', async () => {
    const render = vi.fn().mockResolvedValue(new Blob());
    await createPixelArtSource({ render }).rasterize({ ...piece, doc: { ...piece.doc, width: 150, height: 48, frames: [btoa('\x00'.repeat(150 * 48))] } });
    expect(render.mock.calls[0][1]).toBe(3);
    expect(render.mock.calls[0][0]).toMatchObject({ width: 150, height: 48 });
  });

  it('propagates list/render errors and refuses malformed docs before the renderer', async () => {
    const render = vi.fn().mockRejectedValue(new Error('Canvas unavailable'));
    await expect(createPixelArtSource({ render }).rasterize(piece)).rejects.toThrow('Canvas unavailable');
    render.mockClear();
    await expect(createPixelArtSource({ render }).rasterize({ ...piece, doc: { ...piece.doc, frames: [] } })).rejects.toThrow('Missing pixel data');
    expect(render).not.toHaveBeenCalled();
    await expect(createPixelArtSource({ list: async () => { throw new Error('Offline'); } }).list()).rejects.toThrow('Offline');
  });
});
