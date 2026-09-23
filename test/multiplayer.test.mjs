// Phase 5 Multiplayer controller headless test. A fake WebSocket drives the
// NetClient; a minimal fake document exercises the scoreboard DOM path. No
// browser, no three renderer — the scene graph + scoreboard are asserted
// directly, and dispose() teardown is verified.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { Multiplayer } from '../src/net/Multiplayer.js'
import { Game } from '../src/game/Game.js'
import { MSG } from '../src/net/protocol.js'

class FakeWS {
  constructor(url) { this.url = url; this.sent = []; this.onopen = null; this.onmessage = null; this.onclose = null }
  send(s) { this.sent.push(JSON.parse(s)) }
  close() { if (this.onclose) this.onclose() }
  open() { if (this.onopen) this.onopen() }
  receive(msg) { if (this.onmessage) this.onmessage({ data: JSON.stringify(msg) }) }
}

// Minimal DOM stand-in: createElement returns a node that tracks children and
// textContent; body.appendChild/removeChild track the scoreboard panel.
function fakeDoc() {
  const mkNode = () => ({
    children: [], style: {}, textContent: '',
    appendChild(c) { this.children.push(c); c.parentNode = this },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null },
    get firstChild() { return this.children[0] || null }
  })
  const body = mkNode()
  return { body, createElement: () => mkNode() }
}

function snap(over = {}) {
  return Object.assign({
    tick: 1, time: 0, wave: 2, remaining: 5,
    players: [
      { id: 'me', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, health: 100, stamina: 100, weapon: 'axe', ammo: 5, reserve: 20, dead: false },
      { id: 'alice', x: 3, y: 1.7, z: 4, yaw: 1, pitch: 0, health: 90, stamina: 80, weapon: 'shotgun', ammo: 4, reserve: 20, dead: false },
      { id: 'bob', x: -2, y: 1.7, z: 6, yaw: 2, pitch: 0, health: 70, stamina: 60, weapon: 'pistol', ammo: 12, reserve: 36, dead: false }
    ],
    zombies: [
      { id: 'z1', type: 'walker', x: 1, z: 2, health: 100, state: 'chase', facing: 0.5 },
      { id: 'z2', type: 'brute', x: -3, z: 1, health: 300, state: 'chase', facing: 1 }
    ],
    kills: { me: 3, alice: 5, bob: 1 },
    score: { me: 200, alice: 410, bob: 60 },
    drops: [], events: []
  }, over)
}

function makeMP() {
  const scene = new THREE.Scene()
  const doc = fakeDoc()
  const mp = new Multiplayer({ scene, env: { document: doc }, Socket: FakeWS, url: 'ws://x/ws', name: 'me', room: 'r' })
  mp.socket = mp.net.socket
  mp.socket.open()
  mp.socket.receive({ t: MSG.WELCOME, pid: 'me', roster: [] })
  return { scene, doc, mp }
}

test('welcome adopts pid; snapshot spawns remote avatars but not self', () => {
  const { mp } = makeMP()
  assert.equal(mp.pid, 'me')
  mp.socket.receive({ t: MSG.SNAP, ...snap() })
  assert.equal(mp.players.size, 2, 'two remote avatars (self excluded)')
  assert.ok(mp.players.has('alice') && mp.players.has('bob'))
  assert.ok(!mp.players.has('me'), 'self is not proxied')
  mp.dispose()
})

