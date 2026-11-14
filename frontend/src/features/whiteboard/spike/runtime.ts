import { SEED, WORLD_SIZE, centeredCamera, viewportBounds } from './scene';
import type { Camera, Options, SceneObject, SpatialGrid } from './scene';

const PHASE_MS = 5000;
const PHASES = ['A: pan', 'B: zoom', 'C: drag 30'] as const;

export function summarize(deltas: number[], mounted: number[]) {
  const sorted = [...deltas].sort((a, b) => a - b);
  const durationMs = deltas.reduce((sum, value) => sum + value, 0);
  return {
    durationMs,
    frames: deltas.length,
    avgFps: deltas.length * 1000 / durationMs,
    p95FrameMs: sorted[Math.ceil(sorted.length * 0.95) - 1],
    p99FrameMs: sorted[Math.ceil(sorted.length * 0.99) - 1],
    worstFrameMs: sorted[sorted.length - 1],
    framesOver20Ms: deltas.filter((value) => value > 20).length,
    mountedObjects: {
      min: Math.min(...mounted), max: Math.max(...mounted),
      avg: mounted.reduce((sum, value) => sum + value, 0) / mounted.length,
      end: mounted[mounted.length - 1],
    },
  };
}

type PhaseResult = ReturnType<typeof summarize> & { phase: string; draggedObjects: number };
export interface SpikeResult {
  status: 'completed' | 'aborted';
  reason?: string;
  options: Options;
  seed: number;
  userAgent: string;
  devicePixelRatio: number;
  viewport: { width: number; height: number };
  sceneBuildMs: number;
  initialMountMs: number;
  initialMountedObjects: number;
  mountTiming: string;
  phases: PhaseResult[];
}

declare global {
  interface Window { __wbSpikeResult?: SpikeResult }
}

interface RuntimeConfig {
  viewport: HTMLDivElement;
  world: HTMLDivElement;
  camera: { current: Camera };
  nodes: Map<number, HTMLDivElement>;
  objects: SceneObject[];
  grid: SpatialGrid;
  options: Options;
  initialVisible: SceneObject[];
  startedAt: number;
  sceneBuildMs: number;
  onVisible: (objects: SceneObject[]) => void;
  onStatus: (status: string, running: boolean, ready: boolean) => void;
  onResult: (result: SpikeResult | null) => void;
}

