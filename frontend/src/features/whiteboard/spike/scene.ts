export const SEED = 0xbee2026;
export const WORLD_SIZE = 10000;
const CELL_SIZE = 512;

export interface Options {
  n: number;
  cull: boolean;
  willchange: boolean;
  auto: boolean;
}

export function readOptions(search: string): Options {
  const query = new URLSearchParams(search);
  const n = Number(query.get('n') ?? 2000);
  return {
    n: Number.isSafeInteger(n) && n >= 0 ? n : 2000,
    cull: query.get('cull') !== '0',
    willchange: query.get('willchange') !== '0',
    auto: query.get('auto') === '1',
  };
}

export interface Camera { x: number; y: number; zoom: number }
export interface Bounds { x: number; y: number; width: number; height: number }
export interface SceneObject extends Bounds {
  id: number;
  kind: 'sticky' | 'text' | 'shape' | 'stroke' | 'image' | 'frame';
  color: string;
  text: string;
  ellipse: boolean;
  pixelated: boolean;
  path?: string;
  pointCount?: number;
  src?: string;
}

function randomGenerator(seed: number) {
  return function random() {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

// Encode real 24-bit BMP pixels without using a canvas (even offscreen).
function bitmap(random: () => number): string {
  const size = 32;
  const bytes = new Uint8Array(54 + size * size * 3);
  const view = new DataView(bytes.buffer);
  bytes[0] = 66;
  bytes[1] = 77;
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, size, true);
  view.setInt32(22, size, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  const tint = Math.floor(random() * 255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = 54 + (y * size + x) * 3;
      const checker = ((x >> 2) + (y >> 2)) % 2;
      bytes[offset] = (tint + x * 6) % 256;
      bytes[offset + 1] = checker ? 210 : 65;
      bytes[offset + 2] = (tint + y * 7) % 256;
    }
  }
  return `data:image/bmp;base64,${btoa(String.fromCharCode(...bytes))}`;
}

// Precomputed variable-width outline, not SVG stroke: two sides of a sampled pen trace.
function outline(count: number, width: number, height: number, random: () => number) {
  const frequency = 1 + random() * 4;
  const phase = random() * Math.PI * 2;
  const points = Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    return { x: 12 + t * (width - 24), y: height / 2 + Math.sin(t * Math.PI * 2 * frequency + phase) * (height / 2 - 16) };
  });
  const left: string[] = [];
  const right: string[] = [];
  points.forEach((point, i) => {
    const before = points[Math.max(0, i - 1)];
    const after = points[Math.min(count - 1, i + 1)];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const radius = 2 + 3 * Math.sin(Math.PI * i / (count - 1));
    const scale = radius / (Math.hypot(dx, dy) || 1);
    left.push(`${(point.x - dy * scale).toFixed(2)},${(point.y + dx * scale).toFixed(2)}`);
    right.push(`${(point.x + dy * scale).toFixed(2)},${(point.y - dx * scale).toFixed(2)}`);
  });
  return `M${left.join('L')}L${right.reverse().join('L')}Z`;
}

export function createScene(count: number): SceneObject[] {
  const random = randomGenerator(SEED);
  const colors = ['#f4d96b', '#ef9fbd', '#98d9b3', '#92c7ee'];
  const phrases = ['Plan next level', 'ğ ş ı İ ç ö ü', 'Ship together'];
  const objects = Array.from({ length: count }, (_, id): SceneObject => {
    // A permuted hundred gives the requested proportions without grouping kinds in z-order.
    const bucket = id * 37 % 100;
    const kind = bucket < 30 ? 'sticky' : bucket < 45 ? 'text' : bucket < 65 ? 'shape' : bucket < 90 ? 'stroke' : bucket < 97 ? 'image' : 'frame';
    const width = kind === 'frame' ? 600 : kind === 'sticky' ? 200 : 140 + random() * 140;
    const height = kind === 'frame' ? 420 : kind === 'sticky' ? 200 : 100 + random() * 120;
    const object: SceneObject = {
      id, kind, width, height,
      x: random() * (WORLD_SIZE - width),
      y: random() * (WORLD_SIZE - height),
      color: colors[Math.floor(random() * colors.length)],
      text: phrases.slice(0, 1 + Math.floor(random() * 3)).join('\n'),
      ellipse: random() > 0.5,
      pixelated: random() > 0.5,
    };
    if (kind === 'stroke') {
      object.pointCount = 2 * (50 + Math.floor(random() * 151));
      object.path = outline(object.pointCount / 2, width, height, random);
    }
    if (kind === 'image') object.src = bitmap(random);
    return object;
  });
  // Frames behind the other objects; IDs provide deterministic order within each group.
  return objects.sort((a, b) => Number(b.kind === 'frame') - Number(a.kind === 'frame') || a.id - b.id);
}

export function intersects(a: Bounds, b: Bounds): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

export class SpatialGrid {
  private cells = new Map<string, number[]>();
  private objects: SceneObject[];

  constructor(objects: SceneObject[]) {
    this.objects = objects;
    objects.forEach((object, index) => this.cellsFor(object, (key) => {
      const cell = this.cells.get(key) ?? [];
      cell.push(index);
      this.cells.set(key, cell);
    }));
  }

  private cellsFor(bounds: Bounds, visit: (key: string) => void) {
    for (let x = Math.floor(bounds.x / CELL_SIZE); x <= Math.floor((bounds.x + bounds.width) / CELL_SIZE); x++) {
      for (let y = Math.floor(bounds.y / CELL_SIZE); y <= Math.floor((bounds.y + bounds.height) / CELL_SIZE); y++) visit(`${x}:${y}`);
    }
  }

  query(bounds: Bounds, pinned: ReadonlySet<number> = new Set()): SceneObject[] {
    const indices = new Set<number>();
    this.cellsFor(bounds, (key) => {
      for (const index of this.cells.get(key) ?? []) {
        if (intersects(this.objects[index], bounds)) indices.add(index);
      }
    });
    if (pinned.size) this.objects.forEach((object, index) => { if (pinned.has(object.id)) indices.add(index); });
    return [...indices].sort((a, b) => a - b).map((index) => this.objects[index]);
  }
}

export function viewportBounds(camera: Camera, width: number, height: number): Bounds {
  const margin = 100 / camera.zoom;
  return {
    x: -camera.x / camera.zoom - margin,
    y: -camera.y / camera.zoom - margin,
    width: width / camera.zoom + margin * 2,
    height: height / camera.zoom + margin * 2,
  };
}

export function centeredCamera(width: number, height: number): Camera {
  return { x: width / 2 - WORLD_SIZE / 2, y: height / 2 - WORLD_SIZE / 2, zoom: 1 };
}