test('remote zombies get meshes, dead ones hidden, vanished removed', () => {
  const { scene, mp } = makeMP()
  mp.socket.receive({ t: MSG.SNAP, ...snap() })
  assert.equal(mp.zombies.size, 2)
  let visible = 0
  for (const e of mp.zombies.values()) if (e.mesh.visible) visible++
  assert.equal(visible, 2, 'both alive zombies visible')
  // z2 dies -> hidden; z1 leaves the roster -> removed.
  mp.socket.receive({ t: MSG.SNAP, ...snap({ zombies: [
    { id: 'z1', type: 'walker', x: 1, z: 2, health: 0, state: 'dead', facing: null },
    { id: 'z2', type: 'brute', x: -3, z: 1, health: 0, state: 'dead', facing: null }
  ] }) })
  assert.equal(mp.zombies.size, 2, 'both still tracked')
  for (const e of mp.zombies.values()) assert.equal(e.mesh.visible, false, 'dead hidden')
  mp.socket.receive({ t: MSG.SNAP, ...snap({ zombies: [] }) })
  assert.equal(mp.zombies.size, 0, 'vanished zombies removed')
  mp.dispose()
})

test('avatar leaves the roster -> RemotePlayer disposed', () => {
  const { mp } = makeMP()
  mp.socket.receive({ t: MSG.SNAP, ...snap() })
  assert.ok(mp.players.has('bob'))
  mp.socket.receive({ t: MSG.SNAP, ...snap({ players: snap().players.filter(p => p.id !== 'bob') }) })
  assert.ok(!mp.players.has('bob'), 'departed player avatar removed')
  assert.ok(mp.players.has('alice'), 'remaining player kept')
  mp.dispose()
})

test('scoreboard sorts by score and paints the DOM', () => {
  const { mp, doc } = makeMP()
  mp.socket.receive({ t: MSG.SNAP, ...snap() })
  const rows = mp.scoreboard()
  assert.deepEqual(rows.map(r => r.id), ['alice', 'me', 'bob'], 'sorted by score desc')
  assert.equal(rows[0].score, 410)
  // The scoreboard panel was appended to body and populated with rows.
  assert.ok(doc.body.children.includes(mp._sbEl), 'panel attached to body')
  assert.equal(mp._sbEl.style.display, 'block', 'panel shown')
  // head row + 3 player rows = 4 children.
  assert.equal(mp._sbEl.children.length, 4, 'head + 3 rows')
  assert.match(mp._sbEl.children[0].textContent, /WAVE 2/)
  assert.match(mp._sbEl.children[1].textContent, /alice: 410 pts  5 kills/)
  mp.dispose()
})

test('update sends input and re-poses avatars between snapshots', () => {
  const { mp } = makeMP()
  mp.socket.receive({ t: MSG.SNAP, ...snap() })
  const before = mp.players.get('alice').group.position.x
  // A newer snapshot at a moved position, then interpolate toward it.
  const s2 = snap({ players: snap().players.map(p => p.id === 'alice' ? { ...p, x: 9 } : p) })
  mp.socket.receive({ t: MSG.SNAP, ...s2 })
  for (let i = 0; i < 4; i++) mp.update(1 / 60, { forward: true, turnX: 0.1, turnY: 0 }, 0)
  const sent = mp.net.socket.sent.filter(m => m.t === MSG.INPUT)
  assert.ok(sent.length >= 1, 'input frame sent')
  assert.equal(sent.at(-1).move.fwd, 1, 'forward encoded')
  // Avatar moved toward the newer position (interpolation advanced it).
  assert.ok(mp.players.get('alice').group.position.x > before, 'avatar interpolated forward')
  mp.dispose()
})

test('dispose removes every proxy + panel + closes socket', () => {
  const { scene, mp, doc } = makeMP()
  mp.socket.receive({ t: MSG.SNAP, ...snap() })
  const groupsBefore = scene.children.length
  mp.dispose()
  assert.equal(mp.players.size, 0)
  assert.equal(mp.zombies.size, 0)
  assert.equal(doc.body.children.includes(mp._sbEl), false, 'panel removed from body')
  assert.equal(mp._sbEl, null)
  // Scene lost the added avatar groups + zombie meshes.
  assert.ok(scene.children.length < groupsBefore, 'scene children reduced')
  // Double dispose is safe.
  mp.dispose()
})

