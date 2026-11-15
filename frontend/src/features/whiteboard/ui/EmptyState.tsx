import { useEffect, useMemo } from 'react';
import { usePixelArtStore } from '../../../stores/pixelArtStore';
import { buddyWidth, trimmedImage } from '../../pixelart/decorationImage';
import { useSharpArtUrl } from '../../pixelart/sharpScale';
import type { BoardStore, Runtime, UserId } from '../contract';
import { STAMPS } from '../stamps';
import { StampGlyph } from '../stamps';
import type { BoardNotify, SessionStore } from '../state';
import { TEMPLATES, applyTemplate } from '../templates';
import './emptyState.css';

interface EmptyStateProps {
  readonly store: BoardStore;
  readonly session: SessionStore;
  readonly runtime: Runtime;
  readonly userId: UserId;
  readonly notify: BoardNotify;
  readonly getViewportSize?: () => { readonly width: number; readonly height: number } | null;
}

/** Buddy height cap in the empty state, so the hint stays low-key. */
const MAX_BUDDY_HEIGHT = 80;
const FALLBACK_STAMP_ID = 'eyes';

/** Centred, low-key empty state: the user's pixel buddy, a hint and the templates. */
export function EmptyState({ store, session, runtime, userId, notify, getViewportSize }: EmptyStateProps) {
  const profile = usePixelArtStore(state => state.profiles[userId]);

  useEffect(() => {
    if (!profile) void usePixelArtStore.getState().loadProfile(userId).catch(() => undefined);
  }, [userId, profile]);

  const buddy = profile?.buddies[0];
  const trimmed = useMemo(() => (buddy ? trimmedImage(buddy.doc) : null), [buddy]);
  const height = buddy ? Math.max(16, Math.min(MAX_BUDDY_HEIGHT, buddy.height)) : 48;
  const width = buddy ? buddyWidth(buddy.doc, height) : 48;
  const sharp = useSharpArtUrl(trimmed, width, height);
  const fallback = STAMPS.find(stamp => stamp.id === FALLBACK_STAMP_ID)!;

  return (
    <div className="wb-ui-empty" data-wb-ui-empty="" aria-live="polite">
      <div className="wb-empty-buddy" aria-hidden="true">
        {trimmed && sharp.url
          ? <img src={sharp.url} alt="" draggable={false} style={{ width, height, imageRendering: sharp.imageRendering }} />
          : <StampGlyph stamp={fallback} size={height} className="wb-empty-fallback" />}
      </div>
      <strong>This board is ready for ideas.</strong>
      <span>Start from a template, pick a tool, or double-click to write.</span>
      <div className="wb-empty-templates">
        {TEMPLATES.map(template => (
          <button type="button" key={template.id} title={template.description}
            onClick={() => applyTemplate(template.id, { store, session, runtime, userId, notify, getViewportSize })}>
            {template.name}
          </button>
        ))}
      </div>
    </div>
  );
}
