// test/match.test.mjs — Phase 0 (MULTIPLAYER_PLAN §9, §13): the headless
// Match (src/net/Match.js) drives the shared authoritative core
// (src/game/WorldCore.js) over scripted input sequences, with 2-player
// scenarios and no DOM. Follows existing test conventions: node:test, real
// THREE objects, fixed dt, no Math.random.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { Match, TICK } from '../src/net/Match.js'

const DT = TICK // 20 Hz server tick per the plan

function stepN(m, n) { for (let i = 0; i < n; i++) m.step(DT) }
function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z) }
function makeMatch(players = []) { return new Match({ players }) }

/** Aim a player's camera exactly at a zombie (horizontal, pitch 0). */
function aimAt(slot, z) {
  const dx = z.position.x - slot.player.position.x
  const dz = z.position.z - slot.player.position.z
  slot.player.yaw = Math.atan2(-dx, -dz) // yaw 0 faces -Z
  slot.player.pitch = 0
}

/** Switch to the pistol and arm one trigger pull; the core's step consumes
 *  both edges (switch3, then fire) on that frame. */
function pistolFire(slot, z) {
  slot.inputState.switch3 = true
  aimAt(slot, z)
  slot.inputState.fire = true
}

test('boots headless with 2 players: shared city, wave 1, clean snapshot', () => {
  const m = makeMatch([{ id: 'A', x: 12, z: 0 }, { id: 'B', x: -12, z: 0 }])
  assert.equal(typeof document, 'undefined', 'no DOM in this runtime')
  assert.equal(m.players.size, 2)
  assert.equal(m.collision.aabbs.length, 127, 'same city AABBs as the client (87 + 40 lamp AABBs)')
  assert.equal(m.spawnPoints.length, 12)
  assert.equal(m.wave.wave, 1)
  const snap = m.snapshot()
  assert.deepEqual(snap.players.map(p => p.id), ['A', 'B'])
  assert.equal(snap.wave, 1)
  assert.equal(snap.remaining, 8)
  assert.deepEqual(snap.kills, { A: 0, B: 0 })
  assert.deepEqual(snap.score, { A: 0, B: 0 })
  assert.ok(snap.events.some(e => e.k === 'waveStart' && e.wave === 1))
  for (const p of snap.players) {
    assert.equal(p.health, 100)
    assert.equal(p.weapon, 'shotgun') // default weapon
    assert.equal(p.dead, false)
  }
  // duplicate id / over-cap are rejected (cap 8 enforced)
  assert.equal(m.addPlayer('A'), null)
  for (let i = 0; i < 10; i++) m.addPlayer('X' + i)
  assert.equal(m.players.size, 8, 'playersCap 8 enforced')
})

test('two players move on independent scripted input (no DOM)', () => {
  const m = makeMatch([{ id: 'A', x: 12, z: 0 }, { id: 'B', x: 0, z: 12 }])
  const a = m.getPlayer('A'), b = m.getPlayer('B')
  assert.ok(m.collision.isWalkable(12, 0, 0.35), 'A spawn walkable')
  assert.ok(m.collision.isWalkable(0, 12, 0.35), 'B spawn walkable')
  a.inputState.forward = true  // A: walk toward -Z (yaw 0)
  b.inputState.right = true    // B: strafe toward +X (yaw 0)
  stepN(m, 60)                 // 3 s
  a.inputState.forward = false
  b.inputState.right = false
  const aDx = a.player.position.x - 12
  const aDz = a.player.position.z
  const bDx = b.player.position.x
  const bDz = b.player.position.z - 12
  // Walk speed 3.4 with the accel lerp (k=10/s) gives ~9.86 m in 3 s.
  assert.ok(Math.abs(aDx) < 0.05, `A lateral drift: ${aDx}`)
  assert.ok(aDz < -9.0 && aDz > -10.7, `A walked ~9.9 m toward -Z: ${aDz}`)
  assert.ok(Math.abs(bDz) < 0.05, `B z drift: ${bDz}`)
  assert.ok(bDx > 9.0 && bDx < 10.7, `B strafed ~9.9 m toward +X: ${bDx}`)
  assert.equal(a.player.health, 100)
  assert.equal(b.player.health, 100)
})

