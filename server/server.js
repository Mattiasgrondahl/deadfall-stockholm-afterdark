// server/server.js — Phase 1 of MULTIPLAYER_PLAN.md (§4, §9 Phase 1): the
// authoritative WebSocket server.
//
// One process, one room per instance (plan §12: single room per server). It
// serves the static `dist/` build over HTTP and a WebSocket on the same origin
// (plan §10 single-origin). Each connected socket becomes a player slot in a
// `Match`; the server runs the fixed 20 Hz authoritative tick and broadcasts a
// 10 Hz snapshot to every client. Input frames are validated through
// `protocol.parseInput` so a bad client cannot poison the sim.
//
// Run:  node server/server.js            (PORT env, default 8080)
//       npm run server
//
// Headless-safe: importing this module does NOT start listening; call
// `startServer()` explicitly (so tests can drive a Match without a socket).
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { Match, TICK } from '../src/net/Match.js'
import {
  MSG, SERVER_TICK, SNAPSHOT_INTERVAL, MAX_PLAYERS,
  parseInput, buildSnap, buildWelcome, buildHello,
} from '../src/net/protocol.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '..', 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  // The Pages build is emitted with Vite base `/deadfall-stockholm-afterdark`,
  // so the HTML references /deadfall-stockholm-afterdark/assets/*. When this
  // server serves dist/ at root, strip that base prefix so those asset URLs
  // resolve. Requests without the prefix (plain `vite build`) pass through.
  if (urlPath === '/deadfall-stockholm-afterdark' || urlPath.startsWith('/deadfall-stockholm-afterdark/')) {
    urlPath = urlPath.slice('/deadfall-stockholm-afterdark'.length) || '/index.html'
  }
  if (urlPath === '/') urlPath = '/index.html'
  const filePath = path.join(DIST, urlPath)
  // Prevent path escape outside DIST.
  if (!filePath.startsWith(DIST)) { res.writeHead(403); res.end('forbidden'); return }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return }
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(data)
  })
}

/** A room = one Match + its sockets. Single room per server instance (§12). */
export class Room {
  constructor(difficulty = 'normal') {
    this.match = new Match({ difficulty })
    this.sockets = new Map() // socket -> playerId
    this._snapAccum = 0
  }

  /** Assign the next free player id (p0..p7) and add it to the Match. */
  join(socket) {
    if (this.sockets.size >= MAX_PLAYERS) return null
    let id = null
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const cand = 'p' + i
      if (!this.match.getPlayer(cand)) { id = cand; break }
    }
    if (!id) return null
    const slot = this.match.addPlayer(id)
    if (!slot) return null
    this.sockets.set(socket, id)
    return id
  }

  leave(socket) {
    const id = this.sockets.get(socket)
    if (!id) return
    this.match.removePlayer(id)
    this.sockets.delete(socket)
  }

  applyInput(socket, msg) {
    const id = this.sockets.get(socket)
    if (!id) return
    const input = parseInput(msg)
    if (!input) return
    const slot = this.match.getPlayer(id)
    if (!slot) return
    // Map the validated input onto the slot's inputState (same shape Game uses:
    // forward/back/left/right booleans + turnX/turnY look + fire/reload/jump).
    const is = slot.inputState
    is.forward = input.move.fwd > 0.1
    is.back = input.move.fwd < -0.1
    is.left = input.move.side > 0.1
    is.right = input.move.side < -0.1
    is.sprint = input.sprint
    is.fire = input.fire
    is.reload = input.reload
    is.jump = input.jump
    if (input.switch !== null) is['switch' + (input.switch + 1)] = true
    // Authoritative yaw from accumulated look; pitch is cosmetic but cheap.
    if (input.look.dx) is.turnX += input.look.dx
    if (input.look.dy) is.turnY = Math.max(-1.5, Math.min(1.5, is.turnY + input.look.dy))
  }

  /** Apply an authoritative client-confirmed hit on a zombie: the client's
   *  crosshair hit a remote zombie, so the server applies the damage (attributed
   *  to this socket's player) regardless of the server-side aim ray. */
  applyHit(socket, msg) {
    const id = this.sockets.get(socket)
    if (!id) return
    const victim = msg && msg.victim
    const dmg = msg && typeof msg.dmg === 'number' ? Math.max(0, Math.min(200, msg.dmg)) : 0
    if (victim == null || !(dmg > 0)) return
    this.match.applyHit(victim, dmg, !!msg.head, id)
  }

  /** Advance one authoritative tick and, on the snapshot cadence, broadcast. */
  tick(dt = SERVER_TICK) {
    this.match.step(dt)
    this._snapAccum += dt
    if (this._snapAccum >= SNAPSHOT_INTERVAL) {
      this._snapAccum = 0
      this.broadcast(buildSnap(this.match.snapshot()))
    }
  }

  broadcast(obj) {
    const data = JSON.stringify(obj)
    for (const socket of this.sockets.keys()) {
      if (socket.readyState === 1) socket.send(data) // OPEN
    }
  }
}

/**
 * Start the HTTP + WebSocket server. Returns { http, wss, room, close }.
 * Not called on import — only when run as main or via startServer().
 */
export function startServer(opts = {}) {
  const port = opts.port ?? Number(process.env.PORT || 8080)
  const host = opts.host ?? process.env.HOST ?? '0.0.0.0'
  const room = new Room(opts.difficulty)
  const httpServer = http.createServer(serveStatic)
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

  wss.on('connection', (socket) => {
    // Wait for a hello before assigning a slot, so the room is the join gate.
    let joined = false
    socket.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }
      if (!joined) {
        if (msg.t !== MSG.HELLO) return
        const id = room.join(socket)
        if (id === null) { socket.close(); return }
        joined = true
        socket.send(JSON.stringify(buildWelcome(id, room.match.snapshot().players)))
        return
      }
      switch (msg.t) {
        case MSG.INPUT: room.applyInput(socket, msg); break
        case MSG.HIT: room.applyHit(socket, msg); break
        case MSG.PING: socket.send(JSON.stringify({ t: MSG.PONG, now: msg.now })); break
        case MSG.LEAVE: room.leave(socket); socket.close(); break
      }
    })
    socket.on('close', () => room.leave(socket))
    socket.on('error', () => room.leave(socket))
  })

  // Fixed 20 Hz authoritative tick (plan §4.2). setInterval is a Node timer,
  // available in the server process (not the browser sandbox).
  const timer = setInterval(() => room.tick(TICK), TICK * 1000)

  const server = httpServer.listen(port, host, () => {
    console.log(`[server] http+ws on ${host}:${port}  room players cap ${MAX_PLAYERS}`)
  })

  return {
    http: httpServer, wss, room,
    close() { clearInterval(timer); wss.close(); server.close() },
  }
}

// Re-export for tests that drive a Room/Match without sockets.
export { buildHello }

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer()
}