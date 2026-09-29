import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    // Dev-mode co-op: the game server (npm run server) owns the room sim on
    // :8080. The client builds its ws URL from location.host, so proxy /ws to
    // the game server. rewrite strips vite's HMR ws query (?token=...&ws=),
    // which the game server's WebSocketServer rejects with 400. Set MP_SERVER
    // to point the proxy elsewhere.
    proxy: {
      '/ws': {
        target: process.env.MP_SERVER || 'http://127.0.0.1:8080',
        ws: true,
        rewrite: (p) => p.split('?')[0],
      },
      // Hosted high score lives on the same game server; proxy it too so the
      // dev page (Score._apiBase -> location.origin) reaches :8080.
      '/api/highscore': {
        target: process.env.MP_SERVER || 'http://127.0.0.1:8080',
      },
    },
  },
  preview: { port: 4173, host: true },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0
  }
})
