import { useSyncExternalStore } from 'react';
import { BoardIcon } from './icons';
import type { BoardUIProps } from './Toolbar';

export function UndoRedo({ store }: BoardUIProps) {
  const canUndo = useSyncExternalStore(store.subscribeHistory, store.canUndo);
  const canRedo = useSyncExternalStore(store.subscribeHistory, store.canRedo);
  const report = useSyncExternalStore(store.subscribeHistory, store.getHistoryReport);
  return <div data-wb-ui className="wb-ui-history wb-root__popover" role="group" aria-label="Board history">
    <button type="button" aria-label="Undo" title="Undo · Ctrl/⌘ Z" disabled={!canUndo} onClick={() => store.undo()}><BoardIcon name="undo" /></button>
    <button type="button" aria-label="Redo" title="Redo · Ctrl/⌘ Shift Z" disabled={!canRedo} onClick={() => store.redo()}><BoardIcon name="redo" /></button>
    {report && report.skipped.length > 0 && <span className="wb-ui-history-notice" role="status">Skipped {report.skipped.length} changed or unavailable object(s).</span>}
  </div>;
}