export function startRuntime(config: RuntimeConfig) {
  const { viewport, world, camera, nodes, objects, grid, options } = config;
  let width = viewport.clientWidth;
  let height = viewport.clientHeight;
  let visible = config.initialVisible;
  let dirty = true;
  let disposed = false;
  let ready = false;
  let raf = 0;
  let autoTimer = 0;
  let lastMovement = -Infinity;
  let promoted = false;
  let initialMountMs = 0;
  let initialMountedObjects = 0;
  let pointer: { id: number; x: number; y: number } | null = null;
  let benchmark: {
    phase: number; warmup: number; start: number; previous: number;
    deltas: number[]; mounted: number[]; results: PhaseResult[];
    dragged: SceneObject[];
  } | null = null;
  const pinned = new Set<number>();

  function center(x: number, y: number, zoom: number) {
    Object.assign(camera.current, { x: width / 2 - x * zoom, y: height / 2 - y * zoom, zoom });
    dirty = true;
  }

  function restoreDrag() {
    for (const object of benchmark?.dragged ?? []) {
      const node = nodes.get(object.id);
      if (node) node.style.transform = `translate(${object.x}px, ${object.y}px)`;
    }
    pinned.clear();
    dirty = true;
  }

  function finish(reason?: string) {
    if (!benchmark) return;
    const result: SpikeResult = {
      status: reason ? 'aborted' : 'completed',
      ...(reason ? { reason } : {}),
      options, seed: SEED, userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width, height },
      sceneBuildMs: config.sceneBuildMs, initialMountMs, initialMountedObjects,
      mountTiming: 'Module start through scene generation, initial React commit, initial image decode and two rAFs; not navigation/network time.',
      phases: benchmark.results,
    };
    restoreDrag();
    benchmark = null;
    window.__wbSpikeResult = result;
    config.onResult(result);
    config.onStatus(reason ? `Aborted: ${reason}` : 'Complete', false, true);
  }

  function preparePhase() {
    if (!benchmark) return;
    benchmark.warmup = 2; // Let the culling commit mount objects before establishing the baseline.
    benchmark.start = 0;
    benchmark.deltas = [];
    benchmark.mounted = [];
    if (benchmark.phase === 0) center(1000, WORLD_SIZE / 2, 1);
    if (benchmark.phase === 1) center(WORLD_SIZE / 2, WORLD_SIZE / 2, 0.25);
    if (benchmark.phase === 2) {
      benchmark.dragged = [...objects].sort((a, b) => {
        const distance = (object: SceneObject) => Math.hypot(object.x + object.width / 2 - WORLD_SIZE / 2, object.y + object.height / 2 - WORLD_SIZE / 2);
        return distance(a) - distance(b) || a.id - b.id;
      }).slice(0, 30);
      const group = benchmark.dragged;
      if (group.length) {
        const left = Math.min(...group.map((object) => object.x));
        const top = Math.min(...group.map((object) => object.y));
        const right = Math.max(...group.map((object) => object.x + object.width));
        const bottom = Math.max(...group.map((object) => object.y + object.height));
        // Fit the actual group plus its full drag excursion. Pin it just as a real drag would.
        center((left + right) / 2, (top + bottom) / 2, Math.min(2, width / (right - left + 500), height / (bottom - top + 350)));
        group.forEach((object) => pinned.add(object.id));
      }
    }
    config.onStatus(PHASES[benchmark.phase], true, true);
  }

  function start() {
    if (!ready || benchmark || document.hidden) return;
    window.clearTimeout(autoTimer);
    pointer = null;
    delete window.__wbSpikeResult;
    config.onResult(null);
    benchmark = { phase: 0, warmup: 2, start: 0, previous: 0, deltas: [], mounted: [], results: [], dragged: [] };
    preparePhase();
  }

  function animateBenchmark(now: number) {
    if (!benchmark) return;
    if (benchmark.warmup > 0) {
      benchmark.warmup--;
      benchmark.start = now;
      benchmark.previous = now;
      return;
    }
    const elapsed = now - benchmark.start;
    benchmark.deltas.push(now - benchmark.previous);
    benchmark.mounted.push(nodes.size);
    benchmark.previous = now;
    const t = Math.min(1, elapsed / PHASE_MS);
    if (benchmark.phase === 0) center(1000 + t * 8000, WORLD_SIZE / 2 + Math.sin(t * Math.PI * 2) * 2000, 1);
    if (benchmark.phase === 1) {
      // One full 25% -> 200% -> 25% cycle, fixed world point under viewport centre.
      center(WORLD_SIZE / 2, WORLD_SIZE / 2, 0.25 + 1.75 * (1 - Math.cos(t * Math.PI * 2)) / 2);
    }
    if (benchmark.phase === 2) {
      const dx = Math.sin(t * Math.PI * 4) * 200;
      const dy = Math.sin(t * Math.PI * 2) * 125;
      for (const object of benchmark.dragged) {
        const node = nodes.get(object.id);
        if (node) node.style.transform = `translate(${object.x + dx}px, ${object.y + dy}px)`;
      }
    }
    lastMovement = now;
    if (elapsed >= PHASE_MS) {
      benchmark.results.push({
        phase: PHASES[benchmark.phase],
        ...summarize(benchmark.deltas, benchmark.mounted),
        draggedObjects: benchmark.phase === 2 ? benchmark.dragged.length : 0,
      });
      benchmark.phase++;
      if (benchmark.phase === PHASES.length) finish();
      else preparePhase();
    }
  }

  function frame(now: number) {
    if (disposed) return;
    animateBenchmark(now);
    const moving = options.willchange && (benchmark !== null || now - lastMovement < 180);
    if (moving !== promoted) {
      world.style.willChange = moving ? 'transform' : '';
      promoted = moving;
    }
    if (dirty) {
      const { x, y, zoom } = camera.current;
      world.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
      viewport.style.backgroundSize = `${32 * zoom}px ${32 * zoom}px`;
      viewport.style.backgroundPosition = `${x}px ${y}px`;
      if (options.cull) {
        const next = grid.query(viewportBounds(camera.current, width, height), pinned);
        if (next.length !== visible.length || next.some((object, index) => object !== visible[index])) {
          visible = next;
          config.onVisible(next); // The only camera-driven React update; once per rAF at most.
        }
      }
      dirty = false;
    }
    raf = requestAnimationFrame(frame);
  }

  function wheel(event: WheelEvent) {
    event.preventDefault();
    if (benchmark) return;
    const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
    const dx = event.deltaX * multiplier;
    const dy = event.deltaY * multiplier;
    const current = camera.current;
    if (event.ctrlKey || event.metaKey) {
      const rect = viewport.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const zoom = Math.max(0.1, Math.min(4, current.zoom * Math.exp(-dy * 0.002)));
      const ratio = zoom / current.zoom;
      current.x = x - (x - current.x) * ratio;
      current.y = y - (y - current.y) * ratio;
      current.zoom = zoom;
    } else {
      current.x -= dx;
      current.y -= dy;
    }
    dirty = true;
    lastMovement = performance.now();
  }

  function pointerDown(event: PointerEvent) {
    if (benchmark || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault();
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    viewport.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent) {
    if (!pointer || pointer.id !== event.pointerId) return;
    camera.current.x += event.clientX - pointer.x;
    camera.current.y += event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    dirty = true;
    lastMovement = performance.now();
  }
  function pointerUp(event: PointerEvent) {
    if (pointer?.id !== event.pointerId) return;
    pointer = null;
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  }
  function preventGesture(event: Event) { event.preventDefault(); }
  function visibilityChanged() { if (document.hidden) finish('Tab hidden; rerun in the foreground.'); }
  function resize() {
    finish('Viewport resized; rerun at a fixed size.');
    width = viewport.clientWidth;
    height = viewport.clientHeight;
    dirty = true;
  }

  viewport.addEventListener('wheel', wheel, { passive: false });
  viewport.addEventListener('pointerdown', pointerDown);
  viewport.addEventListener('pointermove', pointerMove);
  viewport.addEventListener('pointerup', pointerUp);
  viewport.addEventListener('pointercancel', pointerUp);
  viewport.addEventListener('lostpointercapture', pointerUp);
  viewport.addEventListener('gesturestart', preventGesture, { passive: false });
  viewport.addEventListener('gesturechange', preventGesture, { passive: false });
  document.addEventListener('visibilitychange', visibilityChanged);
  window.addEventListener('resize', resize);
  raf = requestAnimationFrame(frame);

  // Decode only initially mounted images: later culling mounts/decode remain part of the workload.
  void Promise.all([...world.querySelectorAll('img')].map((image) => image.decode().catch(() => undefined))).then(() => {
    if (disposed) return;
    requestAnimationFrame(() => {
      if (disposed) return;
      requestAnimationFrame(() => {
        if (disposed) return;
        initialMountMs = performance.now() - config.startedAt;
        initialMountedObjects = nodes.size;
        ready = true;
        config.onStatus(`Ready — initial mount ${initialMountMs.toFixed(1)} ms (${initialMountedObjects} objects)`, false, true);
        if (options.auto) autoTimer = window.setTimeout(start, 600);
      });
    });
  });

  return {
    start,
    reset() {
      if (benchmark) return;
      Object.assign(camera.current, centeredCamera(width, height));
      dirty = true;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(autoTimer);
      viewport.removeEventListener('wheel', wheel);
      viewport.removeEventListener('pointerdown', pointerDown);
      viewport.removeEventListener('pointermove', pointerMove);
      viewport.removeEventListener('pointerup', pointerUp);
      viewport.removeEventListener('pointercancel', pointerUp);
      viewport.removeEventListener('lostpointercapture', pointerUp);
      viewport.removeEventListener('gesturestart', preventGesture);
      viewport.removeEventListener('gesturechange', preventGesture);
      document.removeEventListener('visibilitychange', visibilityChanged);
      window.removeEventListener('resize', resize);
    },
  };
}
