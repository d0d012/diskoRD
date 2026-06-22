# Persistent Auth, Auto-Updater, Noise Cancellation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Tauri desktop app always stay logged in, self-update like Discord, and suppress eating/background noise in voice calls.

**Architecture:**
- Auth tokens move from web storage (wiped by WebView cache resets) to `tauri-plugin-store` (encrypted file on disk). A storage abstraction keeps browser dev working via `localStorage` fallback. App startup silently refreshes the session before rendering routes.
- The Tauri updater plugin checks GitHub Releases on startup; a GitHub Actions workflow builds, signs, and uploads installers on every `v*` tag.
- Noise cancellation uses `rnnoise-wasm` (RNNoise compiled to WebAssembly) piped through a `ScriptProcessorNode` to produce a denoised `MediaStream`, which LiveKit publishes instead of the raw mic.

**Tech Stack:** React + Vite + TypeScript + Tailwind, Tauri v2, Zustand, LiveKit client, `tauri-plugin-store` v2, `tauri-plugin-updater` v2, `@tauri-apps/plugin-process` v2, `rnnoise-wasm`, GitHub Actions `tauri-apps/tauri-action`

## Global Constraints

- Tauri version: 2.10.3 (already in Cargo.toml)
- Rust edition: 2021
- All Tauri plugin crates use version `"2"` (semver-compatible with tauri 2.x)
- Named exports only; function declarations for React components
- No `sessionStorage` anywhere after Task 3
- All storage reads/writes go through `frontend/src/lib/storage.ts`
- Backend Go code: untouched

---

### Task 1: Install Tauri store plugin

**Files:**
- Modify: `frontend/src-tauri/Cargo.toml`
- Modify: `frontend/src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `tauri_plugin_store` registered in the Tauri app — required by Task 2's `@tauri-apps/plugin-store` JS calls

- [ ] **Step 1: Add plugin to Cargo.toml**

In `frontend/src-tauri/Cargo.toml`, change the `[dependencies]` section to:

```toml
[dependencies]
serde_json = "1.0"
serde = { version = "1.0", features = ["derive"] }
log = "0.4"
tauri = { version = "2.10.3", features = [] }
tauri-plugin-log = "2"
tauri-plugin-store = "2"
```

- [ ] **Step 2: Register plugin in lib.rs**

Replace the entire contents of `frontend/src-tauri/src/lib.rs` with:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::new().build())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
```

- [ ] **Step 3: Install the JS package**

```bash
cd frontend && npm install @tauri-apps/plugin-store
```

Expected: package added to `package.json`, no errors.

- [ ] **Step 4: Verify Rust compiles**

```bash
cd frontend && npm run tauri build -- --debug 2>&1 | tail -20
```

Expected: no `error[E...]` lines. Warning lines are fine.

- [ ] **Step 5: Commit**

```bash
git add frontend/src-tauri/Cargo.toml frontend/src-tauri/src/lib.rs frontend/package.json frontend/package-lock.json
git commit -m "feat(auth): install tauri-plugin-store for persistent token storage"
```

---

### Task 2: Storage abstraction

**Files:**
- Create: `frontend/src/lib/storage.ts`

**Interfaces:**
- Produces: `storage.get(key)`, `storage.set(key, value)`, `storage.remove(key)`, `storage.clear()` — all return `Promise<...>` — consumed by Tasks 3, 4, and 10

- [ ] **Step 1: Create the file**

Create `frontend/src/lib/storage.ts`:

```typescript
const isTauri = () =>
  typeof window !== "undefined" && !!(window as Record<string, unknown>)["__TAURI_INTERNALS__"];

let _store: import("@tauri-apps/plugin-store").Store | null = null;

async function tauriStore() {
  if (!_store) {
    const { Store } = await import("@tauri-apps/plugin-store");
    _store = await Store.load("diskord.json", { autoSave: true });
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
    } else {
      localStorage.setItem(key, value);
    }
  },

  async remove(key: string): Promise<void> {
    if (isTauri()) {
      const s = await tauriStore();
      await s.delete(key);
    } else {
      localStorage.removeItem(key);
    }
  },

  async clear(): Promise<void> {
    if (isTauri()) {
      const s = await tauriStore();
      await s.clear();
    } else {
      localStorage.clear();
    }
  },
};
```

- [ ] **Step 2: Write the test**

