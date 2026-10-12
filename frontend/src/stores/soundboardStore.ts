import { create } from "zustand";
import { api } from "../lib/api";

export interface GuildSound {
  id: string;
  guildId: string;
  creatorId: string | null;
  name: string;
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface SoundboardSession {
  play: (id: string, preview?: boolean) => Promise<void>;
  stop: () => void;
}

let catalogRequest = 0;

export const useSoundboardStore = create<{
  session: SoundboardSession | null;
  guildId: string | null;
  sounds: GuildSound[];
  loading: boolean;
  catalogError: string | null;
  refresh: () => Promise<void>;
  available: boolean;
  volume: number;
  error: string | null;
  setVolume: (volume: number) => void;
}>((set, get) => ({
  session: null,
  guildId: null,
  sounds: [],
  loading: false,
  catalogError: null,
  refresh: async () => {
    const { guildId, session } = get();
    if (!guildId || !session) return;
    const request = ++catalogRequest;
    set({ loading: true, catalogError: null });
    try {
      const { data } = await api.get(`/guilds/${guildId}/sounds`);
      if (request === catalogRequest && get().session === session && get().guildId === guildId) set({ sounds: data.data ?? [] });
    } catch {
      if (request === catalogRequest && get().session === session) set({ catalogError: "Couldn't load server sounds. Try again." });
    } finally {
      if (request === catalogRequest && get().session === session) set({ loading: false });
    }
  },
  available: false,
  volume: 0.5,
  error: null,
  setVolume: (volume) => set({ volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.5 }),
}));
