const isTauri = () =>
  typeof window !== "undefined" &&
  !!((window as unknown) as Record<string, unknown>)["__TAURI_INTERNALS__"];

let _store: import("@tauri-apps/plugin-store").Store | null = null;

async function tauriStore() {
  if (!_store) {
    const { load } = await import("@tauri-apps/plugin-store");
    _store = await load("diskord.json", { defaults: {}, autoSave: true });
  }
  return _store;
}

export const storage = {
  async get(key: string): Promise<string | null> {
    if (isTauri()) {
      const s = await tauriStore();
      const val = await s.get<string>(key);
      return val ?? null;
    }
    return localStorage.getItem(key);
  },

  async set(key: string, value: string): Promise<void> {
    if (isTauri()) {
      const s = await tauriStore();
      await s.set(key, value);
      await s.save(); // flush immediately — refresh tokens are single-use
    } else {
      localStorage.setItem(key, value);
    }
  },

  async remove(key: string): Promise<void> {
    if (isTauri()) {
      const s = await tauriStore();
      await s.delete(key);
      await s.save();
    } else {
      localStorage.removeItem(key);
    }
  },

  async clear(): Promise<void> {
    if (isTauri()) {
      const s = await tauriStore();
      await s.clear();
      await s.save();
    } else {
      localStorage.clear();
    }
  },
};
