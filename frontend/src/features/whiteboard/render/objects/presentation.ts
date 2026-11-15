import { getStroke } from 'perfect-freehand';
import type { BoardObject, Point, StickyObject, StrokeObject, StrokePoint } from '../../contract';
import {
  FRAME_LABEL_FONT_SIZE, FRAME_LABEL_HEIGHT, FRAME_LABEL_PADDING_X, MARKER_WIDTH_MULTIPLIER,
  STICKY_REACTION_PRESETS, STROKE_WEIGHT_WORLD_UNITS, TINT_FILL_OPACITY,
} from '../../contract';
import {
  displayedSourceRect, frameLabelBounds, hasCheckboxLines, isHexColour, parseCheckboxLine,
  resolveInkCss, resolveStickyToneCss,
} from '../../core';
import { STICKY_LINE_HEIGHT, STICKY_PADDING, TEXT_LINE_HEIGHT } from '../../editing';
import { assetDisplayUrl } from '../../assets/displayUrl';
import { stickyFontSize, textFontSize } from './textFit';

const strokeCache = new WeakMap<readonly StrokePoint[], Map<string, string>>();
const painted = new WeakMap<HTMLElement, BoardObject>();

/** Position/colour do not invalidate the outline cache; point identity does. */
export function strokePath(object: StrokeObject): string {
  let variants = strokeCache.get(object.points);
  if (!variants) strokeCache.set(object.points, variants = new Map());
  const key = `${object.preset}:${object.style.weight}`;
  const cached = variants.get(key);
  if (cached !== undefined) return cached;
  const size = STROKE_WEIGHT_WORLD_UNITS[object.style.weight] * (object.preset === 'marker' ? MARKER_WIDTH_MULTIPLIER : 1);
  const outline = getStroke(object.points.map(p => [p.x, p.y, p.pressure]), {
    size, thinning: object.preset === 'marker' ? 0 : 0.5,
    simulatePressure: false, smoothing: 0.5, streamline: 0, last: true,
  });
  const path = outline.length ? `M${outline.map(p => `${p[0]},${p[1]}`).join('L')}Z` : '';
  variants.set(key, path);
  return path;
}

/** World-unit arrowhead at `end`; empty for a zero-length arrow. */
export function arrowHead(start: Point, end: Point, weight: number): { path: string; base: Point } {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  if (!distance) return { path: '', base: end };
  const length = Math.min(distance, Math.max(weight * 4, 10));
  const ux = (end.x - start.x) / distance;
  const uy = (end.y - start.y) / distance;
  const base = { x: end.x - ux * length, y: end.y - uy * length };
  const half = length * 0.5;
  return {
    base,
    path: `M${base.x - uy * half},${base.y + ux * half}L${end.x},${end.y}L${base.x + uy * half},${base.y - ux * half}Z`,
  };
}

/** Stable across mounts and clients; no random tilt or hover scale. */
export function stickyTilt(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return ((hash >>> 0) % 3001) / 1000 - 1.5;
}

function attributes(node: Element, values: Record<string, string | number>): void {
  for (const [name, value] of Object.entries(values)) node.setAttribute(name, String(value));
}
function textContent(node: Element, value: string): void {
  if (node.childElementCount > 0 || node.textContent !== value) node.textContent = value;
}

function paintRichText(node: HTMLElement, value: string, objectId: string): void {
  if (!hasCheckboxLines(value)) {
    textContent(node, value);
    return;
  }
  const doc = node.ownerDocument;
  node.replaceChildren();
  const lines = value.split('\n');
  lines.forEach((line, index) => {
    const parsed = parseCheckboxLine(line);
    if (!parsed) {
      const row = doc.createElement('div');
      row.className = 'wb-render-text-line';
      row.textContent = line || '\u200b';
      node.appendChild(row);
      return;
    }
    const row = doc.createElement('div');
    row.className = 'wb-render-checkbox-row';
    row.dataset.checked = String(parsed.checked);
    const indentSpaces = (/^[ \t]*/.exec(parsed.bullet)?.[0] ?? '').replace(/\t/g, '  ').length;
    if (indentSpaces > 0) {
      row.style.paddingInlineStart = `${indentSpaces * 0.5}em`;
    }
    const box = doc.createElement('button');
    box.type = 'button';
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(parsed.checked));
    box.setAttribute('aria-label', parsed.label ? `Toggle ${parsed.label}` : `Toggle task ${index + 1}`);
    box.className = 'wb-render-checkbox-box';
    box.dataset.wbCheckboxLine = String(index);
    box.dataset.wbCheckboxObject = objectId;
    const label = doc.createElement('span');
    label.className = 'wb-render-checkbox-label';
    label.textContent = parsed.label;
    row.append(box, label);
    node.appendChild(row);
  });
}

