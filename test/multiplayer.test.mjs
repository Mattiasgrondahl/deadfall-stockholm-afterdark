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
      { id: 'me', name: 'me', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, health: 100, stamina: 100, weapon: 'axe', ammo: 5, reserve: 20, dead: false },
      { id: 'alice', name: 'Alice', x: 3, y: 1.7, z: 4, yaw: 1, pitch: 0, health: 90, stamina: 80, weapon: 'shotgun', ammo: 4, reserve: 20, dead: false },
      { id: 'bob', name: 'Bob', x: -2, y: 1.7, z: 6, yaw: 2, pitch: 0, health: 70, stamina: 60, weapon: 'pistol', ammo: 12, reserve: 36, dead: false }
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

test('remote zombies get bodies, dead ones collapse, vanished removed', () => {
  const { scene, mp } = makeMP()
  mp.socket.receive({ t: MSG.SNAP, ...snap() })
  assert.equal(mp.zombies.size, 2)
  let visible = 0
  for (const e of mp.zombies.values()) if (e.group && e.group.visible) visible++
  assert.equal(visible, 2, 'both alive zombies visible')
  // Both die -> still tracked (collapsing corpse), not instantly hidden.
  mp.socket.receive({ t: MSG.SNAP, ...snap({ zombies: [
    { id: 'z1', type: 'walker', x: 1, z: 2, health: 0, state: 'dead', facing: null },
    { id: 'z2', type: 'brute', x: -3, z: 1, health: 0, state: 'dead', facing: null }
  ] }) })
  assert.equal(mp.zombies.size, 2, 'both still tracked while collapsing')
  for (const e of mp.zombies.values()) assert.equal(e.isDead, true, 'dead corpse begins collapse')
  // After the linger window the corpse expires and is dropped from the map.
  for (let i = 0; i < 420; i++) mp.update(1 / 60)
  assert.equal(mp.zombies.size, 0, 'corpses removed after lingering')
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
  assert.equal(rows[0].name, 'Alice', 'row carries the display name (v7)')
  // The scoreboard panel was appended to body and populated with rows.
  assert.ok(doc.body.children.includes(mp._sbEl), 'panel attached to body')
  assert.equal(mp._sbEl.style.display, 'block', 'panel shown')
  // v12: each player row is followed by its health bar, so head + count +
  // (row + bar) x 3 = 8 children.
  assert.equal(mp._sbEl.children.length, 8, 'head + count + 3 rows + 3 health bars')
  assert.match(mp._sbEl.children[0].textContent, /WAVE 2/)
  assert.match(mp._sbEl.children[1].textContent, /PLAYERS 3/, 'online-player count line (v7)')
  assert.match(mp._sbEl.children[2].textContent, /Alice: 410 pts  5 kills/, 'rows labelled by name (v7)')
  // v12: the node after each row is its health bar, with a fill sized to health.
  const bar = mp._sbEl.children[3]
  assert.equal(bar.className, 'mp-hp', 'health bar node after the row')
  assert.equal(bar.children.length, 1, 'bar holds a single fill')
  assert.equal(bar.children[0].className, 'mp-hp-fill', 'fill node class')
  assert.equal(bar.children[0].style.width, '90%', 'fill sized to Alice health 90')
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

test('co-op applies the server-authoritative health to the local player (can die)', () => {
  const game = new Game({ headless: true })
  game.start()
  const mp = game.startMultiplayer({ room: 'alpha', name: 'Ada', Socket: FakeWS })
  mp.net.socket.open()
  mp.net.socket.receive({ t: MSG.WELCOME, pid: 'ada', roster: [] })
  // The client runs an empty local horde, so nothing damages the local player
  // on the client — the snapshot health is the only source of truth. A snapshot
  // that reports the player hurt must drop the local HUD health.
  mp.net.socket.receive({ t: MSG.SNAP, ...snap({ players: [
    { id: 'ada', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, health: 40, stamina: 55, weapon: 'axe', ammo: 5, reserve: 20, dead: false },
    { id: 'sam', x: 4, y: 1.7, z: 2, yaw: 0, pitch: 0, health: 100, stamina: 100, weapon: 'pistol', ammo: 12, reserve: 36, dead: false }
  ] }) })
  game.step(1 / 60)
  assert.equal(game.player.health, 40, 'local player health synced from the snapshot')
  assert.equal(game.player.stamina, 55, 'stamina synced too')
  assert.equal(game.player.isDead, false, 'still alive at 40 hp')
  // A lethal snapshot flips the local player to dead and triggers the respawn
  // banner — the co-op death path the bug report said was impossible.
  mp.net.socket.receive({ t: MSG.SNAP, ...snap({ players: [
    { id: 'ada', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, health: 0, stamina: 100, weapon: 'axe', ammo: 5, reserve: 20, dead: true },
    { id: 'sam', x: 4, y: 1.7, z: 2, yaw: 0, pitch: 0, health: 100, stamina: 100, weapon: 'pistol', ammo: 12, reserve: 36, dead: false }
  ] }) })
  game.step(1 / 60)
  assert.equal(game.player.health, 0, 'lethal snapshot zeroes local health')
  assert.equal(game.player.isDead, true, 'local player is dead')
  assert.equal(game.state, 'playing', 'co-op death does not end the run')
  assert.equal(game._respawning, true, 'respawn banner flow engaged')
  mp.dispose(); game.multiplayer && game.multiplayer.dispose()
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

test('remote zombies are hit-testable targets; a hit sends authoritative HIT + predicts death', () => {
  const { mp } = makeMP()
  mp.socket.receive({ t: MSG.SNAP, ...snap() })
  const targets = mp.getTargets()
  assert.equal(targets.length, 2, 'two live remote zombies exposed as targets')
  const z1 = targets.find((t) => t._id === 'z1')
  assert.ok(z1, 'z1 proxy present')
  const boxes = z1.getHitboxes()
  assert.equal(boxes.length, 2, 'torso + head hitboxes')
  assert.equal(boxes[1].isHead, true, 'second sphere is the head')
  assert.equal(boxes[1].center.y, 1.8, 'head hitbox at y 1.8 (matches server)')
  assert.equal(boxes[0].center.y, 1.2, 'torso hitbox at y 1.2')
  // A hit sends an authoritative HIT message to the server and client-predicts.
  mp.socket.sent.length = 0
  z1.damage(60, null, 'me', false)
  const hit = mp.socket.sent.find((m) => m.t === MSG.HIT)
  assert.ok(hit, 'HIT message sent to the server')
  assert.equal(hit.victim, 'z1', 'HIT targets z1')
  assert.equal(hit.dmg, 60, 'HIT carries the damage')
  assert.equal(hit.head, false, 'body hit flagged not-head')
  assert.equal(z1.isDead, false, 'z1 survives a 60/100 hit')
  // A fatal headshot flips the proxy dead immediately (client prediction).
  z1.damage(60, null, 'me', true)
  assert.equal(z1.isDead, true, 'fatal hit client-predicts death')
  // Dead zombies drop out of the target list.
  assert.equal(mp.getTargets().find((t) => t._id === 'z1'), undefined, 'dead zombie no longer a target')
  mp.dispose()
})

test('remote zombie bodies have face + hair + eyes and mirror server limb loss', () => {
  const { mp } = makeMP()
  mp.socket.receive({ t: MSG.SNAP, ...snap() })
  const e = mp.zombies.get('z1')
  assert.ok(e._face, 'remote body has a face')
  assert.ok(e._hair, 'remote body has hair')
  assert.equal(e._eyes.length, 2, 'remote body has two eyes')
  // v3 T10: a live remote body is grounded — the group origin sits at the ground
  // plane (feet at y 0), never floating above it like the old primitive box.
  assert.equal(e.group.position.y, 0, 'live remote zombie feet sit on the ground (y 0)')
  // Snapshot limb loss severs the matching limbs + spawns a falling piece.
  const before = e._falling.length
  mp.socket.receive({ t: MSG.SNAP, ...snap({ zombies: [
    { id: 'z1', type: 'walker', x: 1, z: 2, health: 60, state: 'chase', facing: 0, limbs: { arms: 1, legs: 0, head: 0 } },
    { id: 'z2', type: 'brute', x: -3, z: 1, health: 300, state: 'chase', facing: 1, limbs: { arms: 0, legs: 0, head: 0 } }
  ] }) })
  assert.equal(e._armL.visible, false, 'left arm severed by snapshot')
  assert.equal(e._falling.length, before + 1, 'severed arm spawned a falling piece')
  // A decapitate (head:1) detaches the head + face + hair.
  mp.socket.receive({ t: MSG.SNAP, ...snap({ zombies: [
    { id: 'z1', type: 'walker', x: 1, z: 2, health: 60, state: 'chase', facing: 0, limbs: { arms: 1, legs: 0, head: 1 } },
    { id: 'z2', type: 'brute', x: -3, z: 1, health: 300, state: 'chase', facing: 1, limbs: { arms: 0, legs: 0, head: 0 } }
  ] }) })
  assert.equal(e._head.visible, false, 'head detached by decapitate')
  assert.equal(e._face.visible, false, 'face detached with the head')
  mp.dispose()
})

test('proxy sever geometry matches the server Zombie (round-60 radius 0.416)', () => {
  // The client prediction must sever on exactly the impacts the server-side
  // Zombie severs: a dead-centre torso hit (0.417 m from the arm sockets)
  // severs nothing, while a chest-aim impact that clips an arm severs it.
  // Stale 0.3/0.34 radii made the proxy sever LESS than the server, so the
  // client kept showing a limb the server had already dropped.
  const { mp } = makeMP()
  mp.socket.receive({ t: MSG.SNAP, ...snap() })
  const e = mp.zombies.get('z1')
  const proxy = e.getTarget() // lazily built weapon-hit proxy
  // Dead-centre torso hit at z1's position: no sever (margin 0.000944).
  assert.equal(proxy.hitLimbAt(1, 1.2, 2), null, 'torso-centre hit severs nothing')
  assert.equal(e._limbs.arms, 0, 'no arm lost from the torso hit')
  // Impact 0.42 m from the left arm socket (a chest-aim clip): severs the arm.
  // The proxy severs AND counts the round inside hitLimbAt (its own mirror of
  // the chain — the server's authoritative limbs re-sync the counter).
  assert.equal(proxy.hitLimbAt(1 - 0.34, 1.42, 2 + 0.25), 'arm', 'clip near left arm severs it')
  assert.equal(e._armL.visible, false, 'left arm hidden by the prediction')
  assert.equal(e._limbs.arms, 1, 'arm count advanced')
  assert.equal(e._falling.length >= 1, true, 'severed arm spawned a falling piece')
  assert.equal(e._chainShots, 1, 'sever advanced the chain counter')
  mp.dispose()
})

test('remote zombie corpse collapses then expires after lingering', () => {
  const { mp } = makeMP()
  mp.socket.receive({ t: MSG.SNAP, ...snap() })
  const e = mp.zombies.get('z1')
  // Kill it via the snapshot.
  mp.socket.receive({ t: MSG.SNAP, ...snap({ zombies: [
    { id: 'z1', type: 'walker', x: 1, z: 2, health: 0, state: 'dead', facing: null },
    { id: 'z2', type: 'brute', x: -3, z: 1, health: 300, state: 'chase', facing: 1 }
  ] }) })
  assert.equal(e.isDead, true, 'snapshot death begins collapse')
  // After ~1.5 s the corpse has flopped over (rotation.x negative).
  for (let i = 0; i < 90; i++) mp.update(1 / 60)
  assert.ok(e.group.rotation.x < -0.5, 'corpse flops over as it dies')
  assert.ok(e.group.position.y < 0, 'corpse sinks toward the ground')
  // After the linger window it expires and is dropped from the map.
  for (let i = 0; i < 360; i++) mp.update(1 / 60)
  assert.equal(mp.zombies.has('z1'), false, 'expired corpse removed')
  mp.dispose()
})

test('snapshot limb-state oscillation does not leak falling pieces (freeze fix)', () => {
  const { mp } = makeMP()
  // Stream snapshots that flip z1's arm severance on/off repeatedly (the server
  // aim may disagree with the client prediction). Severing is one-way, so the
  // arm must spawn exactly one falling piece and never re-spawn.
  for (let i = 0; i < 40; i++) {
    const arms = i % 2 === 0 ? 1 : 0
    mp.socket.receive({ t: MSG.SNAP, ...snap({ zombies: [
      { id: 'z1', type: 'walker', x: 1, z: 2, health: 60, state: 'chase', facing: 0, limbs: { arms, legs: 0, head: 0 } },
      { id: 'z2', type: 'brute', x: -3, z: 1, health: 300, state: 'chase', facing: 1, limbs: { arms: 0, legs: 0, head: 0 } }
    ] }) })
  }
  const e = mp.zombies.get('z1')
  assert.equal(e._falling.length, 1, 'exactly one falling arm despite 40 toggles')
  assert.equal(e._armL.visible, false, 'severed arm stays hidden')
  mp.dispose()
})

test('remote target exposes position + knockback + shotgunArmor (melee-safe)', () => {
  const { mp } = makeMP()
  mp.socket.receive({ t: MSG.SNAP, ...snap() })
  const t = mp.getTargets().find((q) => q._id === 'z1')
  t.getHitboxes() // refreshes the live position for melee range checks
  assert.ok(t.position && typeof t.position.x === 'number', 'proxy exposes a numeric position')
  assert.equal(t.position.x, 1, 'position.x tracks the snapshot')
  assert.equal(t.position.z, 2, 'position.z tracks the snapshot')
  assert.equal(typeof t.knockback, 'function', 'proxy exposes knockback (no-op)')
  assert.doesNotThrow(() => t.knockback(1, 1, 5), 'knockback is callable')
  const b = mp.getTargets().find((q) => q._id === 'z2')
  assert.equal(b.shotgunArmor, 0.4, 'brute proxy carries brute shotgun armor')
  assert.equal(t.shotgunArmor, 1, 'walker proxy carries walker armor')
  mp.dispose()
})

test('v12: kill feed renders recent kills with killer names and headshot flags', () => {
  const { mp, doc } = makeMP()
  mp.socket.receive({ t: MSG.SNAP, ...snap() })
  // A body kill by alice and a headshot kill by bob (server kill events).
  mp.socket.receive({ t: MSG.SNAP, ...snap({ events: [
    { k: 'kill', victim: 'z1', by: 'alice', type: 'walker', head: false },
    { k: 'kill', victim: 'z2', by: 'bob', type: 'brute', head: true }
  ] }) })
  assert.deepEqual(mp._killFeed, ['Bob ▸ PLAYER (HEAD)', 'Alice ▸ PLAYER'], 'most-recent first, headshot flagged')
  const feed = mp._sbEl.children.find((c) => c.className === 'mp-killfeed')
  assert.ok(feed, 'kill feed node painted')
  assert.deepEqual(feed.children.map((c) => c.textContent), mp._killFeed, 'feed lines rendered in order')
  // A player death event renders as "<victim> DIED" (no killer credited).
  mp.socket.receive({ t: MSG.SNAP, ...snap({ events: [{ k: 'death', victim: 'bob', by: null }] }) })
  // v12: death events are not kill events — the feed only tracks kills.
  assert.equal(mp._killFeed[0], 'Bob ▸ PLAYER (HEAD)', 'death event did not pollute the kill feed')
  // The feed is capped at 5 lines, most-recent first.
  for (let i = 0; i < 8; i++) {
    mp.socket.receive({ t: MSG.SNAP, ...snap({ events: [{ k: 'kill', victim: 'z1', by: 'me', type: 'walker', head: false }] }) })
  }
  assert.equal(mp._killFeed.length, 5, 'feed capped at 5')
  mp.dispose()
})

test('v12: scoreboard rows paint per-player health bars (dead players show empty)', () => {
  const { mp } = makeMP()
  mp.socket.receive({ t: MSG.SNAP, ...snap({ players: [
    { id: 'me', name: 'me', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, health: 100, stamina: 100, weapon: 'axe', ammo: 5, reserve: 20, dead: false },
    { id: 'alice', name: 'Alice', x: 3, y: 1.7, z: 4, yaw: 1, pitch: 0, health: 20, stamina: 80, weapon: 'shotgun', ammo: 4, reserve: 20, dead: false },
    { id: 'bob', name: 'Bob', x: -2, y: 1.7, z: 6, yaw: 2, pitch: 0, health: 0, stamina: 60, weapon: 'pistol', ammo: 12, reserve: 36, dead: true }
  ] }) })
  const bars = mp._sbEl.children.filter((c) => c.className === 'mp-hp')
  assert.equal(bars.length, 3, 'one health bar per row')
  // Rows are sorted by score desc: alice (410), me (200), bob (60).
  assert.equal(bars[0].children[0].style.width, '20%', 'alice bar sized to 20 hp')
  assert.equal(bars[0].children[0].style.background, '#c0392b', 'critical health (<25%) paints red')
  assert.equal(bars[1].children[0].style.width, '100%', 'self bar full')
  assert.equal(bars[2].children[0].style.width, '0%', 'dead player shows an empty bar')
  assert.equal(bars[2].children[0].style.background, '#7a2b2b', 'dead bar paints dark red')
  mp.dispose()
})

test('v12: matchEnd snapshot ends the co-op run and shows the game-over screen', async () => {
  const prevFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ best: 0, top: [] }) })
  try {
    const game = new Game({ headless: true })
    game.start()
    const mp = game.startMultiplayer({ room: 'alpha', name: 'Ada', Socket: FakeWS })
    mp.net.socket.open()
    mp.net.socket.receive({ t: MSG.WELCOME, pid: 'ada', roster: [] })
    mp.net.socket.receive({ t: MSG.SNAP, ...snap({ wave: 5, players: [
      { id: 'ada', name: 'Ada', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, health: 100, stamina: 100, weapon: 'axe', ammo: 5, reserve: 20, dead: false },
      { id: 'sam', name: 'Sam', x: 4, y: 1.7, z: 2, yaw: 0, pitch: 0, health: 100, stamina: 100, weapon: 'pistol', ammo: 12, reserve: 36, dead: false }
    ] }) })
    assert.equal(game.state, 'playing', 'still playing before the match ends')
    game.kills = 7
    game.score.value = 500
    mp.net.socket.receive({ t: MSG.SNAP, ...snap({ wave: 5, events: [
      { k: 'matchEnd', reason: 'waves', scoreboard: [
        { id: 'sam', name: 'Sam', score: 800, kills: 11 },
        { id: 'ada', name: 'Ada', score: 500, kills: 7 }
      ] }
    ] }) })
    assert.equal(mp.matchEnded, true, 'controller latched the match end')
    assert.equal(mp.endReason, 'waves', 'end reason surfaced')
    assert.equal(mp.finalScoreboard.length, 2, 'final scoreboard captured')
    assert.equal(game.state, 'gameover', 'co-op run stopped on the server match end')
    // The wave shown on the end screen is the server-authoritative one.
    assert.equal(game.multiplayer.lastSnap.wave, 5, 'end screen wave comes from the snapshot')
    // A second matchEnd event must not re-fire the hook (one-shot latch).
    let calls = 0
    mp.onMatchEnd = () => { calls++ }
    mp.net.socket.receive({ t: MSG.SNAP, ...snap({ events: [{ k: 'matchEnd', reason: 'timecap', scoreboard: [] }] }) })
    assert.equal(calls, 0, 'match end fires exactly once')
    await game.score.submitRun()
    mp.dispose(); game.multiplayer && game.multiplayer.dispose()
    game.dispose && game.dispose()
  } finally {
    if (prevFetch === undefined) delete globalThis.fetch
    else globalThis.fetch = prevFetch
  }
})

