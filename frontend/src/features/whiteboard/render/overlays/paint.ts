import type { BoardObject, Camera, HandleId, Point, Rect } from '../../contract';
import { worldToScreen } from '../../core';

/** World units between grid dots; every 5th dot is a major dot (CSS). */
export const GRID_SPACING = 24;

/** Camera-dependent grid tokens; opacity fades are derived in CSS from --wb-zoom. */
export function paintGrid(node: HTMLElement, camera: Camera): void {
  const size = GRID_SPACING * camera.zoom;
  node.style.setProperty('--wb-zoom', String(camera.zoom));
  node.style.setProperty('--wb-grid-size', `${size}px`);
  node.style.setProperty('--wb-grid-origin-x', `${camera.x - size / 2}px`);
  node.style.setProperty('--wb-grid-origin-y', `${camera.y - size / 2}px`);
}

export function paintMarquee(node: HTMLDivElement, rect: Rect | null, camera: Camera): void {
  node.hidden = !rect;
  if (!rect) return;
  const point = worldToScreen(rect, camera);
  Object.assign(node.style, { transform: `translate(${point.x}px, ${point.y}px)`, width: `${rect.w * camera.zoom}px`, height: `${rect.h * camera.zoom}px` });
}

const BOX_HANDLES: readonly [HandleId, number, number][] = [
  ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0], ['e', 1, 0.5],
  ['se', 1, 1], ['s', 0.5, 1], ['sw', 0, 1], ['w', 0, 0.5],
];

/** World positions of the handles input can drag (mirrors input's canDragHandle). */
export function handlesFor(object: BoardObject): readonly [HandleId, Point][] {
  if (object.kind === 'line' || object.kind === 'arrow') return [
    ['start', { x: object.x + object.start.x, y: object.y + object.start.y }],
    ['end', { x: object.x + object.end.x, y: object.y + object.end.y }],
  ];
  if (object.kind === 'sticky') return [];
  return BOX_HANDLES.filter(([id]) => {
    if (object.kind === 'image') return id.length === 2;
    if (object.kind === 'text') return id !== 'n' && id !== 's';
    return true;
  }).map(([id, x, y]) => [id, { x: object.x + x * object.w, y: object.y + y * object.h }]);
}

function sizeLabel(object: BoardObject): string | null {
  if (object.kind === 'line' || object.kind === 'arrow' || object.kind === 'sticky') return null;
  return `${Math.round(object.w)} × ${Math.round(object.h)}`;
}

function element(className: string): HTMLDivElement {
  const node = document.createElement('div');
  node.className = className;
  return node;
}

/**
 * Screen-space outline per selected object so nothing scales with zoom. Handles
 * (and the Silkscreen size readout) appear only for a single selection, the
 * only case input resizes. Nodes are reused; only geometry is rewritten.
 */
export function paintSelection(root: HTMLDivElement, objects: readonly BoardObject[], camera: Camera): void {
  const existing = new Map(Array.from(root.children, child => [(child as HTMLElement).dataset.wbSelectionId!, child as HTMLDivElement]));
  const single = objects.length === 1;
  for (const object of objects) {
    let group = existing.get(object.id);
    if (!group) {
      group = element('wb-render-selection-group');
      group.dataset.wbSelectionId = object.id;
      group.append(element('wb-root__selection wb-render-selection-box'));
      root.append(group);
    }
    existing.delete(object.id);
    const outline = group.firstElementChild as HTMLDivElement;
    const screen = worldToScreen(object, camera);
    const width = object.w * camera.zoom;
    const height = object.h * camera.zoom;
    Object.assign(outline.style, { transform: `translate(${screen.x}px, ${screen.y}px)`, width: `${width}px`, height: `${height}px` });
    outline.hidden = object.kind === 'line' || object.kind === 'arrow';

    const handles = single ? handlesFor(object) : [];
    const oldHandles = new Map(Array.from(group.querySelectorAll<HTMLDivElement>('[data-wb-handle]'), node => [node.dataset.wbHandle!, node]));
    for (const [id, point] of handles) {
      let handle = oldHandles.get(id);
      if (!handle) {
        handle = element('wb-root__selection-handle wb-render-handle');
        handle.dataset.wbHandle = id;
        // Not data-wb-object-id: that attribute is reserved for object wrappers.
        handle.dataset.wbHandleFor = object.id;
        group.append(handle);
      }
      oldHandles.delete(id);
      const position = worldToScreen(point, camera);
      handle.style.transform = `translate(${position.x}px, ${position.y}px) translate(-50%, -50%)`;
    }
    for (const node of oldHandles.values()) node.remove();

    const label = single ? sizeLabel(object) : null;
    let readout = group.querySelector<HTMLDivElement>('[data-wb-size-readout]');
    if (label === null) readout?.remove();
    else {
      if (!readout) {
        readout = element('wb-root__size-readout wb-render-size-readout');
        readout.dataset.wbSizeReadout = '';
        group.append(readout);
      }
      if (readout.textContent !== label) readout.textContent = label;
      readout.style.transform = `translate(${screen.x + width / 2}px, ${screen.y + height}px) translate(-50%, 10px)`;
    }
  }
  for (const node of existing.values()) node.remove();
}
