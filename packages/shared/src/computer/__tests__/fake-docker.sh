#!/bin/bash
# A stand-in for the docker CLI. Records every call (one argument per line, calls separated by "--")
# in $FAKE_DOCKER_DIR/calls and keeps the container's state in $FAKE_DOCKER_DIR/{status,started,polls}.
d="$FAKE_DOCKER_DIR"
{ printf '%s\n' "$@"; echo '--'; } >> "$d/calls"
status() { cat "$d/status" 2>/dev/null; }
case "$1" in
  inspect)
    if [ -z "$(status)" ]; then echo "Error: No such object: ${!#}" >&2; exit 1; fi
    health=healthy
    [ -n "$FAKE_DOCKER_UNHEALTHY" ] && health=unhealthy
    polls=$(cat "$d/polls" 2>/dev/null || echo 0)
    if [ "$polls" -lt "${FAKE_DOCKER_STARTING_POLLS:-0}" ]; then health=starting; echo $((polls + 1)) > "$d/polls"; fi
    [ -n "$FAKE_DOCKER_NO_HEALTHCHECK" ] && health=none
    echo "$(status)|$health|started-$(cat "$d/started" 2>/dev/null || echo 0)"
    ;;
  run)
    if [ -n "$(status)" ]; then echo "Conflict. The container name is already in use" >&2; exit 125; fi
    echo running > "$d/status"; echo 1 > "$d/started"; echo abc123
    ;;
  start)
    echo running > "$d/status"; echo $(( $(cat "$d/started" 2>/dev/null || echo 0) + 1 )) > "$d/started"; echo "${2}"
    ;;
  stop)
    if [ -z "$(status)" ]; then echo "Error response from daemon: No such container: ${!#}" >&2; exit 1; fi
    echo exited > "$d/status"; echo "${!#}"
    ;;
  port)
    case "$3" in 6080/tcp) echo "127.0.0.1:40080";; 9223/tcp) echo "127.0.0.1:49223";; esac
    [ "$(status)" = running ] || { echo "Error: No public port '$3' published" >&2; exit 1; }
    ;;
  exec)
    shift
    while [ $# -gt 0 ]; do
      case "$1" in -i) shift;; -u|-w|-e) shift 2;; *) break;; esac
    done
    shift # container name
    [ "$(status)" = running ] || { echo "Error response from daemon: container is not running" >&2; exit 1; }
    case "$1" in
      fake-echo) shift; echo "$*";;
      fake-env) echo "${!2}";;
      fake-err) shift; echo "$*" >&2; exit 3;;
      fake-fail) exit "$2";;
      fake-cat) cat;;
      fake-hang) exec sleep 30;;
      fake-die) echo exited > "$d/status"; echo "partial output"; exit 137;;
      fake-restart) echo $(( $(cat "$d/started") + 1 )) > "$d/started"; exit 137;;
      *) echo "unknown fake command $1" >&2; exit 127;;
    esac
    ;;
  *) echo "fake docker: unsupported $1" >&2; exit 2;;
esac
