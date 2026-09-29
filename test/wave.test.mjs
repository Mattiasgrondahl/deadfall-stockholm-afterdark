// test/wave.test.mjs — WaveManager: totals/cap, cadence, queue, point safety,
// forceClear, natural clear with unspawned remainder, cap stall, determinism,
// remaining, callbacks. Headless; no Math.random.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { WaveManager } from '../src/game/WaveManager.js'
import { Zombie } from '../src/game/Zombie.js'

// City's 12 spawn points, in City.getSpawnPoints() order.
const PTS = [
  { x: 85, z: 0 }, { x: -85, z: 0 },
  { x: 0, z: -85 }, { x: 0, z: 85 },
  { x: 85, z: -85 }, { x: -85, z: -85 },
  { x: 85, z: 85 }, { x: -85, z: 85 },
  { x: 12, z: -12 }, { x: -12, z: -12 },
  { x: 12, z: 12 }, { x: -12, z: 12 }
]

function make() {
  const scene = new THREE.Scene()
  const game = {
    zombies: [],
    spawnZombie(type, x, z) {
      const zb = new Zombie(scene, type, x, z, wm.wave)
      game.zombies.push(zb)
      return zb
    }
  }
  const starts = []
  const clears = []
  const wm = new WaveManager(scene, PTS, null, null, {
    onWaveStart: w => starts.push(w),
    onWaveCleared: w => clears.push(w),
    spawnZombie: (t, x, z) => game.spawnZombie(t, x, z)
  })
  const step = s => { for (let i = 0; i < Math.round(s * 60); i++) wm.update(1 / 60, game) }
  const alive = () => game.zombies.filter(z => !z.isDead).length
  const dist = p => Math.hypot(p.x, p.z - 12) // from player at (0, 12)
  const killAll = () => game.zombies.forEach(z => z.damage(z.maxHealth + 10))
  return { wm, game, starts, clears, step, alive, dist, killAll }
}

test('totals and cap per wave', () => {
  const { wm, game, step } = make()
  wm.reset()
  assert.equal(wm.wave, 1); assert.equal(wm.total, 8); assert.equal(wm.cap, 9)
  step(1); wm.forceClear(game); step(3.6)
  assert.equal(wm.wave, 2); assert.equal(wm.total, 11); assert.equal(wm.cap, 10)
  step(1); wm.forceClear(game); step(3.6)
  assert.equal(wm.wave, 3); assert.equal(wm.total, 14); assert.equal(wm.cap, 11)
})

test('spawn cadence ~0.7 s and full wave 1', () => {
  const { wm, step, alive } = make()
  wm.reset()
  // Spawn #k lands 0.7 s after #k-1, so after k x 0.7 s exactly k have spawned.
  for (let k = 1; k <= 7; k++) {
    step(0.7)
    assert.equal(wm.spawned, k)
  }
  step(0.7)
  assert.equal(wm.spawned, 8) // wave 1 complete (5 + 3*1)
  assert.equal(alive(), 8)
  assert.ok(alive() >= 4) // S6 gate (alive >= 4 at 5 s)
})

test('queue types: W1 shamblers at 0/5, W3 screamers at odd indices', () => {
  const { wm } = make()
  const q1 = wm.buildQueue(1)
  assert.deepEqual(q1.map(q => q.type),
    ['shambler', 'walker', 'walker', 'walker', 'walker', 'shambler', 'walker', 'walker'])
  const q3 = wm.buildQueue(3)
  assert.equal(q3.length, 14)
  assert.equal(q3.filter(q => q.type === 'screamer').length, 7)
  assert.equal(q3.filter(q => q.type === 'walker').length, 7)
  assert.equal(q3.filter(q => q.type === 'shambler').length, 0)
  assert.deepEqual(q3.map((q, i) => (q.type === 'screamer' ? i : -1)).filter(i => i >= 0),
    [1, 3, 5, 7, 9, 11, 13])
})

test('spawn-point safety vs player at (0,12)', () => {
  const { wm, dist } = make()
  const q1 = wm.buildQueue(1)
  assert.ok(q1.filter(q => q.type !== 'shambler').every(q => dist(q) > 24)) // non-shambler spawns far
  const sham1 = q1.filter(q => q.type === 'shambler')
  assert.equal(sham1.length, 2)
  assert.ok(sham1.every(q => dist(q) <= 13)) // S7 speed
  const q2 = wm.buildQueue(2)
  assert.ok(q2.filter(q => q.type === 'shambler').every(q => dist(q) <= 30))
  const idx = q => PTS.findIndex(p => p.x === q.x && p.z === q.z)
  assert.deepEqual(q2.filter(q => q.type === 'walker').map(idx), [1, 2, 3, 4, 6, 7, 9, 0])
  // v6 gameplay (1): from wave 4 the shambler share (every 4th slot) grows
  // until it exceeds the 7-entry SAFE list (wave 6: 17 zombies → 5 shamblers
  // is still ≤ 7; wave 10: 35 → 9 > 7), so extra shamblers fall through to
  // the cycling path — pin that they still resolve to real city points.
  for (const w of [6, 10]) {
    const qw = wm.buildQueue(w)
    const shams = qw.filter(q => q.type === 'shambler')
    assert.ok(shams.every(q => idx(q) >= 0), `wave ${w}: every shambler on a real point`)
    if (shams.length > 7) assert.ok(shams.some(q => dist(q) > 13), `wave ${w}: overflow shamblers use far points`)
  }
})

