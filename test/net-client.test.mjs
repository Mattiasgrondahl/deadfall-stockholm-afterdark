// Phase 1 NetClient headless test (plan §5.4, §6). Uses a fake WebSocket so the
// client logic (hello/welcome, input framing, snapshot ingest, interpolation)
// is verified without a browser or a live socket.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NetClient, lerpPlayer, reconcileSelf } from '../src/net/NetClient.js'
import { MSG } from '../src/net/protocol.js'

class FakeWS {
  constructor(url) { this.url = url; this.sent = []; this.onopen = null; this.onmessage = null; this.onclose = null }
  send(s) { this.sent.push(JSON.parse(s)) }
  close() { if (this.onclose) this.onclose() }
  // Test helper: simulate the server opening + sending a frame.
  open() { if (this.onopen) this.onopen() }
  receive(msg) { if (this.onmessage) this.onmessage({ data: JSON.stringify(msg) }) }
}

test('lerpPlayer interpolates position, snaps discrete fields', () => {
  const a = { id: 'p1', x: 0, y: 1, z: 0, yaw: 0, pitch: 0, health: 100, stamina: 100, weapon: 'axe', ammo: 5, reserve: 20, dead: false }
  const b = { id: 'p1', x: 10, y: 1, z: 10, yaw: Math.PI, pitch: 0, health: 80, stamina: 60, weapon: 'shotgun', ammo: 4, reserve: 20, dead: false }
  const mid = lerpPlayer(a, b, 0.5)
  assert.equal(mid.x, 5, 'x lerped')
  assert.equal(mid.z, 5, 'z lerped')
  assert.equal(mid.weapon, 'shotgun', 'weapon from newer snapshot')
  assert.equal(mid.health, 80, 'health from newer snapshot')
})

test('reconcileSelf lerps predicted toward authoritative', () => {
  const r = reconcileSelf({ x: 0, y: 1, z: 0 }, { x: 10, y: 1, z: 10 }, 0.5)
  assert.equal(r.x, 5); assert.equal(r.z, 5)
})

test('NetClient sends hello on open and adopts pid on welcome', () => {
  const nc = new NetClient({ Socket: FakeWS, url: 'ws://x/ws', name: 'Alice' })
  nc.socket.open()
  assert.equal(nc.socket.sent[0].t, MSG.HELLO, 'hello sent on open')
  assert.equal(nc.socket.sent[0].name, 'Alice')
  nc.socket.receive({ t: MSG.WELCOME, pid: 'p2', roster: [] })
  assert.equal(nc.pid, 'p2', 'pid adopted')
  assert.equal(nc.connected, true)
})

test('NetClient sendInput frames a valid input message', () => {
  const nc = new NetClient({ Socket: FakeWS, url: 'ws://x/ws' })
  nc.socket.open()
  nc.socket.receive({ t: MSG.WELCOME, pid: 'p0', roster: [] })
  nc.sendInput({ forward: true, left: false, back: false, right: false, sprint: true, fire: true, turnX: 0.1, turnY: 0, switch1: true }, 0)
  const f = nc.socket.sent[nc.socket.sent.length - 1]
  assert.equal(f.t, MSG.INPUT)
  assert.equal(f.pid, 'p0')
  assert.equal(f.move.fwd, 1, 'forward -> fwd 1')
  assert.equal(f.sprint, true)
  assert.equal(f.fire, true)
  assert.equal(f.switch, 0, 'switch1 -> 0')
  assert.equal(nc.socket.sent.at(-1).look.dx, 0.1)
  // turnX cleared after send (accumulated look is consumed).
  const st = { forward: false, turnX: 0.2 }
  nc.sendInput(st, 0)
  assert.equal(st.turnX, 0, 'turnX reset after send')
})

test('NetClient ingests snapshots and interpolates remote players', () => {
  const nc = new NetClient({ Socket: FakeWS, url: 'ws://x/ws' })
  nc.socket.open()
  nc.socket.receive({ t: MSG.WELCOME, pid: 'p0', roster: [] })
  nc.socket.receive({ t: MSG.SNAP, tick: 1, players: [{ id: 'p1', x: 0, y: 1, z: 0, yaw: 0, pitch: 0, health: 100, stamina: 100, weapon: 'axe', ammo: 5, reserve: 20, dead: false }], zombies: [], kills: {}, score: {}, drops: [], events: [] })
  nc.update(0.05)
  nc.socket.receive({ t: MSG.SNAP, tick: 2, players: [{ id: 'p1', x: 10, y: 1, z: 10, yaw: 0, pitch: 0, health: 100, stamina: 100, weapon: 'axe', ammo: 5, reserve: 20, dead: false }], zombies: [], kills: {}, score: {}, drops: [], events: [] })
  const interp = nc.interpolated()
  assert.equal(interp.players.length, 1)
  // alpha = snapAge(0)/SNAPSHOT_INTERVAL = 0 -> at the older snapshot's pos.
  assert.equal(interp.players[0].x, 0, 'alpha 0 -> older pos')
  nc.update(0.1) // snapAge now 0.1 -> alpha 1 -> newer pos
  const interp2 = nc.interpolated()
  assert.equal(interp2.players[0].x, 10, 'alpha 1 -> newer pos')
})

test('NetClient close marks disconnected', () => {
  const nc = new NetClient({ Socket: FakeWS, url: 'ws://x/ws' })
  nc.socket.open()
  nc.close()
  assert.equal(nc.connected, false)
})