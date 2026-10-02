#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
test "$(bun -p 'require("./package.json").name')" = otto
: "${OTTO_SECRET_ENV:?Specify verified Infisical environment}"
: "${OTTO_SECRET_PATH:?Specify verified narrow Infisical path}"
test -f .infisical.json || { echo "Verified Otto Infisical link required" >&2; exit 1; }
# The repository must already be linked to the authorized Otto project.
# Never use compose config: it expands secret values into terminal output.
exec bb secret run --env "$OTTO_SECRET_ENV" --path "$OTTO_SECRET_PATH" -- docker compose -f ops/compose.yaml "$@"
