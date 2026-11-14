import { useCallback, useSyncExternalStore } from 'react';
import type { SyncAdapter, SyncStatus } from '../contract';

const LABELS: Record<SyncStatus, string> = {
  connecting: 'Connecting…',
  live: '',
  resyncing: 'Reconnecting…',
  offline: "Offline — changes will sync when you're back",
};
export interface SyncStatusChipProps { adapter: SyncAdapter }

export function SyncStatusChip({ adapter }: SyncStatusChipProps) {
  const subscribe = useCallback((listener: () => void) => adapter.onStatus(listener), [adapter]);
  const getStatus = useCallback(() => adapter.getStatus(), [adapter]);
  const status = useSyncExternalStore(subscribe, getStatus, getStatus);
  // Keep the live region mounted so later status changes are announced.
  return <span role="status" aria-live="polite" aria-atomic="true" className="wb-presence-sync" data-status={status}>
    {LABELS[status]}
  </span>;
}
