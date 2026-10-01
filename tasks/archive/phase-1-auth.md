# Phase 1 — Auth & User System

> Prerequisite: Phase 0 complete (backend skeleton, DB running, config loaded)

## Dependency Graph

```
1.1 (users migration) ──→ 1.2 (auth package) ──┬──→ 1.3 (rate limiting)
                                                 ├──→ 1.4 (user profiles)
                                                 └──→ 1.5 (auth frontend)
```

**Can run in parallel:**
- 1.3 + 1.4 + 1.5 after 1.2 is done (all three write to completely separate files/directories)

**Must be sequential:**
- 1.1 → 1.2 (auth package needs users table)

---

## Task 1.1: Users Table Migration

**Sequential — run first** | Writes to: `backend/migrations/`

**Goal:** Create the `users` table in PostgreSQL.

**Schema:**
```sql
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(32) NOT NULL UNIQUE,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  VARCHAR(64),
    avatar_url    TEXT,
    status        VARCHAR(20) NOT NULL DEFAULT 'offline',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
```

**Steps:**
1. Create `backend/migrations/000001_create_users.up.sql`
2. Create `backend/migrations/000001_create_users.down.sql` (DROP TABLE)
3. Run migration against local Postgres
4. Verify table exists with correct columns

**Acceptance criteria:**
- Migration runs without errors
- Down migration cleanly drops the table
- `\d users` shows correct schema

---

## Task 1.2: Auth Domain Package

**Depends on: 1.1** | Writes to: `backend/internal/auth/`

**Goal:** Build `internal/auth/` with register, login, token refresh, and logout. This is the reference pattern for domain packages where the handler/service/repository split applies.

**Files to create:**
- `models.go` — RegisterRequest, LoginRequest, AuthResponse, UserResponse structs
- `repository.go` — CreateUser, GetUserByEmail, GetUserByID
- `service.go` — Register, Login, RefreshToken, Logout (business logic)
- `handler.go` — HTTP handlers for each endpoint
- `routes.go` — route registration for auth endpoints and route-specific middleware
- `middleware.go` — JWT auth middleware that extracts userID into `c.Locals`
- `auth_test.go` — unit tests for service + handler integration tests

**Implementation details:**
- Password hashing: bcrypt with cost 12
- JWT access token: 15 min expiry, contains `userID` and `username`
- Refresh token: 7 day expiry, stored in Redis with key `refresh:{tokenHash}`
- Logout: delete refresh token from Redis
- Auth middleware: validate JWT, set `c.Locals("userID")` and `c.Locals("username")`

**Endpoints:**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /auth/register | No | Create account |
| POST | /auth/login | No | Login, return tokens |
| POST | /auth/refresh | No | Refresh access token |
| POST | /auth/logout | Yes | Invalidate refresh token |

**Acceptance criteria:**
- Register creates user, returns tokens
- Login with correct credentials returns tokens
- Login with wrong password returns 401
- Refresh with valid refresh token returns new access token
- Expired access token returns 401 on protected routes
- All tests pass: `go test ./internal/auth/...`

---

## Task 1.3: Rate Limiting

**Parallel group: B** (after 1.2) | Writes to: `backend/pkg/middleware/ratelimit.go`

**Goal:** Redis-backed rate limiter as reusable middleware, applied to auth endpoints.

**Implementation:**
- Create `pkg/middleware/ratelimit.go` — generic rate limiter middleware
- Use sliding window counter in Redis
- Key: `ratelimit:{ip}:{endpoint}`
- Limits: 5 requests/minute on `/auth/login`, 3/minute on `/auth/register`
- Return 429 with `Retry-After` header when exceeded
- Apply via route config in `internal/auth/routes.go` (add middleware to specific routes)

**Acceptance criteria:**
- 6th login attempt within 1 minute returns 429
- Rate limit resets after window expires
- Middleware is reusable for future endpoints

---

## Task 1.4: User Profile Endpoints

**Parallel group: B** (after 1.2) | Writes to: `backend/internal/user/`

**Goal:** Get and update user profiles in a separate `internal/user/` package.

**Files:** `internal/user/` — models.go, repository.go, service.go, handler.go, routes.go

**Endpoints:**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /users/:id | Yes | Get user profile (public fields only) |
| PATCH | /users/me | Yes | Update own profile (display_name, avatar_url) |

**Acceptance criteria:**
- GET returns user without password_hash or email
- PATCH updates only allowed fields
- Cannot update another user's profile

---

## Task 1.5: Auth Frontend

**Parallel group: B** (after 1.2) | Writes to: `frontend/src/`

**Goal:** Login and register pages in React.

**Components:**
- `pages/LoginPage.tsx` — email + password form
- `pages/RegisterPage.tsx` — username + email + password form
- `stores/authStore.ts` — Zustand store for user + token state
- `lib/api.ts` — Axios interceptor for token injection + refresh on 401

**Flow:**
1. Register/Login → store tokens in memory (Zustand) + refresh in httpOnly cookie or localStorage
2. Axios interceptor adds `Authorization: Bearer <accessToken>` to all requests
3. On 401 response, interceptor calls `/auth/refresh`, retries original request
4. On refresh failure, redirect to login

**Acceptance criteria:**
- Can register a new account from the UI
- Can login and see a basic "Welcome, {username}" page
- Token refresh works transparently
- Redirect to login on session expiry
