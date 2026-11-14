import { COMMAND_ACK_TIMEOUT_MS, SEQUENCE_GAP_HOLD_MS } from '../contract';
import type { BoardStore, Command, Commit, OpId, Snapshot, SyncAdapter, Unsubscribe } from '../contract';

export interface SyncNotice {
  readonly type: 'outcome-unknown' | 'transport-error' | 'recovery-error' | 'rejected';
  readonly message: string;
  readonly opId?: OpId;
  readonly dependentOpIds?: readonly OpId[];
}
export interface SyncCoordinatorOptions {
  readonly store: BoardStore;
  readonly adapter: SyncAdapter;
  /** Explicit notice surface: the composition layer can display these in its UI. */
  readonly onNotice?: (notice: SyncNotice) => void;
}
export interface SyncCoordinator {
  start(): Promise<void>;
  dispose(): void;
  /** Bounded, immutable notices; the wiring contract otherwise has no error channel. */
  getNotices(): readonly SyncNotice[];
  subscribeNotices(listener: () => void): Unsubscribe;
  /** User/reconnect-driven retry after a failed GET; never loops GETs on failure. */
  retryRecovery(): Promise<void>;
}

/** Sole owner of transport -> store integration. Never owns optimistic reducers. */
export function createSyncCoordinator({ store, adapter, onNotice }: SyncCoordinatorOptions): SyncCoordinator {
  let disposed = false;
  let initialized = false;
  let subscribed = false;
  let startPromise: Promise<void> | null = null;
  let recovery: Promise<void> | null = null;
  let recoveryBlocked = false;
  let awaitingSnapshot = false;
  let scheduled = false;
  let wakeTimer: ReturnType<typeof setTimeout> | undefined;
  let gapTimer: ReturnType<typeof setTimeout> | undefined;
  let bootstrapCommits: Commit[] = [];
  let bootstrapSnapshot: Snapshot | undefined;
  const subscriptions: Unsubscribe[] = [];
  const abandonAfterRecovery = new Set<OpId>();
  const noticeListeners = new Set<() => void>();
  let notices: readonly SyncNotice[] = Object.freeze([]);

  function notice(value: SyncNotice): void {
    if (disposed) return;
    if (import.meta.env.DEV) console.warn(`whiteboard: sync ${value.type}: ${value.message}`, value.opId ?? '');
    const owned = Object.freeze({ ...value, ...(value.dependentOpIds ? { dependentOpIds: Object.freeze([...value.dependentOpIds]) } : {}) });
    notices = Object.freeze([...notices.slice(-99), owned]);
    onNotice?.(owned);
    for (const listener of noticeListeners) listener();
  }

  function clearWake(): void {
    if (wakeTimer !== undefined) clearTimeout(wakeTimer);
    wakeTimer = undefined;
  }

  function clearGap(): void {
    if (gapTimer !== undefined) clearTimeout(gapTimer);
    gapTimer = undefined;
  }

  function scheduleWork(): void {
    if (disposed || scheduled) return;
    scheduled = true;
    // Store subscriptions fire inside atomic publication; do not re-enter them.
    queueMicrotask(() => {
      scheduled = false;
      if (!disposed) work();
    });
  }

  function checkGap(): void {
    if (disposed || !initialized || recovery || recoveryBlocked || awaitingSnapshot || !store.getGap()) {
      clearGap();
      return;
    }
    // Preserve the original hold deadline while evidence for the same open gap grows.
    if (gapTimer === undefined) gapTimer = setTimeout(() => {
      gapTimer = undefined;
      if (!disposed && store.getGap()) void recover();
    }, SEQUENCE_GAP_HOLD_MS);
  }

  function hydrate(snapshot: Snapshot): void {
    store.hydrate(snapshot);
    awaitingSnapshot = false;
  }

  function recover(): Promise<void> {
    if (disposed || !initialized) return Promise.resolve();
    if (recovery) return recovery;
    recoveryBlocked = false;
    clearWake();
    clearGap();
    // Assign the in-flight gate before calling adapter methods or store listeners.
    recovery = Promise.resolve().then(async () => {
      if (disposed) return;
      try {
        const snapshot = await adapter.refetch();
        if (disposed) return;
        hydrate(snapshot);
        for (const opId of abandonAfterRecovery) {
          const before = store.getPendingOperations();
          if (store.abandon(opId)) {
            const remaining = new Set(store.getPendingOperations().map(item => item.command.opId));
            notice({
              type: 'outcome-unknown', opId,
              message: 'Board operation outcome unknown after recovery; its pending work was abandoned.',
              dependentOpIds: before.map(item => item.command.opId).filter(id => id !== opId && !remaining.has(id)),
            });
          }
        }
        abandonAfterRecovery.clear();
      } catch (error) {
        if (!disposed) {
          recoveryBlocked = true;
          notice({ type: 'recovery-error', message: error instanceof Error ? error.message : 'Board recovery failed' });
        }
      } finally {
        recovery = null;
        if (!disposed) scheduleWork();
      }
    });
    return recovery;
  }

  function submit(command: Command): void {
    if (!store.markSending(command.opId)) return;
    // The SAME command object is reused on retries. A transport failure is not
    // an application rejection and leaves optimistic work pending until recovery.
    void Promise.resolve().then(() => {
      if (disposed) return undefined;
      return adapter.submit(command);
    }).then(result => {
      if (disposed || !result) return;
      if ('code' in result) {
        store.applyReject(result);
        // Never silent: the optimistic work just disappeared, so say why.
        notice({ type: 'rejected', opId: command.opId, message: `${result.code}: ${result.error}` });
      } else {
        const known = store.getPendingOperations().some(item => item.command.opId === command.opId);
        store.acknowledge(command.opId, result);
        // A slow accepted HTTP response can outlive abandonment. The store no
        // longer retains that command; GET recovers it without inventing an ack.
        if (!known && result.seq > store.getSeq()) void recover();
      }
      scheduleWork();
    }).catch(error => {
      if (!disposed) notice({
        type: 'transport-error', opId: command.opId,
        message: error instanceof Error ? error.message : 'Board transport failed',
      });
    });
  }

  function work(): void {
    clearWake();
    if (!initialized || recovery || recoveryBlocked || awaitingSnapshot || adapter.getStatus() !== 'live') {
      checkGap();
      return;
    }
    for (const operation of store.getPendingOperations()) {
      const { opId } = operation.command;
      if (operation.status === 'acknowledged') continue;
      if (operation.attempts === 0) {
        if (store.canSend(opId)) submit(operation.command);
        continue;
      }
      const sentAt = store.getSentAt(opId);
      if (sentAt !== undefined && Date.now() - sentAt < COMMAND_ACK_TIMEOUT_MS) continue;
      if (operation.attempts === 1 && store.canSend(opId)) submit(operation.command);
      else abandonAfterRecovery.add(opId); // exhausted or past the store's TTL guard
    }
    if (abandonAfterRecovery.size) {
      void recover();
      return;
    }
    let nextDeadline = Infinity;
    for (const operation of store.getPendingOperations()) {
      if (operation.attempts === 0 || operation.status === 'acknowledged') continue;
      const sentAt = store.getSentAt(operation.command.opId);
      if (sentAt !== undefined) nextDeadline = Math.min(nextDeadline, sentAt + COMMAND_ACK_TIMEOUT_MS);
    }
    if (Number.isFinite(nextDeadline)) wakeTimer = setTimeout(scheduleWork, Math.max(0, nextDeadline - Date.now()));
    checkGap();
  }

  function attach(): void {
    if (subscribed) return;
    subscribed = true;
    subscriptions.push(
      store.subscribePending(scheduleWork),
      store.subscribeGap(checkGap),
      adapter.onCommit(commit => {
        if (disposed) return;
        if (!initialized) bootstrapCommits.push(commit);
        else { store.applyCommit(commit); scheduleWork(); }
      }),
      adapter.onSnapshot(snapshot => {
        if (disposed) return;
        if (!initialized) bootstrapSnapshot = snapshot;
        else {
          hydrate(snapshot);
          recoveryBlocked = false;
          // A READY snapshot is also a successful recovery for previously
          // exhausted ops. Use the same abandonment path after a fresh GET.
          if (abandonAfterRecovery.size) void recover();
          else scheduleWork();
        }
      }),
      adapter.onStatus(status => {
        if (disposed) return;
        if (status === 'connecting' || status === 'resyncing') awaitingSnapshot = true;
        if (status === 'live') {
          if (recoveryBlocked) { recoveryBlocked = false; void recover(); }
          scheduleWork();
        } else { clearWake(); clearGap(); }
      }),
    );
  }

  return {
    start(): Promise<void> {
      if (disposed) return Promise.reject(new DOMException('Board coordinator disposed', 'AbortError'));
      if (startPromise) return startPromise;
      attach();
      startPromise = Promise.resolve().then(async () => {
        const snapshot = await adapter.connect();
        if (disposed) throw new DOMException('Board coordinator disposed', 'AbortError');
        hydrate(bootstrapSnapshot && bootstrapSnapshot.seq > snapshot.seq ? bootstrapSnapshot : snapshot);
        bootstrapSnapshot = undefined;
        initialized = true;
        const commits = bootstrapCommits;
        bootstrapCommits = [];
        for (const commit of commits) store.applyCommit(commit);
        scheduleWork();
      }).catch(error => {
        startPromise = null;
        throw error;
      });
      return startPromise;
    },
    retryRecovery: recover,
    getNotices: () => notices,
    subscribeNotices(listener): Unsubscribe {
      if (!disposed) noticeListeners.add(listener);
      return () => { noticeListeners.delete(listener); };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearWake(); clearGap();
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions.length = 0;
      bootstrapCommits = [];
      bootstrapSnapshot = undefined;
      abandonAfterRecovery.clear();
      noticeListeners.clear();
      adapter.dispose();
    },
  };
}
