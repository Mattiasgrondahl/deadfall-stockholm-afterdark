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
  parseInput, parseFF, buildSnap, buildWelcome, buildHello,
} from '../src/net/protocol.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Web root: DIST_DIR overrides for production hosting (the app checkout keeps
// it beside server/); the default resolves to the repo's dist/.
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.resolve(__dirname, '..', 'dist')
// Hosted high score: one JSON file beside the server (git-ignored dir), the
// base leaderboard every visitor shares. v7: each room code gets a sibling
// file keyed by its code. The path is resolved at CALL time (not import) so a
// test can redirect it via HIGHSCORE_FILE after the module is loaded.
const HS_MAX_NAME = 24
const HS_CTRL = new RegExp('[\\u0000-\\u001f\\u007f]', 'g')
// v7: the room code is now a first-class key — each room code gets its own
// leaderboard + its own Match. Codes are sanitized like names (control chars
// stripped, whitespace collapsed, clamped) and fall back to 'default' so a
// missing/blank code still lands on the original global board.
const HS_MAX_ROOM = 32
const DEFAULT_ROOM = 'default'

/** Resolve the base high-score file path at call time (HIGHSCORE_FILE override). */
function hsRootFile() {
  return process.env.HIGHSCORE_FILE || path.join(__dirname, 'highscore.json')
}

/** Sanitize a room code for use as a key + filename fragment. */
function sanitizeRoom(raw) {
  const s = String(raw == null ? '' : raw)
    .replace(HS_CTRL, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, HS_MAX_ROOM)
  return s || DEFAULT_ROOM
}

/** Map a room code to a safe filename fragment (alnum + dash/underscore). */
function roomFileFragment(room) {
  return room.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 48) || DEFAULT_ROOM
}

/** v3 T6: server-side name sanitizer for the hosted record. A hostile POST
 *  must not poison the shared record, so the name is stripped of control
 *  characters, whitespace-collapsed, trimmed and clamped before it is stored.
 *  The value is only ever served back as JSON text and rendered client-side
 *  via textContent, so it can never become markup. */
function sanitizeName(raw) {
  return String(raw == null ? '' : raw)
    .replace(HS_CTRL, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, HS_MAX_NAME)
}

// Top-10 leaderboard: the hosted record is now a ranked list of entries
// rather than a single best. GET returns {best, name, top:[{name,score}…]}
// where best/name mirror top[0] for backward compatibility with older
// clients; POST inserts a qualifying score and keeps the best HS_TOP.
const HS_TOP = 10

// v8: a fresh board (no persisted file, or an empty one) starts from a seeded
// ladder of 10 named ranks at 1000, 900 … 100 so the title screen always shows
// a full top-10. A new score that beats the lowest rank bumps the rest down a
// step and drops the 11th, keeping exactly the 10 highest (normalizeTop).
const DEFAULT_TOP = [
  { name: 'REAPER', score: 1000 },
  { name: 'GRIM', score: 900 },
  { name: 'ROT', score: 800 },
  { name: 'SHAMBLER', score: 700 },
  { name: 'HORDE', score: 600 },
  { name: 'CRAWLER', score: 500 },
  { name: 'BLOATER', score: 400 },
  { name: 'SPITTER', score: 300 },
  { name: 'WALKER', score: 200 },
  { name: 'SETTOR', score: 100 }
]

/** Coerce one stored/hosted entry to a clean {name, score}; null when junk. */
function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null
  const v = Number(e.score)
  if (!Number.isFinite(v) || v <= 0) return null
  return { name: sanitizeName(e.name), score: Math.floor(v) }
}

/** Normalize a top list: drop junk, sort by score desc (ties keep insertion
 *  order), clamp to HS_TOP. */
function normalizeTop(list) {
  const out = []
  for (const e of Array.isArray(list) ? list : []) {
    const c = cleanEntry(e)
    if (c) out.push(c)
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, HS_TOP)
}

/** Resolve the JSON file for a room's leaderboard. The 'default' room keeps the
 *  legacy HS_FILE path (back-compat); other rooms get a sibling file. */
