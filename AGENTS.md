# AGENTS.md

## Commands
- Install with `npm install`; this repo is npm-based (`package-lock.json` is committed).
- Full local verification: `npm run build && npm test`.
- Deployment: `npm run pages:publish` → builds frontend, runs remote migrations, deploys to Cloudflare Pages.
- `npm run build` runs `tsc` and `vite build`.
- `npm test` runs Vitest once; run focused tests with `npx vitest run tests/domain.test.ts --config vite.config.mjs --configLoader runner`.
- Local D1 dev: `npm run db:migrate:local && npm run pages:dev`.
- Production must set `ADMIN_PASSWORD`, `ENVIRONMENT=production`, `APP_URL` as Cloudflare Secrets, not in `wrangler.toml`.

## Architecture
- **Frontend**: Entry in `src/App.tsx` → `Login`, then role-based lazy-loaded apps (`AdminApp`, `ParentApp`, `ChildApp`) via `React.lazy`. Shell layout and notification center in `src/components/Shell.tsx`. Shared UI components in `src/components/UI.tsx`. Emoji selector in `src/components/EmojiSelect.tsx` with dynamic import of emoji data.
- **API Backend**: Single Cloudflare Pages Function at `functions/api/[[path]].js`. Shared utilities in `functions/api/utils.js`. Route handlers split by domain:
  - `routes/auth.js` — login, logout, session
  - `routes/admin.js` — admin user/system/AI config
  - `routes/parent.js` — parent CRUD for tasks, rewards, achievements, categories, children, review
  - `routes/child.js` — child task submission, reward redemption, warehouse, dashboard, pins
  - `routes/shared.js` — notifications, config import/export, ledger, reports, refund, recall
- **Database**: D1 via Cloudflare, schema managed by `migrations/*.sql`. Bootstrap only creates admin user and runs maintenance (schema ensured by migrations).
- **Tests**: Vitest + `node:sqlite` D1 mock in `tests/helpers/d1-mock.ts`. Each test file creates a fresh in-memory SQLite database with all migrations applied.
- **Domain Logic**: Shared between frontend and backend via `src/lib/domain.ts` (TypeScript, used by frontend/tests) and `src/lib/domain.js` (JavaScript, imported by backend). Keep both in sync.

## Layer Diagram
```
src/App.tsx → Login / role-based lazy apps
  ├── AdminApp.tsx    (lazy, admin only)
  ├── ParentApp.tsx   (lazy, parent only)
  ├── ChildApp.tsx    (lazy, child only)
  └── components/
      ├── Shell.tsx   (layout + notifications)
      ├── UI.tsx      (Field, Empty, Tabs, Toggle, icon, etc.)
      └── EmojiSelect.tsx (dynamic emoji import)

functions/api/[[path]].js → thin router
  ├── utils.js        (shared helpers: auth, DB, validation, AI, etc.)
  └── routes/
      ├── auth.js
      ├── admin.js
      ├── parent.js
      ├── child.js
      └── shared.js
```

## Gotchas
- `domain.ts` and `domain.js` must stay in sync; update both when changing period/points/streak logic.
- Migrations are additive; never `DROP TABLE` in a migration (use `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE`).
- Point balance is derived from `point_ledger` sums; partial unique index `idx_ledger_business_source` prevents duplicate ledger entries.
- Cross-family queries always filter on `parent_id` at the SQL level.
- Deleting a parent is a soft-delete/archive: children, tasks, rewards, etc. are disabled, historical rows remain.
