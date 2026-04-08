import { create } from "zustand";
import { api } from "../lib/api";
import type { User } from "../types";

interface AuthStore {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, displayName: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
}

function loadUser(): User | null {
  try {
    const raw = localStorage.getItem("user") ?? sessionStorage.getItem("user");
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: loadUser(),
  accessToken: sessionStorage.getItem("access_token") ?? localStorage.getItem("access_token"),
  isLoading: false,

  login: async (email, password) => {
    set({ isLoading: true });

    // Mock account for development
    if ((email === "test" || email === "test@test.com") && password === "12345") {
      const mockUser: User = {
        id: "mock-user-1",
        username: "test",
        displayName: "Test User",
        status: "online",
        createdAt: new Date().toISOString(),
      };
      localStorage.setItem("access_token", "mock-token");
      localStorage.setItem("user", JSON.stringify(mockUser));
      set({ user: mockUser, accessToken: "mock-token", isLoading: false });
      return;
    }

    try {
      const { data } = await api.post("/auth/login", { email, password });
      localStorage.setItem("access_token", data.data.accessToken);
      localStorage.setItem("user", JSON.stringify(data.data.user));
      localStorage.setItem("refresh_token", data.data.refreshToken);
      set({ user: data.data.user, accessToken: data.data.accessToken, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  register: async (email, displayName, username, password) => {
    set({ isLoading: true });
    try {
      const { data } = await api.post("/auth/register", { email, displayName, username, password });
      sessionStorage.setItem("access_token", data.data.accessToken);
      sessionStorage.setItem("user", JSON.stringify(data.data.user));
      localStorage.setItem("refresh_token", data.data.refreshToken);
      set({ user: data.data.user, accessToken: data.data.accessToken, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  logout: async () => {
    const refreshToken = localStorage.getItem("refresh_token");
    if (refreshToken) {
      await api.post("/auth/logout", { refreshToken }).catch(() => {});
    }
    sessionStorage.removeItem("access_token");
    sessionStorage.removeItem("user");
    localStorage.removeItem("access_token");
    localStorage.removeItem("user");
    localStorage.removeItem("refresh_token");
    set({ user: null, accessToken: null });
  },

  setUser: (user) => set({ user }),
}));
