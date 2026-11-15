import { api } from '../../../lib/api';
import { onGatewayClose, onGatewayEvent, onGatewayReady, sendGateway } from '../../../hooks/useGateway';
import {
  BOARD_SUBSCRIBE_TIMEOUT_MS, MAX_COORDINATE, MAX_CURSOR_PRESENCE_HZ, MAX_LASER_POINTS,
  MAX_OTHER_PRESENCE_HZ, MAX_PRESENCE_BYTES, PRESENCE_EXPIRY_MS, REJECT_CODE_BY_HTTP_STATUS,
} from '../contract';
import type {
  BoardId, BoardObject, BoardSeq, Command, CommandResult, Commit, ObjectId, OpId, Participant,
  Point, PresenceDrag, PresenceFields, PresenceParticipant, PurgeFilter, PurgeResult, Rect, Reject,
  Snapshot, SyncAdapter, SyncStatus, Unsubscribe, UploadedAsset, UserId,
} from '../contract';
import { jsonBytes } from './validation';
import { retryAfterMs } from './coordinator';

export interface NetworkAdapterOptions {
  /** The channel id; also the gateway room key. Must equal the store's board id. */
  readonly boardId: BoardId;
  /**
   * The signed-in user; must equal the store's user id. getPresence includes
   * this user (name/colour from the room) with default presence fields, so
   * drawing and soft-lock consumers must skip it.
   */
  readonly userId: UserId;
  /** Display-name lookup (guild roster); the payload's name is the fallback. */
  readonly resolveName?: (userId: UserId) => string | undefined;
}

type SyncKind = 'connect' | 'refetch' | 'recover';

const CURSOR_INTERVAL_MS = Math.ceil(1000 / MAX_CURSOR_PRESENCE_HZ);
const OTHER_INTERVAL_MS = Math.ceil(1000 / MAX_OTHER_PRESENCE_HZ);
/** Own non-default presence is re-sent at this cadence so peers do not expire it (< expiry). */
const KEEPALIVE_MS = PRESENCE_EXPIRY_MS / 2;
const RECOVERY_RETRY_MS = 5_000;
const MAX_SYNC_PASSES = 3;
const MAX_PRESENCE_IDS = 500;

const SUBSCRIBE_TIMEOUT_MESSAGE =
  'Board realtime did not answer. The server may not support boards yet; try again after it has been updated.';

