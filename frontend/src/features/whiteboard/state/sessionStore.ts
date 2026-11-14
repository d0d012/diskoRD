import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import type { ObjectId, SessionState, StyleDefaults, ToolId } from '../contract';
import { equalValue, immutableCopy } from './reducers';

export const DEFAULT_STYLE_DEFAULTS: StyleDefaults = immutableCopy({
  stroke: { colour: 'ink', weight: 'thin' },
  strokePreset: 'pen',
  shape: { colour: 'ink', weight: 'thin', fill: 'none' },
  text: { colour: 'ink', size: 'M', font: 'app', bold: false, italic: false, align: 'left' },
  sticky: { tone: 'yellow', font: 'handwriting' },
  frame: { colour: 'gray', weight: 'thin' },
  imagePixelated: false,
});

export interface SessionStore extends StoreApi<SessionState> {
  setTool(tool: ToolId): void;
  setSelectedIds(ids: readonly ObjectId[]): void;
  setEditingId(id: ObjectId | null): void;
  setCroppingId(id: ObjectId | null): void;
  /** Nested styles are complete replacements, just as in object patches. */
  setStyleDefaults(defaults: Partial<StyleDefaults>): void;
  reset(): void;
}

/** Each call creates independent, local-only session state. */
export function createSessionStore(initial: Partial<SessionState> = {}): SessionStore {
  const defaults: SessionState = immutableCopy({
    tool: 'select', selectedIds: [], editingId: null, croppingId: null,
    styleDefaults: DEFAULT_STYLE_DEFAULTS,
    ...initial,
    ...(initial.selectedIds ? { selectedIds: [...new Set(initial.selectedIds)] } : {}),
  });
  const store = createStore<SessionState>(() => defaults);
  // Normalize even direct vanilla setState calls, so the boundary always has
  // unique selection ids and owned immutable JSON values.
  const rawSet = store.setState;
  function setState(
    next: SessionState | Partial<SessionState> | ((state: SessionState) => SessionState | Partial<SessionState>),
    replace?: boolean,
  ): void {
    const previous = store.getState();
    const update = typeof next === 'function' ? next(previous) : next;
    const candidate = replace ? update as SessionState : { ...previous, ...update };
    const normalized = { ...candidate, selectedIds: [...new Set(candidate.selectedIds)] };
    if (equalValue(previous, normalized)) return;
    rawSet(immutableCopy(normalized), true);
  }
  store.setState = setState;
  return Object.assign(store, {
    setTool(tool: ToolId): void { setState({ tool }); },
    setSelectedIds(selectedIds: readonly ObjectId[]): void { setState({ selectedIds }); },
    setEditingId(editingId: ObjectId | null): void { setState({ editingId }); },
    setCroppingId(croppingId: ObjectId | null): void { setState({ croppingId }); },
    setStyleDefaults(styleDefaults: Partial<StyleDefaults>): void {
      setState({ styleDefaults: { ...store.getState().styleDefaults, ...styleDefaults } });
    },
    reset(): void { setState(defaults, true); },
  });
}
