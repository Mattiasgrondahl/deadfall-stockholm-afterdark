// Phase 1 netcode headless test (MULTIPLAYER_PLAN §9 Phase 1, §5 protocol).
//
// Drives the server Room + Match through scripted input with FAKE sockets (no
// real WebSocket, no timers), proving the join gate, input validation, the
// 20 Hz tick, and the 10 Hz snapshot broadcast all work headlessly. The real
// socket transport is exercised by server/server.js at runtime; this test
// covers the logic that does not need a browser or a live socket.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Room } from '../server/server.js'
import { MSG, SERVER_TICK, SNAPSHOT_INTERVAL, MAX_PLAYERS, parseInput, buildHello, buildWelcome } from '../src/net/protocol.js'

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
  assert.ok(snap.players.every((p) => typeof p.x === 'number' && typeof p.health === 'number'), 'player fields present')
})

test('leave removes the player slot', () => {
  const room = new Room()
  const s = fakeSocket()
  const id = room.join(s)
  assert.ok(room.match.getPlayer(id))
  room.leave(s)
  assert.equal(room.match.getPlayer(id), null, 'player removed on leave')
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