test('zombie targets the nearer player, then retargets when it dies', () => {
  const m = makeMatch([{ id: 'A', x: 8, z: 12 }, { id: 'B', x: -12, z: 12 }])
  const a = m.getPlayer('A').player, b = m.getPlayer('B').player
  const z = m.spawnZombie('walker', 0, 12) // on the main street, between them
  assert.ok(dist(z.position, a.position) < dist(z.position, b.position), 'setup: A is nearer')
  stepN(m, 10) // 0.5 s: chase A
  assert.ok(dist(z.position, a.position) < 8, 'closed in on A')
  assert.ok(dist(z.position, a.position) < dist(z.position, b.position), 'still nearer to A')
  const dA0 = dist(z.position, a.position), dB0 = dist(z.position, b.position)
  a.isDead = true // simulated death (the real death path is covered below)
  stepN(m, 30) // 1.5 s: retarget to B
  assert.ok(dist(z.position, b.position) < dB0, 'closes on B after retargeting')
  assert.ok(dist(z.position, a.position) > dA0, 'leaves dead A behind')
  const snap = m.snapshot()
  assert.equal(snap.zombies.find(q => q.id === z._matchId).state, 'chase')
})

test('pistol kills: per-player kill credit, score, decapitate events', () => {
  const m = makeMatch([{ id: 'A', x: 12, z: 0 }, { id: 'B', x: -12, z: 0 }])
  const a = m.getPlayer('A'), b = m.getPlayer('B')
  const za = m.spawnZombie('walker', 12, -3)  // 3 m ahead of A (headshot range)
  const zb = m.spawnZombie('walker', -12, -3) // 3 m ahead of B
  pistolFire(a, za)
  pistolFire(b, zb)
  m.step(DT) // switch + shot for each; a 3 m headshot (52 dmg) kills a 50 hp walker
  assert.ok(za.isDead, 'A killed its zombie')
  assert.ok(zb.isDead, 'B killed its zombie')
  assert.equal(m.kills.get('A'), 1)
  assert.equal(m.kills.get('B'), 1)
  assert.equal(m.score.get('A'), 60, 'walker 10 + 50 x wave 1')
  assert.equal(m.score.get('B'), 60)
  const snap = m.snapshot()
  assert.deepEqual(snap.kills, { A: 1, B: 1 })
  assert.ok(snap.events.some(e => e.k === 'decapitate' && e.by === 'A'), 'A decapitate event')
  assert.ok(snap.events.some(e => e.k === 'decapitate' && e.by === 'B'), 'B decapitate event')
  assert.ok(snap.events.some(e => e.k === 'kill' && e.by === 'A'))
  assert.ok(snap.events.some(e => e.k === 'kill' && e.by === 'B'))
})

test('melee hits damage only the targeted player (health)', () => {
  const m = makeMatch([{ id: 'A', x: 12, z: 0 }, { id: 'B', x: -12, z: 0 }])
  const a = m.getPlayer('A').player, b = m.getPlayer('B').player
  const z = m.spawnZombie('walker', 12, -1.2) // inside the 1.3 m melee range
  stepN(m, 40) // 2 s: walker melee 8, cooldown 0.9 s -> exactly 2 hits
  assert.equal(a.health, 84, 'two melee hits: 100 - 16')
  assert.equal(b.health, 100, 'B is not the target')
  assert.ok(!z.isDead, 'walker survives 16 of 50 hp')
  const hits = m.snapshot().events.filter(e => e.k === 'hit' && e.victim === 'A')
  assert.equal(hits.length, 2)
  assert.ok(hits.every(e => e.by === 'walker'))
})

test('corpses sink, then are removed about 5 s after death', () => {
  const m = makeMatch([{ id: 'A', x: 12, z: 0 }])
  const z = m.spawnZombie('walker', 12, -3)
  z.damage(1000) // debug kill (no attribution, no drop roll)
  assert.ok(z.isDead)
  m.step(DT) // death branch begins: deathTimer accumulates
  assert.equal(m.kills.get('unknown'), 1, 'unattributed kill goes to "unknown"')
  stepN(m, 79) // 80 steps total: deathTimer ~ 4 s
  assert.ok(!z.deadAndGone, 'still decaying at ~4 s')
  assert.ok(z.position.y < 0, 'corpse sinks while decaying')
  assert.ok(m.zombies.includes(z), 'corpse still present at ~4 s')
  stepN(m, 30) // 110 steps total: deathTimer > 5 -> deadAndGone -> spliced
  assert.ok(z.deadAndGone)
  assert.ok(!m.zombies.includes(z), 'corpse removed after 5 s')
})

