import { createStore } from 'zustand/vanilla';
import { MAX_CHANGES_PER_COMMAND, OP_IDEMPOTENCY_TTL_MS } from '../contract';
import type {
  BoardId, BoardObject, BoardStore, Change, CommandResult, Commit,
  DispatchOptions, ObjectId, OpId, PendingOperation, Reject, SequenceGap, Snapshot, UserId,
} from '../contract';
import { BoardHistory, prepareHistoryChanges } from './history';
import type { HistoryDirection } from './history';
import {
  applyServerCommit, compareObjects, computeVisibleState, equalValue,
  immutableCopy, invertChange, reuseObjects,
} from './reducers';
import type { ConfirmedState, ObjectsMap, VersionMap } from './reducers';

/** Compatibility names: revision 2 promotes the full API into contract/. */
export type { SequenceGap } from '../contract';
export type ManagedBoardStore = BoardStore;

export interface BoardStoreOptions {
  readonly boardId: BoardId;
  readonly userId: UserId;
  readonly historyLimit?: number;
  readonly createOpId?: () => OpId;
  readonly now?: () => number;
}

interface StoreView {
  readonly objects: ObjectsMap;
  readonly ordered: readonly BoardObject[];
  readonly ids: readonly ObjectId[];
  readonly pending: readonly PendingOperation[];
  readonly historyRevision: number;
  readonly gap: SequenceGap | null;
}

