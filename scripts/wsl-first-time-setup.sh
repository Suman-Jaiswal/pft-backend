#!/usr/bin/env bash
set -euo pipefail

# First-time/local-repeat setup for pft-backend on Ubuntu WSL.
# - Ensures Docker Postgres is running on localhost:55433
# - Ensures .env exists and DATABASE_URL points to container
# - Installs deps, initializes Prisma schema, seeds owner
# - Starts/restarts PM2 apps used for local backend workflows

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
PARENT_DIR="$(cd "$ROOT_DIR/.." && pwd)"

DB_CONTAINER_NAME="pft_backend_postgres_55433"
DB_IMAGE="postgres:16-alpine"
DB_HOST_PORT="55433"
DB_CONTAINER_PORT="5432"
DB_NAME="pft_backend"
DB_USER="postgres"
DB_PASS="postgres"
DB_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:${DB_HOST_PORT}/${DB_NAME}"

BACKEND_APP_NAME="pft-backend-dev"
STUDIO_APP_NAME="prisma-studio"
FRONTEND_APP_NAME="pft-dev"
FRONTEND_DIR="$PARENT_DIR/pft-app"

hr() {
  printf '\n%s\n' "================================================================================"
}

step() {
  printf '\n-> %s\n' "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: Required command '$1' is missing."
    exit 1
  fi
}

db_is_ready() {
  docker run --rm --network host "${DB_IMAGE}" \
    pg_isready -h localhost -p "${DB_HOST_PORT}" -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1
}

hr
echo "PFT BACKEND :: WSL FIRST-TIME SETUP"
hr
echo "Repo         : $ROOT_DIR"
echo "DB Container : $DB_CONTAINER_NAME"
echo "DB URL       : $DB_URL"

step "Checking required tools"
require_cmd docker
require_cmd node
require_cmd npm
require_cmd npx
require_cmd pm2
echo "OK: docker, node, npm, npx, pm2"

step "Checking Docker availability"
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is not reachable from WSL."
  echo "Start Docker Desktop and enable WSL integration, then rerun this script."
  exit 1
fi
echo "OK: Docker reachable"

step "Ensuring Postgres availability on localhost:${DB_HOST_PORT}"
if db_is_ready; then
  echo "Postgres already reachable on localhost:${DB_HOST_PORT} (skipping container startup)."
else
  echo "No reachable Postgres on localhost:${DB_HOST_PORT}; ensuring container is running."
  if docker ps -a --format '{{.Names}}' | rg "^${DB_CONTAINER_NAME}$" >/dev/null 2>&1; then
    if docker ps --format '{{.Names}}' | rg "^${DB_CONTAINER_NAME}$" >/dev/null 2>&1; then
      echo "Container already running: ${DB_CONTAINER_NAME}"
    else
      echo "Starting existing container: ${DB_CONTAINER_NAME}"
      docker start "${DB_CONTAINER_NAME}" >/dev/null
    fi
  else
    echo "Creating container: ${DB_CONTAINER_NAME}"
    docker run -d \
      --name "${DB_CONTAINER_NAME}" \
      -e POSTGRES_DB="${DB_NAME}" \
      -e POSTGRES_USER="${DB_USER}" \
      -e POSTGRES_PASSWORD="${DB_PASS}" \
      -p "${DB_HOST_PORT}:${DB_CONTAINER_PORT}" \
      "${DB_IMAGE}" >/dev/null
  fi

  step "Waiting for Postgres readiness"
  for i in {1..30}; do
    if db_is_ready; then
      echo "Postgres is ready."
      break
    fi
    if [[ "$i" -eq 30 ]]; then
      echo "ERROR: Postgres did not become ready in time."
      exit 1
    fi
    sleep 1
  done
fi

step "Ensuring .env exists"
if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    echo "Created .env from .env.example"
  else
    touch .env
    echo "Created empty .env"
  fi
fi

step "Setting DATABASE_URL in .env to local container DB"
if rg '^DATABASE_URL=' .env >/dev/null 2>&1; then
  python3 - <<'PY'
from pathlib import Path
p = Path(".env")
lines = p.read_text().splitlines()
out = []
for ln in lines:
    if ln.startswith("DATABASE_URL="):
        out.append("DATABASE_URL=postgresql://postgres:postgres@localhost:55433/pft_backend")
    else:
        out.append(ln)
p.write_text("\n".join(out) + "\n")
PY
else
  printf '\nDATABASE_URL=%s\n' "$DB_URL" >> .env
fi
echo "DATABASE_URL set."

step "Installing npm dependencies"
npm install

step "Generating Prisma client"
npm run prisma:generate

step "Applying schema to DB (db push for fresh/local compatibility)"
npx prisma db push

step "Seeding owner user (safe to rerun)"
if npm run | rg 'seed:owner' >/dev/null 2>&1; then
  npm run seed:owner || true
else
  echo "seed:owner script not found, skipping."
fi

step "Recreating PM2 apps from current .env"
pm2 delete "${BACKEND_APP_NAME}" >/dev/null 2>&1 || true
pm2 delete "${STUDIO_APP_NAME}" >/dev/null 2>&1 || true

pm2 start "npm run start:dev" --name "${BACKEND_APP_NAME}" --cwd "$ROOT_DIR"
pm2 start "npm run prisma:studio" --name "${STUDIO_APP_NAME}" --cwd "$ROOT_DIR"

step "Setting up frontend PM2 app (if pft-app exists)"
if [[ -d "$FRONTEND_DIR" ]]; then
  echo "Frontend directory found: $FRONTEND_DIR"
  (
    cd "$FRONTEND_DIR"
    npm install
  )
  pm2 delete "${FRONTEND_APP_NAME}" >/dev/null 2>&1 || true
  pm2 start "npm run dev" --name "${FRONTEND_APP_NAME}" --cwd "$FRONTEND_DIR"
else
  echo "Frontend directory not found at $FRONTEND_DIR (skipping frontend setup)."
fi

pm2 save

hr
echo "SETUP COMPLETE"
hr
echo "Backend PM2 app : ${BACKEND_APP_NAME}"
echo "Studio PM2 app  : ${STUDIO_APP_NAME}"
echo "Frontend PM2 app: ${FRONTEND_APP_NAME} (if pft-app detected)"
echo "DB URL          : ${DB_URL}"
echo ""
echo "Useful commands:"
echo "  pm2 list"
echo "  pm2 logs ${BACKEND_APP_NAME}"
echo "  pm2 logs ${STUDIO_APP_NAME}"
echo "  npm run backfill:detailed-statements"
echo ""
