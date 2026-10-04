import type { ClientRequest, IncomingMessage } from "node:http";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const publicOrigin = process.env.OTTO_UI_ORIGIN
  ? new URL(process.env.OTTO_UI_ORIGIN).origin
  : undefined;

// BB Connect translates its exact public Origin to the shared port's loopback Origin.
// Restore that one origin at the dev proxy; unrelated origins still reach server denial.
function restorePreviewOrigin(
  outgoing: ClientRequest,
  incoming: IncomingMessage,
) {
  if (
    publicOrigin &&
    incoming.headers.origin === `http://127.0.0.1:${incoming.socket.localPort}`
  )
    outgoing.setHeader("origin", publicOrigin);
}

// https://vite.dev/config/
export default defineConfig({
  server: {
    allowedHosts: process.env.OTTO_UI_ORIGIN
      ? [new URL(process.env.OTTO_UI_ORIGIN).hostname]
      : [],
    proxy: {
      "/api": {
        target: process.env.OTTO_API_ORIGIN ?? "http://127.0.0.1:45175",
        ws: true,
        configure(proxy) {
          proxy.on("proxyReq", restorePreviewOrigin);
          proxy.on("proxyReqWs", restorePreviewOrigin);
        },
      },
    },
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
});
