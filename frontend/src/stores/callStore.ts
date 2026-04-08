import { create } from "zustand";
import { api } from "../lib/api";

export type CallState = "idle" | "calling" | "ringing" | "in-call";

interface ActiveCall {
  channelId: string;
  /** The other person in the call */
  recipientId: string;
  recipientName: string;
  /** Only present when in-call */
  token?: string;
  url?: string;
}

interface CallStore {
  state: CallState;
  call: ActiveCall | null;

  // Outgoing — I initiate
  initiateCall: (channelId: string, recipientId: string, recipientName: string) => Promise<void>;
  cancelCall: (channelId: string) => Promise<void>;

  // Incoming — other side initiates
  onIncomingCall: (channelId: string, callerId: string, callerName: string) => void;
  acceptCall: (channelId: string) => Promise<void>;
  declineCall: (channelId: string) => Promise<void>;

  // Connected — gateway says CALL_ACCEPT
  onCallAccepted: (channelId: string, token: string, url: string) => void;

  // Either side ends the call (gateway CALL_END or CALL_DECLINE)
  onCallEnded: () => void;
  endCall: (channelId: string) => Promise<void>;
}

export const useCallStore = create<CallStore>((set, get) => ({
  state: "idle",
  call: null,

  initiateCall: async (channelId, recipientId, recipientName) => {
    set({ state: "calling", call: { channelId, recipientId, recipientName } });
    try {
      await api.post(`/dms/${channelId}/call`);
    } catch {
      set({ state: "idle", call: null });
    }
  },

  cancelCall: async (channelId) => {
    set({ state: "idle", call: null });
    await api.post(`/dms/${channelId}/call/end`).catch(() => {});
  },

  onIncomingCall: (channelId, callerId, callerName) => {
    // Only accept if we're idle
    if (get().state !== "idle") return;
    set({ state: "ringing", call: { channelId, recipientId: callerId, recipientName: callerName } });
  },

  acceptCall: async (channelId) => {
    await api.post(`/dms/${channelId}/call/accept`);
    // state transitions to "in-call" via onCallAccepted from gateway
  },

  declineCall: async (channelId) => {
    set({ state: "idle", call: null });
    await api.post(`/dms/${channelId}/call/decline`).catch(() => {});
  },

  onCallAccepted: (channelId, token, url) => {
    const current = get().call;
    if (!current || current.channelId !== channelId) return;
    set({ state: "in-call", call: { ...current, token, url } });
  },

  onCallEnded: () => {
    set({ state: "idle", call: null });
  },

  endCall: async (channelId) => {
    set({ state: "idle", call: null });
    await api.post(`/dms/${channelId}/call/end`).catch(() => {});
  },
}));
