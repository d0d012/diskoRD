import type { BoardStore, HandleId, ObjectId, Point, PresenceFields, PresenceParticipant, Runtime, UserId } from '../contract';
import type { BoardNotify, SessionStore } from '../state';

/**
 * One pointer sample in both coordinate spaces. Screen points are CSS pixels
 * relative to the viewport's top-left (DOM bounds already subtracted).
 */
export interface PointerSample {
  readonly screen: Point;
  readonly world: Point;
  /** [0, 1]; 0.5 when the device reports no real pressure. */
  readonly pressure: number;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  /** Ctrl on Windows/Linux, Cmd on macOS (either one counts). */
  readonly modKey: boolean;
}

export interface InputPresence {
  send(fields: PresenceFields): void;
  getParticipants(): readonly PresenceParticipant[];
}

/** Everything a tool may touch. No DOM: tools are unit-testable without a browser. */
export interface ToolContext {
  readonly store: BoardStore;
  readonly session: SessionStore;
  readonly runtime: Runtime;
  readonly userId: UserId;
  /** Fresh lowercase UUID per call (crypto.randomUUID in production). */
  readonly newId: () => ObjectId;
  /** Refused actions (limits, invalid input) are reported here for the UI. */
  readonly notify?: BoardNotify;
  readonly presence?: InputPresence;
}

/** Non-idle states of the tool state machine; idle = no gesture, editing = session.editingId. */
export type GestureKind =
  | 'marquee'
  | 'creating'
  | 'translating'
  | 'resizing'
  | 'endpoint-dragging'
  | 'drawing'
  | 'erasing'
  | 'panning';

/**
 * A pointer gesture from pointer-down to its end. During `move` a gesture only
 * calls runtime.setPreview / runtime.setCamera. `end` clears the preview and
 * performs at most ONE store.dispatch. `cancel` clears the preview and
 * dispatches nothing. After end/cancel the gesture is inert.
 */
export interface Gesture {
  readonly kind: GestureKind;
  move(sample: PointerSample, coalesced?: readonly PointerSample[]): void;
  end(sample: PointerSample): void;
  cancel(): void;
}

/** What the controller learned from the pointer-down event's DOM target. */
export interface PointerDownInfo {
  readonly sample: PointerSample;
  /** 0 primary, 1 middle, 2 secondary. */
  readonly button: number;
  /** `data-wb-handle` of the target (or an ancestor), if any. */
  readonly handle: HandleId | null;
  /** `data-wb-frame-label` of the target (or an ancestor), if any. */
  readonly frameLabelId: ObjectId | null;
  /** Space is held: primary drags pan. */
  readonly spaceHeld: boolean;
}
