import { usePixelArtStore } from '../../../stores/pixelArtStore';
import type { PixelArtPiece } from '../../../types';
import type { Art } from '../../pixelart/lib/art';
import { decodeDoc } from '../../pixelart/lib/doc';
import { artToPng, shareScale } from '../../pixelart/render';

export type GalleryImage = Pick<PixelArtPiece, 'id' | 'title' | 'doc'>;

export interface PixelArtSource {
  list(): Promise<readonly GalleryImage[]>;
  rasterize(piece: GalleryImage): Promise<Blob>;
}

export interface PixelArtSourceOptions {
  readonly list?: () => Promise<readonly GalleryImage[]>;
  /** Production uses the existing transparent nearest-neighbour PNG exporter. */
  readonly render?: (art: Art, scale: number) => Promise<Blob>;
}

/** decodeDoc intentionally reads frame zero, including for animated documents. */
export function createPixelArtSource(options: PixelArtSourceOptions = {}): PixelArtSource {
  return {
    list: options.list ?? (() => usePixelArtStore.getState().loadGallery()),
    async rasterize(piece) {
      const art = decodeDoc(piece.doc);
      return (options.render ?? artToPng)(art, shareScale(art));
    },
  };
}
