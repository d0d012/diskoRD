import type { BoardObject, BoardStore, ObjectId, Runtime, Unsubscribe } from '../contract';
import type { SessionStore } from '../state';
import { compareRanked, getBounds } from '../core';
import { computeVisibleSet, cullingBounds, SpatialGrid } from './culling';
import { paintObject } from './objects/presentation';
import { invalidateTextFits } from './objects/textFit';
import { paintGrid, paintMarquee, paintSelection } from './overlays/paint';

/**
 * Newly visible objects mount at most this many per frame (nearest to the
 * viewport centre first) so a zoom-out that reveals hundreds of objects never
 * blocks a frame. Priority objects bypass the budget; removals are immediate.
 */
const MOUNT_BATCH_SIZE = 48;

interface Layers {
  viewport: HTMLDivElement;
  world: HTMLDivElement;
  grid: HTMLDivElement;
  selection: HTMLDivElement;
  marquee: HTMLDivElement;
}

/**
 * One scheduler for camera, culling, previews and overlays. React sees ONLY
 * ordered visible-id changes; geometry samples never enter an external-store
 * snapshot, React state or Zustand. All objects, including drafts, mount using
 * the same memoized components. Subsequent previews paint those nodes directly.
 */
export function createRenderScene(store: BoardStore, session: SessionStore, runtime: Runtime) {
  const grid = new SpatialGrid();
  const objects = new Map<ObjectId, BoardObject>();
  const nodes = new Map<ObjectId, HTMLDivElement>();
  const objectSubscriptions = new Map<ObjectId, Unsubscribe>();
  const retired = new Map<ObjectId, number>();
  const listeners = new Set<() => void>();
  let ids: readonly ObjectId[] = [];
  /** Set of ids currently rendered (the same membership as `ids`, unordered). */
  const rendered = new Set<ObjectId>();
  let layers: Layers | null = null;
  let raf = 0;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let removalTimer: ReturnType<typeof setTimeout> | undefined;
  let moving = false;
  let previousPreviews = new Set<ObjectId>();
  let previousEditing: ObjectId | null = null;
  let dirtyObjects = new Set<ObjectId>();
  let refreshText = false;
  // Ids created after the first sync, kept for two frames so the slot React
  // mounts for them can still claim the pop-in. Culling re-entry never animates.
  const fresh = new Map<ObjectId, number>();
  let initialSynced = false;

  function previewMap(): Map<ObjectId, BoardObject> {
    return new Map(runtime.getPreview().objects.map(object => [object.id, object]));
  }
  function objectFor(id: ObjectId): BoardObject | undefined {
    return runtime.getPreview().objects.find(object => object.id === id) ?? store.getObject(id) ?? objects.get(id);
  }
  function schedule(): void {
    if (layers && !raf) raf = requestAnimationFrame(frame);
  }
  function frame(): void {
    raf = 0;
    if (!layers) return;
    const { viewport, world, selection, marquee } = layers;
    const camera = runtime.getCamera();
    world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
    world.style.willChange = moving ? 'transform' : '';
    paintGrid(layers.grid, camera);
    const preview = runtime.getPreview();
    const overrides = previewMap();
    const bounds = cullingBounds(camera, viewport.clientWidth, viewport.clientHeight);
    const visible = computeVisibleSet(grid, bounds, preview.objects, preview.hiddenIds);
    const now = Date.now();
    for (const [id, until] of retired) {
      if (until > now) visible.add(id);
      else { retired.delete(id); objects.delete(id); }
    }
    // Removals are immediate; additions mount in budgeted batches so a zoom-out
    // that reveals hundreds of objects never blocks a frame. Selected, edited,
    // preview and freshly-created objects bypass the budget and mount now.
    const desired = new Set<ObjectId>();
    for (const id of visible) if (overrides.has(id) || objects.has(id)) desired.add(id);
    for (const id of rendered) if (!desired.has(id)) rendered.delete(id);
    const priority = new Set<ObjectId>();
    for (const id of session.getState().selectedIds) if (desired.has(id)) priority.add(id);
    const editingId = session.getState().editingId;
    if (editingId && desired.has(editingId)) priority.add(editingId);
    for (const id of overrides.keys()) if (desired.has(id)) priority.add(id);
    for (const id of fresh.keys()) if (desired.has(id)) priority.add(id);
    for (const id of priority) rendered.add(id);
    const centreX = bounds.x + bounds.w / 2;
    const centreY = bounds.y + bounds.h / 2;
    const candidates: { id: ObjectId; distance: number }[] = [];
    for (const id of desired) {
      if (rendered.has(id)) continue;
      const object = overrides.get(id) ?? objects.get(id);
      if (!object) continue;
      const box = getBounds(object);
      const dx = box.x + box.w / 2 - centreX;
      const dy = box.y + box.h / 2 - centreY;
      candidates.push({ id, distance: dx * dx + dy * dy });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    for (const item of candidates.slice(0, MOUNT_BATCH_SIZE)) rendered.add(item.id);
    const next = [...rendered].sort((a, b) => compareRanked((overrides.get(a) ?? objects.get(a))!, (overrides.get(b) ?? objects.get(b))!));
    if (ids.length !== next.length || next.some((id, i) => ids[i] !== id)) {
      ids = next;
      for (const listener of [...listeners]) listener();
    }
    // Keep converging while some visible object has not mounted yet.
    if (rendered.size !== desired.size) schedule();

    // Restore previous overrides as well as painting new ones. This handles
    // cancel, commit, hidden originals and replacement-only previews alike.
    const editing = session.getState().editingId;
    const repaint = new Set([...dirtyObjects, ...previousPreviews, ...overrides.keys(), ...preview.hiddenIds]);
    if (previousEditing) repaint.add(previousEditing);
    if (editing) repaint.add(editing);
    for (const [id, node] of nodes) {
      node.hidden = !visible.has(id);
      node.classList.toggle('wb-render-retired', retired.has(id));
      node.classList.toggle('wb-root__object-exit', retired.has(id));
      if (repaint.has(id)) {
        const object = overrides.get(id) ?? store.getObject(id) ?? objects.get(id);
        if (object) paintObject(node, object, id === editing, overrides.has(id) && store.getObject(id)?.kind === 'sticky');
      }
      else if (refreshText) {
        const object = overrides.get(id) ?? store.getObject(id) ?? objects.get(id);
        if (object && (object.kind === 'sticky' || object.kind === 'text')) paintObject(node, object, id === editing, overrides.has(id) && store.getObject(id)?.kind === 'sticky', true);
      }
    }
    refreshText = false;
    for (const [id, frames] of fresh) {
      if (frames <= 0) fresh.delete(id);
      else fresh.set(id, frames - 1);
    }
    dirtyObjects = new Set();
    previousPreviews = new Set(overrides.keys());
    previousEditing = editing;
    const selected = session.getState().selectedIds.flatMap(id => {
      if (retired.has(id) || (preview.hiddenIds.includes(id) && !overrides.has(id))) return [];
      const object = overrides.get(id) ?? store.getObject(id);
      return object ? [object] : [];
    });
    paintSelection(selection, selected, camera);
    paintMarquee(marquee, preview.marquee, camera);
  }

  function syncIds(): void {
    const current = new Set(store.getObjectIds());
    for (const [id, unsubscribe] of objectSubscriptions) if (!current.has(id)) {
      unsubscribe();
      objectSubscriptions.delete(id);
      grid.delete(id);
      if (nodes.has(id) && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) retired.set(id, Date.now() + 100);
      else objects.delete(id);
    }
    for (const id of current) {
      if (objectSubscriptions.has(id)) continue;
      retired.delete(id);
      if (initialSynced) fresh.set(id, 2);
      const update = () => {
        const object = store.getObject(id);
        if (object) { objects.set(id, object); grid.set(object); }
        dirtyObjects.add(id);
        schedule();
      };
      update();
      objectSubscriptions.set(id, store.subscribeObject(id, update));
    }
    initialSynced = true;
    clearTimeout(removalTimer);
    if (retired.size) removalTimer = setTimeout(schedule, Math.max(0, Math.min(...retired.values()) - Date.now()));
    schedule();
  }

  function register(id: ObjectId, node: HTMLDivElement): Unsubscribe {
    nodes.set(id, node);
    // Only objects new to the board pop in; drafts and culling re-entry do not.
    if (!fresh.has(id)) node.querySelector('.wb-root__object-enter')?.classList.remove('wb-root__object-enter');
    const object = objectFor(id);
    if (object) paintObject(node, object, session.getState().editingId === id, previewMap().has(id) && store.getObject(id)?.kind === 'sticky');
    return () => { nodes.delete(id); };
  }

  function connect(nextLayers: Layers): Unsubscribe {
    layers = nextLayers;
    syncIds();
    const unsubscribers = [store.subscribeIds(syncIds), session.subscribe(schedule), runtime.subscribePreview(schedule), runtime.subscribeCamera(() => {
      moving = true;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => { moving = false; schedule(); }, 180);
      schedule();
    })];
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    resize?.observe(layers.viewport);
    window.addEventListener('resize', schedule);
    const fontsChanged = () => { invalidateTextFits(); refreshText = true; schedule(); };
    document.fonts?.addEventListener('loadingdone', fontsChanged);
    schedule();
    return () => {
      layers = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      moving = false;
      clearTimeout(settleTimer);
      clearTimeout(removalTimer);
      resize?.disconnect();
      window.removeEventListener('resize', schedule);
      document.fonts?.removeEventListener('loadingdone', fontsChanged);
      for (const unsubscribe of unsubscribers) unsubscribe();
      for (const unsubscribe of objectSubscriptions.values()) unsubscribe();
      objectSubscriptions.clear();
      initialSynced = false;
      fresh.clear();
      nextLayers.world.style.willChange = '';
    };
  }

  return {
    connect, register, objectFor,
    subscribe(listener: () => void): Unsubscribe { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getIds: () => ids,
  };
}
export type RenderScene = ReturnType<typeof createRenderScene>;
