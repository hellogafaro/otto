FROM golang:1.26.0 AS gateway-build
WORKDIR /gateway
COPY ops/gateway/go.mod ops/gateway/go.sum ./
RUN go mod download
COPY ops/gateway/main.go ./
RUN CGO_ENABLED=0 go build -trimpath -o /otto-gateway .

FROM oven/bun:1.4.2 AS app
WORKDIR /otto
COPY --chown=bun:bun . .
RUN test "$(bun -p 'require("./package.json").name')" = otto && bun install --frozen-lockfile
USER bun
CMD ["bun", "apps/server/src/index.ts"]

FROM oven/bun:1.4.2 AS gateway
COPY --from=gateway-build /otto-gateway /usr/local/bin/otto-gateway
COPY ops/gateway/LICENSE.CLIProxyAPI /usr/share/licenses/otto-gateway/LICENSE.CLIProxyAPI
USER bun
CMD ["otto-gateway"]

FROM app AS web
RUN bun run build

FROM caddy:2.10.2 AS edge
COPY --from=web /otto/apps/web/dist /srv
COPY ops/Caddyfile /etc/caddy/Caddyfile