Create `frontend/src/lib/storage.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @tauri-apps/plugin-store before importing storage
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn().mockResolvedValue({
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

import { storage } from "./storage";

describe("storage (browser fallback)", () => {
  beforeEach(() => {
    localStorage.clear();
    // Ensure we're not in Tauri context
    delete (window as Record<string, unknown>)["__TAURI_INTERNALS__"];
  });

  it("returns null for missing key", async () => {
    expect(await storage.get("missing")).toBeNull();
  });

  it("sets and gets a value", async () => {
    await storage.set("token", "abc123");
    expect(await storage.get("token")).toBe("abc123");
  });

  it("removes a key", async () => {
    await storage.set("token", "abc123");
    await storage.remove("token");
    expect(await storage.get("token")).toBeNull();
  });

  it("clears all keys", async () => {
    await storage.set("a", "1");
    await storage.set("b", "2");
    await storage.clear();
    expect(await storage.get("a")).toBeNull();
    expect(await storage.get("b")).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd frontend && npm run test -- storage.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/storage.ts frontend/src/lib/storage.test.ts
git commit -m "feat(auth): add storage abstraction (Tauri store / localStorage)"
```

---

### Task 3: Rewrite auth store for async persistent storage

**Files:**
- Modify: `frontend/src/stores/authStore.ts`

**Interfaces:**
- Consumes: `storage` from `../lib/storage`
- Consumes: `setToken` from `../lib/api` (defined in Task 4 — add it to api.ts first if running tasks in order, otherwise implement them together)
- Produces: `useAuthStore` with new fields `isInitialized: boolean` and `initialize(): Promise<void>` — consumed by Task 5

- [ ] **Step 1: Rewrite authStore.ts**

Replace the entire contents of `frontend/src/stores/authStore.ts`:

```typescript
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
          await storage.clear();
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
    await storage.clear();
    setToken(null);
    set({ user: null, accessToken: null });
  },

  setUser: (user) => set({ user }),
}));
```

- [ ] **Step 2: Run existing tests to catch regressions**

```bash
cd frontend && npm run test 2>&1 | tail -30
```

Expected: no new failures (there are no authStore tests currently, so this is a smoke check).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/stores/authStore.ts
git commit -m "feat(auth): rewrite authStore to use persistent storage, add initialize()"
```

---

### Task 4: Fix API interceptor to use in-memory token

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Produces: `setToken(token: string | null): void` — consumed by authStore (Task 3) and called on logout
- Consumes: `storage` from `./storage` — for refresh token reads in 401 handler

- [ ] **Step 1: Rewrite api.ts**

Replace the entire contents of `frontend/src/lib/api.ts`:

```typescript
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
        await storage.clear();
        setToken(null);
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);
```

- [ ] **Step 2: Run tests**

```bash
cd frontend && npm run test 2>&1 | tail -20
```

Expected: all tests still pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "fix(auth): use in-memory token in api interceptor, async refresh token read"
```

---

### Task 5: App startup — initialize auth before rendering routes

**Files:**
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `useAuthStore().initialize()` and `useAuthStore().isInitialized` from Task 3

- [ ] **Step 1: Update App.tsx**

Replace the entire contents of `frontend/src/App.tsx`:

```tsx
import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { AppPage } from "./pages/AppPage";
import { InvitePage } from "./pages/InvitePage";
import { useAuthStore } from "./stores/authStore";

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuthStore();
  const location = useLocation();
  return accessToken ? (
    <>{children}</>
  ) : (
    <Navigate to="/login" state={{ returnTo: location.pathname }} replace />
  );
}

function GuestRoute({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuthStore();
  return accessToken ? <Navigate to="/app" replace /> : <>{children}</>;
}

export function App() {
  const { initialize, isInitialized } = useAuthStore();

  useEffect(() => {
    initialize();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isInitialized) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "var(--color-dc-bg-primary, #313338)",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            border: "3px solid #5865f2",
            borderTopColor: "transparent",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
        <Route path="/register" element={<GuestRoute><RegisterPage /></GuestRoute>} />
        <Route
          path="/app"
          element={
            <PrivateRoute>
              <AppPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/invite/:code"
          element={
            <PrivateRoute>
              <InvitePage />
            </PrivateRoute>
          }
        />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 2: Test the auth flow manually in browser dev**

```bash
cd frontend && npm run dev
```

1. Open `http://localhost:5173`, log in — verify you land on `/app`
2. Hard-refresh (`Cmd+Shift+R`) — verify you stay on `/app` (not redirected to login)
3. Click logout — verify you land on `/login`
4. Refresh — verify you stay on `/login`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(auth): initialize auth from persistent storage on app start"
```

---

### Task 6: Install and configure the Tauri updater plugin

**Files:**
- Modify: `frontend/src-tauri/Cargo.toml`
- Modify: `frontend/src-tauri/src/lib.rs`
- Modify: `frontend/src-tauri/tauri.conf.json`

**Interfaces:**
- Produces: `tauri_plugin_updater` available in the app — required by Task 7's GitHub Actions build and Task 8's update check UI

- [ ] **Step 1: Add updater crate to Cargo.toml**

In `frontend/src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

