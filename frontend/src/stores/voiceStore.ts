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
  screenShareFps: 15 | 30 | 60;
  screenShareResolution: "720" | "1080" | "1440" | "source";
  screenShareAudio: boolean;
  remoteVolumes: Record<string, number>; // userId → 0–1, affects only local listener

  // Participants per channel from gateway VOICE_STATE_UPDATE (for sidebar display)
  voiceParticipants: Record<string, VoiceGatewayParticipant[]>;

  // Actions
  joinVoice: (channelId: string, guildId: string) => Promise<void>;
  leaveVoice: () => Promise<void>;
  setMuted: (v: boolean) => void;
  setDeafened: (v: boolean) => void;
  setCameraOn: (v: boolean) => void;
  setScreenSharing: (v: boolean) => void;
  setScreenShareFps: (fps: 15 | 30 | 60) => void;
  setScreenShareResolution: (r: "720" | "1080" | "1440" | "source") => void;
  setScreenShareAudio: (v: boolean) => void;
  setRemoteVolume: (userId: string, v: number) => void;
  onRoomDisconnected: () => void;

  // Noise cancellation
  isNoiseCancellationEnabled: boolean;
  setNoiseCancellationEnabled: (enabled: boolean) => void;

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
  screenShareFps: 30,
  screenShareResolution: "1080",
  screenShareAudio: false,
  remoteVolumes: {},
  voiceParticipants: {},
  isNoiseCancellationEnabled: false,

  joinVoice: async (channelId, guildId) => {
    const { activeVoiceChannelId } = get();
    if (activeVoiceChannelId && activeVoiceChannelId !== channelId) {
      await api.delete(`/channels/${activeVoiceChannelId}/voice/leave`).catch(() => {});
    }
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
  setScreenShareFps: (fps) => set({ screenShareFps: fps }),
  setScreenShareResolution: (r) => set({ screenShareResolution: r }),
  setScreenShareAudio: (v) => set({ screenShareAudio: v }),
  setRemoteVolume: (userId, v) => set((s) => ({ remoteVolumes: { ...s.remoteVolumes, [userId]: v } })),
  setNoiseCancellationEnabled: (enabled: boolean) => set({ isNoiseCancellationEnabled: enabled }),

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
