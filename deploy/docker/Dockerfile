FROM node:24.13.1-bookworm-slim AS build
ENV CI=1 ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ git \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN corepack enable
COPY . .
RUN git init -q && pnpm install --frozen-lockfile
RUN pnpm --filter @otto/web build
RUN node apps/server/scripts/cli.ts build
RUN pnpm --config.inject-workspace-packages=true --filter @otto/server deploy --prod /runtime \
  && rm -f /runtime/node_modules/.pnpm/node_modules/otto \
  && mkdir -p /runtime/node_modules/otto \
  && mv /runtime/dist /runtime/node_modules/otto/dist

FROM node:24.13.1-bookworm-slim
ENV NODE_ENV=production OTTO_MODE=web OTTO_HOST=0.0.0.0 OTTO_PORT=3773 OTTO_NO_BROWSER=true OTTO_HOME=/data OTTO_INSTALL_ROOT=/opt/otto OTTO_BIN_DIR=/usr/local/bin OTTO_REMOTE_CONTAINER=1 OTTO_SERVER_ENTRYPOINT=/opt/otto/node_modules/otto/dist/bin.mjs OTTO_SERVER_COMMAND=/usr/local/bin/otto
WORKDIR /opt/otto
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /runtime ./
COPY --from=build /src/LICENSE ./LICENSE
COPY --from=build /src/apps/server/package.json ./package.json
COPY plugins/entries ./plugins/entries
COPY scripts/otto-remote-admin.sh ./remote-admin
COPY scripts/initialize-remote-identity.sh ./initialize-remote-identity.sh
COPY deploy/docker/otto-entrypoint.sh /usr/local/bin/otto
RUN mkdir -p /data node/bin \
  && ln -s /usr/local/bin/node node/bin/node \
  && node -p "require('./package.json').version" > VERSION \
  && chmod 755 remote-admin initialize-remote-identity.sh /usr/local/bin/otto \
  && chown node:node /data
EXPOSE 3773
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3773/.well-known/ottoLegacy/environment >/dev/null || exit 1
ENTRYPOINT ["otto"]
CMD ["serve"]
