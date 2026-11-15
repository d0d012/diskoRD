import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import type { BoardObject, ObjectId, SessionState, StyleDefaults, ToolId, UserId } from '../contract';
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

export interface AuthorVisibilityState {
  readonly hiddenAuthors: readonly UserId[];
  readonly soloAuthor: UserId | null;
}

const DEFAULT_VISIBILITY_STATE: AuthorVisibilityState = Object.freeze({
  hiddenAuthors: Object.freeze([]),
  soloAuthor: null,
});

export interface SessionStore extends StoreApi<SessionState> {
  setTool(tool: ToolId): void;
  setSelectedIds(ids: readonly ObjectId[]): void;
  setEditingId(id: ObjectId | null): void;
  setCroppingId(id: ObjectId | null): void;
  /** Nested styles are complete replacements, just as in object patches. */
  setStyleDefaults(defaults: Partial<StyleDefaults>): void;
  getVisibilityState(): AuthorVisibilityState;
  getHiddenAuthors(): readonly UserId[];
  getSoloAuthor(): UserId | null;
  isAuthorHidden(authorId: UserId): boolean;
  hasHiddenAuthors(): boolean;
  toggleHideAuthor(authorId: UserId): void;
  toggleSoloAuthor(authorId: UserId): void;
  showAllAuthors(): void;
  reset(): void;
}

export function isObjectVisible(object: BoardObject, session?: Partial<Pick<SessionStore, 'isAuthorHidden'>>): boolean {
  if (!session?.isAuthorHidden) return true;
  return !session.isAuthorHidden(object.createdBy);
}

export function filterVisibleObjects<T extends BoardObject>(
  objects: readonly T[],
  session?: Partial<Pick<SessionStore, 'isAuthorHidden' | 'hasHiddenAuthors'>>,
): readonly T[] {
  if (!session?.isAuthorHidden || session.hasHiddenAuthors?.() === false) return objects;
  return objects.filter(object => !session.isAuthorHidden!(object.createdBy));
}

/** Each call creates independent, local-only session state. */
export function createSessionStore(initial: Partial<SessionState> = {}): SessionStore {
  const defaults: SessionState = immutableCopy({
    tool: 'select', selectedIds: [], editingId: null, croppingId: null,
    styleDefaults: DEFAULT_STYLE_DEFAULTS,
    ...initial,
    ...(initial.selectedIds ? { selectedIds: [...new Set(initial.selectedIds)] } : {}),
  });
  let visibility: AuthorVisibilityState = DEFAULT_VISIBILITY_STATE;
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
  function updateVisibility(hiddenAuthors: readonly UserId[], soloAuthor: UserId | null): void {
    visibility = Object.freeze({
      hiddenAuthors: Object.freeze([...hiddenAuthors]),
      soloAuthor,
    });
    rawSet({ ...store.getState() }, true);
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
    getVisibilityState(): AuthorVisibilityState { return visibility; },
    getHiddenAuthors(): readonly UserId[] { return visibility.hiddenAuthors; },
    getSoloAuthor(): UserId | null { return visibility.soloAuthor; },
    isAuthorHidden(authorId: UserId): boolean {
      if (visibility.soloAuthor !== null) return authorId !== visibility.soloAuthor;
      return visibility.hiddenAuthors.includes(authorId);
    },
    hasHiddenAuthors(): boolean {
      return visibility.soloAuthor !== null || visibility.hiddenAuthors.length > 0;
    },
    toggleHideAuthor(authorId: UserId): void {
      const { hiddenAuthors, soloAuthor } = visibility;
      if (soloAuthor === authorId) {
        const nextHidden = hiddenAuthors.includes(authorId) ? hiddenAuthors : [...hiddenAuthors, authorId];
        updateVisibility(nextHidden, null);
        return;
      }
      const nextHidden = hiddenAuthors.includes(authorId)
        ? hiddenAuthors.filter(id => id !== authorId)
        : [...hiddenAuthors, authorId];
      updateVisibility(nextHidden, soloAuthor);
    },
    toggleSoloAuthor(authorId: UserId): void {
      const { hiddenAuthors, soloAuthor } = visibility;
      if (soloAuthor === authorId) {
        updateVisibility(hiddenAuthors, null);
        return;
      }
      const nextHidden = hiddenAuthors.includes(authorId)
        ? hiddenAuthors.filter(id => id !== authorId)
        : hiddenAuthors;
      updateVisibility(nextHidden, authorId);
    },
    showAllAuthors(): void {
      if (visibility.soloAuthor === null && visibility.hiddenAuthors.length === 0) return;
      visibility = DEFAULT_VISIBILITY_STATE;
      rawSet({ ...store.getState() }, true);
    },
    reset(): void {
      const hadHidden = visibility !== DEFAULT_VISIBILITY_STATE;
      visibility = DEFAULT_VISIBILITY_STATE;
      const previous = store.getState();
      setState(defaults, true);
      // Visibility lives outside SessionState; even a session already at its
      // defaults must publish when resetting a hide/solo filter.
      if (hadHidden && store.getState() === previous) rawSet({ ...previous }, true);
    },
  });
}
