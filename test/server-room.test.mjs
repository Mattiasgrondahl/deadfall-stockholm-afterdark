// Phase 1 netcode headless test (MULTIPLAYER_PLAN §9 Phase 1, §5 protocol).
//
// Drives the server Room + Match through scripted input with FAKE sockets (no
// real WebSocket, no timers), proving the join gate, input validation, the
// 20 Hz tick, and the 10 Hz snapshot broadcast all work headlessly. The real
// socket transport is exercised by server/server.js at runtime; this test
// covers the logic that does not need a browser or a live socket.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Room, startServer } from '../server/server.js'
import { MSG, SERVER_TICK, SNAPSHOT_INTERVAL, MAX_PLAYERS, parseInput, parseFF, buildHello, buildWelcome } from '../src/net/protocol.js'

// Minimal fake socket: records sent frames, reports OPEN.
function fakeSocket() {
  const sent = []
  return { readyState: 1, sent, send(s) { sent.push(JSON.parse(s)) }, close() {} }
}

test('protocol.parseInput clamps and normalizes', () => {
  const good = parseInput({ t: MSG.INPUT, pid: 'p0', tick: 5, move: { fwd: 2, side: -3 }, sprint: true, look: { dx: 9, dy: -9 }, fire: true, switch: 2 })
  assert.ok(good, 'valid input parses')
  assert.equal(good.move.fwd, 1, 'fwd clamped to 1')
  assert.equal(good.move.side, -1, 'side clamped to -1')
  assert.equal(good.look.dx, 1, 'look.dx clamped')
  assert.equal(good.switch, 2, 'switch preserved')
  assert.equal(parseInput({ t: 'nope' }), null, 'wrong type rejected')
  assert.equal(parseInput({ t: MSG.INPUT }), null, 'missing pid rejected')
  const bad = parseInput({ t: MSG.INPUT, pid: 'p0', switch: 9 })
  assert.equal(bad.switch, null, 'out-of-range switch dropped')
})

test('protocol.parseFF validates a friendly-fire frame', () => {
  const good = parseFF({ t: MSG.FF, victim: 'p1', dmg: 40 })
  assert.deepEqual(good, { victim: 'p1', dmg: 40 }, 'valid ff parses')
  assert.equal(parseFF({ t: MSG.FF, victim: 'p1', dmg: 400 }).dmg, 200, 'dmg clamped to 200')
  assert.equal(parseFF({ t: MSG.FF, victim: 'p1', dmg: -5 }), null, 'non-positive dmg rejected')
  assert.equal(parseFF({ t: MSG.FF, victim: '', dmg: 10 }), null, 'missing victim rejected')
  assert.equal(parseFF({ t: MSG.INPUT, victim: 'p1', dmg: 10 }), null, 'wrong type rejected')
})

test('buildHello / buildWelcome shape', () => {
  const h = buildHello('Player One!!!', 'room')
  assert.equal(h.t, MSG.HELLO)
  assert.ok(h.name.length <= 24, 'name truncated to 24')
  const w = buildWelcome('p3', [{ id: 'p0' }, { id: 'p1' }])
  assert.equal(w.t, MSG.WELCOME)
  assert.equal(w.pid, 'p3')
  assert.equal(w.roster.length, 2)
})

test('Room join assigns sequential pids and caps at 8', () => {
  const room = new Room()
  const ids = []
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const s = fakeSocket()
    const id = room.join(s)
    assert.ok(id, `player ${i} joins`)
    ids.push(id)
  }
  assert.deepEqual(ids, ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'], 'sequential pids')
  // 9th player is refused.
  assert.equal(room.join(fakeSocket()), null, 'cap enforced')
})

test('Room tick advances the sim and broadcasts a 10 Hz snapshot', () => {
  const room = new Room()
  const s0 = fakeSocket(), s1 = fakeSocket()
  room.join(s0); room.join(s1)
  // Feed movement input to p0 (forward) and drive ticks.
  room.applyInput(s0, { t: MSG.INPUT, pid: 'p0', move: { fwd: 1, side: 0 } })
  const before = room.match.getPlayer('p0').player.position.z
  for (let i = 0; i < 20; i++) room.tick(SERVER_TICK) // 1 s
  const after = room.match.getPlayer('p0').player.position.z
  assert.notEqual(before, after, 'p0 moved under authoritative tick')
  // Snapshot cadence: ~10 snapshots over 1 s at 20 Hz.
  const snaps = s0.sent.filter((m) => m.t === MSG.SNAP)
  assert.ok(snaps.length >= 9 && snaps.length <= 11, `~10 snapshots in 1 s (got ${snaps.length})`)
  const snap = snaps[snaps.length - 1]
  assert.ok(Array.isArray(snap.players) && snap.players.length === 2, 'snapshot has both players')
})

