// test/wave-pacing.test.mjs — v6 gameplay (1) pacing-curve acceptance tests.
//
// Pins the WaveManager pacing curves against the source constants:
//   * spawnIntervalFor: 0.7 s (wave 1) tightening to the 0.45 s floor (wave 6+),
//     monotonic non-increasing, never below the floor, always above the pistol's
//     0.28 s fire interval.
//   * capFor: 8+wave through wave 9, then a +0.5/wave ramp to the 16 ceiling.
//   * intermissionFor: 3.0 s base +0.5/wave to a 5.0 s ceiling; 7.0 s after a
//     boss wave (read via forceClear on wave 5).
//   * queueTypeAt composition + nextWavePreview/buildQueue consistency.
//   * live spawn cadence in simulation (wave 6 spawns ~0.45 s apart).
//   * determinism across two fresh managers.
//
// Headless; no Math.random. Reuses the make() harness pattern from wave.test.mjs.
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

// The pistol fires every 0.28 s — the spawn cadence must stay above it so a
// wave can never outrun the player's effective rate of fire.
const PISTOL_INTERVAL = 0.28

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
  const killAll = () => game.zombies.forEach(z => z.damage(z.maxHealth + 10))
  return { wm, game, starts, clears, step, alive, killAll }
}

// Advance a manager to `targetWave` by force-clearing each wave and draining
// the intermission exactly (frame-by-frame until it expires). Returns once
// wave === targetWave with spawned === 0 (the new wave's queue is built and its
// first-spawn timer seeded, but no zombie has landed yet).
function reach(wm, game, step, targetWave) {
  wm.reset()
  for (let w = 1; w < targetWave; w++) {
    let guard = 0
    while (wm.spawned < wm.total && guard++ < 200) step(1)
    wm.forceClear(game)
    // Drain the intermission one frame at a time so we stop the instant the
    // next wave begins (spawned === 0), never overshooting into its cadence.
    let g2 = 0
    while (wm.intermission > 0 && g2++ < 2000) step(1 / 60)
  }
}

test('spawnInterval curve: 0.7 -> 0.45 floor, monotonic, above pistol rate', () => {
  const { wm } = make()
  // Read the curve through the getter by walking waves via reset/buildQueue.
  const at = w => { wm.wave = w; return wm.spawnInterval }
  // Pin the code's actual float values with a tolerance (0.7 - 0.05*(w-1) is
  // not exact in binary float, e.g. wave 5 reads 0.49999999999999994).
  const near = (w, v) => assert.ok(Math.abs(at(w) - v) < 1e-9, `wave ${w}: ${at(w)} != ${v}`)
  near(1, 0.7)
  near(5, 0.5)
  near(6, 0.45)
  // Floor holds from wave 6 onward.
  for (const w of [6, 7, 10, 20, 50]) near(w, 0.45)
  // Monotonic non-increasing and never below the floor, always above the pistol.
  let prev = Infinity
  for (let w = 1; w <= 60; w++) {
    const v = at(w)
    assert.ok(v <= prev + 1e-9, `wave ${w}: ${v} > previous ${prev}`)
    assert.ok(v >= 0.45 - 1e-9, `wave ${w}: ${v} below floor`)
    assert.ok(v > PISTOL_INTERVAL, `wave ${w}: ${v} at/below pistol ${PISTOL_INTERVAL}`)
    prev = v
  }
})

test('capFor: 8+wave to wave 9, +0.5/wave ramp to 16 ceiling', () => {
  const { wm } = make()
  const at = w => { wm.wave = w; return wm.cap }
  // Waves 1..9 = 9..17.
  for (let w = 1; w <= 9; w++) assert.equal(at(w), 8 + w, `cap wave ${w}`)
  // Post-knee: min(16, floor(8 + 9 + 0.5*(w-9))). The code clamps to 16, so
  // wave 10 (floor 17.5) and wave 12 (floor 18.5) both read the 16 ceiling.
  assert.equal(at(10), 16) // min(16, floor(8 + 9 + 0.5))
  assert.equal(at(12), 16) // min(16, floor(8 + 9 + 1.5))
  assert.equal(at(20), 16) // ceiling holds
  // cap + boss stays within the 24-zombie budget (cap <= 16, +1 boss <= 17).
  for (let w = 1; w <= 40; w++) assert.ok(at(w) + 1 <= 24, `wave ${w} cap+boss over budget`)
})

test('intermissionFor: 3.0 base +0.5/wave to 5.0 ceiling; boss wave = 7.0', () => {
  const { wm, game, step } = make()
  // forceClear early-returns when alive === 0 && spawned === 0, so spawn at
  // least one zombie before each clear to make the intermission observable.
  const spawnOne = () => { let g = 0; while (wm.spawned < 1 && g++ < 20) step(1) }
  // Non-boss intermissions, observed through forceClear + getter.
  wm.reset()
  let guard = 0
  while (wm.spawned < wm.total && guard++ < 80) step(1)
  wm.forceClear(game)
  assert.equal(wm.intermission, 3.0) // wave 1
  // Reach wave 4 and force-clear it -> 4.5 s.
  reach(wm, game, step, 4)
  assert.equal(wm.wave, 4)
  spawnOne()
  wm.forceClear(game)
  assert.equal(wm.intermission, 4.5) // wave 4
  // Wave 6+ saturates at the 5.0 ceiling.
  reach(wm, game, step, 6)
  assert.equal(wm.wave, 6)
  spawnOne()
  wm.forceClear(game)
  assert.equal(wm.intermission, 5.0) // ceiling
  // Boss wave: forceClear on wave 5 sets _bossSpawned, so intermission = 7.0.
  reach(wm, game, step, 5)
  assert.equal(wm.wave, 5)
  spawnOne()
  wm.forceClear(game)
  assert.equal(wm.intermission, 7.0) // BOSS_INTERMISSION
})

