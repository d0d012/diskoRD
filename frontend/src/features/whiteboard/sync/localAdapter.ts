import {
  MAX_BOARD_BODY_BYTES, MAX_CHANGES_PER_COMMAND, MAX_OBJECTS_PER_BOARD,
  MAX_REFERENCED_ASSETS_PER_BOARD, OP_IDEMPOTENCY_TTL_MS,
} from '../contract';
import type {
  BoardId, BoardObject, Command, CommandResult, Commit, CommittedChange, OpId,
  PresenceParticipant, Reject, Snapshot, SyncAdapter, SyncStatus, Unsubscribe, UploadedAsset, UserId,
} from '../contract';
import { compareRanked } from '../core';
import { immutableCopy } from '../state';
import { jsonBytes, requireValid, uuidPattern, validateObject } from './validation';

/** Standalone defaults only. Composition MUST pass the same identities as its store. */
export const LOCAL_BOARD_ID = '00000000-0000-4000-8000-000000000001';
export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000002';
export const LOCAL_REMOTE_USER_ID = '00000000-0000-4000-8000-000000000003';

export interface LocalRequest {
  readonly kind: 'connect' | 'refetch' | 'submit';
  readonly command?: Command;
  readonly attempt?: number;
}
export interface LocalAdapterOptions {
  readonly snapshot?: Snapshot;
  /** Required when using a store bound to non-default identities. */
  readonly boardId?: BoardId;
  readonly userId?: UserId;
  /** Delay before evaluating a request. Zero by default; no real networking. */
  readonly latencyMs?: number | ((request: LocalRequest) => number);
  /** Delay AFTER evaluating submit. null simulates a lost HTTP response. */
  readonly responseDelayMs?: number | ((command: Command, attempt: number) => number | null);
  /** Asynchronous broadcast delay; null drops it. Different delays reorder commits. */
  readonly commitDelayMs?: number | ((commit: Commit) => number | null);
  /** First submit rejects as a transport failure, optionally after committing. */
  readonly failTransportOnce?: boolean | 'after-commit';
}
export interface LocalAdapter extends SyncAdapter {
  /** Server-side test hook: immediate evaluation, normal asynchronous broadcast. */
  applyRemote(command: Command, userId?: UserId): Promise<CommandResult | Reject>;
  /** Simulate READY recovery and exercise onSnapshot's ordering contract. */
  simulateReconnect(): Promise<void>;
  /** Server-side test hook: the authority's current state, without a GET or status change. */
  peekSnapshot(): Snapshot;
}

function abortError(): Error {
  return new DOMException('Local board adapter disposed', 'AbortError');
}

/**
 * Local-mode upload: nothing leaves the browser. The asset lives as an object URL
 * (a data URL where object URLs do not exist) and its size comes from decoding it.
 */
async function readLocalAsset(file: Blob): Promise<UploadedAsset> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') throw new Error('That file is not a supported image.');
  const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : await blobToDataUrl(file);
  const { width, height } = await decodeSize(url);
  return { id: crypto.randomUUID(), url, width, height };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That image could not be read.'));
    reader.readAsDataURL(blob);
  });
}

function decodeSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('That image could not be read.'));
    image.src = url;
  });
}

