# VPS Migration Guide

This guide moves the app from Cloudflare Pages + D1 to a single VPS running
Docker Compose, Node, Caddy, and SQLite.

## Target Runtime

- `caddy`: terminates HTTPS and proxies all traffic to the app container.
- `app`: serves `dist` and routes `/api/*` through the existing Pages Function
  entrypoint.
- `scheduler`: runs the existing AI scheduled refresh loop every 30 minutes.
- `data/taskcheck.sqlite`: production SQLite database file, mounted from the VPS
  host into both Node containers.
- Docker images are published to GitHub Container Registry as
  `ghcr.io/sagehere/taskcheck:latest` for both `linux/amd64` and `linux/arm64`.

## VPS Setup

1. Install Docker and Docker Compose on the VPS.
2. Copy the repository to the VPS.
3. Create `.env` from `.env.example` and set:
   - `APP_DOMAIN`
   - `APP_IMAGE=ghcr.io/sagehere/taskcheck:latest`
   - `APP_URL`
   - `ENVIRONMENT=production`
   - `ADMIN_PASSWORD`
   - optional AI provider settings stored by users in the app.
4. Create data directories:

```bash
mkdir -p data backups
```

If the GitHub Container Registry package is private, log in before pulling:

```bash
echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

If the package is public, no login is needed. After the first workflow run,
open the package page in GitHub and set visibility to Public if public pulls are
desired.

## Fresh SQLite Database

For a brand-new install without D1 data:

```bash
docker compose build
docker compose run --rm app npm run db:migrate:sqlite
docker compose up -d
docker compose exec app npm run db:verify:sqlite
```

To use the GitHub-hosted image instead of building on the VPS:

```bash
docker compose pull
docker compose run --rm app npm run db:migrate:sqlite
docker compose up -d
```

## D1 Data Migration

Run a rehearsal first, then repeat the same steps during the final maintenance
window.

1. Export D1 from the current Cloudflare database:

```bash
npx wrangler d1 export kids_task_checkin --remote --output=backups/d1-final.sql
```

2. Stop writes on the old Cloudflare Pages deployment before the final export.
   The app should be treated as read-only until DNS is cut over.

3. Import the SQL dump into SQLite:

```bash
sqlite3 data/taskcheck.sqlite < backups/d1-final.sql
```

4. Stamp current migrations as already applied, because the D1 dump already
   contains the current schema:

```bash
docker compose run --rm app npm run db:stamp:sqlite
```

5. Verify the imported database:

```bash
docker compose run --rm app npm run db:verify:sqlite
```

6. Start the VPS app:

```bash
docker compose pull
docker compose up -d
```

7. Smoke test before DNS cutover:
   - `https://APP_DOMAIN/healthz` returns `{"ok":true}`.
   - Admin, parent, and child logins work.
   - A child can submit a task.
   - A parent can approve it and point balance changes.
   - Reward redemption and notification flows work.
   - Weekly/monthly report pages render.

8. Point DNS to the VPS after smoke tests pass.

Keep the old D1 database unchanged for at least 7 days as a rollback snapshot.
After the VPS starts accepting writes, do not roll back to D1 without first
planning a reverse data migration from SQLite.

## Backups

At minimum, schedule a daily host-level backup:

```bash
sqlite3 data/taskcheck.sqlite ".backup 'backups/taskcheck-$(date +%F).sqlite'"
```

Also copy `data/taskcheck.sqlite-wal` and `data/taskcheck.sqlite-shm` only when
the app is stopped, or use SQLite `.backup` while the app is running.

## Operational Commands

```bash
docker compose logs -f app
docker compose logs -f scheduler
docker compose restart app
docker compose run --rm app npm run db:verify:sqlite
```

## Notes

- `point_ledger` remains the source of truth for balances. Verify balances by
  summing ledger rows, not by checking one screen manually.
- The app still validates `Origin`/`Referer` in production, so `APP_URL` must
  match the public HTTPS URL exactly.
- The D1 export may block D1 requests while it runs. Use a short maintenance
  window for the final export.
