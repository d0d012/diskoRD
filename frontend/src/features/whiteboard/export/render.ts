import type { BoardObject, FrameObject, ImageObject, StickyObject, TextObject } from '../contract';
import {
  FRAME_LABEL_FONT_SIZE, FRAME_LABEL_HEIGHT, FRAME_LABEL_PADDING_X, STROKE_WEIGHT_WORLD_UNITS,
  TEXT_SIZE_WORLD_UNITS, TINT_FILL_OPACITY,
} from '../contract';
import { sourcePixelRect } from '../core';
import { STICKY_LINE_HEIGHT, STICKY_PADDING, TEXT_LINE_HEIGHT } from '../editing';
import { assetDisplayUrl } from '../assets/displayUrl';
import { arrowHead, stickyTilt, strokePath } from '../render/objects/presentation';
import {
  APP_FONT, BOARD_CANVAS, darken, FRAME_BORDER, FRAME_CHIP_BG, FRAME_TITLE, HANDWRITING_FONT,
  inkHex, PIXEL_FONT, stickyFillHex, stickyInkHex,
} from './colours';
import { stickyFontSize, stickyMinHeight } from './fit';
import { wrapText } from './wrap';
import type { ExportPlan } from './scale';
import type { ExportRegion } from './region';

export interface ExportRenderResult {
  readonly canvas: HTMLCanvasElement;
  readonly skippedImages: number;
}

function textFont(kind: 'app' | 'handwriting', size: number, bold: boolean, italic: boolean): string {
  return `${italic ? 'italic ' : ''}${bold ? '700' : '400'} ${size}px ${kind === 'handwriting' ? HANDWRITING_FONT : APP_FONT}`;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

interface WrappedTextSpec {
  readonly text: string;
  readonly font: string;
  readonly fill: string;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly align: 'left' | 'center' | 'right';
  readonly x: number;
  readonly y: number;
  readonly wrapWidth: number;
}

function drawWrappedText(ctx: CanvasRenderingContext2D, spec: WrappedTextSpec): void {
  ctx.font = spec.font;
  ctx.fillStyle = spec.fill;
  ctx.textBaseline = 'top';
  const lines = wrapText(spec.text, Math.max(spec.wrapWidth, 1), run => ctx.measureText(run).width);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const width = ctx.measureText(line).width;
    const x = spec.align === 'center' ? spec.x + (spec.wrapWidth - width) / 2
      : spec.align === 'right' ? spec.x + spec.wrapWidth - width
        : spec.x;
    ctx.fillText(line, x, spec.y + i * spec.fontSize * spec.lineHeight);
  }
}

function drawTextObject(ctx: CanvasRenderingContext2D, object: TextObject): void {
  const fontSize = TEXT_SIZE_WORLD_UNITS[object.style.size];
  drawWrappedText(ctx, {
    text: object.text,
    font: textFont('app', fontSize, object.style.bold, object.style.italic),
    fill: inkHex(object.style.colour),
    fontSize,
    lineHeight: TEXT_LINE_HEIGHT,
    align: object.style.align,
    x: 0,
    y: 0,
    wrapWidth: object.w,
  });
}

function drawStickyObject(ctx: CanvasRenderingContext2D, object: StickyObject): void {
  const fill = stickyFillHex(object.style.tone);
  const ink = stickyInkHex(object.style.tone);
  const fontSize = stickyFontSize(object.text, object.w, stickyMinHeight(object.h), size => run => {
    ctx.save();
    ctx.font = textFont('handwriting', size, true, false);
    const width = ctx.measureText(run).width;
    ctx.restore();
    return width;
  });
  const tilt = stickyTilt(object.id);
  ctx.save();
  ctx.translate(object.x, object.y);
  ctx.translate(object.w / 2, object.h / 2);
  ctx.rotate((tilt * Math.PI) / 180);
  ctx.translate(-object.w / 2, -object.h / 2);

  ctx.fillStyle = fill;
  roundedRect(ctx, 0, 0, object.w, object.h, 8);
  ctx.fill();
  ctx.save();
  roundedRect(ctx, 0, 0, object.w, object.h, 8);
  ctx.clip();
  ctx.fillStyle = darken(fill, 0.92);
  ctx.fillRect(0, 0, object.w, 6);
  ctx.restore();

  drawWrappedText(ctx, {
    text: object.text,
    font: textFont('handwriting', fontSize, true, false),
    fill: ink,
    fontSize,
    lineHeight: STICKY_LINE_HEIGHT,
    align: 'left',
    x: STICKY_PADDING,
    y: STICKY_PADDING,
    wrapWidth: object.w - 2 * STICKY_PADDING,
  });
  ctx.restore();
}

function drawImageObject(ctx: CanvasRenderingContext2D, object: ImageObject, images: ReadonlyMap<string, HTMLImageElement>): void {
  const image = images.get(assetDisplayUrl(object.url));
  if (!image) return;
  const source = sourcePixelRect(object.crop, object);
  ctx.imageSmoothingEnabled = !object.pixelated;
  ctx.drawImage(image, source.x, source.y, source.w, source.h, 0, 0, object.w, object.h);
}