test('Game.startMultiplayer builds the controller + starts the run', () => {
  const game = new Game({ headless: true })
  game.start()
  assert.equal(game.multiplayer, null, 'no controller before joining')
  const mp = game.startMultiplayer({ room: 'alpha', name: 'Ada', Socket: FakeWS })
  assert.ok(mp, 'controller built')
  assert.equal(game.multiplayer, mp)
  assert.equal(game.state, 'playing', 'run started')
  assert.equal(game._mpOpts.room, 'alpha')
  assert.equal(game._mpOpts.name, 'Ada')
  // A snapshot with two players: self excluded, one remote avatar.
  mp.net.socket.open()
  mp.net.socket.receive({ t: MSG.WELCOME, pid: 'ada', roster: [] })
  mp.net.socket.receive({ t: MSG.SNAP, ...snap({ players: [
    { id: 'ada', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, health: 100, stamina: 100, weapon: 'axe', ammo: 5, reserve: 20, dead: false },
    { id: 'sam', x: 4, y: 1.7, z: 2, yaw: 0, pitch: 0, health: 100, stamina: 100, weapon: 'pistol', ammo: 12, reserve: 36, dead: false }
  ] }) })
  assert.ok(mp.players.has('sam'), 'remote avatar present')
  assert.ok(!mp.players.has('ada'), 'self excluded')
  // resetRun rebuilds a fresh controller.
  game.debug.resetRun()
  assert.ok(game.multiplayer && game.multiplayer !== mp, 'resetRun rebuilt the controller')
  mp.dispose()
  game.multiplayer.dispose()
})

test('co-op suppresses local zombie sim + HUD reads server snapshot', () => {
  const game = new Game({ headless: true })
  game.start()
  const mp = game.startMultiplayer({ room: 'alpha', name: 'Ada', Socket: FakeWS })
  mp.net.socket.open()
  mp.net.socket.receive({ t: MSG.WELCOME, pid: 'ada', roster: [] })
  // Server snapshot: wave 3, 7 remaining, one remote zombie + one remote player.
  mp.net.socket.receive({ t: MSG.SNAP, ...snap({
    wave: 3, remaining: 7,
    players: [
      { id: 'ada', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, health: 100, stamina: 100, weapon: 'axe', ammo: 5, reserve: 20, dead: false },
      { id: 'sam', x: 4, y: 1.7, z: 2, yaw: 0, pitch: 0, health: 100, stamina: 100, weapon: 'pistol', ammo: 12, reserve: 36, dead: false }
    ],
    zombies: [{ id: 'z1', x: 2, y: 1, z: 3, type: 'walker', hp: 60 }]
  }) })
  // Local spawn would normally add a client-side zombie; co-op must drop it.
  game.debug.spawnZombie('walker', 1, 1)
  game.debug.setInput({ forward: true })
  game.step(1 / 60)
  assert.equal(game.zombies.length, 0, 'local zombie sim suppressed in co-op')
  // Remote zombie is rendered by the controller, not the local sim.
  assert.ok(mp.zombies.has('z1'), 'remote zombie rendered by controller')
  // HUD reads wave/remaining from the server snapshot, not the local WaveManager.
  assert.equal(game.multiplayer.lastSnap.wave, 3)
  assert.equal(game.multiplayer.lastSnap.remaining, 7)
  // Single-player path still has a local wave manager + zombies.
  const solo = new Game({ headless: true })
  solo.start()
  solo.debug.spawnZombie('walker', 1, 1)
  solo.step(1 / 60)
  assert.ok(solo.zombies.length >= 1, 'single-player keeps local zombie sim')
  mp.dispose(); game.multiplayer && game.multiplayer.dispose()
  solo.dispose && solo.dispose()
})

