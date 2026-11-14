import { useEffect, useSyncExternalStore } from 'react';
import type { BoardNotices } from '../state';

/** How long a notice stays before it fades out on its own. */
export const BOARD_NOTICE_DURATION_MS = 4_000;

export interface BoardNoticeProps {
  notices: BoardNotices;
}

/** Brief, non-blocking message for refused or rejected board actions. */
export function BoardNotice({ notices }: BoardNoticeProps) {
  const notice = useSyncExternalStore(notices.subscribe, notices.getLatest, notices.getLatest);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => notices.dismiss(notice.id), BOARD_NOTICE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [notice, notices]);
  if (!notice) return null;
  return <div key={notice.id} data-wb-ui className="wb-ui-notice" role="status" aria-live="polite" data-wb-notice={notice.kind}>
    {notice.message}
  </div>;
}
