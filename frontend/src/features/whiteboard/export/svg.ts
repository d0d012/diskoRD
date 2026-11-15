import type { BoardObject, FrameObject, ImageObject, StickyObject, TextObject } from '../contract';
import {
  FRAME_LABEL_FONT_SIZE, FRAME_LABEL_HEIGHT, FRAME_LABEL_PADDING_X, STROKE_WEIGHT_WORLD_UNITS,
  TINT_FILL_OPACITY, TEXT_SIZE_WORLD_UNITS,
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
import type { TextMeasure } from './wrap';
import type { ExportPlan } from './scale';
import type { ExportRegion } from './region';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface BoardSvgOptions {
  /** Width measure bound to handwriting-bold, used for text wrapping. */
  readonly measureAt?: (fontSize: number) => TextMeasure;
}

const defaultMeasureAt = (fontSize: number): TextMeasure => run => run.length * fontSize * 0.55;

function textSvg(object: TextObject, measureAt: (fontSize: number) => TextMeasure): string {
  const fontSize = TEXT_SIZE_WORLD_UNITS[object.style.size];
  const lines = wrapText(object.text, Math.max(object.w, 1), measureAt(fontSize));
  const anchor = object.style.align === 'center' ? 'middle' : object.style.align === 'right' ? 'end' : 'start';
  const x = anchor === 'middle' ? object.w / 2 : anchor === 'end' ? object.w : 0;
  const first = fontSize * TEXT_LINE_HEIGHT;
  const tspans = lines.map((line, index) =>
    `<tspan x="${x}" y="${(first + index * fontSize * TEXT_LINE_HEIGHT).toFixed(2)}">${esc(line)}</tspan>`).join('');
  return `<text font-family="${esc(APP_FONT)}" font-size="${fontSize}" font-weight="${object.style.bold ? '700' : '400'}" font-style="${object.style.italic ? 'italic' : 'normal'}" fill="${esc(inkHex(object.style.colour))}" text-anchor="${anchor}">${tspans}</text>`;
}

function stickySvg(object: StickyObject, measureAt: (fontSize: number) => TextMeasure): string {
  const fill = stickyFillHex(object.style.tone);
  const ink = stickyInkHex(object.style.tone);
  const fontSize = stickyFontSize(object.text, object.w, stickyMinHeight(object.h), measureAt);
  const contentWidth = Math.max(object.w - 2 * STICKY_PADDING, 1);
  const lines = wrapText(object.text, contentWidth, measureAt(fontSize));
  const tilt = stickyTilt(object.id);
  const first = fontSize * STICKY_LINE_HEIGHT;
  const tspans = lines.map((line, index) =>
    `<tspan x="${STICKY_PADDING}" y="${(STICKY_PADDING + first + index * fontSize * STICKY_LINE_HEIGHT).toFixed(2)}">${esc(line)}</tspan>`).join('');
  return `<g transform="translate(${object.x} ${object.y}) rotate(${tilt.toFixed(3)} ${object.w / 2} ${object.h / 2})">`
    + `<rect width="${object.w}" height="${object.h}" rx="8" fill="${esc(fill)}" />`
    + `<path d="M8 0H${object.w - 8}Q${object.w} 0 ${object.w} 8V6H0V8Q0 0 8 0Z" fill="${esc(darken(fill, 0.92))}" />`
    + `<text font-family="${esc(HANDWRITING_FONT)}" font-size="${fontSize}" font-weight="700" fill="${esc(ink)}">${tspans}</text>`
    + `</g>`;
}

function imageSvg(object: ImageObject): string {
  const source = sourcePixelRect(object.crop, object);
  return `<g transform="translate(${object.x} ${object.y})">`
    + `<svg width="${object.w}" height="${object.h}" viewBox="${source.x} ${source.y} ${source.w} ${source.h}" preserveAspectRatio="none" overflow="hidden">`
    + `<image href="${esc(assetDisplayUrl(object.url))}" width="${object.width}" height="${object.height}" crossorigin="anonymous" />`
    + `</svg></g>`;
}

function frameSvg(object: FrameObject): string {
  const chipWidth = FRAME_LABEL_PADDING_X * 2 + 10;
  return `<g transform="translate(${object.x} ${object.y})">`
    + `<rect width="${object.w}" height="${object.h}" rx="10" fill="none" stroke="${FRAME_BORDER}" stroke-width="1.5" />`
    + `<g transform="translate(0 ${-FRAME_LABEL_HEIGHT})">`
    + `<rect x="0" y="0" width="${chipWidth}" height="${FRAME_LABEL_HEIGHT}" rx="4" fill="${FRAME_CHIP_BG}" />`
    + `<text x="${FRAME_LABEL_PADDING_X}" y="${FRAME_LABEL_HEIGHT / 2}" dominant-baseline="middle" font-family="${esc(PIXEL_FONT)}" font-size="10" fill="#fff">F</text>`
    + `<text x="${chipWidth + 4}" y="${FRAME_LABEL_HEIGHT / 2}" dominant-baseline="middle" font-family="${esc(APP_FONT)}" font-size="${FRAME_LABEL_FONT_SIZE}" font-weight="800" fill="${FRAME_TITLE}">${esc(object.label)}</text>`
    + `</g></g>`;
}

function objectSvg(object: BoardObject, measureAt: (fontSize: number) => TextMeasure): string {
  switch (object.kind) {
    case 'stroke':
      return `<g transform="translate(${object.x} ${object.y})"><path d="${esc(strokePath(object))}" fill="${esc(inkHex(object.style.colour))}" /></g>`;
    case 'rect':
    case 'ellipse': {
      const weight = STROKE_WEIGHT_WORLD_UNITS[object.style.weight];
      const common = `stroke="${esc(inkHex(object.style.colour))}" stroke-width="${weight}" fill="${esc(inkHex(object.style.colour))}"`;
      const fillAttr = object.style.fill === 'none' ? ' fill="none"' : ` fill-opacity="${object.style.fill === 'tint' ? TINT_FILL_OPACITY : 1}"`;
      const shape = object.kind === 'rect'
        ? `<rect width="${object.w}" height="${object.h}" rx="8" ${common}${fillAttr} />`
        : `<ellipse cx="${object.w / 2}" cy="${object.h / 2}" rx="${object.w / 2}" ry="${object.h / 2}" ${common}${fillAttr} />`;
      return `<g transform="translate(${object.x} ${object.y})">${shape}</g>`;
    }
    case 'line':
    case 'arrow': {
      const weight = STROKE_WEIGHT_WORLD_UNITS[object.style.weight];
      const head = object.kind === 'arrow' ? arrowHead(object.start, object.end, weight) : null;
      const end = head ? head.base : object.end;
      const shaft = `<line x1="${object.start.x}" y1="${object.start.y}" x2="${end.x}" y2="${end.y}" stroke="${esc(inkHex(object.style.colour))}" stroke-width="${weight}" stroke-linecap="round" />`;
      const headPath = head ? `<path d="${esc(head.path)}" fill="${esc(inkHex(object.style.colour))}" stroke-linejoin="round" />` : '';
      return `<g transform="translate(${object.x} ${object.y})">${shaft}${headPath}</g>`;
    }
    case 'text': return `<g transform="translate(${object.x} ${object.y})">${textSvg(object, measureAt)}</g>`;
    case 'sticky': return stickySvg(object, measureAt);
    case 'image': return imageSvg(object);
    case 'frame': return frameSvg(object);
  }
}

/**
 * A self-contained SVG of the exported region: board background, every object
 * (same perfect-freehand strokes, shapes, wrapped text, sticky notes with the
 * handwriting font, images and frame borders) and, for frame exports, a clip to
 * the frame bounds. `measureAt` drives text wrapping and sticky auto-fit.
 */
export function buildBoardSvg(region: ExportRegion, plan: ExportPlan, options: BoardSvgOptions = {}): string {
  const measureAt = options.measureAt ?? defaultMeasureAt;
  const clip = region.clip
    ? `<clipPath id="wb-export-clip"><rect x="${region.clip.x}" y="${region.clip.y}" width="${region.clip.w}" height="${region.clip.h}" /></clipPath>`
    : '';
  const body = region.objects.map(object => objectSvg(object, measureAt)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${plan.width}" height="${plan.height}" viewBox="${plan.originX} ${plan.originY} ${plan.width} ${plan.height}">`
    + `<defs>${clip}</defs>`
    + `<rect x="${plan.originX}" y="${plan.originY}" width="${plan.width}" height="${plan.height}" fill="${BOARD_CANVAS}" />`
    + (region.clip ? `<g clip-path="url(#wb-export-clip)">${body}</g>` : body)
    + `</svg>`;
}
