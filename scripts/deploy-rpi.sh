#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/pft-backend}"
RPI_CONTAINER_NAME="${RPI_CONTAINER_NAME:-pft-backend-app}"
RPI_APP_PORT="${RPI_APP_PORT:-4000}"
RELEASES_DIR="${APP_DIR}/releases"
SHARED_DIR="${APP_DIR}/shared"
CURRENT_LINK="${APP_DIR}/current"
ARCHIVE_PATH="${ARCHIVE_PATH:-/tmp/pft-backend-release.tgz}"
RELEASE_ID="${RELEASE_ID:-$(date +%Y%m%d%H%M%S)}"
RELEASE_DIR="${RELEASES_DIR}/${RELEASE_ID}"

mkdir -p "${RELEASES_DIR}" "${SHARED_DIR}"
rm -rf "${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}"

tar -xzf "${ARCHIVE_PATH}" -C "${RELEASE_DIR}"

if [[ -n "${RPI_ENV_FILE_CONTENT:-}" ]]; then
  printf '%s\n' "${RPI_ENV_FILE_CONTENT}" > "${SHARED_DIR}/.env"
  chmod 600 "${SHARED_DIR}/.env"
fi

if [[ ! -f "${SHARED_DIR}/.env" ]]; then
  echo "Missing ${SHARED_DIR}/.env (or RPI_ENV_FILE_CONTENT secret)." >&2
  exit 1
fi

cp "${SHARED_DIR}/.env" "${RELEASE_DIR}/.env"

cd "${RELEASE_DIR}"
docker build -t pft-backend:"${RELEASE_ID}" -t pft-backend:current .

ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}"

if docker ps -a --format '{{.Names}}' | grep -Fxq "${RPI_CONTAINER_NAME}"; then
  docker rm -f "${RPI_CONTAINER_NAME}"
fi

docker run -d \
  --name "${RPI_CONTAINER_NAME}" \
  --restart unless-stopped \
  --env-file "${SHARED_DIR}/.env" \
  -e "PORT=${RPI_APP_PORT}" \
  -e "RELEASE_ID=${RELEASE_ID}" \
  -e "APP_VERSION=${RELEASE_ID}" \
  -p "${RPI_APP_PORT}:4000" \
  pft-backend:current

docker image prune -f >/dev/null 2>&1 || true