test('forceClear kills live, discards remainder, fires no onWaveCleared', () => {
  const { wm, game, starts, clears, step, alive } = make()
  wm.reset()
  step(1)
  assert.ok(wm.spawned >= 1)
  wm.forceClear(game)
  assert.equal(alive(), 0)
  assert.equal(wm.spawned, wm.total)
  assert.equal(clears.length, 0)
  step(3.6)
  assert.equal(wm.wave, 2)
  // v6 gameplay (1): the new wave's first spawn waits a full cadence tick
  // after the intermission expires, so wave 2 opens at t=3.7, not t=3.0.
  step(0.7)
  assert.ok(wm.spawned >= 1)
  assert.deepEqual(starts, [1, 2])
  assert.equal(clears.length, 0)
})

test('natural clear fires on alive===0 with unspawned remainder (S6 case)', () => {
  const { wm, game, starts, clears, step, alive, killAll } = make()
  wm.reset()
  step(1.4)
  assert.equal(wm.spawned, 2)
  killAll()
  // v6 gameplay (1): the wave-2 intermission is 3.0 s and the new wave's first
  // spawn waits a full 0.7 s cadence tick after it expires, so the clear lands
  // at t=3.0 and the first wave-2 spawn at t=3.7.
  step(3.6)
  assert.deepEqual(clears, [1])
  assert.equal(wm.wave, 2)
  assert.deepEqual(starts, [1, 2])
  assert.equal(alive(), 0) // intermission expired, first spawn not due yet
  assert.equal(wm.spawned, 0)
  assert.equal(game.zombies.length, 2)
  assert.ok(game.zombies.slice(0, 2).every(z => z.isDead))
  step(0.7)
  assert.equal(alive(), 1) // exactly one new wave-2 spawn; 6 unspawned discarded
  assert.equal(wm.spawned, 1)
  assert.equal(game.zombies.length, 3)
  assert.ok(game.zombies.slice(0, 2).every(z => z.isDead))
})

test('concurrent cap stalls spawning; a kill frees a slot', () => {
  const { wm, game, step, alive } = make()
  wm.reset()
  step(1)
  wm.forceClear(game)
  step(3.6) // wave 2, cap 10
  let guard = 0
  while (wm.spawned < 10 && guard++ < 60) step(1)
  assert.equal(wm.spawned, 10)
  assert.equal(alive(), 10)
  step(1)
  assert.equal(wm.spawned, 10) // cap holds
  game.zombies.filter(z => !z.isDead)[0].damage(10000)
  step(1)
  assert.equal(wm.spawned, 11)
  assert.equal(wm.total, 11)
})

test('reset twice gives an identical deterministic queue', () => {
  const { wm } = make()
  wm.reset()
  const q1 = JSON.stringify(wm.queue)
  assert.equal(wm.spawned, 0)
  wm.reset()
  assert.equal(wm.wave, 1)
  assert.equal(wm.spawned, 0)
  assert.equal(JSON.stringify(wm.queue), q1)
})

test('remaining getter tracks kills to zero', () => {
  const { wm, game, step } = make()
  wm.reset()
  assert.equal(wm.remaining, 8)
  let guard = 0
  while (wm.spawned < 8 && guard++ < 60) step(1)
  assert.equal(wm.remaining, 8)
  game.zombies.filter(z => !z.isDead).slice(0, 3).forEach(z => z.damage(z.maxHealth + 10))
  step(1)
  assert.equal(wm.remaining, 5)
  game.zombies.filter(z => !z.isDead).forEach(z => z.damage(z.maxHealth + 10))
  step(1)
  assert.equal(wm.remaining, 0)
})

test('fresh reset fires onWaveStart(1) exactly once', () => {
  const { wm, starts, clears } = make()
  wm.reset()
  assert.deepEqual(starts, [1])
  assert.equal(clears.length, 0)
})

test('large waves (shambler count > SAFE.length) build a valid queue, no crash', () => {
  const { wm } = make()
  const idx = q => PTS.findIndex(p => p.x === q.x && p.z === q.z)
  for (const w of [10, 11, 12, 15, 20, 30]) {
    const q = wm.buildQueue(w)
    assert.equal(q.length, 5 + 3 * w)
    // Every spawn must resolve to a real city point (no undefined index).
    for (const e of q) assert.ok(idx(e) >= 0, `wave ${w}: ${JSON.stringify(e)} not a city point`)
    assert.ok(q.every(e => ['walker', 'shambler', 'screamer'].includes(e.type)))
    assert.deepEqual(wm.buildQueue(w), q) // deterministic
  }
})
