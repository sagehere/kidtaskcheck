# AGENTS.md

## Commands
- Install with `npm install`; this repo is npm-based (`package-lock.json` is committed).
- Full local verification from docs is `npm run build` then `npm test` then `npm run db:migrate:local`.
- `npm run build` runs `tsc` and `vite build --config vite.config.mjs --configLoader native`.
- `npm test` runs Vitest once with `vite.config.mjs`; run focused tests with `npx vitest run tests/domain.test.ts --config vite.config.mjs --configLoader runner`.
- `npm run pages:dev` serves `dist` through Cloudflare Pages Functions on port `8788`; build first so `dist` exists.
- If Pages dev fails under the current Chinese workspace path with esbuild `Cannot read directory "../..": Access is denied`, move the repo to an ASCII-only path before retrying.
- `npm run preview:static` serves only the built frontend from `dist` on `127.0.0.1:4173`; it does not exercise `/api/*` Functions.

## Architecture
- Frontend entrypoint is `src/App.tsx`; it calls same-origin `/api/*` and renders admin, parent, or child UI from `GET /api/auth/me`.
- API entrypoint is `functions/api/[[path]].js`; it is a single Cloudflare Pages Function router backed by D1 binding `DB`.
- Schema source is `migrations/0001_initial.sql`; local and remote migrations target D1 database name `kids_task_checkin`.
- `wrangler.toml` contains placeholder `database_id` and default admin credentials; change `ADMIN_PASSWORD` and real D1 ID before deploy.
- Cloudflare Pages Functions do not support `scheduled` (cron) handlers. To auto-refresh AI greetings weekly, set up an external cron service (e.g. cron-job.org, GitHub Actions) to `POST /api/admin/ai-service/refresh-greetings` weekly. The admin panel also has a manual "刷新 AI 寄语" button.

## Gotchas
- `functions/api/[[path]].js` imports domain helpers from `src/lib/domain.js`, while tests import `src/lib/domain.ts`; update both files together when changing period, points, or streak logic.
- Period keys use UTC dates and ISO week logic in `periodKey`; task submissions are attributed by `submitted_at`, reward limits by `requested_at`.
- Point balance is not stored separately; it is always derived from `point_ledger` sums.
- Deleting a parent is a soft-delete/archive flow: parent, children, tasks, rewards, achievements, and categories are disabled, but historical submissions/redemptions/ledger rows remain.