test('ammo drops: nearest player picks up; ties go to roster order', () => {
  const m = makeMatch([{ id: 'A', x: 12, z: 0 }, { id: 'B', x: 13, z: 0 }])
  const a = m.getPlayer('A').weapon.shotgun
  const b = m.getPlayer('B').weapon.shotgun
  const place = (x) => {
    const d = { x, z: 0, t: 0, kind: 'shells', mesh: new THREE.Mesh(m.drops._geo, m.drops._shellMat) }
    d.mesh.position.set(x, 0.1, 0)
    m.scene.add(d.mesh)
    m.drops._drops.push(d)
  }
  place(12.5) // 0.5 m from both -> roster order (A first)
  place(13.5) // 0.5 m from B, 1.5 m from A -> only B in range
  const rA0 = a.reserve, rB0 = b.reserve
  m.step(DT)
  assert.equal(m.drops.count, 0, 'both drops consumed in one frame')
  assert.equal(a.reserve, rA0 + 8, 'A takes the tied drop')
  assert.equal(b.reserve, rB0 + 8, 'B takes its own drop')
  const snap = m.snapshot()
  assert.equal(snap.drops.length, 0)
  const picks = snap.events.filter(e => e.k === 'pickup')
  assert.equal(picks.length, 2)
  assert.ok(picks.some(e => e.pid === 'A'))
  assert.ok(picks.some(e => e.pid === 'B'))
})

test('wave manager drives deterministic spawns in the match', () => {
  const m = makeMatch([{ id: 'A' }]) // default spawn (0, 1.7, 12)
  stepN(m, 70) // 3.5 s
  assert.equal(m.wave.wave, 1)
  assert.equal(m.wave.spawned, 5) // 0.7 s cadence: t = 0.05, 0.75, 1.45, 2.15, 2.85
  assert.equal(m.zombies.length, 5, 'nothing killed yet')
  assert.deepEqual(m.zombies.map(z => z.type),
    ['shambler', 'walker', 'walker', 'walker', 'walker'])
  // Wave 1 queue: shamblers take the two nearest safe spawn points.
  const q = m.wave.queue
  assert.equal(q.length, 8)
  assert.deepEqual(q[0], { type: 'shambler', x: -12, z: 12 })
  assert.deepEqual(q[1], { type: 'walker', x: 85, z: 0 })
  assert.deepEqual(q[5], { type: 'shambler', x: 12, z: 12 })
  const a = m.getPlayer('A').player
  assert.equal(a.health, 100, 'shamblers are still 9+ m away after 3.5 s')
  const snap = m.snapshot()
  assert.equal(snap.wave, 1)
  assert.equal(snap.remaining, 8)
  assert.equal(snap.zombies.length, 5)
  assert.ok(snap.events.some(e => e.k === 'waveStart' && e.wave === 1))
})

test('two matches with identical scripted inputs stay bit-identical', () => {
  const mk = () => makeMatch([{ id: 'A', x: 12, z: 0 }, { id: 'B', x: -12, z: 0 }])
  const script = (m) => {
    const a = m.getPlayer('A'), b = m.getPlayer('B')
    const za = m.spawnZombie('walker', 12, -3)
    const zb = m.spawnZombie('shambler', -12, -3)
    pistolFire(a, za)
    pistolFire(b, zb)
    m.step(DT) // A's walker dies (52 >= 50); B's shambler survives at 38 hp
    assert.ok(za.isDead && !zb.isDead, 'script sanity: one kill, one survivor')
    a.inputState.forward = true
    b.inputState.right = true
    b.inputState.sprint = true
    stepN(m, 60) // 3 s: A walks -Z, B sprints +X, shambler chases B
    a.inputState.forward = false
    b.inputState.right = false
    b.inputState.sprint = false
    pistolFire(b, zb)
    stepN(m, 40) // 2 s: B's second headshot kills the shambler; then coast
    assert.ok(zb.isDead, 'script sanity: shambler dies to B')
  }
  const m1 = mk(), m2 = mk()
  script(m1)
  script(m2)
  const s1 = m1.snapshot(), s2 = m2.snapshot()
  assert.deepEqual(s1, s2, 'identical scripted inputs -> identical state (deterministic core)')
  assert.equal(s1.kills.A, 1)
  assert.equal(s1.kills.B, 1, 'B lands the killing second headshot')
  assert.equal(s1.score.A, 60, 'walker on wave 1')
  assert.equal(s1.score.B, 65, 'shambler on wave 1: 15 + 50')
})
