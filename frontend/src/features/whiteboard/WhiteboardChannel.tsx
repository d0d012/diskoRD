import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { useAuthStore } from '../../stores/authStore';
import { useUserStore } from '../../stores/userStore';
import type { Point, UserId } from './contract';
import type { ImageIngest } from './assets';
import { StampPicker, armStamp, stampSession, useArmedStamp, type StampPlacer } from './stamps';
import { Viewport } from './render/Viewport';
import { TextEditor } from './editing/TextEditor';
import { CropEditor } from './editing/CropEditor';
import { connectBoard, createBoardResources } from './localBoard';
import type { BoardConnection } from './localBoard';
import { PresenceLayer } from './render/overlays/PresenceLayer';
import { Participants } from './ui/Participants';
import { FollowView } from './ui/FollowView';
import { PeoplePanel } from './ui/PeoplePanel';
import { ImagePicker } from './ui/ImagePicker';
import { EmptyState } from './ui/EmptyState';
import { TemplateGalleryButton } from './ui/TemplateGallery';
import { SyncStatusChip } from './ui/SyncStatus';
import { Toolbar, StyleBar, ZoomControl, UndoRedo, BoardNotice } from './ui';
import { exportBoardPng } from './export';
import './ui/whiteboard.css';

interface WhiteboardChannelProps { channelId: string }

const START_ERROR = 'The board could not connect. Check your connection and reopen this channel.';

/** Roster names the app already knows (member panel, messages); the server name is the fallback. */
function resolveName(userId: UserId): string | undefined {
  const user = useUserStore.getState().users[userId];
  return user?.displayName || user?.username || undefined;
}

export function WhiteboardChannel({ channelId }: WhiteboardChannelProps) {
  const userId = useAuthStore(state => state.user?.id);
  if (!userId) return null;
  return <Board key={`${channelId}:${userId}`} channelId={channelId} userId={userId} />;
}

function Board({ channelId, userId }: WhiteboardChannelProps & { userId: string }) {
  // Store, session, runtime and notices live as long as the channel view; the
  // adapter/coordinator/controller connection is per effect run (StrictMode-safe).
  const [resources] = useState(() => createBoardResources({ boardId: channelId, userId }));
  const { store, session, runtime, notices } = resources;
  const viewport = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<{ adapter: BoardConnection['adapter']; ingest: ImageIngest; stamps: StampPlacer } | null>(null);
  const adapter = connection?.adapter ?? null;
  // 'image'/'stamp' tools mean "the picker is open"; the picker's own close and the toolbar just move the tool.
  const tool = useStore(session, state => state.tool);
  const pickerOpen = tool === 'image';
  const armedStamp = useArmedStamp();
  const stampOpen = tool === 'stamp' && armedStamp === null;
  const requestImage = useCallback(() => {
    session.setTool(session.getState().tool === 'image' ? 'select' : 'image');
  }, [session]);
  const requestStamp = useCallback(() => {
    session.setTool(session.getState().tool === 'stamp' ? 'select' : 'stamp');
  }, [session]);
  const closePicker = useCallback(() => {
    if (session.getState().tool === 'image') session.setTool('select');
  }, [session]);
  const exportPng = useCallback(() => {
    void exportBoardPng(store, session, notices.notify);
  }, [store, session, notices]);
  const closeStampPicker = useCallback(() => {
    if (session.getState().tool === 'stamp') session.setTool('select');
  }, [session]);
  // The armed sticker lives outside React state so the controller's click hook stays stable.
  const stampsRef = useRef<StampPlacer | null>(null);
  useEffect(() => { stampsRef.current = connection?.stamps ?? null; }, [connection]);
  const placeStamp = useCallback((world: Point) => {
    const armed = stampSession.getState().armedId;
    if (!armed) { session.setTool('select'); return; }
    void stampsRef.current?.place(armed, world);
  }, [session]);
  useEffect(() => { if (tool !== 'stamp') armStamp(null); }, [tool]);
  const ids = useSyncExternalStore(store.subscribeIds, store.getObjectIds);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let live: BoardConnection | null = null;
    let started: Promise<void>;
    try {
      // Identities come from `resources` (the store's own), never from props again.
      live = connectBoard(resources, { element, resolveName, onRequestImage: requestImage, onExport: exportPng, onRequestStamp: requestStamp, onStampPlace: placeStamp });
      started = live.started;
      setConnection({ adapter: live.adapter, ingest: live.ingest, stamps: live.stamps });
    } catch (cause) {
      started = Promise.reject(cause); // e.g. non-UUID identities: report, never crash
    }
    let disposed = false;
    started.catch(cause => {
      if (disposed) return;
      console.warn('whiteboard: board could not be started', cause);
      setError(START_ERROR);
    });
    return () => {
      disposed = true;
      live?.dispose();
      setConnection(null);
    };
  }, [resources, requestImage, exportPng, requestStamp, placeStamp]);
  const ui = { store, session, runtime };
  return <Viewport ref={viewport} store={store} session={session} runtime={runtime}>
    {adapter && <PresenceLayer adapter={adapter} runtime={runtime} store={store} selfUserId={userId} />}
    {adapter && <FollowView adapter={adapter} runtime={runtime} />}
    <TextEditor store={store} session={session} runtime={runtime} onNotice={notices.notify} />
    <CropEditor store={store} session={session} runtime={runtime} />
    {!ids.length && <EmptyState store={store} session={session} runtime={runtime} userId={userId} notify={notices.notify} getViewportSize={() => viewport.current?.getBoundingClientRect() ?? null} />}
    {error && <div data-wb-ui className="wb-ui-start-error" role="alert">{error}</div>}
    <BoardNotice notices={notices} />
    {adapter && <><Participants adapter={adapter} selfUserId={userId} /><SyncStatusChip adapter={adapter} /></>}
    <PeoplePanel {...ui} adapter={adapter} selfUserId={userId} boardId={channelId} notify={notices.notify} resolveName={resolveName} controls={<TemplateGalleryButton {...ui} userId={userId} notify={notices.notify} getViewportSize={() => viewport.current?.getBoundingClientRect() ?? null} />} />
    {pickerOpen && connection && <div data-wb-ui className="wb-assets-anchor">
      <ImagePicker onClose={closePicker} onPick={(files, { pixelated }) => {
        closePicker();
        void connection.ingest.addFiles(files, { pixelated });
      }} />
    </div>}
    {stampOpen && connection && <div data-wb-ui className="wb-assets-anchor">
      <StampPicker onClose={closeStampPicker} onPick={armStamp} />
    </div>}
    <Toolbar {...ui} /><StyleBar {...ui} notify={notices.notify} /><ZoomControl {...ui} notify={notices.notify} /><UndoRedo {...ui} />
  </Viewport>;
}
