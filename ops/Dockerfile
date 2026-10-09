FROM oven/bun:1.4.2 AS app
WORKDIR /otto
COPY --chown=bun:bun . .
RUN test "$(bun -p 'require("./package.json").name')" = otto && bun install --frozen-lockfile
USER bun
CMD ["bun", "apps/server/src/index.ts"]

FROM app AS web
RUN bun run build

FROM caddy:2.10.2 AS edge
COPY --from=web /otto/apps/web/dist /srv
COPY ops/Caddyfile /etc/caddy/Caddyfile
