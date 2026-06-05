# AGENTS.md

## Project Overview

"儿童任务打卡" — a family task/reward system for children. React 19 + TypeScript frontend, Cloudflare Pages Functions API, D1 database. Also runnable locally with Node.js + SQLite.

## Key Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on port 5173 (frontend only, no API) |
| `npm run build` | TypeScript check + Vite build → `dist/` |
| `npm test` | Vitest (all tests, in-memory SQLite) |
| `npm run pages:dev` | Local Cloudflare Pages dev on port 8788 (includes API + D1) |
| `npm run server` | Local Node.js server on port 3000 (SQLite, no Cloudflare) |
| `npm run db:migrate:local` | Apply D1 migrations to local `.wrangler/state` |
| `npm run db:migrate:remote` | Apply D1 migrations to remote D1 |
| `npm run pages:publish` | Build + migrate remote D1 + deploy Pages |
| `npm run scheduler:deploy` | Deploy the Cron Worker |

Run a single test file:
```bash
npx vitest run tests/cross-family.test.ts
```

## Architecture

- **Frontend entry**: `src/App.tsx` — lazy-loads `AdminApp`, `ParentApp`, `ChildApp` based on role.
- **API entry**: `functions/api/[[path]].js` — catch-all route handler, dispatches to `routes/{auth,admin,parent,child,shared}.js`.
- **Node.js server**: `server/index.mjs` — adapts the Cloudflare Functions code to run as a plain Node.js HTTP server (used for Docker/self-hosted deployments).
- **Domain logic**: `src/lib/domain.ts` — shared period calculation, streak logic, timezone helpers. Imported by both frontend and backend.
- **D1 adapter**: `server/d1-sqlite-adapter.mjs` — implements the D1 API surface over `node:sqlite` for local dev.
- **Cron Worker**: `workers/ai-scheduler.js` (Cloudflare) / `server/scheduler.mjs` (Node.js) — AI refresh tasks. Pages does not support Cron Triggers, so this is a separate Worker.
- **Migrations**: `migrations/*.sql` — sequential numbered files applied to D1 or SQLite.

## Two Wrangler Configs

- `wrangler.toml` — Pages config. **Do not add `[triggers]` here**; Pages rejects it.
- `wrangler.scheduler.toml` — Cron Worker config. Has `[triggers]` with `crons = ["*/30 * * * *"]`.

Both must have the same `database_id` pointing to the same D1 database. The D1 binding name must be `DB` in both.

## Testing

- Framework: Vitest, configured in `vite.config.mjs` under `test.environment = "node"`.
- Tests use an in-memory SQLite mock (`tests/helpers/d1-mock.ts`) that mimics the D1 API.
- Test setup (`tests/helpers/setup.ts`) runs all `migrations/*.sql` against the in-memory DB.
- Tests import API route functions directly and call them with the mock `env` object.
- Test files: `api.test.ts`, `cross-family.test.ts`, `concurrency.test.ts`, `domain.test.ts`, `ledger.test.ts`, `migration.test.ts`, `notifications.test.ts`, `ai.test.ts`, `server-adapter.test.js`.

## TypeScript

- `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true` — unused variables will fail the build.
- `jsx: "react-jsx"` — no need to import React in JSX files.
- Types: `@cloudflare/workers-types`, `vitest/globals`, `vite/client`.
- `types.d.ts` at root provides additional ambient types.

## Environment Variables

| Variable | Required | Notes |
|---|---|---|
| `ADMIN_PASSWORD` | Yes (prod) | Default `change-me-admin-password` is blocked in production |
| `ENVIRONMENT` | Yes (prod) | Set to `production` |
| `APP_URL` | Yes (prod) | Used for Origin/Referer validation |
| `AI_API_KEY` | Optional | For AI features; must be set on both Pages AND Worker separately |
| `DATABASE_PATH` | Local only | SQLite path, defaults to `./data/taskcheck.sqlite` |
| `ALLOW_DEFAULT_ADMIN_PASSWORD` | Escape hatch | Set to `1` to allow default password in production |

## Deployment Gotchas

- Secrets set on Pages do **not** propagate to the Cron Worker. Set them separately via `wrangler secret put ... --config wrangler.scheduler.toml`.
- The `npm run pages:publish` script runs `build` then `db:migrate:remote` then deploys.
- Production validates non-GET requests by checking `Origin`/`Referer` headers against `APP_URL`.
- AI service URLs must be HTTPS; internal/loopback addresses are rejected.
- Soft-delete pattern: deleting a parent archives their children and config rather than hard-deleting.

## Code Conventions

- API responses use `{ data }` for success, `{ error: { code, message } }` for errors. Helper functions: `ok()`, `fail()`.
- Route handlers are pure functions `(path, method, request, env, actor) => Response | null`. The catch-all `[[path]].js` chains them.
- Input validation uses `validateInput()` with `INPUT_RULES` defined in `functions/api/utils.js`.
- Login rate limiting: 5 attempts per 60s window per key.
- All cross-family queries filter by `parent_id` for data isolation.
