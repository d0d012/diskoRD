import { LASER_DECAY_MS, MAX_LASER_POINTS } from '../../contract';
import type { Point, StrokeObject, StrokePoint } from '../../contract';
import { normalizePoints } from '../../core';
import { EMPTY_PREVIEW, clearPreview, topRanks } from '../objects';
import type { Gesture, PointerSample, ToolContext } from '../types';

interface TimedLaserPoint extends StrokePoint {
  readonly at: number;
}

function buildLaserStroke(ctx: ToolContext, id: string, rank: string, raw: readonly TimedLaserPoint[]): StrokeObject {
  const pointsInput: readonly StrokePoint[] = raw.map((point, index) => ({
    x: point.x,
    y: point.y,
    // Taper tail -> head so the laser trail narrows behind the pointer.
    pressure: raw.length <= 1 ? 0.75 : 0.15 + (0.75 * (index + 1)) / raw.length,
  }));
  const { points, bounds } = normalizePoints(pointsInput);
  return {
    id,
    kind: 'stroke',
    rank,
    version: 0,
    createdBy: ctx.userId,
    ...bounds,
    points,
    preset: 'pen',
    style: { colour: 'red', weight: 'thick' },
  };
}

/**
 * Laser pointer: streams an ephemeral decaying trail through RuntimePreview and
 * BOARD_PRESENCE (`laser` field) without ever dispatching a persisted command.
 * Stays active after pointer-up like Pen.
 */
export function createLaserGesture(ctx: ToolContext, start: PointerSample): Gesture {
  const { runtime, store } = ctx;
  const id = ctx.newId();
  const [rank] = topRanks(store, 1, false);
  const raw: TimedLaserPoint[] = [{ x: start.world.x, y: start.world.y, pressure: 0.75, at: Date.now() }];
  let done = false;

  function prune(now: number): void {
    while (raw.length > 1 && now - raw[0].at > LASER_DECAY_MS) {
      raw.shift();
    }
    while (raw.length > MAX_LASER_POINTS) {
      raw.shift();
    }
  }

  function push(sample: PointerSample, now: number): void {
    const last = raw[raw.length - 1];
    if (last && last.x === sample.world.x && last.y === sample.world.y) return;
    raw.push({ x: sample.world.x, y: sample.world.y, pressure: 0.75, at: now });
  }

  function publish(): void {
    const trail: Point[] = raw.map(point => ({ x: point.x, y: point.y }));
    runtime.setPreview({ ...EMPTY_PREVIEW, objects: [buildLaserStroke(ctx, id, rank, raw)] });
    ctx.presence?.send({ laser: trail });
  }

  const timer = setInterval(() => {
    if (done) return;
    const now = Date.now();
    const before = raw.length;
    prune(now);
    if (raw.length !== before) {
      publish();
    }
  }, 60);

  publish();

  function stop(): void {
    if (done) return;
    done = true;
    clearInterval(timer);
    ctx.presence?.send({ laser: null });
    clearPreview(runtime);
  }

  return {
    kind: 'drawing',
    move(sample, coalesced) {
      if (done) return;
      const now = Date.now();
      if (coalesced && coalesced.length > 0) for (const item of coalesced) push(item, now);
      else push(sample, now);
      prune(now);
      publish();
    },
    end: stop,
    cancel: stop,
  };
}
