import { create } from "zustand";
import { api } from "../lib/api";

export interface VoiceGatewayParticipant {
  userId: string;
  username: string;
}

interface VoiceStore {
  // Connection
  activeVoiceChannelId: string | null;
  activeVoiceGuildId: string | null;
  liveKitToken: string | null;
  liveKitUrl: string | null;
  isConnecting: boolean;

  // Media controls
  isMuted: boolean;
  isDeafened: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;

  // Participants per channel from gateway VOICE_STATE_UPDATE (for sidebar display)
  voiceParticipants: Record<string, VoiceGatewayParticipant[]>;

  // Actions
  joinVoice: (channelId: string, guildId: string) => Promise<void>;
  leaveVoice: () => Promise<void>;
  setMuted: (v: boolean) => void;
  setDeafened: (v: boolean) => void;
  setCameraOn: (v: boolean) => void;
  setScreenSharing: (v: boolean) => void;
  onRoomDisconnected: () => void;

  // Gateway-driven
  updateVoiceState: (channelId: string, participant: VoiceGatewayParticipant, joined: boolean) => void;
}

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  activeVoiceChannelId: null,
  activeVoiceGuildId: null,
  liveKitToken: null,
  liveKitUrl: null,
  isConnecting: false,
  isMuted: false,
  isDeafened: false,
  isCameraOn: false,
  isScreenSharing: false,
  voiceParticipants: {},

  joinVoice: async (channelId, guildId) => {
    set({ isConnecting: true });
    try {
      const { data } = await api.post(`/channels/${channelId}/voice/token`);
      set({
        activeVoiceChannelId: channelId,
        activeVoiceGuildId: guildId,
        liveKitToken: data.data.token,
        liveKitUrl: data.data.url,
        isConnecting: false,
        isMuted: false,
        isDeafened: false,
        isCameraOn: false,
        isScreenSharing: false,
      });
    } catch {
      set({ isConnecting: false });
      throw new Error("Failed to join voice channel");
    }
  },

  leaveVoice: async () => {
    const { activeVoiceChannelId } = get();
    if (activeVoiceChannelId) {
      await api.delete(`/channels/${activeVoiceChannelId}/voice/leave`).catch(() => {});
    }
    set({
      activeVoiceChannelId: null,
      activeVoiceGuildId: null,
      liveKitToken: null,
      liveKitUrl: null,
      isCameraOn: false,
      isScreenSharing: false,
    });
  },

  setMuted: (v) => set({ isMuted: v }),
  setDeafened: (v) => set({ isDeafened: v }),
  setCameraOn: (v) => set({ isCameraOn: v }),
  setScreenSharing: (v) => set({ isScreenSharing: v }),

  onRoomDisconnected: () => {
    const { activeVoiceChannelId } = get();
    if (activeVoiceChannelId) {
      api.delete(`/channels/${activeVoiceChannelId}/voice/leave`).catch(() => {});
    }
    set({
      activeVoiceChannelId: null,
      activeVoiceGuildId: null,
      liveKitToken: null,
      liveKitUrl: null,
      isCameraOn: false,
      isScreenSharing: false,
    });
  },

  updateVoiceState: (channelId, participant, joined) => {
    set((s) => {
      const prev = s.voiceParticipants[channelId] ?? [];
      const filtered = prev.filter((p) => p.userId !== participant.userId);
      return {
        voiceParticipants: {
          ...s.voiceParticipants,
          [channelId]: joined ? [...filtered, participant] : filtered,
        },
      };
    });
  },
}));
