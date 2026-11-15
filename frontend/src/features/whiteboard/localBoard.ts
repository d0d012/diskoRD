import type { BoardId, BoardStore, Point, Runtime, Snapshot, SyncAdapter, UserId } from './contract';
import { createBoardNotices, createBoardStore, createSessionStore } from './state';
import type { BoardNotices, SessionStore } from './state';
import { createRuntime } from './render/runtime';
import { createInputController } from './input/controller';
import { createImageIngest } from './assets/ingest';
import type { ImageIngest } from './assets/ingest';
import { createStampPlacer } from './stamps/placeStamp';
import type { StampPlacer } from './stamps/placeStamp';
import { createLocalAdapter } from './sync/localAdapter';
import { createNetworkAdapter } from './sync/networkAdapter';
import type { LocalAdapter } from './sync/localAdapter';
import { createSyncCoordinator } from './sync/coordinator';
import type { SyncCoordinator, SyncNotice } from './sync/coordinator';

/**
 * The single composition of a board's pieces, shared by WhiteboardChannel and the
 * integration tests so they cannot drift apart. Every piece that knows the board
 * or the user gets the SAME identities: the store stamps createdBy with
 * `userId`, and the adapter (the authority) only accepts creates whose
 * createdBy is its own actor, so a mismatch rejects (and removes) every new object.
 */
export interface BoardIdentity {
  readonly boardId: BoardId;
  readonly userId: UserId;
}

/** Long-lived per channel+user; survives effect re-runs (React StrictMode). */
export interface BoardResources {
  /** The identities the store was built with; every other piece must reuse them. */
  readonly identity: BoardIdentity;
  readonly store: BoardStore;
  readonly session: SessionStore;
  readonly runtime: Runtime;
  readonly notices: BoardNotices;
}

export function createBoardResources({ boardId, userId }: BoardIdentity): BoardResources {
  return {
    identity: { boardId, userId },
    store: createBoardStore({ boardId, userId }),
    session: createSessionStore(),
    runtime: createRuntime(),
    notices: createBoardNotices(),
  };
}

export interface LocalBoardOptions extends BoardIdentity {
  /** The viewport element (`data-wb-viewport`) that owns input. */
  readonly element: HTMLElement;
  /** The Image shortcut was pressed: the host opens its picker. */
  readonly onRequestImage?: () => void;
  /** The Export shortcut (Ctrl/Cmd+Shift+E) was pressed. */
  readonly onExport?: () => void;
  /** The Stamp shortcut was pressed: the host toggles the stamp picker. */
  readonly onRequestStamp?: () => void;
  /** A board click while the Stamp tool is armed places the armed sticker. */
  readonly onStampPlace?: (world: Point) => void;
  /** Initial in-memory server state (tests). */
  readonly snapshot?: Snapshot;
}

export interface LocalBoardConnection {
  /** The in-memory authority (server stand-in) for this connection. */
  readonly adapter: LocalAdapter;
  readonly coordinator: SyncCoordinator;
  readonly ingest: ImageIngest;
  readonly stamps: StampPlacer;
  /** Resolves once the store is hydrated and the coordinator pumps commands. */
  readonly started: Promise<void>;
  dispose(): void;
}

export function syncNoticeMessage(notice: SyncNotice): string {
  switch (notice.type) {
    case 'rejected': {
      const detail = notice.message.replace(/^(invalid|limit|forbidden|conflict|gone):\s*/i, '').trim();
      return detail
        ? `That change could not be saved (${detail}), so it was undone.`
        : 'That change could not be saved, so it was undone.';
    }
    case 'outcome-unknown': return 'A change may not have been saved.';
    default: return 'The board could not sync a change.';
  }
}

export interface BoardConnection {
  readonly adapter: SyncAdapter;
  readonly coordinator: SyncCoordinator;
  /** The one ingestion path for picked, pasted and dropped images. */
  readonly ingest: ImageIngest;
  /** The one placement path for built-in pixel-art stamps. */
  readonly stamps: StampPlacer;
  /** Resolves once the store is hydrated and the coordinator pumps commands. */
  readonly started: Promise<void>;
  dispose(): void;
}