function hsFileFor(room) {
  const root = hsRootFile()
  if (room === DEFAULT_ROOM) return root
  return path.join(path.dirname(root), 'highscore-' + roomFileFragment(room) + '.json')
}

/** Read the persisted leaderboard for `room`. v6: the file is {top:[…]}; a
 *  legacy {best, name} file is migrated into a one-entry list. v8: a missing or
 *  empty board falls back to the seeded DEFAULT_TOP ladder so a fresh room shows
 *  a full top-10 instead of nothing. Returns {top}. */
function readHighScore(room = DEFAULT_ROOM) {
  try {
    const j = JSON.parse(fs.readFileSync(hsFileFor(room), 'utf8'))
    if (Array.isArray(j.top)) {
      const top = normalizeTop(j.top)
      return { top: top.length ? top : DEFAULT_TOP.slice() }
    }
    const c = cleanEntry({ score: j.best, name: j.name })
    return { top: c ? [c] : DEFAULT_TOP.slice() }
  } catch { return { top: DEFAULT_TOP.slice() } }
}

/** Persist the leaderboard for `room`; failures are swallowed (memory stands). */
function writeHighScore(top, room = DEFAULT_ROOM) {
  try { fs.writeFileSync(hsFileFor(room), JSON.stringify({ top })) } catch { /* read-only fs */ }
}

/** Insert a score into the leaderboard if it qualifies (any entry that fits
 *  within the top HS_TOP ranks is kept, even below the current best). Returns
 *  the new list. */
function insertTop(top, score, name) {
  const c = cleanEntry({ score, name })
  if (!c) return top
  const next = top.slice()
  next.push(c)
  return normalizeTop(next)
}

/** Handle /api/highscore. v7: the leaderboard is keyed by room code. GET
 *  ?room=X returns that room's {best, name, top}; POST {score, name, room}
 *  inserts into that room's list. A missing/blank room resolves to 'default'
 *  (the original global board), so older clients are unaffected. `store` is a
 *  Map<room, {top}> shared across requests. */
