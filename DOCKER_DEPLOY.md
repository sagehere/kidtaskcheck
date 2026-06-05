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

- Replace `change-this-before-production` with a strong admin password.
- Replace `https://taskcheck.example.com` with your real HTTPS domain.
- Keep the app bound to `127.0.0.1:3000` when using Nginx Proxy Manager.

## First Start

```bash
mkdir -p data
docker compose pull
docker compose up -d
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
docker compose up -d
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
