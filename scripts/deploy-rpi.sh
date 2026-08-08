#!/usr/bin/env bash
set -euo pipefail

# Configurations
APP_DIR="${APP_DIR:-/opt/pft-backend}"
RPI_CONTAINER_NAME="${RPI_CONTAINER_NAME:-pft-backend-app}"
RPI_APP_PORT="${RPI_APP_PORT:-4000}"
RELEASES_DIR="${APP_DIR}/releases"
SHARED_DIR="${APP_DIR}/shared"
CURRENT_LINK="${APP_DIR}/current"
ARCHIVE_PATH="${ARCHIVE_PATH:-/tmp/pft-backend-release.tgz}"
RELEASE_ID="${RELEASE_ID:-$(date +%Y%m%d%H%M%S)}"
RELEASE_DIR="${RELEASES_DIR}/${RELEASE_ID}"

# 1. Ensure system directories exist with correct permissions using sudo
echo "Creating deployment directories under ${APP_DIR}..."
sudo mkdir -p "${RELEASES_DIR}" "${SHARED_DIR}"

# Ensure current runner user can write inside the specific deployment directories
sudo chown -R "$USER:$USER" "${APP_DIR}"

# Clean up any partial old releases
rm -rf "${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}"

# 2. Extract the archive (dynamically matches whatever runner.temp path is passed)
echo "Extracting deployment archive from ${ARCHIVE_PATH}..."
if [[ ! -f "${ARCHIVE_PATH}" ]]; then
  echo "Error: Archive file not found at ${ARCHIVE_PATH}" >&2
  exit 1
fi
tar -xzf "${ARCHIVE_PATH}" -C "${RELEASE_DIR}"

# 3. Handle Environment Configurations
if [[ -n "${RPI_ENV_FILE_CONTENT:-}" ]]; then
  echo "Writing environment configuration..."
  printf '%s\n' "${RPI_ENV_FILE_CONTENT}" > "${SHARED_DIR}/.env"
  chmod 600 "${SHARED_DIR}/.env"
fi

if [[ ! -f "${SHARED_DIR}/.env" ]]; then
  echo "Error: Missing ${SHARED_DIR}/.env configuration file." >&2
  exit 1
fi

cp "${SHARED_DIR}/.env" "${RELEASE_DIR}/.env"

# 4. Build Docker Image
cd "${RELEASE_DIR}"
echo "Building Docker image pft-backend:${RELEASE_ID}..."
docker build -t pft-backend:"${RELEASE_ID}" -t pft-backend:current .

# 5. Atomically update the symlink
echo "Updating symlink..."
ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}"

# 6. Stop and remove existing container if it exists
if docker ps -a --format '{{.Names}}' | grep -Fxq "${RPI_CONTAINER_NAME}"; then
  echo "Removing existing container: ${RPI_CONTAINER_NAME}..."
  docker rm -f "${RPI_CONTAINER_NAME}"
fi

# 7. Start the new container
echo "Launching container ${RPI_CONTAINER_NAME} on host port ${RPI_APP_PORT}..."
docker run -d \
  --name "${RPI_CONTAINER_NAME}" \
  --restart unless-stopped \
  --env-file "${SHARED_DIR}/.env" \
  -e "PORT=${RPI_APP_PORT}" \
  -e "RELEASE_ID=${RELEASE_ID}" \
  -e "APP_VERSION=${RELEASE_ID}" \
  -p "${RPI_APP_PORT}:4000" \
  pft-backend:current

# 8. Clean up unused build layers
echo "Pruning dangling Docker images..."
docker image prune -f >/dev/null 2>&1 || true

echo "Deployment completed successfully!"
