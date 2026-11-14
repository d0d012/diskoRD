import type {
  ArrowObject, BoardObject, EllipseObject, FrameObject, ImageObject, LineObject, RectObject,
  StickyObject, StrokeObject, TextObject,
} from '../contract';

/** Test fixtures for the render package; one valid object of every kind. */
const base = { version: 1, createdBy: 'u1' } as const;

export const rect: RectObject = {
  ...base, id: 'rect-1', kind: 'rect', rank: '1:a1', x: 10, y: 20, w: 160, h: 100,
  style: { colour: 'blue', weight: 'thin', fill: 'tint' },
};
export const ellipse: EllipseObject = {
  ...base, id: 'ellipse-1', kind: 'ellipse', rank: '1:a2', x: 200, y: 20, w: 120, h: 80,
  style: { colour: 'red', weight: 'thick', fill: 'solid' },
};
export const line: LineObject = {
  ...base, id: 'line-1', kind: 'line', rank: '1:a3', x: 0, y: 300, w: 100, h: 0,
  start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, style: { colour: 'gray', weight: 'thin' },
};
export const arrow: ArrowObject = {
  ...base, id: 'arrow-1', kind: 'arrow', rank: '1:a4', x: 0, y: 400, w: 100, h: 50,
  start: { x: 0, y: 50 }, end: { x: 100, y: 0 }, style: { colour: 'green', weight: 'thick' },
};
export const stroke: StrokeObject = {
  ...base, id: 'stroke-1', kind: 'stroke', rank: '1:a5', x: 500, y: 500, w: 40, h: 20, preset: 'pen',
  points: [{ x: 0, y: 0, pressure: 0.5 }, { x: 20, y: 20, pressure: 0.5 }, { x: 40, y: 10, pressure: 0.5 }],
  style: { colour: 'purple', weight: 'thin' },
};
export const text: TextObject = {
  ...base, id: 'text-1', kind: 'text', rank: '1:a6', x: 600, y: 0, w: 240, h: 30, text: 'Hello ğşı',
  style: { colour: 'orange', size: 'L', font: 'app', bold: true, italic: false, align: 'center' },
};
export const sticky: StickyObject = {
  ...base, id: 'sticky-1', kind: 'sticky', rank: '1:a7', x: 900, y: 0, w: 200, h: 200,
  text: 'Plan the boss fight', style: { tone: 'mint', font: 'handwriting' },
};
export const image: ImageObject = {
  ...base, id: 'image-1', kind: 'image', rank: '1:a8', x: 0, y: 600, w: 100, h: 50,
  assetId: '00000000-0000-4000-8000-000000000001', url: '/uploads/a.png', width: 400, height: 100,
  crop: { x: 0.25, y: 0, w: 0.5, h: 1 }, pixelated: true,
};
export const frame: FrameObject = {
  ...base, id: 'frame-1', kind: 'frame', rank: '0:a1', x: -50, y: -50, w: 640, h: 400,
  label: 'Sprint', style: { colour: 'gray', weight: 'thin' },
};

export const allObjects: readonly BoardObject[] = [rect, ellipse, line, arrow, stroke, text, sticky, image, frame];
