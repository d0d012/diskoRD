import type { Unsubscribe } from '../contract';

/**
 * Local, non-blocking user notices (refused or rejected actions). Never shared,
 * never persisted. The board UI shows the latest one briefly.
 */
export type BoardNoticeKind =
  /** Over MAX_CHANGES_PER_COMMAND: refused rather than split into several writes. */
  | 'too-many-changes'
  /** Over MAX_OBJECTS_PER_BOARD (or another board capacity limit). */
  | 'board-full'
  /** The store refused the command locally (invalid input). */
  | 'refused'
  /** The adapter/server rejected an already applied optimistic command. */
  | 'rejected'
  /** Transport/recovery problems reported by the sync coordinator. */
  | 'sync';

export interface BoardNotice {
  /** Monotonic per channel; a repeated message is still a new notice. */
  readonly id: number;
  readonly kind: BoardNoticeKind;
  readonly message: string;
}

export type BoardNotify = (kind: BoardNoticeKind, message: string) => void;

export interface BoardNotices {
  readonly notify: BoardNotify;
  getLatest(): BoardNotice | null;
  /** Clears the latest notice only if it is still `id`. */
  dismiss(id: number): void;
  subscribe(listener: () => void): Unsubscribe;
}

export function createBoardNotices(): BoardNotices {
  let latest: BoardNotice | null = null;
  let nextId = 1;
  const listeners = new Set<() => void>();
  function emit(): void {
    for (const listener of [...listeners]) listener();
  }
  return {
    notify(kind, message) {
      latest = Object.freeze({ id: nextId++, kind, message });
      emit();
    },
    getLatest: () => latest,
    dismiss(id) {
      if (latest?.id !== id) return;
      latest = null;
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