/** Isolated in-memory authority, not persistent storage and not a shared singleton. */
export function createLocalAdapter(options: LocalAdapterOptions = {}): LocalAdapter {
  const boardId = options.boardId ?? LOCAL_BOARD_ID;
  const userId = options.userId ?? LOCAL_USER_ID;
  requireValid(uuidPattern.test(boardId) && uuidPattern.test(userId), 'Invalid local board/user UUID');
  const initial = immutableCopy(options.snapshot ?? { seq: 0, objects: [] });
  requireValid(Number.isSafeInteger(initial.seq) && initial.seq >= 0, 'Invalid snapshot sequence');
  for (const object of initial.objects) {
    validateObject(object);
    requireValid(object.version > 0 && object.version <= initial.seq, 'Invalid snapshot object version');
  }
  let objects = new Map(initial.objects.map(object => [object.id, object]));
  requireValid(objects.size === initial.objects.length && objects.size <= MAX_OBJECTS_PER_BOARD, 'Invalid snapshot membership');
  let seq = initial.seq;
  let status: SyncStatus = 'offline';
  let disposed = false;
  let transportFailure = options.failTransportOnce;
  const successes = new Map<OpId, { expires: number; result: CommandResult }>();
  const attempts = new Map<OpId, number>();
  const statusListeners = new Set<(status: SyncStatus) => void>();
  const commitListeners = new Set<(commit: Commit) => void>();
  const snapshotListeners = new Set<(snapshot: Snapshot) => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const cancellations = new Set<() => void>();
  const presence: readonly PresenceParticipant[] = Object.freeze([]);
  let fetching: Promise<Snapshot> | null = null;
  let gated = false;
  let fetchGeneration = 0;
  let deliveryFloor = 0;
  let buffered: Commit[] = [];

  function listen<T>(listeners: Set<(value: T) => void>, listener: (value: T) => void): Unsubscribe {
    if (!disposed) listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  function setStatus(next: SyncStatus): void {
    if (status === next) return;
    status = next;
    for (const listener of statusListeners) listener(next);
  }

  function schedule(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!disposed) callback();
    }, Math.max(0, delay));
    timers.add(timer);
    return timer;
  }

  function pause(delay: number | null): Promise<void> {
    if (disposed) return Promise.reject(abortError());
    if (delay === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cancel = () => reject(abortError());
      cancellations.add(cancel);
      if (delay !== null) schedule(() => {
        cancellations.delete(cancel);
        resolve();
      }, delay);
    });
  }

  function latency(request: LocalRequest): number {
    const delay = typeof options.latencyMs === 'function' ? options.latencyMs(request) : options.latencyMs ?? 0;
    requireValid(Number.isFinite(delay) && delay >= 0, 'Invalid local latency');
    return delay;
  }

  function snapshot(): Snapshot {
    return immutableCopy({ seq, objects: [...objects.values()].sort(compareRanked) });
  }

  function deliver(commit: Commit): void {
    if (gated) buffered.push(commit);
    else if (commit.seq > deliveryFloor) for (const listener of commitListeners) listener(commit);
  }

  function broadcast(commit: Commit): void {
    const delay = typeof options.commitDelayMs === 'function' ? options.commitDelayMs(commit) : options.commitDelayMs ?? 0;
    if (delay !== null) schedule(() => deliver(commit), delay);
  }

  function fetchSnapshot(kind: 'connect' | 'refetch'): Promise<Snapshot> {
    if (disposed) return Promise.reject(abortError());
    if (fetching) return fetching;
    gated = true;
    const generation = ++fetchGeneration;
    setStatus(kind === 'connect' ? 'connecting' : 'resyncing');
    fetching = (async () => {
      try {
        await pause(latency({ kind }));
        if (disposed) throw abortError();
        const result = snapshot();
        deliveryFloor = result.seq;
        setStatus('live');
        // Promise continuations hydrate first. Even zero-delay commits use tasks.
        schedule(() => {
          if (generation !== fetchGeneration) return;
          gated = false;
          const commits = buffered;
          buffered = [];
          for (const commit of commits) deliver(commit);
        }, 0);
        return result;
      } catch (error) {
        if (!disposed) setStatus('offline');
        throw error;
      } finally {
        fetching = null;
      }
    })();
    return fetching;
  }

  function invalid(opId: OpId, error: string, code: 'invalid' | 'limit' = 'invalid'): Reject {
    return immutableCopy({ opId, code, error, current: [] });
  }

  function checkReactionOwnership(
    previousReactions: Readonly<Record<string, readonly string[]>> | undefined,
    nextReactions: Readonly<Record<string, readonly string[]>> | undefined,
    actor: UserId,
  ): void {
    const prev = previousReactions ?? {};
    const next = nextReactions ?? {};
    const emojis = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const emoji of emojis) {
      const prevOthers = (prev[emoji] ?? []).filter(u => u !== actor);
      const nextOthers = (next[emoji] ?? []).filter(u => u !== actor);
      requireValid(
        prevOthers.length === nextOthers.length && prevOthers.every((u, i) => u === nextOthers[i]),
        'Reaction change cannot modify other users',
      );
    }
  }

  function evaluate(command: Command, actor: UserId): CommandResult | Reject {
    if (disposed) throw abortError();
    const opId = command?.opId;
    if (!uuidPattern.test(opId)) return invalid(opId, 'Invalid operation UUID');
    const remembered = successes.get(opId);
    if (remembered && remembered.expires > Date.now()) return remembered.result;
    for (const [id, entry] of successes) if (entry.expires <= Date.now()) successes.delete(id);
    try {
      requireValid(uuidPattern.test(actor), 'Invalid actor UUID');
      requireValid(Array.isArray(command.changes) && command.changes.length > 0 &&
        command.changes.length <= MAX_CHANGES_PER_COMMAND, 'Invalid change count');
      const ids = new Set<string>();
      // Validate envelopes before conflict evaluation; never silently ignore fields.
      for (const change of command.changes) {
        requireValid(change && uuidPattern.test(change.id) && !ids.has(change.id), 'Invalid or duplicate object id');
        ids.add(change.id);
        requireValid(['create', 'update', 'delete'].includes(change.action), 'Invalid action');
        const keys = change.action === 'create' ? ['id', 'action', 'expectedVersion', 'expectedSeq', 'body'] :
          change.action === 'update' ? ['id', 'action', 'expectedVersion', 'patch'] : ['id', 'action', 'expectedVersion'];
        requireValid(Object.keys(change).every(key => keys.includes(key)), 'Invalid change fields');
        if (change.action === 'create') {
          requireValid(change.expectedVersion === 0 && change.body?.id === change.id &&
            change.body.version === 0 && change.body.createdBy === actor, 'Invalid create identity');
          requireValid(change.expectedSeq === undefined || (Number.isSafeInteger(change.expectedSeq) && change.expectedSeq >= 0), 'Invalid expectedSeq');
          validateObject(change.body);
          if (change.body.kind === 'sticky' && change.body.reactions !== undefined) {
            checkReactionOwnership(undefined, change.body.reactions, actor);
          }
        } else {
          requireValid(Number.isSafeInteger(change.expectedVersion) && change.expectedVersion > 0, 'Invalid expectedVersion');
          if (change.action === 'update') {
            requireValid(change.patch && typeof change.patch === 'object' && !Array.isArray(change.patch) &&
              Object.keys(change.patch).length > 0, 'Empty or invalid patch');
            for (const [key, value] of Object.entries(change.patch)) {
              requireValid(!['id', 'kind', 'createdBy', 'version'].includes(key) && value !== undefined && value !== null, 'Invalid patch field');
            }
          }
        }
      }
      const failedGuard = command.changes.some(change => change.action === 'create' &&
        change.expectedSeq !== undefined && change.expectedSeq !== seq);
      const missing = command.changes.some(change => change.action !== 'create' && !objects.has(change.id));
      const stale = command.changes.some(change => change.action === 'create'
        ? objects.has(change.id) : objects.get(change.id)?.version !== change.expectedVersion);
      if (failedGuard || missing || stale) {
        return immutableCopy({
          opId, code: !failedGuard && missing ? 'gone' : 'conflict', error: 'Board precondition failed', seq,
          current: command.changes.flatMap(change => { const object = objects.get(change.id); return object ? [object] : []; }),
        });
      }
      requireValid(Number.isSafeInteger(seq + 1), 'Board sequence exhausted');
      const nextSeq = seq + 1;
      const next = new Map(objects);
      const changes: CommittedChange[] = [];
      for (const change of command.changes) {
        if (change.action === 'delete') {
          next.delete(change.id);
          changes.push({ id: change.id, action: 'delete', version: nextSeq });
        } else if (change.action === 'create') {
          const body = { ...change.body, version: nextSeq };
          next.set(change.id, body);
          changes.push({ id: change.id, action: 'create', version: nextSeq, body });
        } else {
          const previous = objects.get(change.id)!;
          requireValid(Object.keys(change.patch).every(key =>
            Object.hasOwn(previous, key) || (previous.kind === 'sticky' && key === 'reactions'),
          ), 'Patch does not match object kind');
          const body = { ...previous, ...change.patch, version: nextSeq } as BoardObject;
          validateObject(body);
          if (previous.kind === 'sticky' && 'reactions' in change.patch) {
            checkReactionOwnership(previous.reactions, (body as Extract<BoardObject, { kind: 'sticky' }>).reactions, actor);
          }
          next.set(change.id, body);
          changes.push({ id: change.id, action: 'update', version: nextSeq, patch: change.patch });
        }
      }
      const assets = new Set([...next.values()].flatMap(object => object.kind === 'image' ? [object.assetId] : []));
      if (next.size > MAX_OBJECTS_PER_BOARD || assets.size > MAX_REFERENCED_ASSETS_PER_BOARD ||
        [...next.values()].reduce((total, object) => total + jsonBytes(object), 0) > MAX_BOARD_BODY_BYTES) {
        return invalid(opId, 'Local board capacity exceeded', 'limit');
      }
      const commit = immutableCopy({ channelId: boardId, userId: actor, opId, seq: nextSeq, changes });
      const result = immutableCopy({ seq: nextSeq, changes: changes.map(({ id, action, version }) => ({ id, action, version })) });
      objects = new Map([...next].map(([id, object]) => [id, immutableCopy(object)]));
      seq = nextSeq;
      successes.set(opId, { expires: Date.now() + OP_IDEMPOTENCY_TTL_MS, result });
      broadcast(commit);
      return result;
    } catch (error) {
      return invalid(opId, error instanceof Error ? error.message : 'Invalid command');
    }
  }

  return {
    connect: () => fetchSnapshot('connect'),
    refetch: () => fetchSnapshot('refetch'),
    async submit(command): Promise<CommandResult | Reject> {
      if (disposed) throw abortError();
      const owned = immutableCopy(command);
      const attempt = (attempts.get(owned.opId) ?? 0) + 1;
      attempts.set(owned.opId, attempt);
      const failure = transportFailure;
      transportFailure = false;
      await pause(latency({ kind: 'submit', command: owned, attempt }));
      if (disposed) throw abortError();
      if (failure === true) throw new Error('Injected local transport failure');
      const result = evaluate(owned, userId);
      if (failure === 'after-commit') throw new Error('Injected local transport failure after commit');
      const delay = typeof options.responseDelayMs === 'function'
        ? options.responseDelayMs(owned, attempt) : options.responseDelayMs ?? 0;
      await pause(delay);
      if (disposed) throw abortError();
      return result;
    },
    async applyRemote(command, actor = LOCAL_REMOTE_USER_ID): Promise<CommandResult | Reject> {
      return evaluate(immutableCopy(command), actor);
    },
    async simulateReconnect(): Promise<void> {
      const result = await fetchSnapshot('refetch');
      if (!disposed) for (const listener of snapshotListeners) listener(result);
    },
    peekSnapshot: snapshot,
    getStatus: () => status,
    onStatus: listener => listen(statusListeners, listener),
    onCommit: listener => listen(commitListeners, listener),
    onSnapshot: listener => listen(snapshotListeners, listener),
    sendPresence(): void { /* Local editor has no remote participants. */ },
    getPresence: () => presence,
    subscribePresence: () => () => {},
    uploadAsset: async file => {
      if (disposed) throw abortError();
      return readLocalAsset(file);
    },
    purge: async filter => {
      if (disposed) throw abortError();
      const matching: BoardObject[] = [];
      for (const obj of objects.values()) {
        if (filter.createdBy !== undefined && obj.createdBy !== filter.createdBy) continue;
        if (filter.rect !== undefined) {
          const r = filter.rect;
          const overlapsX = obj.x <= r.x + r.w && obj.x + obj.w >= r.x;
          const overlapsY = obj.y <= r.y + r.h && obj.y + obj.h >= r.y;
          if (!overlapsX || !overlapsY) continue;
        }
        matching.push(obj);
      }
      if (matching.length > 0) {
        const nextSeq = seq + 1;
        const changes = matching.map(obj => ({ id: obj.id, action: 'delete' as const, version: nextSeq }));
        for (const obj of matching) objects.delete(obj.id);
        seq = nextSeq;
        broadcast(immutableCopy({ channelId: boardId, userId, opId: crypto.randomUUID(), seq: nextSeq, changes }));
      }
      return { deleted: matching.length };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const cancel of cancellations) cancel();
      cancellations.clear();
      buffered = [];
      setStatus('offline');
      statusListeners.clear(); commitListeners.clear(); snapshotListeners.clear();
      successes.clear(); attempts.clear();
    },
  };
}
