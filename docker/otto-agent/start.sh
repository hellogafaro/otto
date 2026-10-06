#!/bin/bash
# Starts the agent's desktop. Run under `docker run --init` (tini is PID 1 and forwards signals here).
set -u

export DISPLAY="${DISPLAY:-:99}"
SCREEN="${OTTO_SCREEN:-1440x900x24}"
PROFILE="$HOME/.config/otto-chromium" # on the volume: carries the agent's site logins
pids=()    # everything we started; stopped on SIGTERM
core=()    # if one of these dies the box is useless: exit so Docker reports it

stop() {
  trap - TERM INT
  kill "${pids[@]}" 2>/dev/null
  pkill -TERM -x chromium 2>/dev/null
  wait
  exit "${1:-0}"
}
trap 'stop 0' TERM INT

# A stopped container keeps /tmp, so stale locks from the last run must go.
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
mkdir -p -m 0700 "$XDG_RUNTIME_DIR" "$PROFILE"

Xvfb "$DISPLAY" -screen 0 "$SCREEN" -nolisten tcp & pids+=($!); core+=($!)
for _ in $(seq 100); do
  xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break
  sleep 0.1
done

# File pickers: without a session bus and the GTK portal, an upload dialog in Chromium hangs or never opens.
eval "$(dbus-launch --sh-syntax)"
export DBUS_SESSION_BUS_ADDRESS
pids+=("$DBUS_SESSION_BUS_PID")
/usr/libexec/xdg-desktop-portal-gtk & pids+=($!)
/usr/libexec/xdg-desktop-portal & pids+=($!)

openbox & pids+=($!)

# VNC stays on the box's loopback; noVNC (websockify) is the only way in, behind the server's auth proxy.
x11vnc -display "$DISPLAY" -localhost -rfbport 5900 -forever -shared -nopw -noxdamage -quiet & pids+=($!); core+=($!)
websockify --web /usr/share/novnc 6080 localhost:5900 & pids+=($!); core+=($!)

# Chromium's CDP listens on loopback only; socat makes it reachable for Docker's port publishing.
socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222 & pids+=($!)

(
  while true; do
    rm -f "$PROFILE"/Singleton*
    chromium --no-sandbox --disable-dev-shm-usage --disable-gpu --password-store=basic \
      --user-data-dir="$PROFILE" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
      --no-first-run --no-default-browser-check --window-size=1440,900 about:blank
    sleep 1
  done
) & pids+=($!)

wait -n "${core[@]}"
echo "start.sh: a core process exited; stopping" >&2
stop 1
