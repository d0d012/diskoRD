import type { Change, HistoryDirection, HistoryReport, HistorySkip, ObjectId, OpId } from '../contract';
export type { HistoryDirection, HistoryReport, HistorySkip } from '../contract';
import type { ObjectsMap, VersionMap } from './reducers';

export interface HistoryEntry {
  readonly opId: OpId;
  readonly inverse: readonly Change[];
  readonly label?: string;
  readonly acknowledgedSeq?: number;
  /** Per-id lineage advances only when our acknowledged inverse restores it. */
  readonly versions?: VersionMap;
  readonly beforeVersions?: VersionMap;
}
export interface HistoryRequest {
  readonly opId: OpId;
  readonly direction: HistoryDirection;
  readonly entry: HistoryEntry;
}

/** Filter per object, then let the server enforce atomicity on the remainder. */
export function prepareHistoryChanges(
  entry: HistoryEntry,
  objects: ObjectsMap,
  tombstones: VersionMap,
  pendingIds: ReadonlySet<ObjectId>,
  seq: number = entry.acknowledgedSeq ?? 0,
): { changes: readonly Change[]; skipped: readonly HistorySkip[] } {
  const changes: Change[] = [];
  const skipped: HistorySkip[] = [];
  for (const inverse of entry.inverse) {
    const object = objects.get(inverse.id);
    const expected = entry.versions?.get(inverse.id) ?? entry.acknowledgedSeq;
    let reason: HistorySkip['reason'] | undefined;
    if (pendingIds.has(inverse.id)) reason = 'pending';
    else if (inverse.action === 'create') {
      if (object) reason = 'changed';
      else if (expected === undefined || tombstones.get(inverse.id) !== expected) {
        reason = 'unproven-absence';
      }
    } else if (!object) reason = 'missing';
    else if (object.version !== expected) reason = 'changed';
    if (reason) skipped.push({ id: inverse.id, reason });
    else if (inverse.action === 'create') changes.push({ ...inverse, expectedVersion: 0, expectedSeq: seq });
    else changes.push({ ...inverse, expectedVersion: expected! });
  }
  return { changes, skipped };
}

/** Per-board, bounded bookkeeping. No transport, timers, or global state. */
export class BoardHistory {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private request: HistoryRequest | null = null;
  private rollbacks = new Map<OpId, { request: HistoryRequest; generation: number; ids: readonly ObjectId[] }>();
  private generation = 0;
  private report: HistoryReport | null = null;
  revision = 0;

  private readonly capacity: number;

  constructor(capacity = 100) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('History capacity must be positive');
    this.capacity = capacity;
  }

  private push(direction: HistoryDirection, entry: HistoryEntry): void {
    const stack = direction === 'undo' ? this.undoStack : this.redoStack;
    stack.push(entry);
    if (stack.length > this.capacity) stack.shift();
  }

  record(entry: HistoryEntry): void {
    // A fresh gesture supersedes an unsent history request, not an in-flight write.
    if (this.request?.direction === 'undo') this.push('undo', this.request.entry);
    this.request = null;
    this.redoStack = [];
    this.generation++;
    this.push('undo', entry);
    this.revision++;
  }

  acknowledge(opId: OpId, seq: number, beforeVersions?: VersionMap): void {
    const rollback = this.rollbacks.get(opId);
    const source = rollback?.request.entry;
    const restoredIds = new Set(rollback?.ids);
    const acknowledge = (entry: HistoryEntry): HistoryEntry => {
      if (entry.opId === opId) return {
        ...entry, acknowledgedSeq: seq,
        versions: new Map(entry.inverse.map(change => [change.id, seq])),
        beforeVersions: beforeVersions ?? entry.beforeVersions,
      };
      if (!source?.beforeVersions || entry.acknowledgedSeq === undefined) return entry;
      const versions = new Map(entry.versions ?? entry.inverse.map(change => [change.id, entry.acknowledgedSeq!]));
      for (const change of entry.inverse) {
        // Undoing our later gesture restored this exact earlier state. Advance
        // only that lineage; unrelated or remotely modified versions never move.
        if (restoredIds.has(change.id) && source.beforeVersions.get(change.id) === versions.get(change.id)) {
          versions.set(change.id, seq);
        }
      }
      return { ...entry, versions };
    };
    this.undoStack = this.undoStack.map(acknowledge);
    this.redoStack = this.redoStack.map(acknowledge);
    if (this.request) this.request = { ...this.request, entry: acknowledge(this.request.entry) };
    this.rollbacks.delete(opId);
    this.revision++;
  }

  reject(opId: OpId): void {
    this.undoStack = this.undoStack.filter(entry => entry.opId !== opId);
    this.redoStack = this.redoStack.filter(entry => entry.opId !== opId);
    if (this.request?.entry.opId === opId) this.request = null;
    const rollback = this.rollbacks.get(opId);
    if (rollback?.generation === this.generation) this.push(rollback.request.direction, rollback.request.entry);
    this.rollbacks.delete(opId);
    this.revision++;
  }

  canUndo(): boolean { return !this.request && this.undoStack.length > 0; }
  canRedo(): boolean { return !this.request && this.redoStack.length > 0; }
  getReport(): HistoryReport | null { return this.report; }

  begin(direction: HistoryDirection, opId: OpId): HistoryRequest | null {
    if (this.request) return null;
    const stack = direction === 'undo' ? this.undoStack : this.redoStack;
    const entry = stack.pop();
    if (!entry) return null;
    this.request = { direction, opId, entry };
    this.revision++;
    return this.request;
  }

  ready(): HistoryRequest | null {
    return this.request?.entry.acknowledgedSeq !== undefined ? this.request : null;
  }

  complete(request: HistoryRequest, inverse: readonly Change[], skipped: readonly HistorySkip[]): void {
    this.request = null;
    this.report = Object.freeze({
      opId: request.opId, direction: request.direction,
      skipped: Object.freeze(skipped.map(item => Object.freeze(item))),
    });
    if (inverse.length) {
      this.push(request.direction === 'undo' ? 'redo' : 'undo', {
        opId: request.opId, inverse, label: request.entry.label,
      });
      this.rollbacks.set(request.opId, { request, generation: this.generation, ids: inverse.map(change => change.id) });
      // Failed-request restoration is bounded, too.
      if (this.rollbacks.size > this.capacity) this.rollbacks.delete(this.rollbacks.keys().next().value!);
    }
    this.revision++;
  }
}
