import type {
  BoardId, BoardObject, BoardSeq, Camera, ObjectId, OpId, Point, Rect,
  ShapeStyle, StickyStyle, StrokePreset, StrokeStyle, TextStyle, ToolId,
  Unsubscribe, UserId, UUID,
} from './types';
import type {
  Change, Command, CommandResult, Commit, PendingOperation, Reject, Snapshot,
} from './operations';

export interface DispatchOptions {
  /** Default true. Undo/redo commands do not recursively add history entries. */
  readonly recordHistory?: boolean;
  /** Local UI label only; not sent to the server. */
  readonly label?: string;
}

export interface SequenceGap {
  readonly expectedSeq: BoardSeq;
  /** Earliest buffered commit or reject evidence beyond contiguous state. */
  readonly receivedSeq: BoardSeq;
}

export type HistoryDirection = 'undo' | 'redo';
export interface HistorySkip {
  readonly id: ObjectId;
  readonly reason: 'changed' | 'missing' | 'pending' | 'unproven-absence';
}
export interface HistoryReport {
  readonly opId: OpId;
  readonly direction: HistoryDirection;
  readonly skipped: readonly HistorySkip[];
}

/**
 * One instance per board/local user (bound at construction). Read APIs expose
 * immutable optimistic projections.
 * Cache returned identities until data changes (suitable for external-store
 * subscriptions). No camera, pointer samples, presence or drag previews here.
 */
export interface BoardStore {
  /** Board/channel UUID bound at store creation. */
  getBoardId?(): BoardId;
  /** Local actor UUID bound at store creation. */
  getUserId?(): UserId;
  /** Replace confirmed state and rebase pending, as specified in operations.ts. */
  hydrate(snapshot: Snapshot): void;
  /** Highest contiguous confirmed board seq; optimistic work never advances it. */
  getSeq(): BoardSeq;
  /** Generate UUID opId, stamp create.createdBy, capture inverse, apply atomically,
   * queue; may throw on invalid input. Create expects explicit version 0.
   */
  dispatch(changes: readonly Change[], opts?: DispatchOptions): OpId;
  applyCommit(commit: Commit): void;
  /** HTTP success path; looks up submitted command by opId, dedupes gateway echo. */
  acknowledge(opId: OpId, result: CommandResult): void;
  applyReject(reject: Reject): void;
  /** Queues while awaiting predecessor ack; null if no eligible history entry. */
  undo(): OpId | null;
  redo(): OpId | null;
  /** Includes entries waiting for ack; a queued undo must never be sent early. */
  canUndo(): boolean;
  canRedo(): boolean;
  getObject(id: ObjectId): BoardObject | undefined;
  /** Ascending rank, then id; frames first via the rank partition. */
  getObjectsInRank(): readonly BoardObject[];
  getObjectIds(): readonly ObjectId[];
  /** No initial callback. Notify once after each atomic visible change to id. */
  subscribeObject(id: ObjectId, listener: () => void): Unsubscribe;
  /** Fires only for membership/order changes; list uses getObjectsInRank order. */
  subscribeIds(listener: () => void): Unsubscribe;
  /** Fires whenever any object is created, updated, deleted, or reordered. */
  subscribeObjects?(listener: () => void): Unsubscribe;
  /** History buttons and sync worker must also observe non-object transitions. */
  subscribeHistory(listener: () => void): Unsubscribe;
  getPendingOperations(): readonly PendingOperation[];
  subscribePending(listener: () => void): Unsubscribe;
  /** Coordinator holds gaps for SEQUENCE_GAP_HOLD_MS, then refetches. */
  getGap(): SequenceGap | null;
  subscribeGap(listener: () => void): Unsubscribe;
  /** Latest local history attempt; observe via subscribeHistory. */
  getHistoryReport(): HistoryReport | null;
  /** False for dependencies, acknowledged ops, exhausted retries or expired TTL.
   * This is eligibility, not a timer: coordinator waits COMMAND_ACK_TIMEOUT_MS.
   */
  canSend(opId: OpId): boolean;
  /** Call immediately BEFORE submit; freezes bytes/preconditions for retries. */
  markSending(opId: OpId): boolean;
  getSentAt(opId: OpId): number | undefined;
  /** After recovery GET, coordinator may discard an exhausted/expired unknown
   * outcome and dependent overlays, reporting uncertainty to the user. Never
   * fabricate a server Reject; late commits still apply. Refuses acknowledged ops.
   */
  abandon(opId: OpId): boolean;
}

