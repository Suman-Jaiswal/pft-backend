# Deploy to Raspberry Pi 5 via GitHub Actions (SSH)

This project includes a full CI/CD pipeline at `.github/workflows/rpi-cicd.yml` that:

1. Installs dependencies
2. Generates Prisma client
3. Runs lint + tests
4. Builds the app
5. Ships release archive to your Raspberry Pi over SSH
6. Runs DB migration from GitHub runner against production DB (`prisma migrate deploy`)
7. Builds and restarts Docker container on Raspberry Pi

## 1) Raspberry Pi one-time setup

### Install runtime dependencies

```bash
sudo apt update
sudo apt install -y openssh-server docker.io docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and log back in once after adding docker group.

### Prepare app directory

```bash
sudo mkdir -p /opt/pft-backend
sudo chown -R "$USER":"$USER" /opt/pft-backend
```

The deploy workflow runs/restarts a Docker container directly (no systemd app service required).

## 2) GitHub repository secrets

Add these repo secrets in GitHub:

- `RPI_HOST`: Pi IP/domain
- `RPI_PORT`: SSH port (usually `22`)
- `RPI_USERNAME`: SSH user (e.g. `pi`)
- `RPI_SSH_PRIVATE_KEY`: private key matching `~/.ssh/authorized_keys` on Pi
- `RPI_APP_DIR`: `/opt/pft-backend` (or your custom directory)
- `RPI_CONTAINER_NAME`: `pft-backend-app`
- `RPI_APP_PORT`: `4000`
- `RPI_ENV_FILE_CONTENT`: full `.env` contents used by backend on Pi
- `PROD_DATABASE_URL`: production Prisma database URL (used by migration job in Actions)

`RPI_ENV_FILE_CONTENT` is written to `${RPI_APP_DIR}/shared/.env` on deploy.

## 3) Triggering deployments

Workflow deploys on:

- push to `main`
- push to `stage/**`
- manual trigger (`workflow_dispatch`)

To deploy manually:

1. Open GitHub Actions
2. Select `rpi-cicd`
3. Click `Run workflow`

## 4) Migration behavior

Migration runs in GitHub Actions before deploy:

```bash
DATABASE_URL=$PROD_DATABASE_URL npm run prisma:migrate:deploy
```

No Prisma migrate command is run on Raspberry Pi.

## 5) Verify on Pi

```bash
docker ps --filter name=pft-backend-app
docker logs --tail 100 pft-backend-app
```

If health endpoint exists, verify:

```bash
curl http://127.0.0.1:4000/health
```
