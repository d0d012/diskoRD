import { create } from "zustand";
import { storage } from "../lib/storage";

const KEY = "settings.media";
const RECENT_EMOJIS_KEY = "settings.recentEmojis";
const MAX_RECENT_EMOJIS = 5;
const SHOW_DECORATIONS_KEY = "settings.showDecorations";

/** Empty string means "use the system default device". */
interface MediaPrefs {
  inputDeviceId: string;
  outputDeviceId: string;
  videoDeviceId: string;
}

interface SettingsState extends MediaPrefs {
  /** Most recently used reactions, newest first. */
  recentEmojis: string[];
  /** Whether pixel art decorations are drawn behind messages. Local to this device. */
  showDecorations: boolean;
  setShowDecorations: (show: boolean) => void;
  load: () => Promise<void>;
  setInputDevice: (id: string) => void;
  setOutputDevice: (id: string) => void;
  setVideoDevice: (id: string) => void;
  recordEmoji: (emoji: string) => void;
}

function persist(state: MediaPrefs) {
  const { inputDeviceId, outputDeviceId, videoDeviceId } = state;
  storage.set(KEY, JSON.stringify({ inputDeviceId, outputDeviceId, videoDeviceId })).catch(() => {});
}

function loadRecentEmojis(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_EMOJIS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is string => typeof e === "string").slice(0, MAX_RECENT_EMOJIS);
  } catch {
    return [];
  }
}

function loadShowDecorations(): boolean {
  try {
    return localStorage.getItem(SHOW_DECORATIONS_KEY) !== "false";
  } catch {
    return true;
  }
}

function saveRecentEmojis(emojis: string[]) {
  try {
    localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(emojis));
  } catch {
    // Storage unavailable — recent emojis simply won't persist.
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  inputDeviceId: "",
  outputDeviceId: "",
  videoDeviceId: "",
  recentEmojis: loadRecentEmojis(),
  showDecorations: loadShowDecorations(),
  setShowDecorations: (showDecorations) => {
    set({ showDecorations });
    try {
      localStorage.setItem(SHOW_DECORATIONS_KEY, String(showDecorations));
    } catch {
      // Storage unavailable — the choice lasts for this session only.
    }
  },
  load: async () => {
    try {
      const raw = await storage.get(KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<MediaPrefs>;
      set({
        inputDeviceId: typeof saved.inputDeviceId === "string" ? saved.inputDeviceId : "",
        outputDeviceId: typeof saved.outputDeviceId === "string" ? saved.outputDeviceId : "",
        videoDeviceId: typeof saved.videoDeviceId === "string" ? saved.videoDeviceId : "",
      });
    } catch { /* corrupt or unavailable storage: keep defaults */ }
  },
  setInputDevice: (inputDeviceId) => { set({ inputDeviceId }); persist(get()); },
  setOutputDevice: (outputDeviceId) => { set({ outputDeviceId }); persist(get()); },
  setVideoDevice: (videoDeviceId) => { set({ videoDeviceId }); persist(get()); },
  recordEmoji: (emoji) => {
    set((s) => {
      const next = [emoji, ...s.recentEmojis.filter((e) => e !== emoji)].slice(0, MAX_RECENT_EMOJIS);
      saveRecentEmojis(next);
      return { recentEmojis: next };
    });
  },
}));
