import { forwardRef, memo, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { BoardStore, ObjectId, Runtime } from '../contract';
import type { SessionStore } from '../state';
import { BoardObjectView } from './objects/BoardObjectView';
import { Grid } from './overlays/Grid';
import { Marquee } from './overlays/Marquee';
import { Selection } from './overlays/Selection';
import { createRenderScene } from './scene';
import type { RenderScene } from './scene';
import '../ui/whiteboard.css';

interface ObjectSlotProps { id: ObjectId; store: BoardStore; scene: RenderScene }
const ObjectSlot = memo(function ObjectSlot({ id, store, scene }: ObjectSlotProps) {
  const root = useRef<HTMLDivElement>(null);
  const subscribe = useCallback((listener: () => void) => store.subscribeObject(id, listener), [store, id]);
  const getSnapshot = useCallback(() => store.getObject(id), [store, id]);
  const stored = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const object = stored ?? scene.objectFor(id);
  useLayoutEffect(() => {
    const node = root.current?.firstElementChild as HTMLDivElement | null;
    if (node) return scene.register(id, node);
  }, [scene, id, object]);
  return <div ref={root} className="wb-render-slot">{object && <BoardObjectView object={object} />}</div>;
});

interface ObjectStackProps { store: BoardStore; scene: RenderScene }
function ObjectStack({ store, scene }: ObjectStackProps) {
  const ids = useSyncExternalStore(scene.subscribe, scene.getIds, scene.getIds);
  return ids.map(id => <ObjectSlot key={id} id={id} store={store} scene={scene} />);
}

export interface ViewportProps {
  store: BoardStore;
  session: SessionStore;
  runtime: Runtime;
  className?: string;
  children?: ReactNode;
}

export const Viewport = forwardRef<HTMLDivElement, ViewportProps>(function Viewport({ store, session, runtime, className, children }, ref) {
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const scene = useMemo(() => createRenderScene(store, session, runtime), [store, session, runtime]);
  useImperativeHandle(ref, () => viewport.current!, []);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !world.current) return;
    return scene.connect({
      viewport: element, world: world.current,
      grid: element.querySelector<HTMLDivElement>('[data-wb-grid]')!,
      selection: element.querySelector<HTMLDivElement>('[data-wb-selection-layer]')!,
      marquee: element.querySelector<HTMLDivElement>('[data-wb-marquee]')!,
    });
  }, [scene]);
  return <div ref={viewport} className={`wb-root wb-render-viewport${className ? ` ${className}` : ''}`} data-wb-viewport="" tabIndex={0} aria-label="Board">
    <Grid />
    <div ref={world} className="wb-render-world" data-wb-world=""><ObjectStack store={store} scene={scene} /></div>
    <div className="wb-render-overlays"><Marquee /><Selection /></div>
    <div className="wb-render-screen-overlay">{children}</div>
  </div>;
});
