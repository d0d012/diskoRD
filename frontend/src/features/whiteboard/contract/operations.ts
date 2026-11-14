import type {
  BoardId, BoardObject, BoardObjectByKind, BoardSeq, ObjectId, ObjectKind, OpId, UserId,
} from './types';

/**
 * Shallow merge only: nested style, points, endpoints and crop are replaced
 * whole, never deep-merged. Missing keys mean unchanged; null/undefined are not
 * patch values. Identity, kind, creator and version are immutable to clients.
 * Must be nonempty. The receiver validates keys against the existing kind;
 * nested objects require ALL their keys (a partial style is invalid).
 */
export type ObjectPatch<K extends ObjectKind = ObjectKind> = {
  [Kind in K]: Partial<Omit<BoardObjectByKind[Kind], 'id' | 'kind' | 'version' | 'createdBy'>> & {
    readonly id?: never;
    readonly kind?: never;
    readonly version?: never;
    readonly createdBy?: never;
  };
}[K];

export interface CreateChange {
  readonly id: ObjectId;
  readonly action: 'create';
  /** Full object: id matches, version=0, createdBy=authenticated creating user.
   * Store stamps createdBy even for undo-of-delete/copying another user's body.
   */
  readonly body: BoardObject;
  /** Revision 2: explicit absence expectation, required on ALL creates. */
  readonly expectedVersion: 0;
  /** Optional exact board seq at evaluation, create only. Mandatory for history
   * re-creation: caller verified the deletion tombstone at this contiguous seq.
   * Guards ABA (absent -> recreated -> deleted) without server tombstone storage.
   * Unrelated concurrent writes also reject this conservative guard. Never
   * retarget/resend a failed guarded create with a newer expectedSeq silently.
   */
  readonly expectedSeq?: BoardSeq;
  readonly patch?: never;
}

export interface UpdateChange {
  readonly id: ObjectId;
  readonly action: 'update';
  /** Positive acknowledged version on the wire; never send 0 to the server. */
  readonly expectedVersion: BoardSeq;
  readonly patch: ObjectPatch;
  readonly body?: never;
  readonly expectedSeq?: never;
}

export interface DeleteChange {
  readonly id: ObjectId;
  readonly action: 'delete';
  readonly expectedVersion: BoardSeq;
  readonly body?: never;
  readonly patch?: never;
  readonly expectedSeq?: never;
}

export type Change = CreateChange | UpdateChange | DeleteChange;

/**
 * POST /channels/:id/board/ops request, no outer envelope.
 * Nonempty, at most MAX_CHANGES_PER_COMMAND, one change per id (decision).
 * Validate every change before writing: a command is all-or-nothing, never
 * partially accepted. Create requires expectedVersion=0 AND absence, plus an
 * exact board seq when expectedSeq is supplied; update/delete require existence
 * and exact positive expectedVersion. Re-create after a delete uses a new board seq.
 * opId is a client UUID, deduped in Redis for 10 minutes; resends use identical
 * bytes and opId and return the original success, without a second commit.
 * Rejections are not cached. v1 limitation: Redis read/write failures are logged
 * but writes continue, so durable idempotency during cache outages is NOT
 * guaranteed. Do not expand the bounded retry policy to compensate.
 */
export interface Command {
  readonly opId: OpId;
  readonly changes: readonly Change[];
}

export type ChangeAction = Change['action'];
export interface ChangeResult {
  readonly id: ObjectId;
  readonly action: ChangeAction;
  /** All entries, including delete tombstones, equal the command's seq. */
  readonly version: BoardSeq;
}

/** POST success data (HTTP envelope is {data: CommandResult}); no bodies. */
export interface CommandResult {
  readonly seq: BoardSeq;
  readonly changes: readonly ChangeResult[];
}

export type CommittedChange =
  | {
    readonly id: ObjectId;
    readonly action: 'create';
    readonly version: BoardSeq;
    /** Full body with body.version === version === commit.seq. */
    readonly body: BoardObject;
    readonly patch?: never;
  }
  | {
    readonly id: ObjectId;
    readonly action: 'update';
    readonly version: BoardSeq;
    readonly patch: ObjectPatch;
    readonly body?: never;
  }
  | {
    readonly id: ObjectId;
    readonly action: 'delete';
    readonly version: BoardSeq;
    readonly body?: never;
    readonly patch?: never;
  };

/** BOARD_COMMIT payload d, not the gateway envelope; seq is board-local. */
export interface Commit {
  readonly channelId: BoardId;
  readonly opId: OpId;
  readonly seq: BoardSeq;
  readonly userId: UserId;
  readonly changes: readonly CommittedChange[];
}

export type RejectCode = 'conflict' | 'gone' | 'invalid' | 'limit' | 'forbidden';

/** HTTP 409 body. seq is the locked board seq at evaluation, NOT a new commit.
 * current contains every touched id still present; absent entries prove absence
 * AS OF seq, not a particular deletion version. A failed board-seq guard is
 * conflict even if the id is absent. No state is written/published on rejection.
 */
export interface ConflictResponse {
  readonly error: string;
  readonly code: 'conflict' | 'gone';
  readonly seq: BoardSeq;
  readonly current: readonly BoardObject[];
}

/** HTTP mapping for the adapter; 409 additionally requires ConflictResponse.
 * 401 is handled by app auth; 404 is a board lifecycle failure. Network/5xx and
 * unrecognized/malformed responses reject the Promise, never fabricate absence.
 * 429 maps to limit when the future per-user rate limiter is installed.
 */
