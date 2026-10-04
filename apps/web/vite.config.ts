import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