export interface StyleDefaults {
  readonly stroke: StrokeStyle;
  readonly strokePreset: StrokePreset;
  readonly shape: ShapeStyle;
  readonly text: TextStyle;
  readonly sticky: StickyStyle;
  readonly frame: StrokeStyle;
  readonly imagePixelated: boolean;
}

/** Local Zustand-compatible state shape, never serialized or shared as an op. */
export interface SessionState {
  readonly tool: ToolId;
  /** Unique ids, in selection order; no Set on the contract boundary. */
  readonly selectedIds: readonly ObjectId[];
  /** Only text/sticky inline editing; crop mode is tracked separately. */
  readonly editingId: ObjectId | null;
  readonly croppingId: ObjectId | null;
  readonly styleDefaults: StyleDefaults;
}

export interface Participant {
  readonly userId: UserId;
  /** Display name, resolved from the guild roster when JOIN only gives userId. */
  readonly name: string;
  /** Nonnegative index into PALETTE_COLOURS; stable for a user's room session. */
  readonly colourIndex: number;
}

export interface PresenceDrag {
  readonly ids: readonly ObjectId[];
  /** World-space translation from the acknowledged geometry at drag start. */
  readonly dx: number;
  readonly dy: number;
}

/**
 * BOARD_PRESENCE fields: world coordinates throughout (viewport is visible
 * world rectangle, not Camera). Decision: omission preserves the last value,
 * null explicitly clears cursor/editing/drag/viewport; [] clears selection.
 * Adapter coalesces latest fields per user/room, enforces byte/rate limits and
 * expires state after 10 s. Send drag=null on pointer-up/cancel; persist only
 * ONE command on pointer-up. All presence is ephemeral, not board state.
 */
export interface PresenceFields {
  readonly cursor?: Point | null;
  readonly selectedIds?: readonly ObjectId[];
  readonly editingId?: ObjectId | null;
  readonly drag?: PresenceDrag | null;
  readonly viewport?: Rect | null;
  readonly laser?: readonly Point[] | null;
}

/** Client → server payload d. userId is never trusted from the client. */
export interface PresencePayload extends PresenceFields {
  readonly channelId: BoardId;
}

/** Server → room payload d; server stamps userId. */
export interface Presence extends PresencePayload {
  readonly userId: UserId;
}

/** Adapter's merged room view, defaulted null/[]; not a gateway payload. */
export interface PresenceParticipant extends Participant {
  readonly cursor: Point | null;
  readonly selectedIds: readonly ObjectId[];
  readonly editingId: ObjectId | null;
  readonly drag: PresenceDrag | null;
  readonly viewport: Rect | null;
  readonly laser?: readonly Point[] | null;
  /** Local Date.now() receive timestamp, not a server timestamp. */
  readonly lastSeenAt: number;
}

export interface BoardRoomPayload {
  readonly channelId: BoardId;
}

/** BOARD_SUBSCRIBED; BOARD_SUBSCRIBE/UNSUBSCRIBE use BoardRoomPayload. */
export interface BoardSubscribed extends BoardRoomPayload {
  readonly seq: BoardSeq;
  readonly participants: readonly Participant[];
}

/** BOARD_JOIN and BOARD_LEAVE use this same payload. */
export interface BoardMembership extends BoardRoomPayload {
  readonly userId: UserId;
}

/** BOARD_JOIN d: the full Participant (M2 decision), so clients need no roster lookup. */
export interface BoardJoin extends BoardMembership, Participant {}

