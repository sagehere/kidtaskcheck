# AGENTS.md

## AI Maintenance Mode

This repository uses an AI feature-index driven maintenance workflow. The goal is to reduce future Codex token use by locating the relevant user-facing feature first, then reading only the files needed for that feature.

Before every Codex task in this repository:

1. Read `docs/ai/PROJECT_INDEX.md` and `docs/ai/FEATURE_INDEX.md` first.
2. Identify the matching feature unit in `FEATURE_INDEX.md` before reading implementation files.
3. Read P0 files first. Prefer staying within P0 unless the task clearly requires more context.
4. When reading P1 or P2 files, state the reason briefly before doing so.
5. Do not default to whole-project search. Use targeted CodeGraph queries for structural questions and targeted `rg` only for literal text.
6. If an index conflicts with code, trust the code, complete the task, and correct the index.
7. After any business-code change, update `docs/ai/FEATURE_INDEX.md`.
8. After any change, append an entry to `docs/ai/CHANGELOG_AI.md`.
9. Do not do unrelated refactors.
10. Do not upgrade dependencies unless the user explicitly asks.
11. Run the smallest necessary verification for the touched area.

Do not read these directories unless the user explicitly asks and gives a specific reason:

- `node_modules`
- `dist`
- `build`
- `.next`
- `coverage`
- `.git`
- large logs or generated files

## Shell And Tools

- Local shell commands should use `rtk` as described in `C:\Users\link\.codex\RTK.md`.
- Use CodeGraph for structural questions: symbols, call chains, definitions, and impact.
- Use `rg` for targeted literal searches after the feature unit is identified.
- Prefer precise file reads over broad exploration.

## Git Publishing

- Default all user-requested pushes to the remote `main` branch.
- Do not create, switch to, or push a feature branch unless the user explicitly requests a branch or pull request workflow.

## Project Overview

This is a Docker-first Node.js + React + SQLite family task check-in app. There is no legacy hosted-platform deployment path in this repository.

## Commands

- Install: `npm install`
- Full verification: `npm run build && npm test`
- Build only: `npm run build`
- Test only: `npm test`
- Start Vite dev server: `npm run dev`
- Start local Node server: `npm run server`
- Start local Node server with scheduler: `ENABLE_BUILTIN_SCHEDULER=true npm run server`
- Run scheduler process: `npm run scheduler`
- SQLite migrate: `npm run db:migrate:sqlite`
- Docker update: `docker compose pull && docker compose up -d`

## Architecture

- Frontend entry: `src/App.tsx`
- Role apps: `src/AdminApp.tsx`, `src/ParentApp.tsx`, `src/ChildApp.tsx`
- Shared UI: `src/components`
- API client/types: `src/api/client.ts`, `src/types/api.ts`
- Shared domain helpers: `src/lib/domain.ts`, `src/lib/domain.js`
- API router: `server/api/router.mjs`
- API route handlers: `server/api/routes`
- API utilities and database helpers: `server/api/utils.js`
- AI generation, queues, cache, scheduled refresh: `server/api/ai`
- Node HTTP/static server: `server/index.mjs`
- Shared scheduler tick: `server/scheduler-tick.mjs`
- Local scheduler process: `server/scheduler.mjs`
- SQLite adapter: `server/sqlite-db.mjs`
- Migrations: `migrations/*.sql`
- Tests: Vitest with in-memory SQLite in `tests/helpers/sqlite-test-db.ts`

## Deployment

- The production image is `ghcr.io/sagehere/kidtaskcheck:latest`.
- Current `docker-compose.yml` maps host port `100` to container port `3000`.
- Public HTTPS is expected to be handled by an existing reverse proxy such as Nginx Proxy Manager.
- Do not commit `data/`, `backups/`, SQLite files, logs, or local build output.

## Gotchas

- `src/lib/domain.ts` and `src/lib/domain.js` must stay in sync.
- Point balance is derived from `point_ledger` sums.
- Cross-family queries must filter by `parent_id` at the SQL level.
- Deleting a parent or child should remain archival/soft-delete behavior.
- Production `APP_URL` must match the public browser URL exactly.
- Production `ADMIN_PASSWORD` must not be the default placeholder.
- New database tables or columns may need both migrations and runtime `ensure*` helpers.
- Parent AI settings use draft state; background polling must not overwrite in-progress edits.
