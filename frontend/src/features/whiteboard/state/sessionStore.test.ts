import { describe, expect, it, vi } from 'vitest';
import { createSessionStore, DEFAULT_STYLE_DEFAULTS, filterVisibleObjects } from './sessionStore';

describe('per-board session store', () => {
  it('has contract-shaped defaults and never shares mutable state between boards', () => {
    const first = createSessionStore();
    const second = createSessionStore();
    expect(first.getState()).toEqual({
      tool: 'select', selectedIds: [], editingId: null, croppingId: null,
      styleDefaults: DEFAULT_STYLE_DEFAULTS,
    });
    first.setTool('pen');
    first.setSelectedIds(['b', 'a', 'b']);
    first.setEditingId('a');
    first.setCroppingId('b');
    expect(first.getState()).toMatchObject({ tool: 'pen', selectedIds: ['b', 'a'], editingId: 'a', croppingId: 'b' });
    expect(second.getState()).toMatchObject({ tool: 'select', selectedIds: [], editingId: null, croppingId: null });
  });

  it('normalizes selection on initialization and vanilla writes; snapshots are stable', () => {
    const store = createSessionStore({ selectedIds: ['a', 'a'] });
    const listener = vi.fn();
    store.subscribe(listener);
    const original = store.getState();
    store.setSelectedIds(['a', 'a']);
    expect(store.getState()).toBe(original);
    expect(listener).not.toHaveBeenCalled();
    store.setState(state => ({ selectedIds: [...state.selectedIds, 'b', 'b'] }));
    expect(store.getState().selectedIds).toEqual(['a', 'b']);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(store.getState().selectedIds)).toBe(true);
  });

  it('returns the original object array without filtering when no author is hidden', () => {
    const session = createSessionStore();
    const objects = Object.freeze([]);
    const isHidden = vi.spyOn(session, 'isAuthorHidden');
    expect(filterVisibleObjects(objects, session)).toBe(objects);
    expect(isHidden).not.toHaveBeenCalled();
  });

  it('publishes reset of visibility even when SessionState is already at defaults', () => {
    const session = createSessionStore();
    session.toggleHideAuthor('alice');
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    session.reset();
    expect(session.hasHiddenAuthors()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('updates complete style defaults without losing unrelated defaults, and resets', () => {
    const store = createSessionStore();
    store.setStyleDefaults({ stroke: { colour: 'blue', weight: 'thick' }, imagePixelated: true });
    expect(store.getState().styleDefaults).toEqual({
      ...DEFAULT_STYLE_DEFAULTS, stroke: { colour: 'blue', weight: 'thick' }, imagePixelated: true,
    });
    store.reset();
    expect(store.getState().styleDefaults).toEqual(DEFAULT_STYLE_DEFAULTS);
  });
});
