import { CURSOR_IDLE_FADE_MS } from '../../contract';
import type { BoardObject, BoardStore, ObjectId, Point, PresenceParticipant, Runtime, SyncAdapter, UserId } from '../../contract';
import { createGhostObject } from './ghostObject';

const INTERPOLATION_MS = 80;
/** The frozen contract value; presence itself expires separately (PRESENCE_EXPIRY_MS). */
const FADE_MS = CURSOR_IDLE_FADE_MS;
const HIDE_MS = 60_000;
interface Motion {
  from: Point;
  to: Point;
  sampledAt: number;
  movedAt: number;
}
interface DragGhost {
  key: string;
  originals: readonly BoardObject[];
  nodes: HTMLElement[];
  suppressed: boolean;
  painted: boolean;
}
function equalPoint(a: Point, b: Point): boolean { return a.x === b.x && a.y === b.y; }
function interpolate(motion: Motion, now: number, reduced: boolean): Point {
  const t = reduced ? 1 : Math.min(1, Math.max(0, (now - motion.sampledAt) / INTERPOLATION_MS));
  return { x: motion.from.x + (motion.to.x - motion.from.x) * t, y: motion.from.y + (motion.to.y - motion.from.y) * t };
}

/** One rAF for all presence, camera, selection and ghost DOM writes. */
export function createPresencePainter(root: HTMLElement, adapter: SyncAdapter, runtime: Runtime, store: BoardStore, selfUserId: UserId) {
  let frame: number | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let participants = adapter.getPresence();
  const motions = new Map<UserId, Motion>();
  const ghosts = new Map<UserId, DragGhost>();
  const suppressedDrags = new Map<UserId, string>();
  const objectSubscriptions = new Map<ObjectId, () => void>();
  const reduced = root.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');

  function schedule(): void {
    if (!disposed && frame === null) frame = requestAnimationFrame(paint);
  }
  function observe(next: readonly PresenceParticipant[]): void {
    const now = Date.now();
    participants = next;
    const present = new Set(next.map(p => p.userId));
    for (const id of motions.keys()) if (!present.has(id)) motions.delete(id);
    for (const id of suppressedDrags.keys()) if (!present.has(id)) suppressedDrags.delete(id);
    // React removes departed members' hosts; paint removes ended drag shells.
    for (const id of ghosts.keys()) if (!present.has(id) || !next.find(p => p.userId === id)?.drag) ghosts.delete(id);
    const watched = new Set<ObjectId>();
    for (const p of next) {
      if (p.userId === selfUserId) continue;
      if (!p.drag || suppressedDrags.get(p.userId) !== JSON.stringify(p.drag.ids)) suppressedDrags.delete(p.userId);
      p.selectedIds.forEach(id => watched.add(id));
      p.drag?.ids.forEach(id => watched.add(id));
      if (p.drag && ghosts.get(p.userId)?.key !== JSON.stringify(p.drag.ids)) ghosts.set(p.userId, {
        key: JSON.stringify(p.drag.ids), originals: p.drag.ids.flatMap(id => store.getObject(id) ?? []),
        nodes: [], suppressed: false, painted: false,
      });
      const previous = motions.get(p.userId);
      if (!p.cursor) motions.delete(p.userId);
      else if (!previous) motions.set(p.userId, { from: p.cursor, to: p.cursor, sampledAt: now, movedAt: now });
      else if (!equalPoint(previous.to, p.cursor)) motions.set(p.userId, {
        from: interpolate(previous, now, !!reduced?.matches), to: p.cursor, sampledAt: now, movedAt: now,
      });
    }
    for (const [id, unsubscribe] of objectSubscriptions) if (!watched.has(id)) {
      unsubscribe(); objectSubscriptions.delete(id);
    }
    for (const id of watched) if (!objectSubscriptions.has(id)) objectSubscriptions.set(id, store.subscribeObject(id, schedule));
    schedule();
  }

  function paintGhosts(host: HTMLElement, p: PresenceParticipant): boolean {
    const key = p.drag ? JSON.stringify(p.drag.ids) : '';
    let ghost = ghosts.get(p.userId);
    if (!p.drag || ghost?.key !== key) {
      ghost?.nodes.forEach(node => node.remove());
      ghosts.delete(p.userId);
      host.replaceChildren();
      ghost = undefined;
    }
    if (!p.drag) { host.style.transform = ''; return false; }
    if (!ghost) {
      ghost = { key, originals: p.drag.ids.flatMap(id => store.getObject(id) ?? []), nodes: [], suppressed: false, painted: false };
      ghosts.set(p.userId, ghost);
    }
    // Presence can arrive before bootstrap hydration. Fill in missing sources
    // when they become available, retaining the captured base for known ids.
    if (ghost.originals.length < p.drag.ids.length && !ghost.suppressed) {
      const known = new Map(ghost.originals.map(object => [object.id, object]));
      const available = p.drag.ids.flatMap(id => known.get(id) ?? store.getObject(id) ?? []);
      if (available.length !== ghost.originals.length) {
        ghost.originals = available;
        ghost.painted = false;
      }
    }
    // A commit/snapshot/optimistic replacement must not apply the delta twice.
    // Latch suppression until drag:null (or a different id set), even if another
    // delayed presence sample arrives after that commit.
    if (!ghost.suppressed && (suppressedDrags.get(p.userId) === key || ghost.originals.some(original => {
      const current = store.getObject(original.id);
      return !current || current.version !== original.version || current.x !== original.x || current.y !== original.y;
    }))) {
      ghost.suppressed = true;
      suppressedDrags.set(p.userId, ghost.key);
      ghost.nodes.forEach(node => node.remove());
      ghost.nodes = [];
    }
    if (!ghost.painted) {
      host.replaceChildren();
      ghost.nodes = [];
      for (const object of ghost.suppressed ? [] : ghost.originals) {
        const node = createGhostObject(root.ownerDocument, object);
        host.appendChild(node);
        ghost.nodes.push(node);
      }
      ghost.painted = true;
    }
    if (ghost.suppressed) { host.style.transform = ''; return false; }
    const camera = runtime.getCamera();
    host.style.transform = `translate(${camera.x + p.drag.dx * camera.zoom}px, ${camera.y + p.drag.dy * camera.zoom}px) scale(${camera.zoom})`;
    return true;
  }

  function paintSelections(host: HTMLElement, p: PresenceParticipant, dragging: boolean): void {
    const wanted = new Set(p.selectedIds);
    const nodes = new Map(Array.from(host.children, node => [(node as HTMLElement).dataset.wbRemoteSelection, node as HTMLElement]));
    for (const [id, node] of nodes) if (!wanted.has(id!)) node.remove();
    const camera = runtime.getCamera();
    for (const id of p.selectedIds) {
      const object = store.getObject(id);
      let node = nodes.get(id);
      if (!object) { node?.remove(); continue; }
      if (!node) {
        node = root.ownerDocument.createElement('div');
        node.className = 'wb-presence-selection';
        node.dataset.wbRemoteSelection = id;
        const tag = root.ownerDocument.createElement('span');
        tag.className = 'wb-presence-selection-name';
        node.appendChild(tag);
        host.appendChild(node);
      }
      node.firstElementChild!.textContent = p.name;
      const drag = dragging && p.drag?.ids.includes(id) ? p.drag : null;
      const point = runtime.worldToScreen({ x: object.x + (drag?.dx ?? 0), y: object.y + (drag?.dy ?? 0) });
      Object.assign(node.style, { transform: `translate(${point.x}px, ${point.y}px)`, width: `${object.w * camera.zoom}px`, height: `${object.h * camera.zoom}px` });
    }
  }

  function paintLaser(container: Element | null, p: PresenceParticipant): void {
    if (!container) return;
    const path = container.querySelector<SVGPathElement>('[data-wb-remote-laser-path]');
    const trail = p.laser;
    if (!path || !trail || trail.length === 0) {
      container.setAttribute('hidden', '');
      path?.setAttribute('d', '');
      return;
    }
    const screenPoints = trail.map(pt => runtime.worldToScreen(pt));
    const d = screenPoints.length === 1
      ? `M${screenPoints[0].x},${screenPoints[0].y}L${screenPoints[0].x + 0.1},${screenPoints[0].y + 0.1}`
      : `M${screenPoints.map(pt => `${pt.x},${pt.y}`).join('L')}`;
    path.setAttribute('d', d);
    container.removeAttribute('hidden');
  }

  function paint(): void {
    frame = null;
    if (disposed) return;
    clearTimeout(idleTimer);
    let nextWake = Infinity;
    let animating = false;
    const now = Date.now();
    const viewport = root.closest<HTMLElement>('[data-wb-viewport]') ?? root.parentElement!;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    const nodes = new Map(Array.from(root.children, node => [(node as HTMLElement).dataset.wbPresenceUser, node as HTMLElement]));
    for (const p of participants) {
      if (p.userId === selfUserId) continue;
      const node = nodes.get(p.userId);
      if (!node) continue; // membership React commit schedules the next paint
      const cursor = node.querySelector<HTMLElement>('[data-wb-remote-cursor]')!;
      const status = cursor.querySelector<HTMLElement>('[data-wb-cursor-status]')!;
      status.textContent = p.editingId ? ' typing…' : '';
      const motion = motions.get(p.userId);
      cursor.hidden = true;
      if (motion) {
        const age = now - motion.movedAt;
        const point = runtime.worldToScreen(interpolate(motion, now, !!reduced?.matches));
        const target = runtime.worldToScreen(motion.to);
        cursor.hidden = age >= HIDE_MS || target.x < 0 || target.y < 0 || target.x >= width || target.y >= height;
        cursor.style.transform = `translate(${point.x}px, ${point.y}px)`;
        cursor.style.opacity = age >= FADE_MS ? '0.35' : '1';
        if (!reduced?.matches && now - motion.sampledAt < INTERPOLATION_MS && !equalPoint(motion.from, motion.to)) animating = true;
        if (age < FADE_MS) nextWake = Math.min(nextWake, FADE_MS - age);
        else if (age < HIDE_MS) nextWake = Math.min(nextWake, HIDE_MS - age);
      }
      const dragging = paintGhosts(node.querySelector('[data-wb-remote-ghosts]')!, p);
      paintSelections(node.querySelector('[data-wb-remote-selections]')!, p, dragging);
      paintLaser(node.querySelector('[data-wb-remote-laser]'), p);
    }
    if (animating) schedule();
    if (Number.isFinite(nextWake)) idleTimer = setTimeout(schedule, Math.max(1, nextWake));
  }

  const unsubscribePresence = adapter.subscribePresence(observe);
  const unsubscribeCamera = runtime.subscribeCamera(schedule);
  const unsubscribeCommit = adapter.onCommit(commit => {
    for (const p of participants) {
      if (!p.drag || !commit.changes.some(change => p.drag!.ids.includes(change.id))) continue;
      suppressedDrags.set(p.userId, JSON.stringify(p.drag.ids));
    }
    schedule();
  });
  const unsubscribeIds = store.subscribeIds(schedule);
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  resize?.observe(root.closest('[data-wb-viewport]') ?? root);
  reduced?.addEventListener?.('change', schedule);
  observe(participants);
  return {
    schedule,
    dispose(): void {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      clearTimeout(idleTimer);
      unsubscribePresence(); unsubscribeCamera(); unsubscribeIds(); unsubscribeCommit();
      objectSubscriptions.forEach(unsubscribe => unsubscribe());
      resize?.disconnect();
      reduced?.removeEventListener?.('change', schedule);
      ghosts.forEach(ghost => ghost.nodes.forEach(node => node.remove()));
      for (const node of root.querySelectorAll('[data-wb-remote-selection]')) node.remove();
    },
  };
}