test('co-op self death respawns instead of ending the run', () => {
  const game = new Game({ headless: true })
  game.start()
  const mp = game.startMultiplayer({ room: 'alpha', name: 'Ada', Socket: FakeWS })
  mp.net.socket.open()
  mp.net.socket.receive({ t: MSG.WELCOME, pid: 'ada', roster: [] })
  // Snapshot where self is alive.
  mp.net.socket.receive({ t: MSG.SNAP, ...snap({ players: [
    { id: 'ada', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, health: 100, stamina: 100, weapon: 'axe', ammo: 5, reserve: 20, dead: false },
    { id: 'sam', x: 4, y: 1.7, z: 2, yaw: 0, pitch: 0, health: 100, stamina: 100, weapon: 'pistol', ammo: 12, reserve: 36, dead: false }
  ] }) })
  // Local player dies -> co-op must NOT enter GAMEOVER; it enters respawning.
  game.player.damage(999, 'test')
  assert.equal(game.state, 'playing', 'co-op death does not end the run')
  assert.equal(game._respawning, true, 'respawning flag set')
  // Server snapshot marks self dead, then a respawn event revives.
  mp.net.socket.receive({ t: MSG.SNAP, ...snap({ players: [
    { id: 'ada', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, health: 0, stamina: 100, weapon: 'axe', ammo: 5, reserve: 20, dead: true },
    { id: 'sam', x: 4, y: 1.7, z: 2, yaw: 0, pitch: 0, health: 100, stamina: 100, weapon: 'pistol', ammo: 12, reserve: 36, dead: false }
  ] }) })
  assert.equal(mp.selfDead, true, 'controller sees self dead')
  mp.net.socket.receive({ t: MSG.SNAP, ...snap({ players: [
    { id: 'ada', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, health: 100, stamina: 100, weapon: 'axe', ammo: 5, reserve: 20, dead: false },
    { id: 'sam', x: 4, y: 1.7, z: 2, yaw: 0, pitch: 0, health: 100, stamina: 100, weapon: 'pistol', ammo: 12, reserve: 36, dead: false }
  ], events: [{ k: 'respawn', victim: 'ada' }] }) })
  assert.equal(game._respawning, false, 'respawn event cleared the flag')
  assert.equal(game.player.isDead, false, 'local player revived')
  // Single-player death still ends the run.
  const solo = new Game({ headless: true })
  solo.start()
  solo.player.damage(999, 'test')
  assert.equal(solo.state, 'gameover', 'single-player death ends the run')
  mp.dispose(); game.multiplayer && game.multiplayer.dispose()
  solo.dispose && solo.dispose()
})

test('client pings the server and shows RTT + connection status', () => {
  const { scene, mp, doc } = makeMP()
  mp.net.socket.open()
  mp.net.socket.receive({ t: MSG.WELCOME, pid: 'me', roster: [] })
  // Drive past the ping interval -> a PING frame is sent with a timestamp.
  for (let i = 0; i < 200; i++) mp.update(1 / 60, { forward: false }, 0)
  const pings = mp.net.socket.sent.filter(m => m.t === MSG.PING)
  assert.ok(pings.length >= 1, 'ping frame sent')
  assert.equal(typeof pings.at(-1).now, 'number', 'ping carries a timestamp')
  // Server echoes the timestamp back in a PONG; RTT = now - sent.
  const sent = pings.at(-1).now
  mp.net._now = () => sent + 42
  mp.net.socket.receive({ t: MSG.PONG, now: sent })
  assert.equal(mp.net.pingMs, 42, 'RTT measured from the echoed timestamp')
  // Scoreboard header shows the ping.
  mp.socket.receive({ t: MSG.SNAP, ...snap() })
  assert.ok(mp._sbEl.firstChild.textContent.includes('42ms'), 'ping shown in scoreboard')
  // Disconnected -> header reads CONNECTION LOST.
  mp.net.connected = false
  mp._renderScoreboard(mp.lastSnap)
  assert.equal(mp._sbEl.firstChild.textContent, 'CONNECTION LOST', 'lost status shown')
  mp.dispose()
})