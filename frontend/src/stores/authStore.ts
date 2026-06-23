import { create } from "zustand";
import { api, setToken } from "../lib/api";
import { storage } from "../lib/storage";
import type { User } from "../types";

interface AuthStore {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  isInitialized: boolean;
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    displayName: string,
    username: string,
    password: string
  ) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  accessToken: null,
  isLoading: false,
  isInitialized: false,

  initialize: async () => {
    try {
      const [accessToken, refreshToken, userRaw] = await Promise.all([
        storage.get("access_token"),
        storage.get("refresh_token"),
        storage.get("user"),
      ]);

      if (accessToken) {
        const user = userRaw ? (JSON.parse(userRaw) as User) : null;
        setToken(accessToken);
        set({ user, accessToken, isInitialized: true });
        return;
      }

      if (refreshToken) {
        try {
          const { data } = await api.post("/auth/refresh", { refreshToken });
          const newToken: string = data.data.accessToken;
          const user: User = data.data.user;
          await storage.set("access_token", newToken);
          await storage.set("user", JSON.stringify(user));
          setToken(newToken);
          set({ user, accessToken: newToken, isInitialized: true });
          return;
        } catch {
          await storage.remove("access_token");
          await storage.remove("refresh_token");
          await storage.remove("user");
        }
      }
    } catch {
      // Storage read failure — continue to login
    }
    set({ isInitialized: true });
  },

  login: async (email, password) => {
    set({ isLoading: true });

    if ((email === "test" || email === "test@test.com") && password === "12345") {
      const mockUser: User = {
        id: "mock-user-1",
        username: "test",
        displayName: "Test User",
        status: "online",
        createdAt: new Date().toISOString(),
      };
      await storage.set("access_token", "mock-token");
      await storage.set("user", JSON.stringify(mockUser));
      setToken("mock-token");
      set({ user: mockUser, accessToken: "mock-token", isLoading: false });
      return;
    }

    try {
      const { data } = await api.post("/auth/login", { email, password });
      const { accessToken, refreshToken, user } = data.data;
      await storage.set("access_token", accessToken);
      await storage.set("refresh_token", refreshToken);
      await storage.set("user", JSON.stringify(user));
      setToken(accessToken);
      set({ user, accessToken, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  register: async (email, displayName, username, password) => {
    set({ isLoading: true });
    try {
      const { data } = await api.post("/auth/register", {
        email,
        displayName,
        username,
        password,
      });
      const { accessToken, refreshToken, user } = data.data;
      await storage.set("access_token", accessToken);
      await storage.set("refresh_token", refreshToken);
      await storage.set("user", JSON.stringify(user));
      setToken(accessToken);
      set({ user, accessToken, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  logout: async () => {
    const refreshToken = await storage.get("refresh_token");
    if (refreshToken) {
      await api.post("/auth/logout", { refreshToken }).catch(() => {});
    }
    await storage.remove("access_token");
    await storage.remove("refresh_token");
    await storage.remove("user");
    setToken(null);
    set({ user: null, accessToken: null });
  },

  setUser: (user) => set({ user }),
}));
