# Docker Deployment

This project is deployed as a Docker image from GitHub Container Registry.

```text
ghcr.io/sagehere/kidtaskcheck:latest
```

Supported platforms:

- `linux/amd64`
- `linux/arm64`

The image is built by GitHub Actions on every push to `main`.

## docker-compose.yml

Edit the included `docker-compose.yml` before deploying:

- Replace `change-me-admin-password` with a strong admin password.
- Replace `https://your-domain.com` with your real HTTPS domain.
- Keep the published host port aligned with your reverse proxy. The included compose maps host port `100` to container port `3000`.
- Keep the healthcheck pointed at `http://127.0.0.1:3000/healthz`. Healthchecks run inside the container, so they must use the container port, not the published host port.

## First Start

```bash
mkdir -p data
docker compose pull
docker compose up -d --force-recreate app
```

## Nginx Proxy Manager

Create a Proxy Host:

- Domain Names: your app domain
- Scheme: `http`
- Forward Hostname / IP: `127.0.0.1`
- Forward Port: `3000`
- SSL: request a certificate
- Force SSL: enabled

`APP_URL` in `docker-compose.yml` must match the public URL.

## Update

```bash
docker compose pull
docker compose up -d --force-recreate app
```

Use `--force-recreate` after changing `healthcheck`, `ports`, or other container-level settings. Docker stores the healthcheck on the container, so a plain restart can leave the old probe running.

## Healthcheck

The app exposes `GET /healthz` and returns `{"ok":true}` when the Node server is reachable.

Verify the running container uses the expected probe:

```bash
docker inspect --format '{{json .Config.Healthcheck.Test}}' "$(docker compose ps -q app)"
```

The output should include `http://127.0.0.1:3000/healthz`. If it points at the published host port, such as `127.0.0.1:100`, recreate the container:

```bash
docker compose up -d --force-recreate app
```

## Logs

```bash
docker compose logs -f app
```

## Backups

```bash
mkdir -p backups
docker compose exec app node -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync('/app/data/taskcheck.sqlite'); db.exec(\"VACUUM INTO '/app/data/backup.sqlite'\"); db.close();"
cp data/backup.sqlite backups/taskcheck-$(date +%F).sqlite
```

Never store `data/`, `backups/`, or SQLite database files in Git.
