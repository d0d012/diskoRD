import { MAX_OBJECT_BODY_BYTES } from '../../contract';
import type { StrokeObject, StrokePoint } from '../../contract';
import { enforceStrokeLimits, normalizePoints } from '../../core';
import { EMPTY_PREVIEW, clearPreview, createChange, safeDispatch, topRanks } from '../objects';
import type { Gesture, PointerSample, ToolContext } from '../types';

/**
 * Decision: raw samples are capped so a runaway gesture cannot grow memory
 * without bound; simplification on finish brings it under MAX_STROKE_POINTS.
 */
export const MAX_RAW_STROKE_SAMPLES = 20_000;

function samplePoint(sample: PointerSample): StrokePoint {
  return { x: sample.world.x, y: sample.world.y, pressure: sample.pressure };
}

export function buildStroke(ctx: ToolContext, id: string, rank: string, raw: readonly StrokePoint[]): StrokeObject {
  const { points, bounds } = normalizePoints(raw);
  const defaults = ctx.session.getState().styleDefaults;
  return {
    id, kind: 'stroke', rank, version: 0, createdBy: ctx.userId, ...bounds, points,
    preset: defaults.strokePreset, style: defaults.stroke,
  };
}

function byteLength(object: StrokeObject): number {
  return new TextEncoder().encode(JSON.stringify(object)).byteLength;
}

/**
 * Pen: collect world samples (with coalesced events), preview the live
 * stroke, and on finish simplify within the point and byte limits and
 * dispatch one create. Pen stays the active tool; selection is untouched.
 */
export function createPenGesture(ctx: ToolContext, start: PointerSample): Gesture {
  const { runtime, store } = ctx;
  const id = ctx.newId();
  const [rank] = topRanks(store, 1, false);
  const raw: StrokePoint[] = [samplePoint(start)];
  let done = false;

  function push(sample: PointerSample): void {
    if (raw.length >= MAX_RAW_STROKE_SAMPLES) return;
    const point = samplePoint(sample);
    const last = raw[raw.length - 1];
    if (last.x === point.x && last.y === point.y) return;
    raw.push(point);
  }

  return {
    kind: 'drawing',
    move(sample, coalesced) {
      if (done) return;
      if (coalesced && coalesced.length > 0) for (const item of coalesced) push(item);
      else push(sample);
      runtime.setPreview({ ...EMPTY_PREVIEW, objects: [buildStroke(ctx, id, rank, raw)] });
    },
    end(sample) {
      if (done) return;
      done = true;
      push(sample);
      const stroke = enforceStrokeLimits(buildStroke(ctx, id, rank, raw));
      if (stroke.points.length > 0 && byteLength(stroke) <= MAX_OBJECT_BODY_BYTES) {
        safeDispatch(store, [createChange(stroke)], 'Draw', ctx.notify);
      }
      clearPreview(runtime);
    },
    cancel() {
      if (done) return;
      done = true;
      clearPreview(runtime);
    },
  };
}