export function createBoardStore(options: BoardStoreOptions): ManagedBoardStore {
  const { boardId, userId } = options;
  const newId = options.createOpId ?? (() => crypto.randomUUID());
  const now = options.now ?? Date.now;
  const history = new BoardHistory(options.historyLimit);
  let confirmed: ConfirmedState = { objects: new Map(), versions: new Map() };
  // Only actual ordered deletes prove that undoing a deletion is safe.
  let tombstones = new Map<ObjectId, number>();
  let lastSeq = 0;
  let snapshotSeq = 0;
  let rejectionSeq = 0;
  let pending: readonly PendingOperation[] = Object.freeze([]);
  const buffered = new Map<number, Commit>();
  const dependencies = new Map<OpId, Map<ObjectId, OpId>>();
  const submissionTimes = new Map<OpId, { first: number; latest: number }>();
  const view = createStore<StoreView>(() => ({
    objects: new Map(), ordered: Object.freeze([]), ids: Object.freeze([]),
    pending, historyRevision: 0, gap: null,
  }));

  function setPending(next: readonly PendingOperation[]): void {
    const normalized = next.map((operation, index) => {
      const previous = pending[index];
      return previous?.command === operation.command && previous.status === operation.status &&
        previous.attempts === operation.attempts && previous.acknowledgedSeq === operation.acknowledgedSeq
        ? previous : Object.freeze(operation);
    });
    if (normalized.length === pending.length && normalized.every((operation, index) => operation === pending[index])) return;
    pending = Object.freeze(normalized);
  }

  function findPending(opId: OpId): PendingOperation | undefined {
    return pending.find(operation => operation.command.opId === opId);
  }

  function publish(): void {
    const previous = view.getState();
    const objects = reuseObjects(previous.objects, computeVisibleState(confirmed.objects, pending, lastSeq));
    for (const object of objects.values()) Object.freeze(object);
    const sorted = objects === previous.objects ? previous.ordered : [...objects.values()].sort(compareObjects);
    const ordered = sorted.length === previous.ordered.length && sorted.every((object, i) => object === previous.ordered[i])
      ? previous.ordered : Object.freeze(sorted);
    const nextIds = ordered.map(object => object.id);
    const ids = equalValue(nextIds, previous.ids) ? previous.ids : Object.freeze(nextIds);
    const evidence = [...buffered.keys(), ...(rejectionSeq > lastSeq ? [rejectionSeq] : [])];
    const receivedSeq = evidence.length ? Math.min(...evidence) : undefined;
    const nextGap = receivedSeq !== undefined && receivedSeq > lastSeq
      ? { expectedSeq: lastSeq + 1, receivedSeq } : null;
    const gap = equalValue(nextGap, previous.gap) ? previous.gap : nextGap && Object.freeze(nextGap);
    view.setState({ objects, ordered, ids, pending, historyRevision: history.revision, gap });
  }

  function subscribe<T>(select: (state: StoreView) => T, listener: () => void): () => void {
    return view.subscribe((state, previous) => {
      if (select(state) !== select(previous)) listener();
    });
  }

  function validateChanges(changes: readonly Change[], visible: ObjectsMap): void {
    if (!changes.length || changes.length > MAX_CHANGES_PER_COMMAND) throw new Error('Invalid change count');
    const ids = new Set<ObjectId>();
    for (const change of changes) {
      if (ids.has(change.id)) throw new Error('Only one change per object is allowed');
      ids.add(change.id);
      const object = visible.get(change.id);
      if (change.action === 'create') {
        if (object || change.expectedVersion !== 0 || change.body.id !== change.id || change.body.version !== 0 ||
          (change.expectedSeq !== undefined && (!Number.isSafeInteger(change.expectedSeq) || change.expectedSeq < 0))) {
          throw new Error('Invalid create');
        }
      } else {
        if (!object || !Number.isSafeInteger(change.expectedVersion) || change.expectedVersion < 0 ||
          change.expectedVersion !== object.version) throw new Error('Invalid expectedVersion');
        if (change.action === 'update') {
          if (!Object.keys(change.patch).length) throw new Error('Empty patch');
          for (const [key, value] of Object.entries(change.patch)) {
            const isStickyReactions = object.kind === 'sticky' && key === 'reactions';
            if (['id', 'kind', 'version', 'createdBy'].includes(key) ||
              (!Object.prototype.hasOwnProperty.call(object, key) && !isStickyReactions) ||
              value === undefined || value === null) {
              throw new Error('Invalid patch');
            }
            if (isStickyReactions) {
              if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid patch value');
              const entries = Object.entries(value as Record<string, unknown>);
              if (entries.length > 16) throw new Error('Invalid patch value');
              for (const [emoji, users] of entries) {
                if (typeof emoji !== 'string' || emoji !== emoji.trim() || emoji.length === 0 || [...emoji].length > 16 || /[\0\r\n\t]/.test(emoji)) {
                  throw new Error('Invalid patch value');
                }
                if (!Array.isArray(users) || users.length < 1 || users.length > 100) {
                  throw new Error('Invalid patch value');
                }
                const seen = new Set<string>();
                for (const u of users) {
                  if (typeof u !== 'string' || seen.has(u)) throw new Error('Invalid patch value');
                  seen.add(u);
                }
              }
              continue;
            }
            // Shallow replacement requires a COMPLETE nested value. Runtime
            // callers (JSON/clipboard) do not get TypeScript's structural checks.
            const previous = (object as unknown as Record<string, unknown>)[key];
            function checkShape(before: unknown, after: unknown): void {
              if (after === null || after === undefined || typeof before !== typeof after) throw new Error('Invalid patch value');
              if (Array.isArray(before)) {
                if (!Array.isArray(after)) throw new Error('Invalid patch array');
                for (const item of after) checkShape(before[0] ?? { x: 0, y: 0, pressure: 0 }, item);
              } else if (typeof before === 'object' && before !== null) {
                const oldFields = before as Record<string, unknown>;
                const newFields = after as Record<string, unknown>;
                if (!equalValue(Object.keys(oldFields).sort(), Object.keys(newFields).sort())) throw new Error('Incomplete nested patch');
                for (const field of Object.keys(oldFields)) checkShape(oldFields[field], newFields[field]);
              }
            }
            checkShape(previous, value);
          }
        }
      }
    }
  }

  function enqueue(changes: readonly Change[], opts: DispatchOptions, opId: OpId): readonly Change[] {
    const visible = computeVisibleState(confirmed.objects, pending, lastSeq);
    const owned = immutableCopy(changes.map(change => change.action === 'create'
      ? { ...change, body: { ...change.body, createdBy: userId } } : change));
    validateChanges(owned, visible);
    if (findPending(opId)) throw new Error('Duplicate local opId');
    const inverse = immutableCopy(owned.flatMap(change => {
      const result = invertChange(visible, change);
      return result ? [result] : [];
    }));
    const waits = new Map<ObjectId, OpId>();
    const queued = owned.map(change => {
      const predecessor = [...pending].reverse().find(operation =>
        operation.command.changes.some(item => item.id === change.id),
      );
      if (!predecessor) return change;
      waits.set(change.id, predecessor.command.opId);
      return change.action === 'create' ? change : { ...change, expectedVersion: 0 };
    });
    dependencies.set(opId, waits);
    setPending([...pending, {
      command: immutableCopy({ opId, changes: queued }), status: 'queued', attempts: 0,
    }]);
    if (opts.recordHistory !== false) history.record({ opId, inverse, label: opts.label });
    return inverse;
  }

  function finish(opId: OpId, seq: number, beforeVersions?: VersionMap): void {
    const completed = findPending(opId);
    if (!completed) return;
    const before = new Map<ObjectId, number>();
    for (const change of completed.command.changes) {
      const version = change.action === 'create' ? beforeVersions?.get(change.id) : change.expectedVersion;
      if (version !== undefined) before.set(change.id, version);
    }
    setPending(pending.filter(operation => operation.command.opId !== opId));
    dependencies.delete(opId);
    submissionTimes.delete(opId);
    history.acknowledge(opId, seq, before);
    setPending(pending.map(operation => {
      const waits = dependencies.get(operation.command.opId);
      if (!waits || ![...waits.values()].includes(opId)) return operation;
      // A dependent operation cannot have been submitted before its predecessor.
      const changes = operation.command.changes.map(change => {
        if (waits.get(change.id) !== opId) return change;
        waits.delete(change.id);
        return change.action === 'create' ? change : { ...change, expectedVersion: seq };
      });
      return { ...operation, command: immutableCopy({ ...operation.command, changes }) };
    }));
  }

  function cancel(opId: OpId): void {
    const cancelled = new Set([opId]);
    for (const operation of pending) {
      const waits = dependencies.get(operation.command.opId);
      if (waits && [...waits.values()].some(id => cancelled.has(id))) cancelled.add(operation.command.opId);
    }
    setPending(pending.filter(operation => !cancelled.has(operation.command.opId)));
    for (const id of cancelled) {
      dependencies.delete(id);
      submissionTimes.delete(id);
      history.reject(id);
    }
  }

  function integrate(commit: Commit): void {
    const beforeVersions = confirmed.versions;
    for (const change of commit.changes) {
      if (commit.seq <= (confirmed.versions.get(change.id) ?? 0)) continue;
      if (change.action === 'delete') tombstones.set(change.id, commit.seq);
      else tombstones.delete(change.id);
    }
    confirmed = applyServerCommit(confirmed, commit);
    lastSeq = commit.seq;
    finish(commit.opId, commit.seq, beforeVersions);
  }

  function drain(): void {
    let commit = buffered.get(lastSeq + 1);
    while (commit) {
      buffered.delete(commit.seq);
      integrate(commit);
      commit = buffered.get(lastSeq + 1);
    }
  }

  function processHistory(): boolean {
    const request = history.ready();
    if (!request) return false;
    const pendingIds = new Set(pending.flatMap(operation => operation.command.changes.map(change => change.id)));
    const { changes, skipped } = prepareHistoryChanges(request.entry, confirmed.objects, tombstones, pendingIds, lastSeq);
    const inverse = changes.length ? enqueue(changes, { recordHistory: false }, request.opId) : [];
    history.complete(request, inverse, skipped);
    return changes.length > 0;
  }

  function receive(commit: Commit): void {
    if (commit.channelId !== boardId) return;
    if (commit.seq <= lastSeq) {
      finish(commit.opId, commit.seq);
    } else {
      const operation = findPending(commit.opId);
      if (operation) setPending(pending.map(item => item === operation
        ? { ...item, status: 'acknowledged', acknowledgedSeq: commit.seq } : item));
      if (commit.seq === lastSeq + 1) {
        integrate(commit);
        drain();
      } else if (!buffered.has(commit.seq)) buffered.set(commit.seq, commit);
    }
    processHistory();
    publish();
  }

  function requestHistory(direction: HistoryDirection): OpId | null {
    const opId = newId();
    const request = history.begin(direction, opId);
    if (!request) return null;
    const waiting = request.entry.acknowledgedSeq === undefined;
    const sent = processHistory();
    publish();
    return waiting || sent ? opId : null;
  }

  function canSend(opId: OpId): boolean {
    const operation = findPending(opId);
    if (!operation || operation.status === 'acknowledged' || operation.attempts === 2 ||
      dependencies.get(opId)?.size) return false;
    const timestamp = submissionTimes.get(opId);
    if (timestamp && now() - timestamp.first >= OP_IDEMPOTENCY_TTL_MS) return false;
    return operation.command.changes.every(change => change.action === 'create' || change.expectedVersion > 0);
  }

  return {
    hydrate(snapshot: Snapshot): void {
      if (snapshot.seq < Math.max(lastSeq, rejectionSeq)) return; // Never rewind newer evidence.
      snapshotSeq = snapshot.seq;
      const owned = immutableCopy(snapshot);
      confirmed = {
        objects: new Map(owned.objects.map(object => [object.id, object])),
        versions: new Map(owned.objects.map(object => [object.id, object.version])),
      };
      tombstones = new Map(); // Snapshots contain no evidence of the last deletion.
      lastSeq = owned.seq;
      for (const operation of [...pending]) {
        if (operation.acknowledgedSeq !== undefined && operation.acknowledgedSeq <= lastSeq) {
          finish(operation.command.opId, operation.acknowledgedSeq);
        }
      }
      for (const [seq, commit] of buffered) {
        if (seq <= lastSeq) {
          finish(commit.opId, seq);
          buffered.delete(seq);
        }
      }
      drain();
      // Drop unsent work targeting vanished objects. Sent unknown outcomes retain
      // their exact command for idempotent resolution, but have no invalid overlay.
      let visible = confirmed.objects;
      for (const operation of [...pending]) {
        if (operation.attempts === 0 && operation.status !== 'acknowledged' && operation.command.changes.some(change =>
          change.action !== 'create' && !visible.has(change.id),
        )) {
          cancel(operation.command.opId);
          continue;
        }
        if (!findPending(operation.command.opId)) continue;
        visible = computeVisibleState(confirmed.objects, pending.slice(0, pending.indexOf(operation) + 1), lastSeq);
      }
      processHistory();
      publish();
    },
    getSeq: () => lastSeq,
    getBoardId: () => boardId,
    getUserId: () => userId,
    dispatch(changes, opts = {}): OpId {
      const opId = newId();
      enqueue(changes, opts, opId);
      publish();
      return opId;
    },
    applyCommit(commit): void { receive(immutableCopy(commit)); },
    acknowledge(opId: OpId, result: CommandResult): void {
      const operation = findPending(opId);
      if (!operation) return;
      if (result.changes.length !== operation.command.changes.length || operation.command.changes.some(change =>
        !result.changes.some(item => item.id === change.id && item.action === change.action && item.version === result.seq),
      )) throw new Error('Acknowledgement does not match submitted command');
      const commit: Commit = {
        channelId: boardId, userId, opId, seq: result.seq,
        changes: operation.command.changes.map(change => {
          if (change.action === 'create') return {
            id: change.id, action: 'create', version: result.seq, body: { ...change.body, version: result.seq },
          };
          if (change.action === 'update') return { id: change.id, action: 'update', version: result.seq, patch: change.patch };
          return { id: change.id, action: 'delete', version: result.seq };
        }),
      };
      receive(immutableCopy(commit));
    },
    applyReject(reject: Reject): void {
      const operation = findPending(reject.opId);
      if (!operation || operation.status === 'acknowledged') return;
      const objects = new Map(confirmed.objects);
      const versions = new Map(confirmed.versions);
      const isConflict = reject.code === 'conflict' || reject.code === 'gone';
      const current = new Map(immutableCopy(reject.current).map(object => [object.id, object]));
      if (isConflict) rejectionSeq = Math.max(rejectionSeq, reject.seq);
      for (const change of operation.command.changes) {
        if (!isConflict || reject.seq < snapshotSeq) continue;
        const object = current.get(change.id);
        const knownVersion = versions.get(change.id) ?? 0;
        if (object && (object.version > knownVersion ||
          (object.version === knownVersion && objects.has(change.id)))) {
          objects.set(change.id, object);
          versions.set(change.id, object.version);
          tombstones.delete(change.id);
        } else if (!object && knownVersion <= reject.seq) {
          objects.delete(change.id);
          // Evidence of absence at this seq, NOT proof of the actual deletion seq.
          versions.set(change.id, reject.seq);
          tombstones.delete(change.id);
        }
      }
      confirmed = { objects, versions };
      cancel(reject.opId);
      processHistory();
      publish();
    },
    undo: () => requestHistory('undo'),
    redo: () => requestHistory('redo'),
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    getObject: id => view.getState().objects.get(id),
    getObjectsInRank: () => view.getState().ordered,
    getObjectIds: () => view.getState().ids,
    subscribeObject: (id, listener) => subscribe(state => state.objects.get(id), listener),
    subscribeIds: listener => subscribe(state => state.ids, listener),
    subscribeObjects: listener => subscribe(state => state.ordered, listener),
    subscribeHistory: listener => subscribe(state => state.historyRevision, listener),
    getPendingOperations: () => view.getState().pending,
    subscribePending: listener => subscribe(state => state.pending, listener),
    getGap: () => view.getState().gap,
    subscribeGap: listener => subscribe(state => state.gap, listener),
    getHistoryReport: () => history.getReport(),
    canSend,
    markSending(opId): boolean {
      if (!canSend(opId)) return false;
      const operation = findPending(opId)!;
      const timestamp = now();
      submissionTimes.set(opId, { first: submissionTimes.get(opId)?.first ?? timestamp, latest: timestamp });
      setPending(pending.map(item => item === operation ? {
        ...item, status: item.attempts === 0 ? 'sending' : 'retrying', attempts: item.attempts === 0 ? 1 : 2,
      } : item));
      publish();
      return true;
    },
    getSentAt: opId => submissionTimes.get(opId)?.latest,
    abandon(opId): boolean {
      const operation = findPending(opId);
      if (!operation || operation.status === 'acknowledged') return false;
      cancel(opId);
      processHistory();
      publish();
      return true;
    },
  };
}