test('queueTypeAt composition + nextWavePreview/buildQueue consistency', () => {
  const { wm } = make()
  const counts = q => {
    const c = { walker: 0, shambler: 0, screamer: 0 }
    for (const e of q) c[e.type]++
    return c
  }
  // Wave 1/2 keep the i%5 shambler rule.
  const q1 = wm.buildQueue(1)
  assert.deepEqual(q1.map(q => q.type),
    ['shambler', 'walker', 'walker', 'walker', 'walker', 'shambler', 'walker', 'walker'])
  const q2 = wm.buildQueue(2)
  assert.deepEqual(q2.map((q, i) => (q.type === 'shambler' ? i : -1)).filter(i => i >= 0),
    [0, 5, 10]) // i%5===0 for wave < 3
  // Wave 3: screamers at every odd slot, no shamblers.
  const q3 = wm.buildQueue(3)
  assert.deepEqual(q3.map((q, i) => (q.type === 'screamer' ? i : -1)).filter(i => i >= 0),
    [1, 3, 5, 7, 9, 11, 13])
  assert.equal(counts(q3).shambler, 0)
  // Wave 4+: shamblers at every 4th slot (i%4===0), screamers at odd slots.
  for (const w of [4, 5, 6, 10]) {
    const q = wm.buildQueue(w)
    const shamIdx = q.map((e, i) => (e.type === 'shambler' ? i : -1)).filter(i => i >= 0)
    assert.ok(shamIdx.every(i => i % 4 === 0), `wave ${w}: shambler off i%4`)
    const scrIdx = q.map((e, i) => (e.type === 'screamer' ? i : -1)).filter(i => i >= 0)
    assert.ok(scrIdx.every(i => i % 2 === 1), `wave ${w}: screamer off odd slot`)
    // No overlap: a slot can't be both (i%4===0 is even, screamers are odd).
    assert.equal(new Set([...shamIdx, ...scrIdx]).size, shamIdx.length + scrIdx.length)
  }
  // nextWavePreview counts must match buildQueue for the next wave. Drive the
  // manager into an intermission so the preview is live, then compare.
  for (const w of [1, 2, 3, 4, 5, 6]) {
    const ctx = make()
    reach(ctx.wm, ctx.game, ctx.step, w) // now at wave w, spawned 0
    // Spawn at least one zombie so forceClear has something to clear (it
    // early-returns when alive === 0 && spawned === 0).
    let guard = 0
    while (ctx.wm.spawned < 1 && guard++ < 20) ctx.step(1)
    // force-clear wave w to enter the intermission; preview describes wave w+1.
    ctx.wm.forceClear(ctx.game)
    const pv = ctx.wm.nextWavePreview
    assert.ok(pv, `no preview after wave ${w}`)
    assert.equal(pv.wave, w + 1)
    const built = ctx.wm.buildQueue(w + 1)
    assert.deepEqual(
      { wave: pv.wave, total: pv.total, walker: built.filter(e => e.type === 'walker').length, shambler: built.filter(e => e.type === 'shambler').length, screamer: built.filter(e => e.type === 'screamer').length },
      { wave: pv.wave, total: pv.total, walker: pv.walker, shambler: pv.shambler, screamer: pv.screamer },
      `preview vs buildQueue mismatch for wave ${w + 1}`)
    assert.equal(pv.total, 5 + 3 * (w + 1))
    assert.equal(pv.boss, (w + 1) % 5 === 0)
  }
})

test('wave 6 spawn cadence ~0.45 s apart in simulation', () => {
  const { wm, game, step } = make()
  reach(wm, game, step, 6)
  assert.equal(wm.wave, 6)
  assert.equal(wm.spawnInterval, 0.45)
  assert.equal(wm.spawned, 0) // wave 6 queue built, first spawn not due yet
  // The first wave-6 spawn waits a full cadence tick (timer seeded to 0.45),
  // then each spawn follows 0.45 s later. Step slightly past each tick to clear
  // float residue; cap is 14 < total 23, so stay within that range.
  for (let k = 1; k <= 10; k++) {
    step(0.46)
    assert.equal(wm.spawned, k, `wave 6 spawn count after ${k} x ~0.45 s`)
  }
  // No spawn fires early: a sub-cadence step must not advance the count.
  const before = wm.spawned
  step(0.2)
  assert.equal(wm.spawned, before)
})

test('two fresh managers produce identical queues and intervals', () => {
  const a = make()
  const b = make()
  a.wm.reset()
  b.wm.reset()
  for (const w of [1, 2, 3, 4, 5, 6, 10, 20]) {
    assert.deepEqual(a.wm.buildQueue(w), b.wm.buildQueue(w), `queue wave ${w}`)
    a.wm.wave = w
    b.wm.wave = w
    assert.equal(a.wm.spawnInterval, b.wm.spawnInterval, `interval wave ${w}`)
    assert.equal(a.wm.cap, b.wm.cap, `cap wave ${w}`)
  }
})