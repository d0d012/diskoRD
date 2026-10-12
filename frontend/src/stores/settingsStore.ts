import { create } from "zustand";
import { storage } from "../lib/storage";

const KEY = "settings.media";

/** Empty string means "use the system default device". */
interface MediaPrefs {
  inputDeviceId: string;
  outputDeviceId: string;
  videoDeviceId: string;
}

interface SettingsState extends MediaPrefs {
  load: () => Promise<void>;
  setInputDevice: (id: string) => void;
  setOutputDevice: (id: string) => void;
  setVideoDevice: (id: string) => void;
}

function persist(state: MediaPrefs) {
  const { inputDeviceId, outputDeviceId, videoDeviceId } = state;
  storage.set(KEY, JSON.stringify({ inputDeviceId, outputDeviceId, videoDeviceId })).catch(() => {});
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  inputDeviceId: "",
  outputDeviceId: "",
  videoDeviceId: "",
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
}));