function serveHighScore(req, res, store) {
  const roomOf = (reqUrl) => {
    const q = (reqUrl || '').split('?')[1]
    if (!q) return DEFAULT_ROOM
    for (const kv of q.split('&')) {
      const [k, v] = kv.split('=')
      if (k === 'room') return sanitizeRoom(decodeURIComponent(v || ''))
    }
    return DEFAULT_ROOM
  }
  const payload = (top) => {
    const lead = top[0]
    return { best: lead ? lead.score : 0, name: lead ? lead.name : '', top }
  }
  if (req.method === 'GET') {
    const room = roomOf(req.url)
    let st = store.get(room)
    if (!st) { st = readHighScore(room); store.set(room, st) }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(payload(st.top)))
    return
  }
  if (req.method === 'POST') {
    let body = ''
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy() })
    req.on('end', () => {
      let v = NaN, nm = '', room = DEFAULT_ROOM
      try { const j = JSON.parse(body); v = Number(j.score); nm = j.name; room = sanitizeRoom(j.room) } catch { /* bad json -> NaN */ }
      let st = store.get(room)
      if (!st) { st = readHighScore(room); store.set(room, st) }
      if (Number.isFinite(v) && v >= 0 && v <= 1e9) {
        const next = insertTop(st.top, v, nm)
        if (next !== st.top) {
          st.top = next
          writeHighScore(next, room)
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(payload(st.top)))
      return
    })
    return
  }
  res.writeHead(405, { Allow: 'GET, POST' })
  res.end('method not allowed')
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  // Hosted high-score API, served at both the root and the Pages base path so
  // one server instance answers either build. v7: `req._hsStore` is the
  // room-keyed leaderboard Map.
  const hsStore = req._hsStore
  if (hsStore && (urlPath === '/api/highscore' || urlPath === '/deadfall-stockholm-afterdark/api/highscore')) {
    serveHighScore(req, res, hsStore)
    return
  }
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
    // Vite emits content-hashed asset filenames, so /assets/* is immutable and
    // cacheable forever; index.html must never be cached or a deploy stalls.
    const cache = urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache })
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
  join(socket, name) {
    if (this.sockets.size >= MAX_PLAYERS) return null
    let id = null
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const cand = 'p' + i
      if (!this.match.getPlayer(cand)) { id = cand; break }
    }
    if (!id) return null
    const slot = this.match.addPlayer(id, undefined, undefined, name)
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

  /** Apply an authoritative friendly-fire hit: a client's shot landed on a
   *  teammate, so the server applies the reduced friendly-fire damage to the
   *  victim's player (attributed to the shooter). */
  applyFF(socket, msg) {
    const id = this.sockets.get(socket)
    if (!id) return
    const ff = parseFF(msg)
    if (!ff) return
    this.match.applyFF(ff.victim, ff.dmg, id)
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
  // v7: each room code gets its own Match + leaderboard. `rooms` is the
  // room-code -> Room registry; `hsStore` is the room-code -> {top} leaderboard
  // store shared with serveHighScore. The 'default' room is pre-created so the
  // returned `.room` (and legacy single-room tests) still resolve.
  const rooms = new Map()
  const hsStore = new Map()
  const roomFor = (code) => {
    const key = sanitizeRoom(code)
    let r = rooms.get(key)
    if (!r) { r = new Room(opts.difficulty); rooms.set(key, r) }
    return r
  }
  const defaultRoom = roomFor(DEFAULT_ROOM)
  // Seed the default leaderboard: opts.highScore is a one-entry board (tests);
  // otherwise read the persisted default file.
  if (Number.isFinite(opts.highScore)) {
    const c = cleanEntry({ score: opts.highScore, name: opts.highScoreName })
    hsStore.set(DEFAULT_ROOM, { top: c ? [c] : [] })
  } else {
    hsStore.set(DEFAULT_ROOM, readHighScore(DEFAULT_ROOM))
  }
  const httpServer = http.createServer((req, res) => { req._hsStore = hsStore; serveStatic(req, res) })
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

  wss.on('connection', (socket) => {
    // Wait for a hello before assigning a slot, so the room is the join gate.
    let joined = false
    let room = null
    socket.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }
      if (!joined) {
        if (msg.t !== MSG.HELLO) return
        // v3 T11: carry the hello display name into the slot so the snapshot can
        // label remote avatars. buildHello already clamps to 24 chars.
        // v7: route the socket into the room its hello names (msg.room), so
        // distinct room codes are distinct sessions with distinct leaderboards.
        room = roomFor(msg.room)
        const id = room.join(socket, msg.name)
        if (id === null) { socket.close(); return }
        joined = true
        socket.send(JSON.stringify(buildWelcome(id, room.match.snapshot().players)))
        return
      }
      switch (msg.t) {
        case MSG.INPUT: room.applyInput(socket, msg); break
        case MSG.HIT: room.applyHit(socket, msg); break
        case MSG.FF: room.applyFF(socket, msg); break
        case MSG.PING: socket.send(JSON.stringify({ t: MSG.PONG, now: msg.now })); break
        case MSG.LEAVE: room.leave(socket); socket.close(); break
      }
    })
    socket.on('close', () => { if (room) room.leave(socket) })
    socket.on('error', () => { if (room) room.leave(socket) })
  })

  // Fixed 20 Hz authoritative tick (plan §4.2). setInterval is a Node timer,
  // available in the server process (not the browser sandbox). v7: tick every
  // room in the registry, not just one.
  const timer = setInterval(() => {
    for (const r of rooms.values()) r.tick(TICK)
  }, TICK * 1000)

  const server = httpServer.listen(port, host, () => {
    console.log(`[server] http+ws on ${host}:${port}  room players cap ${MAX_PLAYERS}`)
  })

  return {
    http: httpServer, wss, room: defaultRoom, rooms, hsState: hsStore.get(DEFAULT_ROOM), hsStore,
    close() { clearInterval(timer); wss.close(); server.close() },
  }
}

// Re-export for tests that drive a Room/Match without sockets.
export { buildHello, readHighScore, writeHighScore }

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer()
}