export interface BoardConnectionOptions {
  /** The viewport element (`data-wb-viewport`) that owns input. */
  readonly element: HTMLElement;
  /** The Image shortcut was pressed: the host opens its picker. */
  readonly onRequestImage?: () => void;
  /** The Export shortcut (Ctrl/Cmd+Shift+E) was pressed. */
  readonly onExport?: () => void;
  /** The Stamp shortcut was pressed: the host toggles the stamp picker. */
  readonly onRequestStamp?: () => void;
  /** A board click while the Stamp tool is armed places the armed sticker. */
  readonly onStampPlace?: (world: Point) => void;
  /** Display-name lookup for presence; the server-provided name is the fallback. */
  readonly resolveName?: (userId: UserId) => string | undefined;
}

/**
 * The ONE place an adapter, coordinator and input controller are assembled
 * around a store. The adapter is built by the caller but must act as the
 * store's user; presence flows adapter <-> controller from here.
 */
function wireBoard(
  resources: BoardResources, adapter: SyncAdapter, element: HTMLElement, userId: UserId,
  onRequestImage?: () => void, onExport?: () => void, onRequestStamp?: () => void, onStampPlace?: (world: Point) => void,
): BoardConnection {
  const { store, session, runtime, notices } = resources;
  const coordinator = createSyncCoordinator({
    store, adapter,
    onNotice: notice => notices.notify(notice.type === 'rejected' ? 'rejected' : 'sync', syncNoticeMessage(notice)),
  });
  const ingest = createImageIngest({
    adapter, store, session, runtime, userId,
    // The pipeline only reports refused/failed uploads.
    notify: (_kind, message) => notices.notify('refused', message),
    getViewportSize: () => element.getBoundingClientRect(),
  });
  const stamps = createStampPlacer({ adapter, store, session, runtime, userId, notify: notices.notify });
  const controller = createInputController({
    element, store, session, runtime, userId, onNotice: notices.notify, onRequestImage, onExport, onRequestStamp, onStampPlace,
    onImageFiles: (files, at) => { void ingest.addFiles(files, at ? { at } : undefined); },
    presence: { send: adapter.sendPresence, getParticipants: adapter.getPresence },
  });
  const started = coordinator.start();
  // Callers observe `started`; never leave an unhandled rejection behind on dispose.
  started.catch(() => undefined);
  let disposed = false;
  return {
    adapter,
    coordinator,
    ingest,
    stamps,
    started,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      controller.dispose();
      ingest.dispose();
      stamps.dispose();
      coordinator.dispose();
      adapter.dispose();
      runtime.setPreview({ objects: [], hiddenIds: [], marquee: null });
    },
  };
}

/**
 * Real connection: HTTP persistence + gateway commits/presence. Board and user
 * come from `resources.identity`, the same values the store was built with, so
 * the adapter can never act as a different user than the store stamps.
 */
export function connectBoard(resources: BoardResources, options: BoardConnectionOptions): BoardConnection {
  const { boardId, userId } = resources.identity;
  const adapter = createNetworkAdapter({ boardId, userId, resolveName: options.resolveName });
  return wireBoard(resources, adapter, options.element, userId, options.onRequestImage, options.onExport, options.onRequestStamp, options.onStampPlace);
}

/** Local-only connection (tests, standalone): in-memory adapter standing in for the server. */
export function connectLocalBoard(resources: BoardResources, options: LocalBoardOptions): LocalBoardConnection {
  const { boardId, userId, element, snapshot, onRequestImage, onExport, onRequestStamp, onStampPlace } = options;
  const adapter = createLocalAdapter({ boardId, userId, snapshot });
  return { ...wireBoard(resources, adapter, element, userId, onRequestImage, onExport, onRequestStamp, onStampPlace), adapter };
}
