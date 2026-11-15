import {
  GEOMETRY_EPSILON, HEX_COLOUR_PATTERN, MAX_ASSET_URL_BYTES, MAX_COORDINATE, MAX_FRAME_LABEL_LENGTH,
  MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS, MAX_OBJECT_BODY_BYTES, MAX_REACTION_EMOJI_LENGTH,
  MAX_STICKY_REACTION_EMOJIS, MAX_STICKY_REACTION_USERS, MAX_STICKY_TEXT_LENGTH,
  MAX_STROKE_POINTS, MAX_TEXT_LENGTH, PALETTE_COLOURS, STICKY_TONES, STROKE_WEIGHTS, UUID_PATTERN,
} from '../contract';
import type { BoardObject, PaletteColour, Point, StickyTone, StrokePoint } from '../contract';
import { normalizePoints, rankPrefix } from '../core';

export const uuidPattern = new RegExp(UUID_PATTERN);
export const hexColourPattern = new RegExp(HEX_COLOUR_PATTERN);
const encoder = new TextEncoder();

export function isValidColour(value: unknown): value is PaletteColour {
  return (PALETTE_COLOURS as readonly string[]).includes(value as string) ||
    (typeof value === 'string' && hexColourPattern.test(value));
}

export function isValidStickyTone(value: unknown): value is StickyTone {
  return (STICKY_TONES as readonly string[]).includes(value as string) ||
    (typeof value === 'string' && hexColourPattern.test(value));
}

export function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

export function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function fields(value: unknown, keys: readonly string[], optional: readonly string[] = []): asserts value is Record<string, unknown> {
  requireValid(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected an object');
  const actual = Object.keys(value);
  requireValid(
    actual.every(key => keys.includes(key) || optional.includes(key)) &&
    keys.every(key => actual.includes(key)),
    'Invalid or incomplete object fields',
  );
}

export function stickyReactions(value: unknown): void {
  if (value === undefined) return;
  requireValid(value !== null && typeof value === 'object' && !Array.isArray(value), 'Invalid sticky reactions');
  const entries = Object.entries(value as Record<string, unknown>);
  requireValid(entries.length <= MAX_STICKY_REACTION_EMOJIS, 'Too many sticky reaction types');
  for (const [emoji, users] of entries) {
    text(emoji, MAX_REACTION_EMOJI_LENGTH, true);
    requireValid(
      emoji === emoji.trim() && emoji.length > 0 && !/[\r\n\t]/.test(emoji) &&
      Array.isArray(users) && users.length >= 1 && users.length <= MAX_STICKY_REACTION_USERS,
      'Invalid sticky reaction entry',
    );
    const seen = new Set<string>();
    for (const uid of users) {
      requireValid(typeof uid === 'string' && uuidPattern.test(uid) && !seen.has(uid), 'Invalid reaction user UUID');
      seen.add(uid);
    }
  }
}

function number(value: unknown, min: number, max: number): void {
  requireValid(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, 'Invalid number');
}

function text(value: unknown, maximum: number, multiline = true): void {
  requireValid(typeof value === 'string' && !value.includes('\0') &&
    (multiline ? !value.includes('\r') : true) && [...value].length <= maximum, 'Invalid text');
  // JSON strings containing lone surrogates are not Unicode scalar strings.
  requireValid(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value), 'Invalid Unicode');
}

function strokeStyle(value: unknown, fill = false): void {
  fields(value, fill ? ['colour', 'weight', 'fill'] : ['colour', 'weight']);
  requireValid(isValidColour(value.colour) &&
    (STROKE_WEIGHTS as readonly string[]).includes(value.weight as string), 'Invalid stroke style');
  if (fill) requireValid(['none', 'tint', 'solid'].includes(value.fill as string), 'Invalid fill');
}

function tightBounds(points: readonly Point[], w: number, h: number): void {
  const { bounds } = normalizePoints(points.map(point => ({ ...point, pressure: 0.5 })));
  const epsilon = GEOMETRY_EPSILON * Math.max(1, w, h);
  requireValid(Math.abs(bounds.x) <= epsilon && Math.abs(bounds.y) <= epsilon &&
    Math.abs(bounds.w - w) <= epsilon && Math.abs(bounds.h - h) <= epsilon, 'Geometry must have tight local bounds');
}