test('v4 co-op: authoritative client yaw steers the server player', () => {
  const room = new Room()
  const s0 = fakeSocket()
  room.join(s0)
  // The client owns the mouse and sends its yaw (its local player.update consumes
  // the raw look deltas before sendInput, so look.dx is always 0 here). Without
  // adopting it the server keeps facing the spawn direction and W slides the
  // player sideways — the reported "invisible wall".
  const p = room.match.getPlayer('p0').player
  assert.equal(p.yaw, 0, 'spawns facing -Z')
  room.applyInput(s0, { t: MSG.INPUT, pid: 'p0', yaw: Math.PI / 2 })
  assert.equal(p.yaw, Math.PI / 2, 'server adopts the client yaw')
  // With yaw = +90°, forward maps to +X (not -Z): forward input must move the
  // player along X, proving the server now moves along the client's heading.
  room.applyInput(s0, { t: MSG.INPUT, pid: 'p0', move: { fwd: 1, side: 0 }, yaw: Math.PI / 2 })
  const bx = p.position.x, bz = p.position.z
  for (let i = 0; i < 20; i++) room.tick(SERVER_TICK)
  assert.ok(Math.abs(p.position.x - bx) > 0.5, 'forward moves along the client yaw (X), not the spawn axis')
  assert.ok(Math.abs(p.position.z - bz) < 0.5, 'no sideways slide along the stale spawn axis')
})

test('v4 friendly fire: room.applyFF damages the victim player', () => {
  const room = new Room()
  const s0 = fakeSocket(), s1 = fakeSocket()
  room.join(s0); room.join(s1)
  const victim = room.match.getPlayer('p1').player
  // p0 fires on p1: 60 raw -> 21 applied (0.35 fraction).
  room.applyFF(s0, { t: MSG.FF, victim: 'p1', dmg: 60 })
  assert.equal(victim.health, 79, 'friendly fire applied 60 * 0.35 = 21 damage')
  // A malformed frame (no victim) is a no-op.
  room.applyFF(s0, { t: MSG.FF, victim: '', dmg: 60 })
  assert.equal(victim.health, 79, 'malformed ff frame ignored')
})

test('leave holds the player slot in disconnect grace, then frees it', () => {
  // v12 (MULTIPLAYER_PLAN §14 item 2): a socket close no longer deletes the
  // slot outright — it is flagged disconnected and held for DISCONNECT_GRACE so
  // a refresh can reconnect. The Room's socket map drops it immediately.
  const room = new Room()
  const s = fakeSocket()
  const id = room.join(s)
  assert.ok(room.match.getPlayer(id))
  room.leave(s)
  const slot = room.match.getPlayer(id)
  assert.ok(slot && slot.disconnected, 'slot held in grace, flagged disconnected')
  assert.equal(room.sockets.get(s), undefined, 'socket mapping removed on leave')
  // Drive ticks past the 5 s grace window: the slot is finally freed.
  for (let i = 0; i < 110; i++) room.tick(SERVER_TICK) // 5.5 s
  assert.equal(room.match.getPlayer(id), null, 'slot freed once the grace elapses')
})

test('input validation blocks a malformed frame', () => {
  const room = new Room()
  const s = fakeSocket()
  room.join(s)
  // Garbage fwd/side must coerce to 0 -> no forward/back/left/right flags set.
  room.applyInput(s, { t: MSG.INPUT, pid: 'p0', move: { fwd: 'oops', side: null } })
  const is = room.match.getPlayer('p0').inputState
  assert.equal(is.forward, false, 'garbage fwd does not set forward')
  assert.equal(is.back, false, 'garbage fwd does not set back')
  assert.equal(is.left, false, 'garbage side does not set left')
  assert.equal(is.right, false, 'garbage side does not set right')
})

test('v7: distinct room codes are distinct sessions (independent Matches)', async () => {
  // Two websockets hello-ing different room codes land in separate Matches, so
  // players in one room never appear in the other's snapshot.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-room-'))
  const prev = process.env.HIGHSCORE_FILE
  process.env.HIGHSCORE_FILE = path.join(dir, 'highscore.json')
  const srv = startServer({ port: 0, host: '127.0.0.1' })
  const sockets = []
  try {
    const addr = await new Promise((resolve) => {
      const poll = () => { const a = srv.http.address(); if (a && a.port) resolve(a); else setTimeout(poll, 10) }
      poll()
    })
    const WS = globalThis.WebSocket
    const a = new WS(`ws://127.0.0.1:${addr.port}/ws`)
    const b = new WS(`ws://127.0.0.1:${addr.port}/ws`)
    sockets.push(a, b)
    const seen = { a: [], b: [] }
    const waitOpen = (ws) => new Promise((r) => { if (ws.readyState === 1) r(); else ws.addEventListener('open', r) })
    a.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.t === MSG.SNAP) seen.a.push(m) })
    b.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.t === MSG.SNAP) seen.b.push(m) })
    await Promise.all([waitOpen(a), waitOpen(b)])
    a.send(JSON.stringify(buildHello('Alice', 'CRYPT-9')))
    b.send(JSON.stringify(buildHello('Bob', 'HORDE-7')))
    // Let a few snapshot ticks elapse.
    await new Promise((r) => setTimeout(r, 400))
    const aNames = new Set((seen.a.at(-1)?.players || []).map((p) => p.name))
    const bNames = new Set((seen.b.at(-1)?.players || []).map((p) => p.name))
    assert.ok(aNames.size >= 1 && bNames.size >= 1, 'each room has its own player')
    assert.ok(aNames.has('Alice') && !aNames.has('Bob'), 'room A holds only Alice')
    assert.ok(bNames.has('Bob') && !bNames.has('Alice'), 'room B holds only Bob')
  } finally {
    for (const ws of sockets) { try { ws.close() } catch { /* already closed */ } }
    srv.close()
    if (prev === undefined) delete process.env.HIGHSCORE_FILE
    else process.env.HIGHSCORE_FILE = prev
    fs.rmSync(dir, { recursive: true, force: true })
  }
})