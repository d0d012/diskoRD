import { create } from "zustand";
import { api } from "../lib/api";
import type { User } from "../types";

interface AuthStore {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  accessToken: localStorage.getItem("access_token"),
  isLoading: false,

  login: async (email, password) => {
    set({ isLoading: true });

    // Mock account for development
    if (email === "test" && password === "12345") {
      const mockUser: User = {
        id: "mock-user-1",
        username: "test",
        discriminator: "0001",
        status: "online",
        createdAt: new Date().toISOString(),
      };
      localStorage.setItem("access_token", "mock-token");
      set({ user: mockUser, accessToken: "mock-token", isLoading: false });
      return;
    }

    const { data } = await api.post("/auth/login", { email, password });
    localStorage.setItem("access_token", data.data.accessToken);
    localStorage.setItem("refresh_token", data.data.refreshToken);
    set({ user: data.data.user, accessToken: data.data.accessToken, isLoading: false });
  },

  logout: async () => {
    await api.post("/auth/logout").catch(() => {});
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    set({ user: null, accessToken: null });
  },

  setUser: (user) => set({ user }),
}));