test('v4 friendly fire: getPlayers exposes teammate proxies that send MSG.FF on damage', () => {
  const { mp } = makeMP()
  mp.socket.receive({ t: MSG.SNAP, ...snap() })
  const players = mp.getPlayers()
  assert.equal(players.length, 2, 'two teammates (self excluded)')
  const alice = players.find((p) => p.id === 'alice')
  assert.ok(alice, 'alice proxied')
  assert.equal(alice.isDead, false)
  assert.ok(alice.getHitboxes().length === 2, 'torso + head hitboxes')
  assert.equal(alice.getHitboxes().find((h) => h.isHead).isHead, true, 'head hitbox flagged')
  // No-op zombie-only surface so the weapon hit loop never misfires on a player.
  assert.equal(alice.hitLimbAt(0, 0, 0), null, 'no severable limbs')
  assert.equal(typeof alice._chainShot, 'function', 'chain shot is a no-op fn')
  alice._chainShot(1)
  alice.knockback(1, 1, 5)
  // A confirmed hit sends an authoritative friendly-fire message to the server.
  mp.socket.sent.length = 0
  alice.damage(40)
  const ff = mp.socket.sent.filter((m) => m.t === MSG.FF)
  assert.equal(ff.length, 1, 'one FF message sent')
  assert.equal(ff[0].victim, 'alice')
  assert.equal(ff[0].dmg, 40, 'raw damage forwarded (server scales it)')
  // A dead teammate is not offered as a target.
  mp.socket.receive({ t: MSG.SNAP, ...snap({ players: [
    { id: 'me', name: 'me', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, health: 100, stamina: 100, weapon: 'axe', ammo: 5, reserve: 20, dead: false },
    { id: 'alice', name: 'Alice', x: 3, y: 1.7, z: 4, yaw: 1, pitch: 0, health: 0, stamina: 0, weapon: 'shotgun', ammo: 4, reserve: 20, dead: true },
    { id: 'bob', name: 'Bob', x: -2, y: 1.7, z: 6, yaw: 2, pitch: 0, health: 70, stamina: 60, weapon: 'pistol', ammo: 12, reserve: 36, dead: false }
  ] }) })
  assert.equal(mp.getPlayers().find((p) => p.id === 'alice'), undefined, 'dead teammate dropped')
  mp.dispose()
})

