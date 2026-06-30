# SQLite Backup And Compaction

This app stores production data in one SQLite database file, usually under `data/` or the path set by `DATABASE_PATH`. Daily maintenance deletes expired detail rows and AI job history, but SQLite reuses freed pages instead of shrinking the file immediately. Use this runbook when you need an actual smaller `.sqlite` file.

## Before Compacting

1. Schedule a quiet maintenance window. `VACUUM` needs an exclusive database lock and can temporarily require free disk space close to the database size.
2. Stop the app container or process so no request writes to the database during the compact step.
3. Back up the database file and its WAL/SHM sidecars if present:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item data/taskcheck.sqlite "backups/taskcheck-$stamp.sqlite"
Copy-Item data/taskcheck.sqlite-wal "backups/taskcheck-$stamp.sqlite-wal" -ErrorAction SilentlyContinue
Copy-Item data/taskcheck.sqlite-shm "backups/taskcheck-$stamp.sqlite-shm" -ErrorAction SilentlyContinue
```

## Verify The Backup

Run the existing SQLite verification against the live path or a copied path:

```powershell
$env:DATABASE_PATH = "data/taskcheck.sqlite"
npm run db:verify:sqlite
```

## Compact

Run compaction only after the backup is complete:

```powershell
$env:DATABASE_PATH = "data/taskcheck.sqlite"
npm run db:compact
```

The script runs `PRAGMA wal_checkpoint(TRUNCATE)`, `VACUUM`, and `PRAGMA optimize`. It does not change retention policy and does not delete rows by itself.

## Restore

1. Stop the app.
2. Move the current database and sidecars aside.
3. Copy the backup `.sqlite` file back to the configured `DATABASE_PATH`.
4. Start the app and run `npm run db:verify:sqlite`.

## Docker Notes

For the default compose deployment, run backup and compact commands on the host path mounted as `/app/data` in the container. Keep backups outside `data/` when possible so cleanup jobs and deploy scripts do not confuse backups with the active database.
