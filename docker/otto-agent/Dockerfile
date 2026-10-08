# syntax=docker/dockerfile:1
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.8
ARG BUN_IMAGE=oven/bun:1.4.2-slim
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS task
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ripgrep \
 && rm -rf /var/lib/apt/lists/* \
 && userdel -r node \
 && useradd --create-home --uid 1000 --shell /bin/bash agent
USER agent
WORKDIR /home/agent
ENV HOME=/home/agent
RUN mkdir -p chats \
 && node -e 'if(Number(process.versions.node.split(".")[0])!==22)process.exit(1)' \
 && bash --version >/dev/null \
 && git --version >/dev/null \
 && rg --version >/dev/null
STOPSIGNAL SIGTERM
ENTRYPOINT ["sleep", "infinity"]

# The agent's computer: a desktop (Xvfb + Openbox), the agent's browser (Fortress, a stealth Chromium fork, with CDP
# on the box's loopback), noVNC for people, and the CLI tools an agent shell needs, including the `otto` CLI on Bun.
# DockerComputer (packages/shared/src/computer/docker.ts) runs it; see docs/computers.md. Build from the repo root:
#
#   docker build --build-context otto-resources=apps/electron/resources -t otto-agent:latest docker/otto-agent
#
# The browser is always Fortress: the build fails when its release cannot be downloaded or its checksum differs;
# there is no stock Chromium in the image to fall back to.

FROM ${UV_IMAGE} AS uv
FROM ${BUN_IMAGE} AS bun

# Fortress (github.com/tiliondev/fortress), checked against the release's SHA256SUMS.
FROM debian:bookworm-slim AS fortress
ARG TARGETARCH
ARG FORTRESS_VERSION=v153.0.8010.36
ARG FORTRESS_SHA256_AMD64=f677f850e64a75f4c202955649df074629306231feb4a2fa9bab0b9bbddafb6a
ARG FORTRESS_SHA256_ARM64=5213d291e6e883ece6d9509fa39be1ae0a7e188592ef87318693e705be994728
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    major="${FORTRESS_VERSION%%.*}"; \
    case "${TARGETARCH:-amd64}" in \
      amd64) asset="fortress-${major}-linux-x64.tar.gz"; sum="$FORTRESS_SHA256_AMD64" ;; \
      arm64) asset="fortress-${major}-linux-arm64.tar.gz"; sum="$FORTRESS_SHA256_ARM64" ;; \
      *) echo "Fortress has no Linux build for ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fSL --retry 3 -o /tmp/fortress.tar.gz "https://github.com/tiliondev/fortress/releases/download/${FORTRESS_VERSION}/${asset}"; \
    echo "${sum}  /tmp/fortress.tar.gz" | sha256sum -c -; \
    mkdir -p /opt/fortress; \
    tar -xzf /tmp/fortress.tar.gz -C /opt/fortress --strip-components=1; \
    rm /tmp/fortress.tar.gz; \
    test -x /opt/fortress/tilion; test -x /opt/fortress/chrome

# Debian slim with Node 22 (agent-browser and npm tools) already in it.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash ca-certificates curl git tmux procps ripgrep socat unzip \
      xvfb x11-utils openbox x11vnc novnc websockify \
      fonts-liberation fonts-noto-color-emoji fontconfig \
      dbus dbus-x11 xdg-desktop-portal xdg-desktop-portal-gtk \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 libasound2 \
      libxcomposite1 libxdamage1 libxrandr2 libxfixes3 libxkbcommon0 libpango-1.0-0 libcairo2 libudev1 libatomic1 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=uv /uv /uvx /usr/local/bin/
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=fortress /opt/fortress /opt/fortress

# The `otto` CLI (apps/electron/resources/scripts/otto.mjs, no dependencies) on Bun; it knows no command, so it never
# goes stale against the server. The `otto-resources` build context is required (see the build line above).
COPY --from=otto-resources scripts/otto.mjs /opt/otto/otto.mjs
RUN printf '#!/bin/sh\nexec bun /opt/otto/otto.mjs "$@"\n' > /usr/local/bin/otto && chmod 0755 /usr/local/bin/otto

# agent-browser for scripts in the box, pointed at the same Fortress (CDP on 127.0.0.1:9222, `--cdp 9222`); it must not
# download a browser of its own. The agent's own browser tool is browser_tool, driven by the server over CDP.
RUN npm install -g agent-browser && npm cache clean --force \
 && if command -v chromium >/dev/null || command -v chromium-browser >/dev/null || command -v google-chrome >/dev/null; then \
      echo "a stock Chromium is in the image; agents browse only with Fortress" >&2; exit 1; \
    fi \
 && /opt/fortress/chrome --version

# Non-root user at uid 1000 (the node image already owns that uid).
RUN userdel -r node \
 && useradd --create-home --uid 1000 --shell /bin/bash agent \
 && mkdir -p /skills /sources /otto/docs /etc/xdg-desktop-portal \
 && printf '[preferred]\ndefault=gtk\n' > /etc/xdg-desktop-portal/portals.conf

USER agent
WORKDIR /home/agent
# files: shared work of every chat (group-writable); chats: one folder per chat. /skills, /sources and /otto/docs are read-only mounts.
RUN mkdir -m 2775 files && mkdir -m 0755 chats

ENV HOME=/home/agent \
    DISPLAY=:99 \
    XDG_RUNTIME_DIR=/tmp/runtime-agent \
    XDG_CURRENT_DESKTOP=openbox \
    GTK_USE_PORTAL=1 \
    TILION_NO_ACTIVATE=1 \
    AGENT_BROWSER_EXECUTABLE_PATH=/opt/fortress/tilion \
    OTTO_CDP_URL=http://127.0.0.1:9222

COPY --chmod=0755 start.sh /usr/local/bin/start.sh

# 6080 noVNC, 9223 CDP (socat in front of Fortress's loopback-only 9222). Publish both on 127.0.0.1 only.
EXPOSE 6080 9223

# Ready = Fortress answers CDP and noVNC serves its page.
HEALTHCHECK --interval=2s --timeout=3s --start-period=5s --retries=30 \
  CMD curl -fs http://127.0.0.1:9222/json/version >/dev/null && curl -fs http://127.0.0.1:6080/vnc.html >/dev/null || exit 1

# Run with `docker run --init`: tini is PID 1, reaps zombies and forwards SIGTERM to start.sh.
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/start.sh"]