Full `[dependencies]` section now looks like:

```toml
[dependencies]
serde_json = "1.0"
serde = { version = "1.0", features = ["derive"] }
log = "0.4"
tauri = { version = "2.10.3", features = [] }
tauri-plugin-log = "2"
tauri-plugin-store = "2"
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

- [ ] **Step 2: Register plugins in lib.rs**

Replace `frontend/src-tauri/src/lib.rs`:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
```

- [ ] **Step 3: Install JS packages**

```bash
cd frontend && npm install @tauri-apps/plugin-updater @tauri-apps/plugin-process
```

- [ ] **Step 4: Generate the signing keypair (ONE-TIME — do this on your machine)**

```bash
cd frontend && npm run tauri signer generate -- -w ~/.tauri/diskoRD.key
```

This prints:
```
Public key: dW50cnVzdGVkIGNvbW1lbnQ...  (long base64 string)
Environment variables:
  TAURI_SIGNING_PRIVATE_KEY=<long base64>
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<password>
```

Copy the **public key** (starts with `dW50...`) — you need it in the next step.
Copy `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — add them to GitHub Actions secrets at `https://github.com/d0d012/diskoRD/settings/secrets/actions` with exactly those names.

**Never commit the private key file.**

- [ ] **Step 5: Add updater config to tauri.conf.json**

Replace the entire `frontend/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "../node_modules/@tauri-apps/cli/config.schema.json",
  "productName": "diskoRD",
  "version": "0.1.0",
  "identifier": "com.diskord.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "windows": [
      {
        "title": "diskoRD",
        "width": 1280,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "resizable": true,
        "fullscreen": false,
        "decorations": false,
        "transparent": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  },
  "plugins": {
    "updater": {
      "pubkey": "REPLACE_WITH_YOUR_PUBLIC_KEY",
      "endpoints": [
        "https://github.com/d0d012/diskoRD/releases/latest/download/latest.json"
      ]
    }
  }
}
```

Replace `REPLACE_WITH_YOUR_PUBLIC_KEY` with the public key printed in Step 4.

- [ ] **Step 6: Verify Rust compiles**

```bash
cd frontend && npm run tauri build -- --debug 2>&1 | tail -20
```

Expected: no `error[E...]` lines.

- [ ] **Step 7: Commit**

```bash
git add frontend/src-tauri/Cargo.toml frontend/src-tauri/src/lib.rs frontend/src-tauri/tauri.conf.json frontend/package.json frontend/package-lock.json
git commit -m "feat(updater): install tauri-plugin-updater and configure GitHub releases endpoint"
```

---

### Task 7: GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: GitHub secrets `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (set up in Task 6 Step 4)
- Produces: GitHub Release with `diskoRD_*_x64-setup.exe` and `latest.json` as release assets — which the updater endpoint in Task 6 reads

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    permissions:
      contents: write
    runs-on: windows-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: frontend/package-lock.json

      - name: Install frontend deps
        working-directory: frontend
        run: npm ci

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: frontend/src-tauri -> target

      - name: Build and release
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          projectPath: frontend
          tagName: ${{ github.ref_name }}
          releaseName: diskoRD ${{ github.ref_name }}
          releaseBody: "Self-updating release — install once and the app updates itself."
          releaseDraft: false
          prerelease: false
          includeUpdaterJson: true
```

- [ ] **Step 2: Test the workflow trigger**

Push a test tag to trigger the build:

```bash
git tag v0.1.1
git push origin v0.1.1
```

Go to `https://github.com/d0d012/diskoRD/actions` — watch the `Release` workflow run. Once it completes, check `https://github.com/d0d012/diskoRD/releases` for the new release with `diskoRD_0.1.1_x64-setup.exe` and `latest.json` attached.

**Expected:** Green workflow, release visible with both assets.

If the workflow fails: read the Actions log. Most common issue is the signing key secret not being set — verify both secrets are present in GitHub repository settings.

- [ ] **Step 3: Commit the workflow file**

```bash
git add .github/workflows/release.yml
git commit -m "feat(updater): add GitHub Actions release workflow for Tauri builds"
```

---

### Task 8: In-app update check and toast

**Files:**
- Create: `frontend/src/hooks/useUpdater.ts`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process` (installed in Task 6)
- Consumes: `isTauri` detection from `storage.ts` pattern (inline check for `__TAURI_INTERNALS__`)

- [ ] **Step 1: Create useUpdater hook**

Create `frontend/src/hooks/useUpdater.ts`:

```typescript
import { useEffect, useState } from "react";

function isTauri() {
  return !!(window as Record<string, unknown>)["__TAURI_INTERNALS__"];
}