/** Boundary validation, not geometry normalization: accepted bytes never change. */
export function validateObject(object: BoardObject): void {
  const base = ['id', 'kind', 'version', 'createdBy', 'rank', 'x', 'y', 'w', 'h'];
  const extras: Record<BoardObject['kind'], readonly string[]> = {
    rect: ['style'], ellipse: ['style'], stroke: ['points', 'preset', 'style'],
    line: ['start', 'end', 'style'], arrow: ['start', 'end', 'style'],
    text: ['text', 'style'], sticky: ['text', 'style'], frame: ['label', 'style'],
    image: ['assetId', 'url', 'width', 'height', 'crop', 'pixelated'],
  };
  requireValid(object && Object.hasOwn(extras, object.kind), 'Unknown object kind');
  fields(object, [...base, ...extras[object.kind]], object.kind === 'sticky' ? ['reactions'] : []);
  requireValid(uuidPattern.test(object.id) && uuidPattern.test(object.createdBy), 'Invalid object UUID');
  requireValid(Number.isSafeInteger(object.version) && object.version >= 0, 'Invalid object version');
  requireValid(typeof object.rank === 'string' && rankPrefix(object.rank) === (object.kind === 'frame' ? '0' : '1'), 'Invalid rank partition');
  number(object.x, -MAX_COORDINATE, MAX_COORDINATE);
  number(object.y, -MAX_COORDINATE, MAX_COORDINATE);
  number(object.w, 0, MAX_COORDINATE);
  number(object.h, 0, MAX_COORDINATE);
  if (!['stroke', 'line', 'arrow'].includes(object.kind)) requireValid(object.w > 0 && object.h > 0, 'Empty object bounds');
  requireValid(jsonBytes(object) <= MAX_OBJECT_BODY_BYTES, 'Object exceeds local byte limit');
  switch (object.kind) {
    case 'rect': case 'ellipse': strokeStyle(object.style, true); break;
    case 'frame': strokeStyle(object.style); text(object.label, MAX_FRAME_LABEL_LENGTH, false); break;
    case 'text':
      text(object.text, MAX_TEXT_LENGTH);
      fields(object.style, ['colour', 'size', 'font', 'bold', 'italic', 'align']);
      requireValid(isValidColour(object.style.colour) && ['S', 'M', 'L', 'XL'].includes(object.style.size) &&
        object.style.font === 'app' && typeof object.style.bold === 'boolean' && typeof object.style.italic === 'boolean' &&
        ['left', 'center', 'right'].includes(object.style.align), 'Invalid text style');
      break;
    case 'sticky':
      text(object.text, MAX_STICKY_TEXT_LENGTH);
      fields(object.style, ['tone', 'font']);
      requireValid(isValidStickyTone(object.style.tone) && object.style.font === 'handwriting', 'Invalid sticky style');
      stickyReactions(object.reactions);
      break;
    case 'stroke':
      strokeStyle(object.style);
      requireValid(['pen', 'marker'].includes(object.preset), 'Invalid stroke preset');
      requireValid(Array.isArray(object.points) && object.points.length > 0 && object.points.length <= MAX_STROKE_POINTS, 'Invalid stroke points');
      for (const point of object.points as readonly StrokePoint[]) {
        fields(point, ['x', 'y', 'pressure']);
        number(point.x, 0, MAX_COORDINATE); number(point.y, 0, MAX_COORDINATE); number(point.pressure, 0, 1);
      }
      tightBounds(object.points, object.w, object.h);
      break;
    case 'line': case 'arrow':
      strokeStyle(object.style);
      for (const point of [object.start, object.end]) {
        fields(point, ['x', 'y']); number(point.x, 0, MAX_COORDINATE); number(point.y, 0, MAX_COORDINATE);
      }
      tightBounds([object.start, object.end], object.w, object.h);
      break;
    case 'image':
      requireValid(uuidPattern.test(object.assetId) && typeof object.url === 'string' &&
        /^(\/uploads\/.+|https?:\/\/.+)/.test(object.url) && !object.url.includes('\0') &&
        encoder.encode(object.url).byteLength <= MAX_ASSET_URL_BYTES, 'Invalid asset');
      requireValid(Number.isInteger(object.width) && Number.isInteger(object.height), 'Invalid source dimensions');
      number(object.width, 1, MAX_IMAGE_DIMENSION); number(object.height, 1, MAX_IMAGE_DIMENSION);
      requireValid(object.width * object.height <= MAX_IMAGE_PIXELS && typeof object.pixelated === 'boolean', 'Invalid image');
      fields(object.crop, ['x', 'y', 'w', 'h']);
      for (const value of Object.values(object.crop)) number(value, 0, 1);
      requireValid(object.crop.w > 0 && object.crop.h > 0 && object.crop.x + object.crop.w <= 1 + GEOMETRY_EPSILON &&
        object.crop.y + object.crop.h <= 1 + GEOMETRY_EPSILON, 'Invalid crop');
      break;
  }
}
