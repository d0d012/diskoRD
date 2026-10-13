# AGENTS.md

diskoRD is a self-hosted Discord alternative: Go + Fiber backend (`backend/`), React + Vite + TypeScript + Tailwind frontend (`frontend/`), Tauri v2 desktop shell (`frontend/src-tauri/`), PostgreSQL, Redis, LiveKit. Setup and commands are in `README.md`; non-obvious runtime behavior (gateway fanout, auth/session refresh, DM call state, voice) is in `docs/architecture.md` — read the relevant section before touching those areas.

## Conventions

- **API:** every endpoint returns `{ "data": ... }` or `{ "error": "message" }`; paginated lists are `{ "data": { "items": [...], "hasMore": bool } }` with cursor pagination. Return HTTP errors as `fiber.NewError(status, msg)`, wrap internal errors with the call site (`fmt.Errorf("guild.Service.Create: %w", err)`), log with zerolog, and never leak internal errors to clients.
- **Migrations:** golang-migrate, applied manually (the server does not migrate on start). Name files `NNNNNN_description.{up,down}.sql`; every up needs a down. Numbering has gaps — take the next number after the highest existing one. UUID PKs, `created_at`/`updated_at` TIMESTAMPTZ, explicit `ON DELETE` on every FK, indexed FKs.
- **Frontend:** named exports only, function declarations for components, Zustand for global state.
- **Tests:** Go uses testify with mocks at the repository boundary; frontend uses Vitest + React Testing Library.

## Before committing

- Backend: `go test ./...` in `backend/`. Frontend: `npm run lint` and `npm run test` in `frontend/`.
- Commits: `type(scope): description` (types `feat|fix|refactor|test|chore|docs`; scope is the domain, `frontend`, `infra`, or `release`). Branches: `feature/…`, `fix/…`, `refactor/…`.
- Releases: bump the version in `frontend/package.json`, `frontend/src-tauri/Cargo.toml` and `tauri.conf.json` together, and keep `@tauri-apps/*` npm package versions on the same minor as their Rust crates — the release build fails on a mismatch. A `v*` tag builds the Windows installer only. Deploy the backend first with `scripts/update.sh` (README) when the new client needs new endpoints; `scripts/deploy.sh` is for provisioning a fresh server only.

## Repo layout notes

- Task specs live in `tasks/` (see `tasks/README.md`); `tasks/active/` is ready-to-implement work.
- `.cursor/rules/` holds more detailed per-area conventions.
- Never commit `.env` files or secrets.
