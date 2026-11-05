import type { Message } from "../types";

// Only live gateway arrivals emit this signal; loading history or changing mute
// preferences must never request OS attention.
export const DM_MESSAGE_EVENT = "diskord:dm-message";
export function emitDMMessage(message: Message) {
  window.dispatchEvent(new CustomEvent<Message>(DM_MESSAGE_EVENT, { detail: message }));
}