test('v4 friendly fire: a self hit event fires onSelfHit feedback', () => {
  const { mp } = makeMP()
  let hits = []
  mp.onSelfHit = (dmg, by, ff) => hits.push({ dmg, by, ff })
  mp.socket.receive({ t: MSG.SNAP, ...snap({ events: [
    { k: 'hit', victim: 'me', dmg: 14, by: 'alice', ff: true },
    { k: 'hit', victim: 'alice', dmg: 20, by: 'walker' },
  ] }) })
  assert.equal(hits.length, 1, 'only the self-targeted hit fires the hook')
  assert.equal(hits[0].dmg, 14)
  assert.equal(hits[0].by, 'alice')
  assert.equal(hits[0].ff, true, 'friendly-fire flag forwarded')
  mp.dispose()
})

test('v4 co-op: a remote zombie in the attack state plays a melee pose', () => {
  const { mp } = makeMP()
  const attackSnap = (state) => ({ t: MSG.SNAP, ...snap({ zombies: [
    { id: 'z1', type: 'walker', x: 1, z: 2, health: 100, state, facing: 0 },
    { id: 'z2', type: 'brute', x: -3, z: 1, health: 300, state: 'chase', facing: 1 }
  ] }) })
  mp.socket.receive(attackSnap('chase'))
  const e = mp.zombies.get('z1')
  const restL = e._armL.rotation.x
  // Entering the attack state kicks off a swing timer.
  mp.socket.receive(attackSnap('attack'))
  assert.equal(e._state, 'attack', 'snapshot state captured')
  assert.equal(e._wasAttacking, true, 'attack edge latched')
  // Drive the pose: arms swing away from rest + the torso leans forward.
  for (let i = 0; i < 12; i++) e.update(1 / 60)
  assert.notEqual(e._armL.rotation.x, restL, 'arm moved off rest during the swing')
  assert.ok(e.group.rotation.x > 0, 'torso leans into the lunge')
  // Leaving the attack state into `chase` hands off to the walk cycle, so the
  // arm moves again (it does NOT return to a static rest while chasing).
  mp.socket.receive(attackSnap('chase'))
  e._attackT = 0
  e.update(1 / 60)
  assert.equal(e._wasAttacking, false, 'attack edge cleared')
  // Idle (no target) eases the limbs back to rest.
  mp.socket.receive(attackSnap('idle'))
  e.update(1 / 60)
  assert.equal(e._armL.rotation.x, restL, 'arm returns to rest when idle')
  assert.equal(e.group.rotation.x, 0, 'lean resets')
  mp.dispose()
})