function drawFrameObject(ctx: CanvasRenderingContext2D, object: FrameObject): void {
  ctx.strokeStyle = FRAME_BORDER;
  ctx.lineWidth = 1.5;
  roundedRect(ctx, 0, 0, object.w, object.h, 10);
  ctx.stroke();

  const chipWidth = FRAME_LABEL_PADDING_X * 2 + 10;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, -FRAME_LABEL_HEIGHT, Math.max(object.w, chipWidth + 8), FRAME_LABEL_HEIGHT);
  ctx.clip();
  ctx.fillStyle = FRAME_CHIP_BG;
  roundedRect(ctx, 0, -FRAME_LABEL_HEIGHT, chipWidth, FRAME_LABEL_HEIGHT, 4);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `400 10px ${PIXEL_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('F', FRAME_LABEL_PADDING_X, -FRAME_LABEL_HEIGHT / 2);
  ctx.fillStyle = FRAME_TITLE;
  ctx.font = `800 ${FRAME_LABEL_FONT_SIZE}px ${APP_FONT}`;
  ctx.fillText(object.label, chipWidth + 4, -FRAME_LABEL_HEIGHT / 2);
  ctx.restore();
}

function drawObject(
  ctx: CanvasRenderingContext2D, object: BoardObject,
  images: ReadonlyMap<string, HTMLImageElement>,
): void {
  // Sticky notes rotate around their own centre; they own their save/restore.
  if (object.kind === 'sticky') {
    drawStickyObject(ctx, object);
    return;
  }
  ctx.save();
  ctx.translate(object.x, object.y);
  switch (object.kind) {
    case 'stroke': {
      ctx.fillStyle = inkHex(object.style.colour);
      ctx.fill(new Path2D(strokePath(object)));
      break;
    }
    case 'rect':
    case 'ellipse': {
      const weight = STROKE_WEIGHT_WORLD_UNITS[object.style.weight];
      ctx.strokeStyle = inkHex(object.style.colour);
      ctx.lineWidth = weight;
      ctx.fillStyle = inkHex(object.style.colour);
      ctx.globalAlpha = object.style.fill === 'tint' ? TINT_FILL_OPACITY : 1;
      if (object.kind === 'rect') roundedRect(ctx, 0, 0, object.w, object.h, 8);
      else { ctx.beginPath(); ctx.ellipse(object.w / 2, object.h / 2, object.w / 2, object.h / 2, 0, 0, Math.PI * 2); }
      if (object.style.fill !== 'none') ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
      break;
    }
    case 'line':
    case 'arrow': {
      const weight = STROKE_WEIGHT_WORLD_UNITS[object.style.weight];
      ctx.strokeStyle = inkHex(object.style.colour);
      ctx.lineWidth = weight;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(object.start.x, object.start.y);
      const end = object.kind === 'arrow' ? arrowHead(object.start, object.end, weight).base : object.end;
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      if (object.kind === 'arrow') {
        const head = arrowHead(object.start, object.end, weight);
        ctx.fillStyle = inkHex(object.style.colour);
        ctx.fill(new Path2D(head.path));
      }
      break;
    }
    case 'text': drawTextObject(ctx, object); break;
    case 'image': drawImageObject(ctx, object, images); break;
    case 'frame': drawFrameObject(ctx, object); break;
  }
  ctx.restore();
}

function imageFrom(src: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (crossOrigin) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image failed to load'));
    image.src = src;
  });
}

/**
 * Loads a board asset without tainting the export canvas. The board already
 * showed cross-origin assets through plain <img> tags, and that cached response
 * (no Vary: Origin) fails a later crossOrigin load, so fetch a fresh CORS copy
 * and draw it from a same-origin blob URL.
 */
async function loadImage(url: string): Promise<HTMLImageElement> {
  if (!/^https?:\/\//i.test(url)) return imageFrom(url, false);
  try {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error(`image fetch ${response.status}`);
    const blobUrl = URL.createObjectURL(await response.blob());
    try {
      return await imageFrom(blobUrl, false);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  } catch {
    return imageFrom(url, true);
  }
}

/** True when drawing the image would taint the export canvas. */
function isTainted(image: HTMLImageElement): boolean {
  try {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    const ctx = probe.getContext('2d');
    if (!ctx) return true;
    ctx.drawImage(image, 0, 0, 1, 1);
    ctx.getImageData(0, 0, 1, 1);
    return false;
  } catch {
    return true;
  }
}

/**
 * Rasterizes the region at the planned scale: board background, objects in rank
 * order (so overlaps match the board), frame clip when exporting a frame, and
 * images that load cleanly. Images that fail to load or would taint the canvas
 * are skipped and counted so the caller can report them.
 */
export async function renderExport(region: ExportRegion, plan: ExportPlan): Promise<ExportRenderResult> {
  const canvas = document.createElement('canvas');
  canvas.width = plan.pixelWidth;
  canvas.height = plan.pixelHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');

  const images = new Map<string, HTMLImageElement>();
  const skipped = new Set<string>();
  await Promise.all(region.objects.filter(object => object.kind === 'image').map(async object => {
    const url = assetDisplayUrl(object.url);
    if (images.has(url) || skipped.has(url)) return;
    try {
      const image = await loadImage(url);
      if (isTainted(image)) skipped.add(url);
      else images.set(url, image);
    } catch {
      skipped.add(url);
    }
  }));

  ctx.fillStyle = BOARD_CANVAS;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(plan.scale, plan.scale);
  ctx.translate(-plan.originX, -plan.originY);
  if (region.clip) {
    ctx.beginPath();
    ctx.rect(region.clip.x, region.clip.y, region.clip.w, region.clip.h);
    ctx.clip();
  }
  for (const object of region.objects) drawObject(ctx, object, images);
  ctx.restore();

  return { canvas, skippedImages: skipped.size };
}