function paintStickyReactions(container: HTMLElement | null, object: StickyObject): void {
  if (!container) return;
  const doc = container.ownerDocument;
  const wasOpen = container.dataset.open === 'true';
  container.replaceChildren();
  const entries = Object.entries(object.reactions ?? {}).filter(([, users]) => users.length > 0);
  for (const [emoji, users] of entries) {
    const chip = doc.createElement('button');
    chip.type = 'button';
    chip.className = 'wb-root__sticky-chip wb-render-reaction-chip';
    chip.dataset.wbReaction = emoji;
    chip.dataset.wbReactionObject = object.id;
    chip.setAttribute('aria-label', `React ${emoji} (${users.length})`);
    chip.title = `${emoji} (${users.length})`;
    const icon = doc.createElement('span');
    icon.className = 'wb-render-reaction-emoji';
    icon.textContent = emoji;
    const count = doc.createElement('span');
    count.className = 'wb-render-reaction-count';
    count.textContent = String(users.length);
    chip.append(icon, count);
    container.appendChild(chip);
  }
  const trigger = doc.createElement('button');
  trigger.type = 'button';
  trigger.className = 'wb-root__sticky-chip wb-render-reaction-add';
  trigger.dataset.wbReactionTrigger = object.id;
  trigger.setAttribute('aria-label', 'Add reaction');
  trigger.setAttribute('aria-expanded', String(wasOpen));
  trigger.textContent = '+';
  container.appendChild(trigger);
  if (wasOpen) {
    const picker = doc.createElement('div');
    picker.className = 'wb-render-reaction-picker';
    picker.setAttribute('role', 'group');
    picker.setAttribute('aria-label', 'Choose reaction');
    for (const emoji of STICKY_REACTION_PRESETS) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'wb-render-reaction-option';
      btn.dataset.wbReaction = emoji;
      btn.dataset.wbReactionObject = object.id;
      btn.setAttribute('aria-label', `React ${emoji}`);
      btn.textContent = emoji;
      picker.appendChild(btn);
    }
    container.appendChild(picker);
  }
}