export const REJECT_CODE_BY_HTTP_STATUS = {
  400: 'invalid', 403: 'forbidden', 413: 'limit', 429: 'limit',
} as const;

/** Normalized adapter value: attach opId to 409; other errors have no current
 * state evidence. Reconcile whole objects, not patches; cancel failed optimistic
 * work and dependents. A transport failure is NOT a Reject.
 */
export type Reject =
  | (ConflictResponse & { readonly opId: OpId })
  | {
    readonly opId: OpId;
    readonly code: Exclude<RejectCode, 'conflict' | 'gone'>;
    readonly error: string;
    readonly current: readonly [];
    readonly seq?: never;
  };

/** GET /channels/:id/board data, read in one consistent server transaction. */
export interface Snapshot {
  readonly seq: BoardSeq;
  readonly objects: readonly BoardObject[];
}

/**
 * Frozen reconciliation protocol (store owns confirmed state + pending overlay):
 * - Dispatch applies optimistically immediately and queues the command. Object
 *   version is the last confirmed board seq, NOT a local increment; new = 0.
 * - Apply commits atomically to CONFIRMED state, then replay pending absolute
 *   patches in dispatch order. Never apply a patch twice to the optimistic map.
 *   Every committed create/update gets version=seq; deletes retain a seq
 *   tombstone internally so old writes cannot resurrect objects. For each id,
 *   skip a change if its version <= the known object/tombstone version (reject
 *   reconciliation may already have supplied a newer body). Never roll back
 *   an object to an older version from a late reject response either. Missing
 *   conflict/gone ids acquire an absence watermark at reject.seq, so delayed
 *   commits <= that seq cannot resurrect them. Rejections older than the latest
 *   snapshot (or per-id evidence) cannot replace newer evidence. A reject ahead
 *   of contiguous seq exposes a gap, but NEVER advances the contiguous seq.
 *   A GET older than already observed reject evidence cannot rewind it.
 * - seq <= confirmed seq: ignore state changes, but acknowledge a matching
 *   pending opId. seq == confirmed seq+1: apply and drain contiguous buffered
 *   commits. seq > confirmed seq+1: buffer, hold 300 ms for the missing commit,
 *   then refetch if the gap remains. Do not advance seq past an open gap.
 * - HTTP ack and gateway echo may arrive in either order. Both acknowledge the
 *   SAME opId, once. The HTTP result can reconstruct that op's commit using its
 *   exact submitted changes (server validates, never normalizes fields); apply
 *   the same sequence rules. A later echo is a duplicate, not another write.
 * - Join/every READY: subscribe, await BOARD_SUBSCRIBED with timeout, buffer
 *   commits, fetch snapshot, apply buffered seq > snapshot.seq, then replay
 *   pending ops. An old backend ignoring subscribe must time out, not hang.
 * - Refetch replaces confirmed state, never blindly clears pending. Drop ops
 *   known accepted at/below snapshot.seq. Replay compatible pending overlays;
 *   incompatible ones are not silently retargeted to somebody else's version.
 *   Unknown outcomes are resolved by resending the original idempotent opId.
 * - Once sent, command bytes/preconditions are immutable. Serialise dependent
 *   local writes to the same id: queued UPDATE/DELETE version=0 is LOCAL ONLY
 *   (create's explicit 0 is valid on the wire). Resolve dependent preconditions
 *   after their own predecessor ack, or cancel on predecessor reject.
 *   Only advance preconditions through acknowledged OWN predecessor writes,
 *   never through remote writes. No answer after 5 s: resend once unchanged;
 *   another 5 s without answer triggers refetch (no unbounded resend loop).
 *   Never automatically resend an unresolved op after its idempotency TTL;
 *   adopt a fresh snapshot and surface the unknown outcome instead. After the
 *   second timeout's successful refetch (or recovery after TTL expiry), the
 *   coordinator abandons still-unresolved exhausted/expired ops and dependents,
 *   with an explicit "outcome unknown" notice. Never infer an ack
 *   just because snapshot fields equal a patch; late accepted commits still apply.
 * - Undo/redo are new conditional commands, local own actions only. Capture
 *   before-images; wait for the reverted op's ack and ordered integration.
 *   Skip each object whose current version differs from that history entry's
 *   last acknowledged version (including another person's edit); do not skip
 *   whole commands unnecessarily. Server still enforces atomicity on the
 *   remaining changes. Undo of create deletes; undo of delete recreates only
 *   if absent with the known deletion tombstone still unchanged. A snapshot
 *   carries no tombstones: invalidate absence-dependent history that cannot be
 *   proven safe after refetch. Re-creation uses expectedVersion=0 and
 *   expectedSeq=current contiguous seq, checked atomically by the server;
 *   local tombstone checks alone do not protect against an unseen ABA race.
 *   Re-created bodies have createdBy=local user, not the original creator.
 *   Redo inverts the acknowledged undo. HistoryReport exposes per-id skips.
 *   Creates require absence, so undo never overwrites an existing object.
 */
export interface PendingOperation {
  readonly command: Command;
  readonly status: 'queued' | 'sending' | 'retrying' | 'acknowledged';
  /** Actual submissions: 0, 1 or 2. */
  readonly attempts: 0 | 1 | 2;
  /** Present after HTTP ack, even when sequence integration is still buffered. */
  readonly acknowledgedSeq?: BoardSeq;
}
