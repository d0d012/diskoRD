import type {
  BoardObject, Change, Commit, ObjectId, ObjectPatch, PendingOperation,
} from '../contract';

export type ObjectsMap = ReadonlyMap<ObjectId, BoardObject>;
export type VersionMap = ReadonlyMap<ObjectId, number>;

/** Absolute, shallow patches; optimistic writes never invent a version. */
export function applyChange(objects: ObjectsMap, change: Change): ObjectsMap {
  const previous = objects.get(change.id);
  if (change.action === 'create') {
    if (previous) return objects;
    return new Map(objects).set(change.id, change.body);
  }
  if (!previous) return objects;
  const next = new Map(objects);
  if (change.action === 'delete') next.delete(change.id);
  else next.set(change.id, { ...previous, ...change.patch } as BoardObject);
  return next;
}

/** Capture only overwritten fields, not a full-body replacement for updates. */
export function invertChange(objects: ObjectsMap, change: Change): Change | null {
  const previous = objects.get(change.id);
  if (change.action === 'create') {
    return { id: change.id, action: 'delete', expectedVersion: 0 };
  }
  if (!previous) return null;
  if (change.action === 'delete') {
    return { id: change.id, action: 'create', expectedVersion: 0, body: { ...previous, version: 0 } };
  }
  const patch = Object.fromEntries(Object.keys(change.patch).map(key => [
    key,
    previous.kind === 'sticky' && key === 'reactions'
      ? previous.reactions ?? {}
      : previous[key as keyof BoardObject],
  ])) as ObjectPatch;
  return { id: change.id, action: 'update', expectedVersion: previous.version, patch };
}

export interface ConfirmedState {
  readonly objects: ObjectsMap;
  /** Includes live versions and deletion tombstones. */
  readonly versions: VersionMap;
}

/** Sequence ordering is the store's job; per-object ordering also guards rejects. */
export function applyServerCommit(state: ConfirmedState, commit: Commit): ConfirmedState {
  let objects = state.objects;
  let versions = state.versions;
  for (const change of commit.changes) {
    if (commit.seq <= (versions.get(change.id) ?? 0)) continue;
    const next = new Map(objects);
    if (change.action === 'delete') next.delete(change.id);
    else if (change.action === 'create') {
      next.set(change.id, { ...change.body, version: commit.seq });
    } else {
      const previous = objects.get(change.id);
      if (previous) next.set(change.id, { ...previous, ...change.patch, version: commit.seq } as BoardObject);
    }
    objects = next;
    versions = new Map(versions).set(change.id, commit.seq);
  }
  return { objects, versions };
}

/** Skip incompatible commands atomically. Never retarget an absolute patch. */
export function computeVisibleState(
  canonical: ObjectsMap,
  pending: readonly PendingOperation[],
  confirmedSeq?: number,
): ObjectsMap {
  let objects = canonical;
  const overlaid = new Set<ObjectId>();
  for (const { command, acknowledgedSeq } of pending) {
    const compatible = command.changes.every(change => {
      const object = objects.get(change.id);
      if (change.action === 'create') return !object && (
        change.expectedSeq === undefined || confirmedSeq === undefined ||
        change.expectedSeq === confirmedSeq || acknowledgedSeq !== undefined
      );
      return object !== undefined && (
        change.expectedVersion === object.version ||
        (change.expectedVersion === 0 && overlaid.has(change.id))
      );
    });
    if (!compatible) continue;
    for (const change of command.changes) {
      objects = applyChange(objects, change);
      overlaid.add(change.id);
    }
  }
  return objects;
}

export function compareObjects(a: BoardObject, b: BoardObject): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
}

/** JSON-shaped data only. Keeps external-store snapshots stable across replay. */
export function equalValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = Object.keys(a);
  const right = Object.keys(b);
  return left.length === right.length && left.every(key =>
    Object.prototype.hasOwnProperty.call(b, key) &&
    equalValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

export function reuseObjects(previous: ObjectsMap, next: ObjectsMap): ObjectsMap {
  const result = new Map(next);
  let identical = previous.size === next.size;
  for (const [id, object] of next) {
    const old = previous.get(id);
    if (equalValue(old, object)) result.set(id, old!);
    else identical = false;
  }
  return identical ? previous : result;
}

/** Own the JSON values handed to the store; consumers cannot mutate snapshots. */
export function immutableCopy<T>(value: T): T {
  const copy: T = structuredClone(value);
  function freeze(item: unknown): void {
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) return;
    Object.values(item).forEach(freeze);
    Object.freeze(item);
  }
  freeze(copy);
  return copy;
}
