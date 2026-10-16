#!/bin/sh
set -eu
# Platform volumes (Railway) arrive owned by root: take /data for the node user once, then drop
# root so the server never runs with it.
if [ "$(id -u)" = 0 ]; then
  [ "$(stat -c %U /data)" = node ] || chown -R node:node /data
  exec setpriv --reuid=node --regid=node --init-groups env HOME=/home/node "$0" "$@"
fi
# Otto state lives in OTTO_HOME. The server reads OTTO_LEGACY_HOME, so derive it here and never
# inherit an ambient Otto Legacy home.
OTTO_HOME="${OTTO_HOME:-$HOME/.otto}"
OTTO_LEGACY_HOME="$OTTO_HOME"
export OTTO_HOME OTTO_LEGACY_HOME
if [ "${OTTO_REMOTE_IDENTITY_READY:-0}" != 1 ]; then
  OTTO_REMOTE_IDENTITY_READY=1 OTTO_IDENTITY_NODE="$(command -v node)" \
    /opt/otto/initialize-remote-identity.sh
  export OTTO_REMOTE_IDENTITY_READY
fi
if [ "$#" -gt 0 ] && [ "$1" = remote ]; then
  shift
  exec /opt/otto/remote-admin "$@"
fi
exec node /opt/otto/node_modules/otto/dist/bin.mjs "$@"
