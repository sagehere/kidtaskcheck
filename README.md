# Kids Task Checkin

A self-hosted family task and reward app for children. The project is now a Docker-first Node.js + React + SQLite application.

## Runtime

- Frontend: React 19 + Vite.
- Backend: Node.js HTTP server in `server/index.mjs`.
- API modules: `server/api`.
- Database: SQLite via `node:sqlite`, stored at `data/taskcheck.sqlite`.
- Scheduler: Built into `server/index.mjs`, enable with `ENABLE_BUILTIN_SCHEDULER=true`.
- Container image: `ghcr.io/sagehere/kidtaskcheck:latest`.

## Local Development

```bash
npm install
npm run build
npm test
npm run db:migrate:sqlite
npm run server
```

The Node server listens on port `3000` by default. Set `PORT` to override it.

## Docker Deployment

Edit `docker-compose.yml` before production:

- Change `ADMIN_PASSWORD`.
- Change `APP_URL` to the HTTPS URL configured in Nginx Proxy Manager.
- Keep `DATABASE_PATH=/app/data/taskcheck.sqlite`.

Start from the GitHub-hosted image:

```bash
mkdir -p data
docker compose pull
docker compose up -d
```

Use Nginx Proxy Manager to proxy your public domain to:

```text
http://127.0.0.1:3000
```

Enable HTTPS and Force SSL in Nginx Proxy Manager. `APP_URL` must exactly match the public URL, including protocol and port if any.

## Updates

```bash
docker compose pull
docker compose up -d
```

## Backups

Use SQLite's online backup command while the app is running:

```bash
mkdir -p backups
docker compose exec app node -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync('/app/data/taskcheck.sqlite'); db.exec(\"VACUUM INTO '/app/data/backup.sqlite'\"); db.close();"
cp data/backup.sqlite backups/taskcheck-$(date +%F).sqlite
```

Keep `data/` and `backups/` off Git.

## Docker Migration Repair

If Docker logs repeat this error after an update:

```text
migration failed: 0002_limits_and_repeat_submissions.sql: duplicate column name: limit_count
```

the SQLite schema already has `tasks.limit_count`, but `__vps_migrations` is missing the `0002` record. Do not delete the database unless you intentionally want to lose local data.

Back up the database first:

```bash
mkdir -p backups
docker compose exec app node -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync('/app/data/taskcheck.sqlite'); db.exec(\"VACUUM INTO '/app/data/repair-before-0002.sqlite'\"); db.close();"
cp data/repair-before-0002.sqlite backups/taskcheck-repair-before-0002-$(date +%F-%H%M%S).sqlite
```

Then run the targeted repair script:

```bash
docker compose run --rm app npm run db:repair:0002
docker compose up -d
docker compose logs --tail=80 app
```

The repair only handles this known `0002` half-migration state. It stamps the migration when the schema rewrite is already complete, or finishes the `task_submissions` rewrite before stamping. If it reports an integrity or shape mismatch, stop and restore from backup or inspect the database manually.

## Useful Scripts

```bash
npm run build
npm test
npm run server
ENABLE_BUILTIN_SCHEDULER=true npm run server
npm run db:repair:0002
```

## Safety Notes

- Point balance is derived from `point_ledger`; do not edit balances manually.
- SQL migrations are additive. Do not drop historical business tables.
- Cross-family queries must filter by `parent_id`.
- Production must not use the default `ADMIN_PASSWORD`.
