import axios, { AxiosError } from "axios";
import { storage } from "./storage";

const baseURL = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";
export const apiBaseURL = baseURL;

/**
 * Resolves a relative media URL (e.g. `/uploads/avatars/...`) against the API
 * origin. Web builds serve `/uploads` from the same origin, so the URL is left
 * untouched; desktop/Tauri builds point at an absolute API origin and need the
 * prefix. Absolute URLs are returned unchanged.
 */
export function resolveMediaUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (!url.startsWith("/")) return url;
  if (/^https?:\/\//i.test(baseURL)) {
    try {
      return new URL(url, baseURL).toString();
    } catch {
      return url;
    }
  }
  return url;
}

export const api = axios.create({
  baseURL,
  headers: { "Content-Type": "application/json" },
});

// In-memory token — set by authStore, read synchronously by the interceptor
let _token: string | null = null;
export function setToken(token: string | null) {
  _token = token;
}

// ── Session refresh ──────────────────────────────────────────────────────────

/** The server definitively rejected the refresh token — the user must log in again. */
export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired");
    this.name = "SessionExpiredError";
  }
}

interface SessionHandlers {
  onRefreshed: (session: { accessToken: string; user: unknown }) => void;
  onExpired: () => void;
}

let handlers: SessionHandlers | null = null;
export function setSessionHandlers(h: SessionHandlers) {
  handlers = h;
}

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];
let refreshPromise: Promise<string> | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function clearSession() {
  await storage.remove("access_token");
  await storage.remove("refresh_token");
  await storage.remove("user");
  setToken(null);
  handlers?.onExpired();
}

async function doRefresh(): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    // Re-read each attempt: another window may have rotated the token meanwhile.
    const refreshToken = await storage.get("refresh_token");
    if (!refreshToken) {
      await clearSession();
      throw new SessionExpiredError();
    }
    try {
      const { data } = await axios.post(`${baseURL}/auth/refresh`, { refreshToken });
      const { accessToken, refreshToken: nextRefreshToken, user } = data.data;
      // Persist the rotated refresh token BEFORE anything else — it is single-use.
      if (nextRefreshToken) await storage.set("refresh_token", nextRefreshToken);
      await storage.set("access_token", accessToken);
      if (user) await storage.set("user", JSON.stringify(user));
      setToken(accessToken);
      handlers?.onRefreshed({ accessToken, user });
      scheduleRefresh();
      return accessToken;
    } catch (err) {
      const status = (err as AxiosError).response?.status;
      // Only an explicit rejection ends the session. Network errors, 5xx and
      // 429 are transient: keep the credentials and retry.
      if (status === 400 || status === 401 || status === 403) {
        await clearSession();
        throw new SessionExpiredError();
      }
      if (attempt >= RETRY_DELAYS_MS.length) throw err;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/** Refresh the session; concurrent callers share one in-flight attempt. */
export function refreshSession(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

// ── Proactive refresh ────────────────────────────────────────────────────────

const REFRESH_MARGIN_MS = 2 * 60 * 1000;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let keeperStarted = false;

function tokenExpiryMs(token: string | null): number | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function isTokenFresh(token: string | null): boolean {
  const exp = tokenExpiryMs(token);
  return exp !== null && exp - Date.now() > REFRESH_MARGIN_MS;
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  const exp = tokenExpiryMs(_token);
  if (exp === null) return;
  const delay = Math.max(5_000, exp - Date.now() - REFRESH_MARGIN_MS);
  refreshTimer = setTimeout(() => {
    refreshSession().catch(() => scheduleRetry());
  }, delay);
}

function scheduleRetry() {
  if (!_token) return;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshSession().catch(() => scheduleRetry());
  }, 30_000);
}

function revalidate() {
  if (!_token || isTokenFresh(_token)) return;
  refreshSession().catch(() => scheduleRetry());
}

/**
 * Keeps the access token fresh in the background: refreshes shortly before
 * expiry, and re-checks whenever the window regains focus or the network
 * returns (timers are throttled or frozen while the app is in the background
 * or the machine sleeps).
 */
export function startSessionKeeper() {
  scheduleRefresh();
  if (keeperStarted || typeof window === "undefined") return;
  keeperStarted = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") revalidate();
  });
  window.addEventListener("focus", revalidate);
  window.addEventListener("online", revalidate);
}

export function stopSessionKeeper() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
}

// ── Axios interceptors ───────────────────────────────────────────────────────

api.interceptors.request.use((config) => {
  if (_token) {
    config.headers.Authorization = `Bearer ${_token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && original && !original._retry && !original.url?.includes("/auth/")) {
      original._retry = true;
      try {
        const newToken = await refreshSession();
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch {
        // Expired → handlers already logged the user out. Transient failure →
        // keep the session and surface the original error to the caller.
      }
    }
    return Promise.reject(error);
  }
);
