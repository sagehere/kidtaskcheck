# AGENTS.md

## Project Overview

This is a Docker-first Node.js + React + SQLite family task check-in app. There is no legacy hosted-platform deployment path in this repository.

## Commands

- Install: `npm install`
- Full verification: `npm run build && npm test`
- Start local Node server: `npm run server`
- Start local Node server with scheduler: `ENABLE_BUILTIN_SCHEDULER=true npm run server`
- Apply SQLite migrations: `npm run db:migrate:sqlite`
- Verify SQLite database: `npm run db:verify:sqlite`
- Docker update: `docker compose pull && docker compose up -d`

## Architecture

- Frontend entry: `src/App.tsx`
- Role apps: `src/AdminApp.tsx`, `src/ParentApp.tsx`, `src/ChildApp.tsx`
- Shared UI: `src/components`
- API router: `server/api/router.mjs`
- API route handlers: `server/api/routes`
- API utilities and database helpers: `server/api/utils.js`
- AI generation and scheduled refresh: `server/api/ai`
- Node HTTP/static server: `server/index.mjs`
- Local scheduler process: `server/scheduler.mjs`
- SQLite adapter: `server/sqlite-db.mjs`
- Migrations: `migrations/*.sql`
- Tests: Vitest with in-memory SQLite in `tests/helpers/sqlite-test-db.ts`

## Deployment

- The production image is `ghcr.io/sagehere/kidtaskcheck:latest`.
- `docker-compose.yml` exposes the app on `127.0.0.1:3000`.
- Public HTTPS is expected to be handled by an existing reverse proxy such as Nginx Proxy Manager.
- Do not commit `data/`, `backups/`, SQLite files, logs, or local build output.

## Gotchas

- `src/lib/domain.ts` and `src/lib/domain.js` must stay in sync.
- Point balance is derived from `point_ledger` sums.
- Cross-family queries must filter by `parent_id` at the SQL level.
- Deleting a parent or child should remain archival/soft-delete behavior.
- Production `APP_URL` must match the public browser URL exactly.
- Production `ADMIN_PASSWORD` must not be the default placeholder.
