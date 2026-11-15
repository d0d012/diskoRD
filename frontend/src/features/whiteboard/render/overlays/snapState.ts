import type { Rect, Runtime } from '../../contract';
import type { SnapGuide } from '../../core/snap';

interface SnapState { viewport: Rect; guides: readonly SnapGuide[]; listeners: Set<() => void> }
const states = new WeakMap<Runtime, SnapState>();
export function snapState(runtime: Runtime): SnapState {
  let state = states.get(runtime);
  if (!state) { state = { viewport: { x: 0, y: 0, w: 0, h: 0 }, guides: [], listeners: new Set() }; states.set(runtime, state); }
  return state;
}
export function setSnapGuides(runtime: Runtime, guides: readonly SnapGuide[]): void {
  const state = snapState(runtime); state.guides = guides;
  for (const listener of state.listeners) listener();
}
