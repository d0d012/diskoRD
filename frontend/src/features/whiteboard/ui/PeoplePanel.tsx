import { useCallback, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { useUserStore } from '../../../stores/userStore';
import type { BoardId, PurgeFilter, PurgeResult, Rect, SyncAdapter, UserId } from '../contract';
import { PALETTE_COLOURS } from '../contract';
import { computeAuthorRegions, fitToBounds } from '../core';
import type { AuthorRegion, AuthorRegions } from '../core';
import { participantStyle, useRoomParticipants } from '../render/overlays/presence';
import type { BoardNotify } from '../state';
import { purgeBoard, purgeFailureMessage } from '../sync/networkAdapter';
import { BoardIcon } from './icons';
import { FollowPersonButton } from './FollowPersonButton';
import type { BoardUIProps } from './Toolbar';
import { useCanManageChannel } from './useCanManageChannel';

export interface PeoplePanelProps extends BoardUIProps {
  readonly controls?: ReactNode;
  readonly adapter?: SyncAdapter | null;
  readonly selfUserId?: UserId;
  readonly boardId?: BoardId;
  readonly notify?: BoardNotify;
  readonly resolveName?: (userId: UserId) => string | undefined;
  readonly canManage?: boolean;
  readonly defaultOpen?: boolean;
  readonly onPurge?: (filter: PurgeFilter) => Promise<PurgeResult>;
}

interface PendingPurgeConfirm {
  readonly key: string;
  readonly label: string;
  readonly objectCount: number;
  readonly filter: PurgeFilter;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hashColourIndex(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % PALETTE_COLOURS.length;
}

export function PeoplePanel({
  controls,
  store,
  session,
  runtime,
  adapter,
  selfUserId,
  boardId,
  notify,
  resolveName,
  canManage,
  defaultOpen = false,
  onPurge,
}: PeoplePanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [scatteredCursor, setScatteredCursor] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState<PendingPurgeConfirm | null>(null);
  const [purging, setPurging] = useState(false);
  const [lastPurgeNotice, setLastPurgeNotice] = useState<string | null>(null);

  const effectiveBoardId = boardId ?? store.getBoardId?.() ?? '';
  const effectiveSelfId = selfUserId ?? store.getUserId?.() ?? '';
  const isModerator = useCanManageChannel(effectiveBoardId, canManage);

  const subscribeObjects = useCallback(
    (listener: () => void) => (store.subscribeObjects ? store.subscribeObjects(listener) : store.subscribeIds(listener)),
    [store],
  );
  const objects = useSyncExternalStore(subscribeObjects, store.getObjectsInRank);
  const authors = useMemo(() => computeAuthorRegions(objects), [objects]);

  const subscribeVisibility = useCallback(
    (listener: () => void) => session.subscribe(listener),
    [session],
  );
  const visibility = useSyncExternalStore(subscribeVisibility, session.getVisibilityState);

  const participants = useRoomParticipants(adapter);

  const knownUsers = useUserStore(s => s.users);
  const authUser = useAuthStore(s => s.user);

  const resolveAuthor = useCallback(
    (userId: UserId): { name: string; colourIndex: number; avatarUrl?: string | null } => {
      const roomMember = participants.find(p => p.userId === userId);
      const colourIndex = roomMember ? roomMember.colourIndex : hashColourIndex(userId);
      const customName = resolveName?.(userId);
      const rosterUser = knownUsers[userId];
      const selfMatch = authUser?.id === userId ? authUser : undefined;
      const name = customName
        || rosterUser?.displayName
        || rosterUser?.username
        || selfMatch?.displayName
        || selfMatch?.username
        || roomMember?.name
        || (UUID_RE.test(userId) ? `Unknown (${userId.slice(0, 6)})` : userId);
      return {
        name,
        colourIndex,
        avatarUrl: rosterUser?.avatarUrl ?? selfMatch?.avatarUrl,
      };
    },
    [participants, resolveName, knownUsers, authUser],
  );

  const fitBounds = useCallback(
    (bounds: Rect) => {
      const element = rootRef.current?.closest<HTMLElement>('[data-wb-viewport]');
      const w = element && element.clientWidth > 0 ? element.clientWidth : (window.innerWidth || 800);
      const h = element && element.clientHeight > 0 ? element.clientHeight : (window.innerHeight || 600);
      runtime.setCamera(fitToBounds(bounds, { x: 0, y: 0, w, h }, 64));
    },
    [runtime],
  );

  const handleCycleScattered = useCallback(
    (author: AuthorRegions) => {
      const list = author.scatteredRegions;
      if (list.length === 0) return;
      const currentIdx = (scatteredCursor[author.authorId] ?? 0) % list.length;
      const target = list[currentIdx];
      fitBounds(target.bounds);
      setScatteredCursor(prev => ({ ...prev, [author.authorId]: (currentIdx + 1) % list.length }));
    },
    [scatteredCursor, fitBounds],
  );

  function requestPurge(pending: Omit<PendingPurgeConfirm, 'objectCount'>): void {
    if (purging || !isModerator) return;
    // A connected component's bounding box can overlap other components.
    // Confirm the actual rectangle-filter count, not just the cluster's count.
    const { createdBy, rect } = pending.filter;
    const objectCount = objects.filter(object =>
      (createdBy === undefined || object.createdBy === createdBy) &&
      (!rect || (object.x <= rect.x + rect.w && object.x + object.w >= rect.x &&
        object.y <= rect.y + rect.h && object.y + object.h >= rect.y)),
    ).length;
    setConfirming({ ...pending, objectCount });
  }

  const executePurge = useCallback(
    async (pending: PendingPurgeConfirm) => {
      if (purging || !isModerator) return;
      setPurging(true);
      try {
        let result: PurgeResult;
        if (onPurge) {
          result = await onPurge(pending.filter);
        } else if (adapter?.purge) {
          result = await adapter.purge(pending.filter);
        } else {
          result = await purgeBoard(effectiveBoardId, pending.filter);
        }
        const msg = `Removed ${result.deleted} ${result.deleted === 1 ? 'object' : 'objects'}.`;
        setLastPurgeNotice(msg);
        notify?.('refused', msg);
        setConfirming(null);
      } catch (error) {
        const msg = error instanceof Error && error.message ? error.message : purgeFailureMessage(error);
        setLastPurgeNotice(null);
        notify?.('refused', msg);
        setConfirming(null);
      } finally {
        setPurging(false);
      }
    },
    [purging, isModerator, onPurge, adapter, effectiveBoardId, notify],
  );

  const hasHidden = visibility.soloAuthor !== null || visibility.hiddenAuthors.length > 0;
  const hiddenObjectCount = useMemo(() => {
    if (!hasHidden) return 0;
    let count = 0;
    for (const obj of objects) {
      const hidden = visibility.soloAuthor !== null
        ? obj.createdBy !== visibility.soloAuthor
        : visibility.hiddenAuthors.includes(obj.createdBy);
      if (hidden) count++;
    }
    return count;
  }, [hasHidden, objects, visibility]);

  return (
    <div ref={rootRef} data-wb-ui="" className="wb-people-chrome">
      <div className="wb-people-controls">
        {controls}
        {hasHidden && (
          <div className="wb-hidden-indicator" role="status" aria-label="Hidden objects indicator">
            <span className="wb-hidden-indicator__label">
              {visibility.soloAuthor !== null
                ? `Solo: ${resolveAuthor(visibility.soloAuthor).name} (${hiddenObjectCount} hidden)`
                : `${hiddenObjectCount} ${hiddenObjectCount === 1 ? 'object' : 'objects'} hidden`}
            </span>
            <button
              type="button"
              className="wb-hidden-indicator__button"
              onClick={() => session.showAllAuthors()}
            >
              Show all
            </button>
          </div>
        )}
        <button
          type="button"
          className="wb-people-toggle"
          aria-label="People on board"
          aria-expanded={open}
          title="People & regions on this board"
          onClick={() => setOpen(prev => !prev)}
        >
          <BoardIcon name="people" width={16} height={16} />
          <span>People</span>
          <span className="wb-people-toggle__count">{authors.length}</span>
        </button>
      </div>

      {open && (
        <section className="wb-people-panel" aria-label="People panel">
          <header className="wb-people-panel__header">
            <h3 className="wb-people-panel__title">People on board</h3>
            {hasHidden && (
              <button
                type="button"
                className="wb-people-panel__show-all"
                onClick={() => session.showAllAuthors()}
              >
                Show all
              </button>
            )}
          </header>

          {lastPurgeNotice && (
            <div className="wb-people-panel__result" role="status">
              {lastPurgeNotice}
            </div>
          )}

          {confirming && isModerator && (
            <div className="wb-people-confirm" role="alertdialog" aria-label="Confirm object removal">
              <p className="wb-people-confirm__text">
                {confirming.label} — remove {confirming.objectCount}{' '}
                {confirming.objectCount === 1 ? 'object' : 'objects'}?
              </p>
              <div className="wb-people-confirm__actions">
                <button
                  type="button"
                  className="wb-people-confirm__btn wb-people-confirm__btn--danger"
                  disabled={purging}
                  onClick={() => { void executePurge(confirming); }}
                >
                  {purging ? 'Removing…' : `Confirm (${confirming.objectCount})`}
                </button>
                <button
                  type="button"
                  className="wb-people-confirm__btn"
                  disabled={purging}
                  onClick={() => setConfirming(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {authors.length === 0 ? (
            <p className="wb-people-panel__empty">No drawings on this board yet.</p>
          ) : (
            <ul className="wb-people-list" aria-label="Board authors">
              {authors.map(author => {
                const info = resolveAuthor(author.authorId);
                const isExplicitlyHidden = visibility.hiddenAuthors.includes(author.authorId);
                const isSolo = visibility.soloAuthor === author.authorId;
                const isEffectivelyHidden = session.isAuthorHidden(author.authorId);
                const initial = Array.from(info.name.trim())[0]?.toLocaleUpperCase() || '?';

                return (
                  <li
                    key={author.authorId}
                    className={`wb-people-author${isEffectivelyHidden ? ' wb-people-author--hidden' : ''}`}
                    data-wb-author={author.authorId}
                  >
                    <div className="wb-people-author__row">
                      <span
                        className="wb-presence-avatar wb-people-author__avatar"
                        style={participantStyle(info.colourIndex)}
                        aria-hidden="true"
                      >
                        {initial}
                      </span>
                      <div className="wb-people-author__meta">
                        <span className="wb-people-author__name">
                          {info.name}
                          {author.authorId === effectiveSelfId ? ' (you)' : ''}
                        </span>
                        <span className="wb-people-author__count">
                          {author.objectCount} {author.objectCount === 1 ? 'object' : 'objects'}
                        </span>
                      </div>
                      <div className="wb-people-author__toggles">
                        {adapter && author.authorId !== effectiveSelfId && participants.some(p => p.userId === author.authorId) && <FollowPersonButton adapter={adapter} userId={author.authorId} name={info.name} />}
                        <button
                          type="button"
                          className="wb-people-btn"
                          aria-pressed={isExplicitlyHidden}
                          aria-label={`Hide ${info.name}`}
                          onClick={() => session.toggleHideAuthor(author.authorId)}
                        >
                          {isExplicitlyHidden ? 'Unhide' : 'Hide'}
                        </button>
                        <button
                          type="button"
                          className="wb-people-btn"
                          aria-pressed={isSolo}
                          aria-label={`Solo ${info.name}`}
                          onClick={() => session.toggleSoloAuthor(author.authorId)}
                        >
                          Solo
                        </button>
                      </div>
                    </div>

                    {isModerator && (
                      <div className="wb-people-author__mod">
                        <button
                          type="button"
                          className="wb-people-mod-btn"
                          aria-label={`Remove everything by ${info.name}`}
                          onClick={() =>
                            requestPurge({
                              key: `author:${author.authorId}`,
                              label: `Remove everything by ${info.name}`,
                              filter: { createdBy: author.authorId },
                            })
                          }
                        >
                          Remove everything by this person
                        </button>
                      </div>
                    )}

                    <ul className="wb-people-regions" aria-label={`Regions for ${info.name}`}>
                      {author.regions.map((region: AuthorRegion, index: number) => (
                        <li key={region.id} className="wb-people-region">
                          <button
                            type="button"
                            className="wb-people-region__jump"
                            onClick={() => fitBounds(region.bounds)}
                          >
                            <span>Region {index + 1}</span>
                            <span className="wb-people-region__count">
                              {region.objectCount} {region.objectCount === 1 ? 'object' : 'objects'}
                            </span>
                          </button>
                          {isModerator && (
                            <button
                              type="button"
                              className="wb-people-region__remove"
                              aria-label={`Remove region ${index + 1} by ${info.name}`}
                              onClick={() =>
                                requestPurge({
                                  key: `region:${region.id}`,
                                  label: `Remove region ${index + 1} by ${info.name}`,
                                  filter: { createdBy: author.authorId, rect: region.bounds },
                                })
                              }
                            >
                              Remove this region
                            </button>
                          )}
                        </li>
                      ))}

                      {author.scatteredRegions.length > 0 && (
                        <li className="wb-people-region wb-people-region--scattered">
                          <button
                            type="button"
                            className="wb-people-region__jump"
                            onClick={() => handleCycleScattered(author)}
                          >
                            <span>Scattered small marks ({author.scatteredRegions.length})</span>
                            <span className="wb-people-region__count">
                              {author.scatteredObjectCount}{' '}
                              {author.scatteredObjectCount === 1 ? 'mark' : 'marks'}
                            </span>
                          </button>
                          {isModerator && (
                            <button
                              type="button"
                              className="wb-people-region__remove"
                              aria-label={`Remove scattered region by ${info.name}`}
                              onClick={() => {
                                const list = author.scatteredRegions;
                                const idx = ((scatteredCursor[author.authorId] ?? 1) - 1 + list.length) % list.length;
                                const target = list[idx];
                                requestPurge({
                                  key: `region:${target.id}`,
                                  label: `Remove scattered region by ${info.name}`,
                                  filter: { createdBy: author.authorId, rect: target.bounds },
                                });
                              }}
                            >
                              Remove this region
                            </button>
                          )}
                        </li>
                      )}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