test('v4 co-op: a chasing remote zombie plays a walk cycle (legs swing, body bobs)', () => {
  const { mp } = makeMP()
  const chaseSnap = { t: MSG.SNAP, ...snap({ zombies: [
    { id: 'z1', type: 'walker', x: 1, z: 2, health: 100, state: 'chase', facing: 0 }
  ] }) }
  mp.socket.receive(chaseSnap)
  const e = mp.zombies.get('z1')
  assert.equal(e._chasing, true, 'chase state drives the walk flag')
  const restLeg = e._legL.rotation.x
  // Drive several frames: the legs must swing off rest and the body must bob.
  let legMoved = false, bobbed = false
  for (let i = 0; i < 20; i++) {
    e.update(1 / 60)
    if (e._legL.rotation.x !== restLeg) legMoved = true
    if (e.group.rotation.x !== 0) bobbed = true
  }
  assert.ok(legMoved, 'legs swing while chasing (no rigid slide)')
  assert.ok(bobbed, 'body bobs while chasing')
  // Arms counter-swing the legs (opposite signs) while chasing.
  assert.notEqual(e._armL.rotation.x, e._armRest.l, 'arm left the rest pose while walking')
  // Idle stops the gait: limbs ease back to rest.
  mp.socket.receive({ t: MSG.SNAP, ...snap({ zombies: [
    { id: 'z1', type: 'walker', x: 1, z: 2, health: 100, state: 'idle', facing: 0 }
  ] }) })
  e.update(1 / 60)
  assert.equal(e._legL.rotation.x, 0, 'legs return to rest when idle')
  assert.equal(e.group.rotation.x, 0, 'bob resets when idle')
  mp.dispose()
})