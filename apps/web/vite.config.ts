import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const serverPort = process.env.CRAFT_RPC_PORT ?? '9100'
// Stubs for Node modules, shared with Craft's own web client.
const shims = resolve(import.meta.dirname, '../webui/src/shims')

export default defineConfig({
  server: {
    port: 5176,
    host: true,
    // Dev only: reached through the bb link, whose host name changes.
    allowedHosts: true,
    // The headless server owns login, config and the WebSocket.
    proxy: {
      '/api': { target: `http://127.0.0.1:${serverPort}`, changeOrigin: true },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      // Dev only: on this machine the browser reaches the server directly. Through the bb link
      // the server's CRAFT_WEBUI_WS_URL (the public address) is used as is.
      name: 'local-ws-url',
      configureServer(server) {
        server.middlewares.use('/api/config', (req, res, next) => {
          const host = (req.headers.host ?? '').split(':')[0]
          if (req.url !== '/' || (host !== '127.0.0.1' && host !== 'localhost')) return next()
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ wsUrl: `ws://127.0.0.1:${serverPort}` }))
        })
      },
    },
  ],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      // The shared protocol code touches Node modules that never run in a browser.
      ...Object.fromEntries(
        [
          'fs', 'node:fs', 'path', 'node:path', 'child_process', 'node:child_process',
          'os', 'node:os', 'node:crypto', 'node:util', 'node:process', 'node:buffer',
          'node:https', 'node:http', 'node:net', 'node:url', 'node:events',
          'crypto', 'https', 'http', 'net', 'events', 'util', 'buffer', 'stream',
          'node:stream', 'tls', 'node:tls', 'url', 'zlib', 'node:zlib',
          'string_decoder', 'node:string_decoder', 'assert', 'node:assert',
        ].map((name) => [name, resolve(shims, 'node-builtins.ts')]),
      ),
      'fs/promises': resolve(shims, 'fs-promises.ts'),
      'node:fs/promises': resolve(shims, 'fs-promises.ts'),
      ws: resolve(shims, 'ws.ts'),
      open: resolve(shims, 'open.ts'),
      'electron-log': resolve(shims, 'electron-log.ts'),
      'electron-log/renderer': resolve(shims, 'electron-log.ts'),
      // One React for the app and the design system.
      react: resolve(import.meta.dirname, 'node_modules/react'),
      'react-dom': resolve(import.meta.dirname, 'node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
})
