#!/usr/bin/env bash
# Dev server with the web UI on one port (9100).
# Run it as: infisical run --env dev -- scripts/dev.sh
# CRAFT_SERVER_TOKEN from Infisical is the short dev password for the web login; the
# server's own token must be long, so it is random on every start.
set -euo pipefail
cd "$(dirname "$0")/.."
export CRAFT_WEBUI_PASSWORD="${CRAFT_WEBUI_PASSWORD:-${CRAFT_SERVER_TOKEN:?set CRAFT_SERVER_TOKEN}}"
CRAFT_SERVER_TOKEN="$(openssl rand -hex 32)"
export CRAFT_SERVER_TOKEN
export CRAFT_WEBUI_DIR="apps/webui/dist"
exec bun run server:dev