function abortError(): Error {
  return new DOMException('Board adapter disposed', 'AbortError');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSeq(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parsePoint(value: unknown): Point | undefined {
  return isRecord(value) && finiteNumber(value.x) && finiteNumber(value.y) ? { x: value.x, y: value.y } : undefined;
}

function parseRect(value: unknown): Rect | undefined {
  return isRecord(value) && finiteNumber(value.x) && finiteNumber(value.y) &&
    finiteNumber(value.w) && finiteNumber(value.h) && value.w >= 0 && value.h >= 0
    ? { x: value.x, y: value.y, w: value.w, h: value.h } : undefined;
}

function parseIds(value: unknown): ObjectId[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value.filter((id): id is string => typeof id === 'string').slice(0, MAX_PRESENCE_IDS);
  return ids;
}

function parseDrag(value: unknown): PresenceDrag | undefined {
  if (!isRecord(value) || !finiteNumber(value.dx) || !finiteNumber(value.dy)) return undefined;
  const ids = parseIds(value.ids);
  return ids ? { ids, dx: value.dx, dy: value.dy } : undefined;
}

function parseLaser(value: unknown): Point[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LASER_POINTS) return undefined;
  const pts: Point[] = [];
  for (const item of value) {
    if (!isRecord(item) || Object.keys(item).length !== 2 || !finiteNumber(item.x) || !finiteNumber(item.y) ||
      Math.abs(item.x) > MAX_COORDINATE || Math.abs(item.y) > MAX_COORDINATE) return undefined;
    pts.push({ x: item.x, y: item.y });
  }
  return pts;
}

/** Incoming presence fields -> sanitized partial update (undefined = leave unchanged). */
interface PresenceUpdate {
  cursor?: Point | null;
  selectedIds?: readonly ObjectId[];
  editingId?: ObjectId | null;
  drag?: PresenceDrag | null;
  viewport?: Rect | null;
  laser?: readonly Point[] | null;
}

function parsePresenceFields(d: Record<string, unknown>): PresenceUpdate {
  const update: PresenceUpdate = {};
  if (d.cursor === null) update.cursor = null;
  else if (d.cursor !== undefined) { const v = parsePoint(d.cursor); if (v) update.cursor = v; }
  if (d.selectedIds !== undefined) { const v = parseIds(d.selectedIds); if (v) update.selectedIds = v; }
  if (d.editingId === null) update.editingId = null;
  else if (typeof d.editingId === 'string') update.editingId = d.editingId;
  if (d.drag === null) update.drag = null;
  else if (d.drag !== undefined) { const v = parseDrag(d.drag); if (v) update.drag = v; }
  if (d.viewport === null) update.viewport = null;
  else if (d.viewport !== undefined) { const v = parseRect(d.viewport); if (v) update.viewport = v; }
  if (d.laser === null) update.laser = null;
  else if (d.laser !== undefined) { const v = parseLaser(d.laser); if (v) update.laser = v; }
  return update;
}

function hasActiveFields(p: PresenceParticipant): boolean {
  return p.cursor !== null || p.selectedIds.length > 0 || p.editingId !== null || p.drag !== null || p.viewport !== null || (p.laser != null && p.laser.length > 0);
}

function httpStatus(error: unknown): number | undefined {
  if (!isRecord(error) || !isRecord(error.response)) return undefined;
  return typeof error.response.status === 'number' ? error.response.status : undefined;
}

function httpMessage(error: unknown, fallback: string): string {
  if (isRecord(error) && isRecord(error.response) && isRecord(error.response.data) &&
    typeof error.response.data.error === 'string' && error.response.data.error) return error.response.data.error;
  return fallback;
}

function isCanceled(error: unknown): boolean {
  return isRecord(error) && (error.code === 'ERR_CANCELED' || error.name === 'CanceledError' || error.name === 'AbortError');
}

const UPLOAD_FALLBACK = 'The image could not be uploaded. Try again.';
const PURGE_FALLBACK = 'Could not remove objects. Try again.';

/** A message fit to show the user: the server's own text where it is written for them. */
function uploadFailureMessage(error: unknown): string {
  const status = httpStatus(error);
  if (status === undefined) return "Couldn't reach the server. Check your connection and try again.";
  if (status === 400 || status === 413 || status === 429) return httpMessage(error, UPLOAD_FALLBACK);
  if (status === 403) return "You can't add images to this board.";
  if (status === 404) return 'This board is no longer available.';
  return UPLOAD_FALLBACK;
}

export function purgeFailureMessage(error: unknown): string {
  const status = httpStatus(error);
  if (status === undefined) return "Couldn't reach the server. Check your connection and try again.";
  if (status === 403) return httpMessage(error, 'You do not have permission to manage this channel.');
  if (status === 429) {
    const delay = retryAfterMs(error);
    const sec = delay !== undefined ? Math.max(1, Math.ceil(delay / 1000)) : undefined;
    const msg = httpMessage(error, '');
    if (msg) return sec !== undefined && !msg.includes(String(sec)) ? `${msg} (retry after ${sec}s)` : msg;
    return sec !== undefined ? `Too many requests — try again in ${sec}s.` : 'Too many requests — try again in a moment.';
  }
  if (status === 400 || status === 422) return httpMessage(error, PURGE_FALLBACK);
  if (status === 404) return 'This board is no longer available.';
  return httpMessage(error, PURGE_FALLBACK);
}

function parsePurgeResult(value: unknown): PurgeResult {
  if (!isRecord(value) || typeof value.deleted !== 'number' || !Number.isSafeInteger(value.deleted) || value.deleted < 0) {
    throw new Error('Malformed board purge response');
  }
  return { deleted: value.deleted };
}

export async function purgeBoard(
  boardId: BoardId,
  filter: PurgeFilter,
  signal?: AbortSignal,
): Promise<PurgeResult> {
  const body: Record<string, unknown> = {};
  if (filter.createdBy !== undefined) body.createdBy = filter.createdBy;
  if (filter.rect !== undefined) {
    body.rect = { x: filter.rect.x, y: filter.rect.y, w: filter.rect.w, h: filter.rect.h };
  }
  let response: unknown;
  try {
    response = await api.post(`/channels/${boardId}/board/purge`, body, signal ? { signal } : undefined);
  } catch (error) {
    if (isCanceled(error)) throw abortError();
    throw new Error(purgeFailureMessage(error), { cause: error });
  }
  return parsePurgeResult(envelope(response));
}

function parseUploadedAsset(value: unknown): UploadedAsset {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.url !== 'string' || !value.url ||
    !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height)) {
    throw new Error('Malformed asset upload response');
  }
  return { id: value.id, url: value.url, width: value.width as number, height: value.height as number };
}

