import { create } from "zustand";
import {
  api,
  setToken,
  setSessionHandlers,
  refreshSession,
  isTokenFresh,
  startSessionKeeper,
  stopSessionKeeper,
  SessionExpiredError,
} from "../lib/api";
import { storage } from "../lib/storage";
import { useCallStore } from "./callStore";
import type { User } from "../types";

interface AuthStore {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  isInitialized: boolean;
  initialize: () => Promise<void>;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  register: (
    email: string,
    displayName: string,
    username: string,
    password: string
  ) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
}

function parseUser(raw: string | null): User | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
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
      const storedUser = parseUser(userRaw);

      if (accessToken && (isTokenFresh(accessToken) || !refreshToken)) {
        setToken(accessToken);
        set({ user: storedUser, accessToken, isInitialized: true });
        startSessionKeeper();
        return;
      }

      if (refreshToken) {
        // Show the app immediately with the stored session; refresh in the
        // background so a slow or offline start never logs the user out.
        if (accessToken && storedUser) {
          setToken(accessToken);
          set({ user: storedUser, accessToken, isInitialized: true });
          startSessionKeeper();
          refreshSession().catch(() => {});
          return;
        }
        try {
          await refreshSession();
          set({ isInitialized: true });
          startSessionKeeper();
          return;
        } catch (err) {
          if (!(err instanceof SessionExpiredError)) {
            // Transient failure with nothing cached — stay on login but keep
            // the refresh token so the next attempt can succeed.
          }
        }
      }
    } catch {
      // Storage read failure — continue to login
    }
    set({ isInitialized: true });
  },

  login: async (email, password, rememberMe = true) => {
    set({ isLoading: true });
    try {
      const { data } = await api.post("/auth/login", { email, password, rememberMe });
      const { accessToken, refreshToken, user } = data.data;
      await storage.set("refresh_token", refreshToken);
      await storage.set("access_token", accessToken);
      await storage.set("user", JSON.stringify(user));
      setToken(accessToken);
      set({ user, accessToken, isLoading: false });
      startSessionKeeper();
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
      await storage.set("refresh_token", refreshToken);
      await storage.set("access_token", accessToken);
      await storage.set("user", JSON.stringify(user));
      setToken(accessToken);
      set({ user, accessToken, isLoading: false });
      startSessionKeeper();
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  logout: async () => {
    const { call, endCall } = useCallStore.getState();
    if (call) await endCall(call.channelId);
    const refreshToken = await storage.get("refresh_token");
    if (refreshToken) {
      await api.post("/auth/logout", { refreshToken }).catch(() => {});
    }
    stopSessionKeeper();
    await storage.remove("access_token");
    await storage.remove("refresh_token");
    await storage.remove("user");
    setToken(null);
    set({ user: null, accessToken: null });
  },

  setUser: (user) => set({ user }),
}));

// Keep the store in sync with background token refreshes, and log out in-place
// (no full page reload) when the server definitively rejects the session.
setSessionHandlers({
  onRefreshed: ({ accessToken, user }) => {
    useAuthStore.setState((s) => ({
      accessToken,
      user: (user as User | undefined) ?? s.user,
    }));
  },
  onExpired: () => {
    stopSessionKeeper();
    useAuthStore.setState({ user: null, accessToken: null });
  },
});
