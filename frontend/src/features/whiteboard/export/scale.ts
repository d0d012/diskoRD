import type { Rect } from '../contract';

/** World units of empty margin added on every side of the exported region. */
export const EXPORT_PADDING = 32;
/** Nominal rasterization scale (CSS world units -> device pixels). */
export const EXPORT_SCALE = 2;
/** Hard cap on the long side of the output PNG, in device pixels. */
export const EXPORT_MAX_SIDE = 8192;

export interface ExportPlan {
  /** Padded region's top-left corner in world units (the export origin). */
  readonly originX: number;
  readonly originY: number;
  /** Padded region size in world units. */
  readonly width: number;
  readonly height: number;
  /** Effective scale: nominal scale, reduced so the long side stays capped. */
  readonly scale: number;
  /** Output canvas size in device pixels. */
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

export interface ExportScaleOptions {
  readonly padding?: number;
  readonly scale?: number;
  readonly maxSide?: number;
}

/**
 * Pads a world-space content bounds and picks the raster scale. The scale is
 * `scale` (2x) unless that would push the long side past `maxSide` (8192px),
 * in which case it is reduced to fit the cap exactly.
 */
export function planExport(bounds: Rect, options: ExportScaleOptions = {}): ExportPlan {
  const padding = options.padding ?? EXPORT_PADDING;
  const baseScale = options.scale ?? EXPORT_SCALE;
  const maxSide = options.maxSide ?? EXPORT_MAX_SIDE;
  const width = Math.max(1, bounds.w + padding * 2);
  const height = Math.max(1, bounds.h + padding * 2);
  const longSide = Math.max(width, height);
  const scale = Math.min(baseScale, maxSide / longSide);
  return {
    originX: bounds.x - padding,
    originY: bounds.y - padding,
    width,
    height,
    scale,
    pixelWidth: Math.max(1, Math.round(width * scale)),
    pixelHeight: Math.max(1, Math.round(height * scale)),
  };
}