function envelope(response: unknown): unknown {
  return isRecord(response) && isRecord(response.data) ? response.data.data : undefined;
}

function parseSnapshot(value: unknown): Snapshot {
  if (!isRecord(value) || !isSeq(value.seq) || !Array.isArray(value.objects)) throw new Error('Malformed board snapshot');
  return { seq: value.seq, objects: value.objects as BoardObject[] };
}

function parseCommandResult(value: unknown): CommandResult {
  if (!isRecord(value) || !isSeq(value.seq) || !Array.isArray(value.changes)) throw new Error('Malformed board command result');
  return value as unknown as CommandResult;
}

/**
 * The real SyncAdapter: board state over HTTP (snapshot + commands), live
 * commits and ephemeral presence over the app's single gateway socket. It never
 * touches the store; the coordinator owns that (see SyncAdapter's comment).
 */
export function createNetworkAdapter(options: NetworkAdapterOptions): SyncAdapter {
  const { boardId, userId } = options;
  const snapshotPath = `/channels/${boardId}/board`;
  const opsPath = `${snapshotPath}/ops`;
  const assetsPath = `${snapshotPath}/assets`;

  let disposed = false;
  let started = false;
  let status: SyncStatus = 'offline';
  /** True once BOARD_SUBSCRIBED arrived on the CURRENT socket. */
  let subscribed = false;
  let readyCount = 0;
  let inflight: { kind: SyncKind; promise: Promise<Snapshot> } | null = null;
  let recoverAfter = false;
  let gated = false;
  let deliveryFloor: BoardSeq = 0;
  let buffered: Commit[] = [];
  let waiter: { resend(): void; resolve(): void; reject(error: Error): void } | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const abort = new AbortController();
  const gatewayUnsubs: Unsubscribe[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const statusListeners = new Set<(status: SyncStatus) => void>();
  const commitListeners = new Set<(commit: Commit) => void>();
  const snapshotListeners = new Set<(snapshot: Snapshot) => void>();
  const presenceListeners = new Set<(participants: readonly PresenceParticipant[]) => void>();

  function listen<T>(listeners: Set<(value: T) => void>, listener: (value: T) => void): Unsubscribe {
    if (!disposed) listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  function setStatus(next: SyncStatus): void {
    if (status === next) return;
    status = next;
    for (const listener of [...statusListeners]) listener(next);
  }

  function schedule(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!disposed) callback();
    }, delay);
    timers.add(timer);
    return timer;
  }

  function cancelTimer(timer: ReturnType<typeof setTimeout> | undefined): void {
    if (timer === undefined) return;
    clearTimeout(timer);
    timers.delete(timer);
  }

  // ---- commits ---------------------------------------------------------

  function deliver(commit: Commit): void {
    if (gated) buffered.push(commit);
    else if (commit.seq > deliveryFloor) for (const listener of [...commitListeners]) listener(commit);
  }

  function onCommitEvent(d: unknown): void {
    if (disposed || !isRecord(d) || d.channelId !== boardId || !isSeq(d.seq) || !Array.isArray(d.changes)) return;
    deliver(d as unknown as Commit);
  }

  // ---- sync (connect / refetch / recovery) -----------------------------

  function subscribeRoom(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (disposed) { reject(abortError()); return; }
      let timer: ReturnType<typeof setTimeout> | undefined;
      // The timeout measures an OPEN socket's silence (an old backend ignoring
      // the op). While the gateway is still (re)connecting -- its backoff can
      // exceed the timeout -- nothing was sent, so wait for READY instead of
      // failing the board permanently.
      const send = () => {
        if (!sendGateway('BOARD_SUBSCRIBE', { channelId: boardId })) return;
        cancelTimer(timer);
        timer = schedule(() => current.reject(new Error(SUBSCRIBE_TIMEOUT_MESSAGE)), BOARD_SUBSCRIBE_TIMEOUT_MS);
      };
      const finish = (settle: () => void) => () => {
        cancelTimer(timer);
        if (waiter === current) waiter = null;
        settle();
      };
      const current = {
        resend: send,
        resolve: finish(resolve),
        reject: (error: Error) => finish(() => reject(error))(),
      };
      waiter = current;
      // Socket not open yet: the next READY triggers resend().
      send();
    });
  }

  /** Settles with `promise`, or rejects at once on dispose even if the transport ignores the signal. */
  function untilDisposed<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (abort.signal.aborted) { reject(abortError()); return; }
      const onAbort = () => reject(abortError());
      abort.signal.addEventListener('abort', onAbort, { once: true });
      promise.then(resolve, reject).finally(() => abort.signal.removeEventListener('abort', onAbort));
    });
  }

  async function fetchSnapshot(): Promise<Snapshot> {
    for (;;) {
      let response: unknown;
      try {
        response = await untilDisposed(api.get(snapshotPath, { signal: abort.signal }));
      } catch (error) {
        if (disposed || isCanceled(error)) throw abortError();
        const delay = retryAfterMs(error);
        if (delay !== undefined) {
          await untilDisposed(new Promise<void>(resolve => { schedule(resolve, delay); }));
          continue;
        }
        throw error;
      }
      if (disposed) throw abortError();
      return parseSnapshot(envelope(response));
    }
  }

  function flushLater(): void {
    schedule(() => {
      gated = false;
      const commits = buffered;
      buffered = [];
      for (const commit of commits) deliver(commit);
    }, 0);
  }

  async function runSync(kind: SyncKind): Promise<Snapshot> {
    gated = true;
    buffered = [];
    if (kind !== 'refetch') setStatus(kind === 'connect' ? 'connecting' : 'resyncing');
    else if (status === 'live') setStatus('resyncing');
    try {
      let snapshot: Snapshot | undefined;
      for (let pass = 0; pass < MAX_SYNC_PASSES; pass++) {
        if (kind !== 'refetch' && !subscribed) await subscribeRoom();
        const mark = readyCount;
        snapshot = await fetchSnapshot();
        // A READY (new socket) during the GET invalidated the subscription.
        if (kind === 'refetch' || (subscribed && readyCount === mark)) break;
        snapshot = undefined;
      }
      if (!snapshot) throw new Error('Board connection kept changing; could not sync');
      deliveryFloor = snapshot.seq;
      if (kind === 'recover') {
        for (const listener of [...snapshotListeners]) listener(snapshot);
      }
      setStatus(kind === 'refetch' && !subscribed ? status : 'live');
      flushLater();
      return snapshot;
    } catch (error) {
      gated = false;
      buffered = [];
      if (!disposed) setStatus('offline');
      throw error;
    }
  }

  function startSync(kind: SyncKind): Promise<Snapshot> {
    if (disposed) return Promise.reject(abortError());
    if (inflight) return inflight.promise;
    const promise = runSync(kind);
    const entry = { kind, promise };
    inflight = entry;
    const settled = () => {
      if (inflight === entry) inflight = null;
      if (disposed) return;
      if (recoverAfter) { recoverAfter = false; void recover(); }
    };
    promise.then(settled, settled);
    return promise;
  }

  function recover(): Promise<void> {
    cancelTimer(retryTimer);
    retryTimer = undefined;
    return startSync('recover').then(() => undefined, error => {
      if (disposed || !started || isCanceled(error)) return;
      console.warn('whiteboard: board recovery failed', error);
      retryTimer = schedule(() => { retryTimer = undefined; void recover(); }, RECOVERY_RETRY_MS);
    });
  }

  function onReady(): void {
    if (disposed || !started) return;
    readyCount += 1;
    subscribed = false;
    if (waiter) waiter.resend();
    else if (!inflight) void recover();
    else if (inflight.kind === 'refetch') recoverAfter = true;
  }

  function onClose(): void {
    if (disposed || !started) return;
    subscribed = false;
    setStatus('offline');
    clearParticipants();
  }

  function onSubscribed(d: unknown): void {
    if (disposed || !isRecord(d) || d.channelId !== boardId) return;
    subscribed = true;
    replaceParticipants(d.participants);
    waiter?.resolve();
    // The new room has no memory of us: re-announce everything we know.
    pending = { ...own };
    flushPresence();
  }

  // ---- HTTP submit -----------------------------------------------------

  async function submit(command: Command): Promise<CommandResult | Reject> {
    if (disposed) throw abortError();
    let response: unknown;
    try {
      response = await untilDisposed(api.post(opsPath, command, { signal: abort.signal }));
    } catch (error) {
      if (disposed || isCanceled(error)) throw abortError();
      const statusCode = httpStatus(error);
      if (statusCode === 409) {
        const body = isRecord(error) && isRecord(error.response) ? error.response.data : undefined;
        if (!isRecord(body) || (body.code !== 'conflict' && body.code !== 'gone') ||
          !isSeq(body.seq) || !Array.isArray(body.current) || typeof body.error !== 'string') {
          throw new Error('Malformed board conflict response', { cause: error });
        }
        return { opId: command.opId, error: body.error, code: body.code, seq: body.seq, current: body.current as BoardObject[] };
      }
      if (statusCode !== undefined && statusCode !== 429 && statusCode in REJECT_CODE_BY_HTTP_STATUS) {
        const code = REJECT_CODE_BY_HTTP_STATUS[statusCode as keyof typeof REJECT_CODE_BY_HTTP_STATUS];
        return { opId: command.opId as OpId, code, error: httpMessage(error, `Board change rejected (${statusCode})`), current: [] };
      }
      throw error; // network, 401 after refresh, 404, 429, 5xx: a transport/rate-limit error, never a Reject
    }
    if (disposed) throw abortError();
    return parseCommandResult(envelope(response));
  }

  // ---- asset upload ----------------------------------------------------

  async function uploadAsset(file: Blob): Promise<UploadedAsset> {
    if (disposed) throw abortError();
    const form = new FormData();
    form.append('file', file);
    let response: unknown;
    try {
      response = await untilDisposed(api.post(assetsPath, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        signal: abort.signal,
      }));
    } catch (error) {
      if (disposed || isCanceled(error)) throw abortError();
      throw new Error(uploadFailureMessage(error), { cause: error });
    }
    if (disposed) throw abortError();
    return parseUploadedAsset(envelope(response));
  }

  async function purge(filter: PurgeFilter): Promise<PurgeResult> {
    if (disposed) throw abortError();
    return untilDisposed(purgeBoard(boardId, filter, abort.signal));
  }

  // ---- presence: incoming ---------------------------------------------

  const participants = new Map<UserId, PresenceParticipant>();
  let presenceView: readonly PresenceParticipant[] = Object.freeze([]);
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;

  function notifyPresence(): void {
    presenceView = Object.freeze([...participants.values()]);
    for (const listener of [...presenceListeners]) listener(presenceView);
    scheduleExpiry();
  }

  function nameFor(id: UserId, fallback: unknown): string {
    const resolved = options.resolveName?.(id);
    if (resolved) return resolved;
    return typeof fallback === 'string' && fallback ? fallback : 'Someone';
  }

  /** Self is a member too (Participants shows it first); its presence fields stay default. */
  function makeParticipant(value: Record<string, unknown>): PresenceParticipant | undefined {
    if (typeof value.userId !== 'string' || !value.userId) return undefined;
    const colourIndex = typeof value.colourIndex === 'number' && Number.isInteger(value.colourIndex) && value.colourIndex >= 0
      ? value.colourIndex : 0;
    const base: Participant = { userId: value.userId, name: nameFor(value.userId, value.name), colourIndex };
    return {
      ...base, cursor: null, selectedIds: [], editingId: null, drag: null, viewport: null, lastSeenAt: Date.now(),
    };
  }

  function replaceParticipants(list: unknown): void {
    participants.clear();
    if (Array.isArray(list)) {
      for (const item of list) {
        const participant = isRecord(item) ? makeParticipant(item) : undefined;
        if (participant) participants.set(participant.userId, participant);
      }
    }
    notifyPresence();
  }

  function clearParticipants(): void {
    if (!participants.size) return;
    participants.clear();
    notifyPresence();
  }

  function onJoin(d: unknown): void {
    if (disposed || !isRecord(d) || d.channelId !== boardId) return;
    const next = makeParticipant(d);
    if (!next) return;
    const existing = participants.get(next.userId);
    participants.set(next.userId, existing ? { ...existing, name: next.name, colourIndex: next.colourIndex } : next);
    notifyPresence();
  }

  function onLeave(d: unknown): void {
    if (disposed || !isRecord(d) || d.channelId !== boardId || typeof d.userId !== 'string') return;
    if (participants.delete(d.userId)) notifyPresence();
  }

  function onPresenceEvent(d: unknown): void {
    if (disposed || !isRecord(d) || d.channelId !== boardId || typeof d.userId !== 'string' || d.userId === userId) return;
    const existing = participants.get(d.userId);
    if (!existing) return; // JOIN/SUBSCRIBED always precede presence; never invent a participant
    participants.set(d.userId, { ...existing, ...parsePresenceFields(d), lastSeenAt: Date.now() });
    notifyPresence();
  }

  function scheduleExpiry(): void {
    if (expiryTimer !== undefined || disposed) return;
    let earliest = Infinity;
    for (const participant of participants.values()) {
      if (hasActiveFields(participant)) earliest = Math.min(earliest, participant.lastSeenAt + PRESENCE_EXPIRY_MS);
    }
    if (!Number.isFinite(earliest)) return;
    expiryTimer = schedule(() => {
      expiryTimer = undefined;
      const now = Date.now();
      let changed = false;
      for (const [id, participant] of participants) {
        if (hasActiveFields(participant) && now - participant.lastSeenAt >= PRESENCE_EXPIRY_MS) {
          participants.set(id, { ...participant, cursor: null, selectedIds: [], editingId: null, drag: null, viewport: null, laser: null });
          changed = true;
        }
      }
      if (changed) notifyPresence();
      else scheduleExpiry();
    }, Math.max(0, earliest - Date.now()));
  }

  // ---- presence: outgoing ---------------------------------------------

  /** Latest known own value per field (re-announced on every subscribe / keepalive). */
  let own: PresenceFields = {};
  /** Fields waiting for their rate-limit window. */
  let pending: PresenceFields = {};
  /** Any BOARD_PRESENCE frame: the server's token bucket counts frames, not fields. */
  let lastSendAt = -Infinity;
  let lastOtherAt = -Infinity;
  let presenceTimer: ReturnType<typeof setTimeout> | undefined;
  let keepaliveTimer: ReturnType<typeof setTimeout> | undefined;

  /** Shrink id arrays until the stamped payload fits; undefined if it cannot fit. */
  function fit(fields: Record<string, unknown>): Record<string, unknown> | undefined {
    const payload = { channelId: boardId, ...fields } as Record<string, unknown>;
    // The cap applies to the server-stamped form, so measure with userId included.
    const size = () => jsonBytes({ ...payload, userId });
    for (let guard = 0; guard < 16 && size() > MAX_PRESENCE_BYTES; guard++) {
      const selected = Array.isArray(payload.selectedIds) ? payload.selectedIds as ObjectId[] : [];
      const drag = isRecord(payload.drag) ? payload.drag as unknown as PresenceDrag : null;
      const dragIds = drag?.ids ?? [];
      const laser = Array.isArray(payload.laser) ? payload.laser as Point[] : [];
      if (!selected.length && !dragIds.length && laser.length <= 1) return undefined;
      if (laser.length > 1 && laser.length >= selected.length && laser.length >= dragIds.length) {
        payload.laser = laser.slice(Math.ceil(laser.length / 2));
      } else if (selected.length >= dragIds.length && selected.length > 0) {
        payload.selectedIds = selected.slice(0, Math.floor(selected.length / 2));
      } else {
        payload.drag = { ...drag!, ids: dragIds.slice(0, Math.floor(dragIds.length / 2)) };
      }
    }
    return size() > MAX_PRESENCE_BYTES ? undefined : payload;
  }

  function flushPresence(): void {
    cancelTimer(presenceTimer);
    presenceTimer = undefined;
    const keys = Object.keys(pending) as (keyof PresenceFields)[];
    if (!keys.length) return;
    if (!subscribed) return; // re-announced from `own` on the next BOARD_SUBSCRIBED
    const now = Date.now();
    // The server allows MAX_CURSOR_PRESENCE_HZ frames per second in total and
    // silently drops the excess. Separate cursor and other-field frames would
    // reach 20 + 5 per second while dragging, losing selection/drag/editing
    // updates (including drag=null). So every frame shares the cursor window;
    // non-cursor fields are additionally held to MAX_OTHER_PRESENCE_HZ and
    // ride along in the same frame as the cursor.
    const cursorReady = now - lastSendAt >= CURSOR_INTERVAL_MS;
    const otherReady = cursorReady && now - lastOtherAt >= OTHER_INTERVAL_MS;
    const out: Record<string, unknown> = {};
    const rest: Record<string, unknown> = {};
    let sendsCursor = false;
    let sendsOther = false;
    for (const key of keys) {
      const isCursor = key === 'cursor' || key === 'laser';
      if (isCursor ? cursorReady : otherReady) {
        out[key] = pending[key];
        if (isCursor) sendsCursor = true; else sendsOther = true;
      } else rest[key] = pending[key];
    }
    pending = rest as PresenceFields;
    if (sendsCursor || sendsOther) {
      const payload = fit(out);
      if (payload && sendGateway('BOARD_PRESENCE', payload)) {
        lastSendAt = now;
        if (sendsOther) lastOtherAt = now;
        scheduleKeepalive();
      }
    }
    const waits: number[] = [];
    if ('cursor' in rest || 'laser' in rest) waits.push(lastSendAt + CURSOR_INTERVAL_MS - now);
    if (Object.keys(rest).some(key => key !== 'cursor' && key !== 'laser')) {
      waits.push(Math.max(lastSendAt + CURSOR_INTERVAL_MS, lastOtherAt + OTHER_INTERVAL_MS) - now);
    }
    if (waits.length) presenceTimer = schedule(flushPresence, Math.max(1, Math.min(...waits)));
  }

  function ownActive(): boolean {
    return own.cursor != null || (own.selectedIds?.length ?? 0) > 0 || own.editingId != null ||
      own.drag != null || own.viewport != null;
  }

  function scheduleKeepalive(): void {
    cancelTimer(keepaliveTimer);
    keepaliveTimer = undefined;
    if (!ownActive()) return;
    keepaliveTimer = schedule(() => {
      keepaliveTimer = undefined;
      if (!ownActive() || !subscribed) return;
      const { laser: _laser, ...restOwn } = own;
      void _laser;
      pending = { ...restOwn, ...pending };
      flushPresence();
      scheduleKeepalive();
    }, KEEPALIVE_MS);
  }

  function sendPresence(fields: PresenceFields): void {
    if (disposed) return;
    const merged: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) merged[key] = value;
    if (!Object.keys(merged).length) return;
    own = { ...own, ...merged };
    pending = { ...pending, ...merged };
    flushPresence();
  }

  // ---- lifecycle -------------------------------------------------------

  function connect(): Promise<Snapshot> {
    if (disposed) return Promise.reject(abortError());
    started = true;
    if (!gatewayUnsubs.length) {
      gatewayUnsubs.push(
        onGatewayEvent('BOARD_SUBSCRIBED', onSubscribed),
        onGatewayEvent('BOARD_COMMIT', onCommitEvent),
        onGatewayEvent('BOARD_PRESENCE', onPresenceEvent),
        onGatewayEvent('BOARD_JOIN', onJoin),
        onGatewayEvent('BOARD_LEAVE', onLeave),
        onGatewayReady(onReady),
        onGatewayClose(onClose),
      );
    }
    const result = startSync('connect');
    // A failed bootstrap leaves nothing running: the caller reports it and may retry connect().
    result.catch(() => { if (!disposed && !inflight) started = false; });
    return result;
  }

  function dispose(): void {
    if (disposed) return;
    if (started && (subscribed || waiter)) sendGateway('BOARD_UNSUBSCRIBE', { channelId: boardId });
    disposed = true;
    abort.abort();
    waiter?.reject(abortError());
    for (const unsubscribe of gatewayUnsubs) unsubscribe();
    gatewayUnsubs.length = 0;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    presenceTimer = undefined; keepaliveTimer = undefined; expiryTimer = undefined; retryTimer = undefined;
    buffered = [];
    pending = {}; own = {};
    participants.clear();
    presenceView = Object.freeze([]);
    if (status !== 'offline') {
      status = 'offline';
      for (const listener of [...statusListeners]) listener('offline');
    }
    statusListeners.clear(); commitListeners.clear(); snapshotListeners.clear(); presenceListeners.clear();
  }

  return {
    connect,
    dispose,
    submit,
    refetch: () => startSync('refetch'),
    getStatus: () => status,
    onStatus: listener => listen(statusListeners, listener),
    onCommit: listener => listen(commitListeners, listener),
    onSnapshot: listener => listen(snapshotListeners, listener),
    sendPresence,
    getPresence: () => presenceView,
    subscribePresence: listener => listen(presenceListeners, listener),
    uploadAsset,
    purge,
  };
}