export function useUpdater() {
  const [updateReady, setUpdateReady] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;

    async function checkForUpdate() {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (cancelled || !update?.available) return;
        setUpdateVersion(update.version ?? null);

        await update.downloadAndInstall();
        if (!cancelled) setUpdateReady(true);
      } catch {
        // Silently ignore — update check failures should never surface to users
      }
    }

    checkForUpdate();
    return () => { cancelled = true; };
  }, []);

  async function restartApp() {
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      window.location.reload();
    }
  }

  return { updateReady, updateVersion, restartApp };
}
```

- [ ] **Step 2: Add update toast to App.tsx**

In `frontend/src/App.tsx`, add the import and toast. Replace the full file:

```tsx
import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { AppPage } from "./pages/AppPage";
import { InvitePage } from "./pages/InvitePage";
import { useAuthStore } from "./stores/authStore";
import { useUpdater } from "./hooks/useUpdater";

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuthStore();
  const location = useLocation();
  return accessToken ? (
    <>{children}</>
  ) : (
    <Navigate to="/login" state={{ returnTo: location.pathname }} replace />
  );
}

function GuestRoute({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuthStore();
  return accessToken ? <Navigate to="/app" replace /> : <>{children}</>;
}

function UpdateToast({
  version,
  onRestart,
}: {
  version: string | null;
  onRestart: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 9999,
        backgroundColor: "#5865f2",
        color: "#fff",
        borderRadius: 8,
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        fontSize: 14,
      }}
    >
      <span>
        diskoRD {version ? `v${version}` : "update"} is ready
      </span>
      <button
        onClick={onRestart}
        style={{
          backgroundColor: "#fff",
          color: "#5865f2",
          border: "none",
          borderRadius: 4,
          padding: "4px 10px",
          fontWeight: 600,
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        Restart
      </button>
    </div>
  );
}

export function App() {
  const { initialize, isInitialized } = useAuthStore();
  const { updateReady, updateVersion, restartApp } = useUpdater();

  useEffect(() => {
    initialize();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isInitialized) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "var(--color-dc-bg-primary, #313338)",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            border: "3px solid #5865f2",
            borderTopColor: "transparent",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
          <Route path="/register" element={<GuestRoute><RegisterPage /></GuestRoute>} />
          <Route
            path="/app"
            element={
              <PrivateRoute>
                <AppPage />
              </PrivateRoute>
            }
          />
          <Route
            path="/invite/:code"
            element={
              <PrivateRoute>
                <InvitePage />
              </PrivateRoute>
            }
          />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </BrowserRouter>
      {updateReady && (
        <UpdateToast version={updateVersion} onRestart={restartApp} />
      )}
    </>
  );
}
```

- [ ] **Step 3: Verify app still starts cleanly**

```bash
cd frontend && npm run dev
```

Open `http://localhost:5173` — app should load normally, no console errors about the updater (it silently skips when not in Tauri).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useUpdater.ts frontend/src/App.tsx
git commit -m "feat(updater): add update check on startup with restart toast"
```

---

### Task 9: Noise cancellation — RNNoise setup and Vite config

**Files:**
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/src/stores/voiceStore.ts`

**Interfaces:**
- Produces: `isNoiseCancellationEnabled` and `setNoiseCancellationEnabled` in `voiceStore` — consumed by Tasks 10 and 11

- [ ] **Step 1: Install rnnoise-wasm**

```bash
cd frontend && npm install rnnoise-wasm
```

Expected: package in `node_modules/rnnoise-wasm`, no errors.

- [ ] **Step 2: Update vite.config.ts for WASM**

Replace `frontend/vite.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["rnnoise-wasm"],
  },
  assetsInclude: ["**/*.wasm"],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/gateway": {
        target: "ws://localhost:8080",
        ws: true,
      },
      "/rtc": {
        target: "ws://localhost:7880",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 3: Add NC state to voiceStore**

Read `frontend/src/stores/voiceStore.ts` first, then add `isNoiseCancellationEnabled` and `setNoiseCancellationEnabled` to the store interface and implementation. Find the existing interface definition and add these two fields alongside the existing fields. Find the `create<VoiceStore>` call and add the implementation:

```typescript
isNoiseCancellationEnabled: false,
setNoiseCancellationEnabled: (enabled: boolean) =>
  set({ isNoiseCancellationEnabled: enabled }),
```

Add to the interface:
```typescript
isNoiseCancellationEnabled: boolean;
setNoiseCancellationEnabled: (enabled: boolean) => void;
```

- [ ] **Step 4: Verify dev server starts**

```bash
cd frontend && npm run dev 2>&1 | head -20
```

Expected: `VITE v...  ready in ...ms` with no WASM-related errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/vite.config.ts frontend/src/stores/voiceStore.ts frontend/package.json frontend/package-lock.json
git commit -m "feat(voice): install rnnoise-wasm, add NC state to voiceStore"
```

---

### Task 10: Noise cancellation hook

**Files:**
- Create: `frontend/src/hooks/useNoiseCancellation.ts`

**Interfaces:**
- Consumes: `storage` from `../lib/storage`
- Consumes: `isNoiseCancellationEnabled`, `setNoiseCancellationEnabled` from voiceStore
- Produces: `processStream(raw: MediaStream): Promise<{ stream: MediaStream; cleanup: () => void }>` — consumed by Tasks 11 and 12

- [ ] **Step 1: Create the hook**

Create `frontend/src/hooks/useNoiseCancellation.ts`:

```typescript
import { useCallback, useRef } from "react";
import { useVoiceStore } from "../stores/voiceStore";
import { storage } from "../lib/storage";

interface RNNoiseModule {
  newState: () => unknown;
  processFrame: (state: unknown, frame: Float32Array) => number;
  deleteState: (state: unknown) => void;
}

const FRAME_SIZE = 480;
const SAMPLE_RATE = 48000;

async function applyRNNoise(
  rawStream: MediaStream,
  rnnoise: RNNoiseModule
): Promise<{ stream: MediaStream; cleanup: () => void }> {
  const state = rnnoise.newState();
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const source = ctx.createMediaStreamSource(rawStream);
  // 512 is the smallest power-of-2 buffer, closest to the 480-sample RNNoise frame
  const processor = ctx.createScriptProcessor(512, 1, 1);
  const dest = ctx.createMediaStreamDestination();

  let leftover = new Float32Array(0);

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const output = e.outputBuffer.getChannelData(0);

    const combined = new Float32Array(leftover.length + input.length);
    combined.set(leftover);
    combined.set(input, leftover.length);

    const processed = new Float32Array(combined.length);
    let offset = 0;

    while (offset + FRAME_SIZE <= combined.length) {
      const frame = combined.slice(offset, offset + FRAME_SIZE);
      rnnoise.processFrame(state, frame);
      processed.set(frame, offset);
      offset += FRAME_SIZE;
    }

    leftover = combined.slice(offset);
    output.set(processed.subarray(0, output.length));
  };

  source.connect(processor);
  processor.connect(dest);

  const cleanup = () => {
    processor.disconnect();
    source.disconnect();
    ctx.close();
    rnnoise.deleteState(state);
  };

  return { stream: dest.stream, cleanup };
}

export function useNoiseCancellation() {
  const { isNoiseCancellationEnabled, setNoiseCancellationEnabled } =
    useVoiceStore();
  const rnnoiseRef = useRef<RNNoiseModule | null>(null);

  const loadRNNoise = useCallback(async (): Promise<RNNoiseModule> => {
    if (!rnnoiseRef.current) {
      // rnnoise-wasm exports a factory function as default
      const factory = await import("rnnoise-wasm");
      rnnoiseRef.current = await (factory.default ?? factory)();
    }
    return rnnoiseRef.current!;
  }, []);

  const processStream = useCallback(
    async (
      raw: MediaStream
    ): Promise<{ stream: MediaStream; cleanup: () => void }> => {
      if (!isNoiseCancellationEnabled) {
        return { stream: raw, cleanup: () => {} };
      }
      const rnnoise = await loadRNNoise();
      return applyRNNoise(raw, rnnoise);
    },
    [isNoiseCancellationEnabled, loadRNNoise]
  );

  const toggle = useCallback(async () => {
    const next = !isNoiseCancellationEnabled;
    setNoiseCancellationEnabled(next);
    await storage.set("nc_enabled", String(next));
  }, [isNoiseCancellationEnabled, setNoiseCancellationEnabled]);

  const loadPersistedPreference = useCallback(async () => {
    const val = await storage.get("nc_enabled");
    if (val === "true") setNoiseCancellationEnabled(true);
  }, [setNoiseCancellationEnabled]);

  return {
    isEnabled: isNoiseCancellationEnabled,
    processStream,
    toggle,
    loadPersistedPreference,
  };
}
```

- [ ] **Step 2: Load persisted NC preference on app start**

In `frontend/src/App.tsx`, inside the `App` function, add the NC preference load after the `initialize()` call:

Find the `useEffect` that calls `initialize()` and update it:

```tsx
const { loadPersistedPreference } = useNoiseCancellation();

useEffect(() => {
  initialize();
  loadPersistedPreference();
}, []); // eslint-disable-line react-hooks/exhaustive-deps
```

Add the import at the top of App.tsx:
```tsx
import { useNoiseCancellation } from "./hooks/useNoiseCancellation";
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useNoiseCancellation.ts frontend/src/App.tsx
git commit -m "feat(voice): add useNoiseCancellation hook with RNNoise processing"
```

---

### Task 11: Integrate noise cancellation into useVoice

**Files:**
- Modify: `frontend/src/hooks/useVoice.ts`

**Interfaces:**
- Consumes: `useNoiseCancellation().processStream` from Task 10
- Consumes: `LocalAudioTrack` from `livekit-client`

- [ ] **Step 1: Modify useVoice.ts**

Replace the entire `frontend/src/hooks/useVoice.ts`:

```typescript
import { useEffect, useRef, useState, useCallback } from "react";
import {
  Room,
  RoomEvent,
  Track,
  LocalAudioTrack,
  Participant,
  RemoteParticipant,
  ConnectionState,
  type TrackPublication,
} from "livekit-client";
import { playSound } from "../lib/sounds";
import { useVoiceStore } from "../stores/voiceStore";
import { useNoiseCancellation } from "./useNoiseCancellation";

export interface VoiceParticipant {
  identity: string;
  name: string;
  isSpeaking: boolean;
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  isScreenSharing: boolean;
  isLocal: boolean;
  cameraTrack: Track | null;
  screenTrack: Track | null;
  audioTrack: Track | null;
  screenAudioTrack: Track | null;
}

function buildParticipant(p: Participant, isLocal: boolean): VoiceParticipant {
  let cameraTrack: Track | null = null;
  let screenTrack: Track | null = null;
  let audioTrack: Track | null = null;
  let screenAudioTrack: Track | null = null;

  for (const pub of p.trackPublications.values()) {
    if (!pub.track) continue;
    if (pub.source === Track.Source.Camera) cameraTrack = pub.track;
    if (pub.source === Track.Source.ScreenShare) screenTrack = pub.track;
    if (pub.source === Track.Source.Microphone) audioTrack = pub.track;
    if (pub.source === Track.Source.ScreenShareAudio) screenAudioTrack = pub.track;
  }

  return {
    identity: p.identity,
    name: p.name ?? p.identity,
    isSpeaking: p.isSpeaking,
    isMicEnabled: p.isMicrophoneEnabled,
    isCameraEnabled: p.isCameraEnabled,
    isScreenSharing: screenTrack !== null,
    isLocal,
    cameraTrack,
    screenTrack,
    audioTrack,
    screenAudioTrack,
  };
}

export function useVoice() {
  const roomRef = useRef<Room | null>(null);
  const ncCleanupRef = useRef<(() => void) | null>(null);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.Disconnected
  );
  const {
    liveKitToken,
    liveKitUrl,
    isMuted,
    isCameraOn,
    isScreenSharing,
    screenShareFps,
    screenShareResolution,
    screenShareAudio,
    onRoomDisconnected,
  } = useVoiceStore();
  const { processStream } = useNoiseCancellation();

  const refreshParticipants = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    const list: VoiceParticipant[] = [
      buildParticipant(room.localParticipant, true),
    ];
    room.remoteParticipants.forEach((p: RemoteParticipant) => {
      list.push(buildParticipant(p, false));
    });
    setParticipants(list);
  }, []);

  // Connect / disconnect when token/url changes
  useEffect(() => {
    if (!liveKitToken || !liveKitUrl) {
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      ncCleanupRef.current?.();
      ncCleanupRef.current = null;
      setParticipants([]);
      setConnectionState(ConnectionState.Disconnected);
      return;
    }

    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    room.on(RoomEvent.Connected, async () => {
      setConnectionState(ConnectionState.Connected);
      refreshParticipants();
      const { isMuted } = useVoiceStore.getState();

      try {
        const rawStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        const { stream: processedStream, cleanup } =
          await processStream(rawStream);
        ncCleanupRef.current = cleanup;

        const processedTrack = processedStream.getAudioTracks()[0];
        const livekitTrack = new LocalAudioTrack(
          processedTrack,
          undefined,
          false
        );
        await room.localParticipant.publishTrack(livekitTrack);
        if (isMuted) {
          await room.localParticipant.setMicrophoneEnabled(false);
        }
      } catch {
        // Fall back to LiveKit's built-in mic handling
        room.localParticipant.setMicrophoneEnabled(!isMuted);
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      setConnectionState(ConnectionState.Disconnected);
      setParticipants([]);
      ncCleanupRef.current?.();
      ncCleanupRef.current = null;
      onRoomDisconnected();
    });
    room.on(RoomEvent.Reconnecting, () =>
      setConnectionState(ConnectionState.Reconnecting)
    );
    room.on(RoomEvent.ParticipantConnected, refreshParticipants);
    room.on(RoomEvent.ParticipantDisconnected, refreshParticipants);
    room.on(RoomEvent.TrackSubscribed, refreshParticipants);
    room.on(RoomEvent.TrackUnsubscribed, refreshParticipants);
    room.on(RoomEvent.LocalTrackPublished, refreshParticipants);
    room.on(RoomEvent.LocalTrackUnpublished, refreshParticipants);
    room.on(RoomEvent.ActiveSpeakersChanged, refreshParticipants);
    room.on(RoomEvent.TrackMuted, (pub: TrackPublication) => {
      if (pub.source === Track.Source.Microphone) playSound("mute");
      refreshParticipants();
    });
    room.on(RoomEvent.TrackUnmuted, (pub: TrackPublication) => {
      if (pub.source === Track.Source.Microphone) playSound("unmute");
      refreshParticipants();
    });

    room.connect(liveKitUrl, liveKitToken);

    return () => {
      room.removeAllListeners();
      room.disconnect();
      roomRef.current = null;
      ncCleanupRef.current?.();
      ncCleanupRef.current = null;
    };
  }, [liveKitToken, liveKitUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mic mute/unmute
  useEffect(() => {
    roomRef.current?.localParticipant.setMicrophoneEnabled(!isMuted);
  }, [isMuted]);

  // Camera — fixed 720p / 30fps
  useEffect(() => {
    roomRef.current?.localParticipant.setCameraEnabled(isCameraOn, {
      resolution: { width: 1280, height: 720, frameRate: 30 },
    });
  }, [isCameraOn]);

  // Screen share — uses store resolution, fps, and audio settings
  useEffect(() => {
    const resolutionMap = {
      "720": { width: 1280, height: 720 },
      "1080": { width: 1920, height: 1080 },
      "1440": { width: 2560, height: 1440 },
      source: { width: 0, height: 0 },
    };
    const { width, height } = resolutionMap[screenShareResolution];
    const resolution = width
      ? { width, height, frameRate: screenShareFps }
      : { width: 99999, height: 99999, frameRate: screenShareFps };
    roomRef.current?.localParticipant.setScreenShareEnabled(isScreenSharing, {
      audio: screenShareAudio,
      resolution,
    });
  }, [isScreenSharing, screenShareFps, screenShareResolution, screenShareAudio]);

  return { participants, connectionState };
}
```

- [ ] **Step 2: Run lint**

```bash
cd frontend && npm run lint 2>&1 | tail -20
```

Expected: no new errors related to `useVoice.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useVoice.ts
git commit -m "feat(voice): apply RNNoise noise cancellation to mic stream in guild voice"
```

---

### Task 12: Integrate noise cancellation into DMCallPanel

**Files:**
- Modify: `frontend/src/features/call/DMCallPanel.tsx`

**Interfaces:**
- Consumes: `useNoiseCancellation().processStream` from Task 10
- Consumes: `LocalAudioTrack` from `livekit-client`

- [ ] **Step 1: Modify DMCallPanel.tsx**

At the top of `frontend/src/features/call/DMCallPanel.tsx`, add imports:

```typescript
import { LocalAudioTrack } from "livekit-client";
import { useNoiseCancellation } from "../../hooks/useNoiseCancellation";
```

Add `useNoiseCancellation` inside the `DMCallPanel` function component (alongside existing hooks):

```typescript
const { processStream } = useNoiseCancellation();
```

Find the `room.connect(call.url, call.token).then(() => {` block and replace it with:

```typescript
room.connect(call.url, call.token).then(async () => {
  try {
    const rawStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const { stream: processedStream, cleanup } = await processStream(rawStream);
    // Store cleanup so it runs when the component unmounts
    (roomRef.current as Room & { _ncCleanup?: () => void })._ncCleanup = cleanup;
    const processedTrack = processedStream.getAudioTracks()[0];
    const livekitTrack = new LocalAudioTrack(processedTrack, undefined, false);
    await room.localParticipant.publishTrack(livekitTrack);
  } catch {
    room.localParticipant.setMicrophoneEnabled(true).catch(() => {});
  }
  refresh();
});
```

Find the cleanup `return () => {` block and add NC cleanup:

```typescript
return () => {
  const r = roomRef.current as (Room & { _ncCleanup?: () => void }) | null;
  r?._ncCleanup?.();
  room.disconnect();
  roomRef.current = null;
  setParticipants([]);
};
```

- [ ] **Step 2: Run lint**

```bash
cd frontend && npm run lint 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/call/DMCallPanel.tsx
git commit -m "feat(voice): apply RNNoise noise cancellation in DM call panel"
```

---

### Task 13: Noise cancellation toggle in ControlBar and DMCallPanel header

**Files:**
- Modify: `frontend/src/features/voice/ControlBar.tsx`
- Modify: `frontend/src/features/call/DMCallPanel.tsx`

**Interfaces:**
- Consumes: `useNoiseCancellation().toggle`, `useNoiseCancellation().isEnabled` from Task 10

- [ ] **Step 1: Add NC toggle to ControlBar.tsx**

In `frontend/src/features/voice/ControlBar.tsx`, add the import:

```typescript
import { useNoiseCancellation } from "../../hooks/useNoiseCancellation";
```

Inside `export function ControlBar`, add:

```typescript
const { isEnabled: isNCEnabled, toggle: toggleNC } = useNoiseCancellation();
```

Add the NC button between the screen-share button and the disconnect button (before the `{/* Disconnect */}` comment):

```tsx
{/* Noise Cancellation */}
<ControlBtn
  active={isNCEnabled}
  onClick={toggleNC}
  title={isNCEnabled ? "Noise cancellation on" : "Noise cancellation off"}
  floating={floating}
>
  {isNCEnabled ? (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 15c1.66 0 3-1.34 3-3V6c0-1.66-1.34-3-3-3S9 4.34 9 6v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V6zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-2.08c3.39-.49 6-3.39 6-6.92h-2z"/>
      <path d="M2 2l20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  ) : (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 15c1.66 0 3-1.34 3-3V6c0-1.66-1.34-3-3-3S9 4.34 9 6v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V6zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-2.08c3.39-.49 6-3.39 6-6.92h-2z"/>
    </svg>
  )}
</ControlBtn>
```

- [ ] **Step 2: Add NC toggle to DMCallPanel header**

In `frontend/src/features/call/DMCallPanel.tsx`, add the import (if not already there from Task 12):

```typescript
import { useNoiseCancellation } from "../../hooks/useNoiseCancellation";
```

Inside `DMCallPanel`, add alongside existing hooks:

```typescript
const { isEnabled: isNCEnabled, toggle: toggleNC } = useNoiseCancellation();
```

In the header button group (the `<div className="flex items-center gap-1">` containing mute and end-call buttons), add the NC button before the end-call button:

```tsx
{/* Noise Cancellation */}
<button
  onClick={toggleNC}
  className="p-1 rounded transition-colors"
  title={isNCEnabled ? "Noise cancellation on" : "Noise cancellation off"}
  style={{
    color: isNCEnabled
      ? "var(--color-dc-interactive-active, #00b0f4)"
      : "var(--color-dc-interactive-normal)",
  }}
  onMouseEnter={(e) =>
    (e.currentTarget.style.backgroundColor =
      "var(--color-dc-bg-modifier-hover)")
  }
  onMouseLeave={(e) =>
    (e.currentTarget.style.backgroundColor = "transparent")
  }
>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 15c1.66 0 3-1.34 3-3V6c0-1.66-1.34-3-3-3S9 4.34 9 6v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V6zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-2.08c3.39-.49 6-3.39 6-6.92h-2z"/>
  </svg>
</button>
```

- [ ] **Step 3: Run lint**

```bash
cd frontend && npm run lint 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 4: Manual test — verify NC toggle works**

```bash
cd frontend && npm run dev
```

1. Log in and join a voice channel
2. Verify NC button appears in control bar
3. Click it — it should highlight (active state)
4. Reload — verify the preference is remembered (NC still on)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/voice/ControlBar.tsx frontend/src/features/call/DMCallPanel.tsx
git commit -m "feat(voice): add noise cancellation toggle button to ControlBar and DM call panel"
```

---

## Summary of all files changed

| File | Action |
|---|---|
| `frontend/src-tauri/Cargo.toml` | Add `tauri-plugin-store`, `tauri-plugin-updater`, `tauri-plugin-process` |
| `frontend/src-tauri/src/lib.rs` | Register all three plugins |
| `frontend/src-tauri/tauri.conf.json` | Add updater config with pubkey + endpoint |
| `frontend/src/lib/storage.ts` | New — async storage abstraction |
| `frontend/src/lib/storage.test.ts` | New — tests for storage |
| `frontend/src/lib/api.ts` | Use in-memory token, async refresh token |
| `frontend/src/stores/authStore.ts` | Async persistent auth, add `initialize()` |
| `frontend/src/stores/voiceStore.ts` | Add `isNoiseCancellationEnabled` state |
| `frontend/src/App.tsx` | Call `initialize()`, show loading spinner, update toast |
| `frontend/src/hooks/useUpdater.ts` | New — update check + download + restart |
| `frontend/src/hooks/useNoiseCancellation.ts` | New — RNNoise hook |
| `frontend/src/hooks/useVoice.ts` | Apply NC to mic before publishing |
| `frontend/src/features/call/DMCallPanel.tsx` | Apply NC to mic, add toggle button |
| `frontend/src/features/voice/ControlBar.tsx` | Add NC toggle button |
| `frontend/vite.config.ts` | Add WASM support for rnnoise-wasm |
| `.github/workflows/release.yml` | New — build, sign, release on tag push |
