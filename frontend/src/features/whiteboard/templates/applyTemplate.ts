import type { BoardObject, BoardStore, ObjectId, Rank, Runtime, UserId } from '../contract';
import { fitToBounds, getBounds, unionBounds } from '../core';
import { createChange, safeDispatch, topRanks } from '../input/objects';
import type { BoardNotify, SessionStore } from '../state';
import { DEFAULT_STYLE_DEFAULTS } from '../state/sessionStore';
import { templateById } from './templates';
import type { TemplateItem } from './templates';

/**
 * Applies a starter template as ONE command (one undo step). Geometry is laid
 * out relative to the viewport centre, so the template is centred where the
 * user is looking. Ranks respect the frame/non-frame partition.
 */

export interface ApplyTemplateOptions {
  readonly store: BoardStore;
  readonly session: SessionStore;
  readonly runtime: Runtime;
  readonly userId: UserId;
  readonly notify?: BoardNotify;
  readonly newId?: () => ObjectId;
  readonly getViewportSize?: () => { readonly width: number; readonly height: number } | null;
}

const FRAME_STYLE = { colour: 'blue', weight: 'thin' } as const;

function toObject(item: TemplateItem, rank: Rank, id: ObjectId, createdBy: UserId): BoardObject {
  const base = { id, rank, version: 0, createdBy, x: item.x, y: item.y, w: item.w, h: item.h };
  if (item.kind === 'frame') return { ...base, kind: 'frame', label: item.label, style: FRAME_STYLE };
  switch (item.kind) {
    case 'sticky': return { ...base, kind: 'sticky', text: item.text, style: { tone: item.tone, font: 'handwriting' } };
    case 'text': return { ...base, kind: 'text', text: item.text, style: { ...DEFAULT_STYLE_DEFAULTS.text, ...item.style } };
    case 'rect': case 'ellipse': return { ...base, kind: item.kind, style: { ...DEFAULT_STYLE_DEFAULTS.shape, colour: item.colour ?? DEFAULT_STYLE_DEFAULTS.shape.colour, fill: item.fill ?? DEFAULT_STYLE_DEFAULTS.shape.fill } };
    case 'line': case 'arrow': return { ...base, kind: item.kind, start: item.start, end: item.end, style: { ...DEFAULT_STYLE_DEFAULTS.stroke, colour: item.colour ?? DEFAULT_STYLE_DEFAULTS.stroke.colour } };
  }
}

export function applyTemplate(templateId: string, options: ApplyTemplateOptions): ObjectId[] | null {
  const template = templateById(templateId);
  if (!template) return null;
  const { store, session, runtime, userId, notify } = options;
  const newId = options.newId ?? (() => crypto.randomUUID());

  const size = options.getViewportSize?.();
  const width = size && size.width > 0 ? size.width : window.innerWidth;
  const height = size && size.height > 0 ? size.height : window.innerHeight;
  const centre = runtime.screenToWorld({ x: width / 2, y: height / 2 });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of template.items) {
    if (item.x < minX) minX = item.x;
    if (item.y < minY) minY = item.y;
    if (item.x + item.w > maxX) maxX = item.x + item.w;
    if (item.y + item.h > maxY) maxY = item.y + item.h;
  }
  const dx = centre.x - (minX + maxX) / 2;
  const dy = centre.y - (minY + maxY) / 2;
  const shifted: TemplateItem[] = template.items.map(item => ({ ...item, x: item.x + dx, y: item.y + dy }));

  const frames = shifted.filter(item => item.kind === 'frame');
  const others = shifted.filter(item => item.kind !== 'frame');
  const frameRanks = topRanks(store, frames.length, true);
  const otherRanks = topRanks(store, others.length, false);

  const objects: BoardObject[] = [
    ...frames.map((item, index) => toObject(item, frameRanks[index], newId(), userId)),
    ...others.map((item, index) => toObject(item, otherRanks[index], newId(), userId)),
  ];

  const opId = safeDispatch(store, objects.map(createChange), `Apply ${template.name}`, notify);
  if (opId === null) return null;
  const ids = objects.map(object => object.id);
  session.setSelectedIds([]);
  // Templates are larger than a typical viewport at 100%: show all of it, never zooming in.
  const fitted = fitToBounds(unionBounds(objects.map(getBounds)), { x: 0, y: 0, w: width, h: height }, 64);
  if (fitted.zoom < runtime.getCamera().zoom) runtime.setCamera(fitted);
  return ids;
}