/** Shared by React mounts and the rAF preview path. Never uses innerHTML. */
export function paintObject(node: HTMLDivElement, object: BoardObject, editing = false, lifted = false, refit = false): void {
  node.style.transform = `translate(${object.x}px, ${object.y}px)`;
  node.style.width = `${object.w}px`;
  node.style.height = `${object.h}px`;
  const text = node.querySelector<HTMLElement>('[data-wb-text]');
  if (text) text.style.visibility = editing ? 'hidden' : '';
  const sticky = node.querySelector<HTMLElement>('.wb-root__sticky');
  if (sticky) sticky.dataset.lifted = String(lifted);
  const previous = painted.get(node);
  painted.set(node, object);
  if (previous === object && !refit) return;
  // Move-only previews must not measure text or rebuild paths.
  const bodyUnchanged = !refit && previous && previous.kind === object.kind && previous.w === object.w && previous.h === object.h &&
    Object.keys(object).every(key => ['x', 'y', 'rank', 'version', 'createdBy'].includes(key) ||
      object[key as keyof BoardObject] === previous[key as keyof BoardObject]);
  if (bodyUnchanged) return;

  if ('style' in object && 'colour' in object.style) node.style.color = resolveInkCss(object.style.colour);
  const svg = node.querySelector('svg');
  if (svg) attributes(svg, { width: Math.max(1, object.w), height: Math.max(1, object.h) });
  switch (object.kind) {
    case 'stroke':
      attributes(node.querySelector('path')!, { d: strokePath(object), fill: 'currentColor' });
      break;
    case 'rect':
    case 'ellipse': {
      const shape = node.querySelector('[data-wb-shape]')!;
      attributes(shape, { stroke: 'currentColor', 'stroke-width': STROKE_WEIGHT_WORLD_UNITS[object.style.weight], fill: object.style.fill === 'none' ? 'none' : 'currentColor', 'fill-opacity': object.style.fill === 'tint' ? TINT_FILL_OPACITY : 1 });
      if (object.kind === 'rect') attributes(shape, { width: object.w, height: object.h, rx: 8 });
      else attributes(shape, { cx: object.w / 2, cy: object.h / 2, rx: object.w / 2, ry: object.h / 2 });
      break;
    }
    case 'line':
    case 'arrow': {
      const weight = STROKE_WEIGHT_WORLD_UNITS[object.style.weight];
      const line = node.querySelector('line')!;
      attributes(line, { x1: object.start.x, y1: object.start.y, x2: object.end.x, y2: object.end.y, stroke: 'currentColor', 'stroke-width': weight, 'stroke-linecap': 'round' });
      if (object.kind === 'arrow') {
        const head = arrowHead(object.start, object.end, weight);
        attributes(node.querySelector('path')!, { d: head.path, fill: 'currentColor', 'stroke-linejoin': 'round' });
        // Stop the shaft at the head's base so the round cap never pokes past the tip.
        attributes(line, { x2: head.base.x, y2: head.base.y });
      }
      break;
    }
    case 'text':
      paintRichText(text!, object.text, object.id);
      // Same font, line height and zero padding as the editor's textarea.
      Object.assign(text!.style, { fontSize: `${textFontSize(object)}px`, lineHeight: String(TEXT_LINE_HEIGHT), fontWeight: object.style.bold ? '700' : '400', fontStyle: object.style.italic ? 'italic' : 'normal', textAlign: object.style.align });
      break;
    case 'sticky': {
      sticky!.dataset.tone = object.style.tone;
      if (isHexColour(object.style.tone)) {
        const custom = resolveStickyToneCss(object.style.tone);
        sticky!.style.setProperty('--wb-sticky-fill', custom.fill);
        sticky!.style.setProperty('--wb-sticky-ink', custom.ink);
      } else {
        sticky!.style.removeProperty('--wb-sticky-fill');
        sticky!.style.removeProperty('--wb-sticky-ink');
      }
      sticky!.style.setProperty('--wb-sticky-tilt', `${stickyTilt(object.id)}deg`);
      sticky!.style.padding = `${STICKY_PADDING}px`;
      paintRichText(text!, object.text, object.id);
      // fitSticky is the editor's own auto-fit, so text never jumps on edit start/end.
      Object.assign(text!.style, { fontSize: `${stickyFontSize(object)}px`, lineHeight: String(STICKY_LINE_HEIGHT) });
      paintStickyReactions(node.querySelector<HTMLElement>('[data-wb-sticky-reactions]'), object);
      // Persisted h is owned by the editing package; rendering never writes ops.
      break;
    }
    case 'image': {
      const image = node.querySelector('img')!;
      const src = assetDisplayUrl(object.url);
      if (image.getAttribute('src') !== src) image.setAttribute('src', src);
      const source = displayedSourceRect(object.crop, object, object);
      Object.assign(image.style, { left: `${source.x}px`, top: `${source.y}px`, width: `${source.w}px`, height: `${source.h}px`, imageRendering: object.pixelated ? 'pixelated' : 'auto' });
      break;
    }
    case 'frame': {
      const label = node.querySelector<HTMLElement>('[data-wb-frame-label]')!;
      const bounds = frameLabelBounds(object);
      Object.assign(label.style, { left: '0px', top: `${-FRAME_LABEL_HEIGHT}px`, width: `${bounds.w}px`, height: `${FRAME_LABEL_HEIGHT}px`, paddingInline: `${FRAME_LABEL_PADDING_X}px`, fontSize: `${FRAME_LABEL_FONT_SIZE}px` });
      textContent(label.querySelector('[data-wb-frame-title]')!, object.label);
      break;
    }
  }
}
