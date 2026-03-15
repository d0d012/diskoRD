# Phase 0 — Foundation

## Dependency Graph

```
0.1 (Go backend) ──┐
                    ├──→ 0.4 (Env config) ──→ 0.5 (CI pipeline)
0.2 (React frontend)┘         │
                               │
0.3 (Docker Compose) ─────────┘
```

**Can run in parallel:**
- 0.1 + 0.2 + 0.3 (all write to separate directories: `backend/`, `frontend/`, `infra/`)

**Must wait:**
- 0.4 after 0.1 (merges env loading into `pkg/config/config.go` created by 0.1)
- 0.5 after 0.1 + 0.2 (CI references both backend and frontend)

---

## Task 0.1: Go Backend Skeleton

**Parallel group: A** | Writes to: `backend/`

**Goal:** Initialize the Go module with the project folder structure.

**Steps:**
1. `go mod init github.com/d0d012/diskord` inside `backend/`
2. Create directory structure:
   ```
   backend/
     cmd/server/main.go        # Fiber app setup, placeholder route
     internal/auth/
     internal/gateway/
     internal/guild/
     internal/message/
     internal/presence/
     internal/voice/
     internal/friend/
     internal/storage/
     pkg/db/db.go              # PostgreSQL connection helper (pool via pgx or database/sql)
     pkg/redis/redis.go        # Redis client wrapper
     pkg/config/config.go      # Viper config loader — load from .env with defaults for all vars
     migrations/
   ```
3. Install core deps: `fiber/v2`, `viper`, `pgx/v5`, `go-redis/v9`, `zerolog`, `testify`, `golang-migrate`
4. `pkg/config/config.go` should load all vars from `.env.example` via Viper with sensible defaults so the app starts without a `.env` file in development
5. `main.go` should: load config, connect to DB, connect to Redis, start Fiber on `:8080`, have `GET /health` returning `{"data":"ok"}`
6. Verify: `go build ./cmd/server` compiles, `go test ./...` passes

**Acceptance criteria:**
- `go build ./cmd/server` succeeds
- `go test ./...` passes
- `GET /health` returns 200

---

## Task 0.2: React + Vite Frontend Skeleton

**Parallel group: A** | Writes to: `frontend/`

**Goal:** Initialize the frontend with TypeScript, Tailwind, and folder structure.

**Steps:**
1. `npm create vite@latest frontend -- --template react-ts`
2. Install: `tailwindcss`, `postcss`, `autoprefixer`, `axios`, `zustand`, `react-router-dom`
3. Configure Tailwind
4. Create folder structure:
   ```
   frontend/src/
     components/ui/
     features/
     hooks/
     stores/
     lib/api.ts          # Axios instance with baseURL from env
     types/
     pages/
   ```
5. Create a minimal `App.tsx` with React Router and a placeholder home page
6. Set up Vite proxy: `/api` → `http://localhost:8080`

**Acceptance criteria:**
- `npm run dev` starts the dev server
- `npm run build` produces a production build
- `npm run lint` passes

---

## Task 0.3: Docker Compose (Local Dev)

**Parallel group: A** | Writes to: `infra/`

**Goal:** Docker Compose that runs PostgreSQL, Redis, and Nginx.

**Steps:**
1. Create `infra/docker-compose.yml` with:
   - `postgres:16` — port 5432, volume for data, init with `diskord` database
   - `redis:7` — port 6379
   - `nginx` — reverse proxy config (port 80 → frontend:5173, /api → backend:8080)
2. Create `infra/nginx/nginx.conf` with the reverse proxy rules
3. Create `infra/nginx/dev.conf` for local development

**Acceptance criteria:**
- `docker compose -f infra/docker-compose.yml up -d` starts all 3 services
- `psql` can connect to the database
- `redis-cli ping` returns PONG

---

## Task 0.4: Verify Integration

**Depends on: 0.1, 0.2, 0.3** | Sequential

**Goal:** Ensure backend connects to Dockerized Postgres and Redis, and frontend proxies to backend.

**Steps:**
1. Copy `.env.example` to `.env`
2. Start Docker services: `docker compose -f infra/docker-compose.yml up -d`
3. Run backend: `cd backend && go run ./cmd/server`
4. Verify `GET http://localhost:8080/health` returns 200
5. Run frontend: `cd frontend && npm run dev`
6. Verify frontend loads at `http://localhost:5173`

**Acceptance criteria:**
- Backend starts and connects to Postgres + Redis without errors
- Frontend dev server starts
- Health endpoint responds

---

## Task 0.5: CI Pipeline (GitHub Actions)

**Depends on: 0.1, 0.2** | Writes to: `.github/`

**Goal:** Basic CI that runs on every push/PR.

**Steps:**
1. Create `.github/workflows/ci.yml`
2. Jobs:
   - **backend**: `go vet`, `go test ./...`, `go build ./cmd/server`
   - **frontend**: `npm ci`, `npm run lint`, `npm run build`
3. Trigger on push to `main` and all PRs

**Acceptance criteria:**
- CI config is valid YAML
- Jobs cover lint, test, and build for both backend and frontend
