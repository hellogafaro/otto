#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${1:-otto-task:verification}"
cd "$ROOT"

command -v docker >/dev/null
command -v bun >/dev/null
docker info >/dev/null
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  docker build --target task --pull=false -t "$IMAGE" docker/otto-agent
fi

OTTO_TEST_CHAT_COMPUTER_DOCKER=1 OTTO_TEST_TASK_IMAGE="$IMAGE" bun test ./packages/server-core/src/sessions/mastra-computer-docker.isolated.ts
OTTO_TEST_CHAT_COMPUTER_DOCKER=1 OTTO_TEST_TASK_IMAGE="$IMAGE" bun test ./packages/server-core/src/webui/computer-turn.isolated.ts
