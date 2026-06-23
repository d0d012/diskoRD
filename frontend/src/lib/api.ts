import axios from "axios";
import { storage } from "./storage";

const baseURL = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";

export const api = axios.create({
  baseURL,
  headers: { "Content-Type": "application/json" },
});

// In-memory token — set by authStore, read synchronously by the interceptor
let _token: string | null = null;
export function setToken(token: string | null) {
  _token = token;
}

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
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refreshToken = await storage.get("refresh_token");
      if (!refreshToken) {
        return Promise.reject(error);
      }
      try {
        const { data } = await axios.post(`${baseURL}/auth/refresh`, { refreshToken });
        const newToken: string = data.data.accessToken;
        await storage.set("access_token", newToken);
        setToken(newToken);
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch {
        await storage.remove("access_token");
        await storage.remove("refresh_token");
        await storage.remove("user");
        setToken(null);
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);