export type SyncStatus = 'connecting' | 'live' | 'resyncing' | 'offline';

export interface UploadedAsset {
  readonly id: UUID;
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

export interface PurgeFilter {
  readonly createdBy?: UserId;
  readonly rect?: Rect;
}

export interface PurgeResult {
  readonly deleted: number;
}

/**
 * Board/user are bound at construction. Store integration has ONE owner (the
 * composition layer): connect() returns the bootstrap snapshot, onCommit feeds
 * applyCommit, submit results feed acknowledge/applyReject. Adapter does not
 * mutate the store. Register listeners BEFORE connect; adapter buffers commits
 * through snapshot fetch, then delivers seq > snapshot.seq in the next task
 * after connect/refetch resolves (caller hydrates synchronously after await).
 * It repeats subscribe/refetch on every READY. onSnapshot delivers subsequent
 * recovery snapshots BEFORE the buffered commits for that recovery.
 * live means subscribed + hydrated, not merely an open socket.
 * Coordinator owns 300 ms gap detection and 5 s retry timers; it calls refetch
 * and resubmits the same Command. Adapter performs one HTTP attempt per submit.
 */
export interface SyncAdapter {
  connect(): Promise<Snapshot>;
  /** Idempotent: unsubscribe room, remove listeners/timers, abort requests. */
  dispose(): void;
  /** Success/rejection are values; transport errors reject the Promise. */
  submit(command: Command): Promise<CommandResult | Reject>;
  /** Buffer commits during GET; returned snapshot follows the same ordering as connect. */
  refetch(): Promise<Snapshot>;
  getStatus(): SyncStatus;
  onStatus(listener: (status: SyncStatus) => void): Unsubscribe;
  onCommit(listener: (commit: Commit) => void): Unsubscribe;
  /** Automatic READY/reconnect recovery only; explicit refetch returns its snapshot. */
  onSnapshot(listener: (snapshot: Snapshot) => void): Unsubscribe;
  /** Adapter adds channelId; merge/coalesce/rate-limit before gateway send. */
  sendPresence(fields: PresenceFields): void;
  /**
   * Everyone in the room INCLUDING the local user (Participants lists self
   * first). Self's presence fields stay default; cursor/selection/ghost
   * painting and soft locks must skip self.
   */
  getPresence(): readonly PresenceParticipant[];
  /** Hot-path subscription; never route cursor/drag samples through React/Zustand. */
  subscribePresence(listener: (participants: readonly PresenceParticipant[]) => void): Unsubscribe;
  /** Multipart upload. Blob may be a File; SVG is always refused. */
  uploadAsset(file: Blob): Promise<UploadedAsset>;
  /** Moderator cleanup of objects matching createdBy and/or intersecting rect. */
  purge?(filter: PurgeFilter): Promise<PurgeResult>;
}

/**
 * Render-only overrides, never persisted. Objects replace matching store ids;
 * new ids are drafts; hiddenIds suppress originals; null marquee clears it.
 * Entire preview is replaced, not merged. Input owns this single local preview.
 */
export interface RuntimePreview {
  readonly objects: readonly BoardObject[];
  readonly hiddenIds: readonly ObjectId[];
  readonly marquee: Rect | null;
}

/**
 * Mutable non-React hot path shared by input/render. Camera and preview writes
 * synchronously notify subscribers, which schedule ONE shared rAF DOM update.
 * Screen points are CSS pixels relative to the viewport's top-left; callers
 * subtract DOM bounds first. No window/document or app imports are required.
 */
export interface Runtime {
  getCamera(): Camera;
  /** Clamp zoom to contract limits. Do not round world positions to pixels. */
  setCamera(camera: Camera): void;
  subscribeCamera(listener: (camera: Camera) => void): Unsubscribe;
  screenToWorld(screen: Point): Point;
  worldToScreen(world: Point): Point;
  getPreview(): RuntimePreview;
  setPreview(preview: RuntimePreview): void;
  subscribePreview(listener: (preview: RuntimePreview) => void): Unsubscribe;
}

