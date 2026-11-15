import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

/**
 * UI-only state for the Stamp tool, shared between the React popover and the
 * imperative input controller without touching the board session store. Never
 * persisted or sent to the server.
 */
export interface StampUiState {
  /** The sticker armed for placement, or null while the popover is open. */
  readonly armedId: string | null;
}

export const stampSession = createStore<StampUiState>(() => ({ armedId: null }));

export function armStamp(id: string | null): void {
  stampSession.setState({ armedId: id });
}

export function useArmedStamp(): string | null {
  return useStore(stampSession, state => state.armedId);
}
