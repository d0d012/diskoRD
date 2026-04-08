import axios from "axios";

// In browser (nginx proxy): VITE_API_URL is not set, "/api" is the nginx prefix.
// In Tauri: set VITE_API_URL=https://diskord.ahmertezcan.com/api in .env.production.
const baseURL = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";

export const api = axios.create({
  baseURL,
  headers: { "Content-Type": "application/json" },
});

// Inject access token on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token") ?? sessionStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, attempt token refresh only if a refresh token exists
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refreshToken = localStorage.getItem("refresh_token");
      // No refresh token (e.g. mock account) — let the caller handle the error
      if (!refreshToken) {
        return Promise.reject(error);
      }
      try {
        const { data } = await axios.post("/api/auth/refresh", { refreshToken });
        localStorage.setItem("access_token", data.data.accessToken);
        original.headers.Authorization = `Bearer ${data.data.accessToken}`;
        return api(original);
      } catch {
        localStorage.removeItem("access_token");
        localStorage.removeItem("user");
        localStorage.removeItem("refresh_token");
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);
