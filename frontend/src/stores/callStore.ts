import { create } from "zustand";
import { api } from "../lib/api";
import { useVoiceStore } from "./voiceStore";

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
  /** One-line message for the user (errors, "No answer", …); auto-cleared by the UI. */
  notice: string | null;
  setNotice: (notice: string | null) => void;

  // Outgoing — I initiate
  initiateCall: (channelId: string, recipientId: string, recipientName: string) => Promise<void>;
  cancelCall: (channelId: string) => Promise<void>;

  // Incoming — other side initiates
  onIncomingCall: (channelId: string, callerId: string, callerName: string) => void;
  acceptCall: (channelId: string) => Promise<void>;
  declineCall: (channelId: string) => Promise<void>;

  // Connected — gateway says CALL_ACCEPT
  onCallAccepted: (channelId: string, token: string, url: string) => void;

  // Gateway CALL_DECLINE / CALL_END / CALL_TIMEOUT. Events for a channel other than
  // the current call are stale and ignored.
  onCallEnded: (channelId?: string, notice?: string) => void;
  onCallTimeout: (channelId: string) => void;
  endCall: (channelId: string) => Promise<void>;
  /** Extend an active call on the server; ends it locally if the server dropped it. */
  keepalive: (channelId: string) => Promise<void>;
}

function errorMessage(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
  return msg ? msg.charAt(0).toUpperCase() + msg.slice(1) : fallback;
}

function leaveGuildVoice() {
  // A DM call and a guild voice channel can't share the microphone pipeline.
  if (useVoiceStore.getState().activeVoiceChannelId) {
    void useVoiceStore.getState().leaveVoice();
  }
}

export const useCallStore = create<CallStore>((set, get) => ({
  state: "idle",
  call: null,
  notice: null,

  setNotice: (notice) => set({ notice }),

  initiateCall: async (channelId, recipientId, recipientName) => {
    if (get().state !== "idle") return;
    leaveGuildVoice();
    set({ state: "calling", call: { channelId, recipientId, recipientName }, notice: null });
    try {
      await api.post(`/dms/${channelId}/call`);
    } catch (err) {
      set({ state: "idle", call: null, notice: errorMessage(err, "Couldn't start the call") });
    }
  },

  cancelCall: async (channelId) => {
    set({ state: "idle", call: null });
    await api.post(`/dms/${channelId}/call/end`).catch(() => {});
  },

  onIncomingCall: (channelId, callerId, callerName) => {
    // Only accept if we're idle (the server also refuses to ring busy users)
    if (get().state !== "idle") return;
    set({ state: "ringing", call: { channelId, recipientId: callerId, recipientName: callerName }, notice: null });
  },

  acceptCall: async (channelId) => {
    leaveGuildVoice();
    try {
      await api.post(`/dms/${channelId}/call/accept`);
      // state transitions to "in-call" via onCallAccepted from gateway
    } catch (err) {
      if (get().call?.channelId === channelId) {
        set({ state: "idle", call: null, notice: errorMessage(err, "This call is no longer available") });
      }
    }
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

  onCallEnded: (channelId, notice) => {
    const current = get().call;
    if (channelId && current && current.channelId !== channelId) return;
    set({ state: "idle", call: null, ...(notice ? { notice } : {}) });
  },

  onCallTimeout: (channelId) => {
    const { call, state } = get();
    if (!call || call.channelId !== channelId) return;
    const notice =
      state === "ringing" ? `Missed call from ${call.recipientName}` :
      state === "calling" ? `${call.recipientName} didn't answer` :
      undefined;
    set({ state: "idle", call: null, ...(notice ? { notice } : {}) });
  },

  endCall: async (channelId) => {
    set({ state: "idle", call: null });
    await api.post(`/dms/${channelId}/call/end`).catch(() => {});
  },

  keepalive: async (channelId) => {
    try {
      await api.post(`/dms/${channelId}/call/keepalive`);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 410 || status === 404) get().onCallEnded(channelId, "Call ended");
    }
  },
}));
