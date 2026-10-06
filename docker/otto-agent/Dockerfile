# syntax=docker/dockerfile:1
# The agent's computer: a desktop (Xvfb + Openbox), a browser (Chromium with CDP on loopback),
# noVNC for people, and the CLI tools an agent shell needs. Run it with docker/otto-agent via
# DockerComputer (packages/shared/src/computer/docker.ts); see docs/computers.md.
#
#   docker build -t otto-agent:latest docker/otto-agent
#   docker build --build-arg INSTALL_CLAUDE=true -t otto-agent:latest docker/otto-agent   # Claude Code (H3)

ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.8
FROM ${UV_IMAGE} AS uv

# Debian slim with Node 22 already in it.
FROM node:22-bookworm-slim

ARG INSTALL_CLAUDE=false

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash ca-certificates curl git tmux procps ripgrep socat \
      xvfb x11-utils openbox x11vnc novnc websockify \
      chromium fonts-liberation fonts-noto-color-emoji \
      dbus dbus-x11 xdg-desktop-portal xdg-desktop-portal-gtk \
 && rm -rf /var/lib/apt/lists/*

COPY --from=uv /uv /uvx /usr/local/bin/

# agent-browser drives the system Chromium over CDP; it must not download its own.
RUN npm install -g agent-browser \
 && if [ "$INSTALL_CLAUDE" = "true" ]; then npm install -g @anthropic-ai/claude-code; fi \
 && npm cache clean --force

# Non-root user at uid 1000 (the node image already owns that uid).
RUN userdel -r node \
 && useradd --create-home --uid 1000 --shell /bin/bash agent \
 && mkdir /skills \
 && mkdir -p /etc/xdg-desktop-portal \
 && printf '[preferred]\ndefault=gtk\n' > /etc/xdg-desktop-portal/portals.conf

USER agent
WORKDIR /home/agent
# files: shared work of every chat (group-writable); chats: one folder per chat; skills: read-only mount at /skills.
RUN mkdir -m 2775 files \
 && mkdir -m 0755 chats .claude \
 && ln -s /skills .claude/skills

ENV HOME=/home/agent \
    DISPLAY=:99 \
    XDG_RUNTIME_DIR=/tmp/runtime-agent \
    XDG_CURRENT_DESKTOP=openbox \
    GTK_USE_PORTAL=1 \
    AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium \
    OTTO_CDP_URL=http://127.0.0.1:9222

COPY --chmod=0755 start.sh /usr/local/bin/start.sh

# 6080 noVNC, 9223 CDP (socat in front of Chromium's loopback-only 9222). Publish both on 127.0.0.1 only.
EXPOSE 6080 9223

# Ready = Chromium answers CDP and noVNC serves its page.
HEALTHCHECK --interval=2s --timeout=3s --start-period=3s --retries=30 \
  CMD curl -fs http://127.0.0.1:9222/json/version >/dev/null && curl -fs http://127.0.0.1:6080/vnc.html >/dev/null || exit 1

# Run with `docker run --init`: tini is PID 1, reaps zombies and forwards SIGTERM to start.sh.
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/start.sh"]
