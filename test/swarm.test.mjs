// SwarmDirector headless test — continuous neutral-zombie scheduling for CTF.
// Verifies the cadence, the carrier/nearest-player anchor bias, the concurrency
// cap, escalation with score, determinism, and dispose — all without three/DOM.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SwarmDirector } from '../src/game/SwarmDirector.js'
import { FlagState } from '../src/game/Flag.js'

function mk(over = {}) {
  const spawned = []
  const flag = over.flag || new FlagState()
  const d = new SwarmDirector({
    spawnZombie: (type, x, z) => spawned.push({ type, x, z }),
    players: over.players || (() => []),
    flag,
    liveCount: over.liveCount || (() => 0),
    bases: over.bases || { lovis: { x: -90, z: -90 }, krag: { x: 90, z: 90 } },
    rngSeed: over.rngSeed || 12345
  })
  return { d, spawned, flag }
}

test('swarm is idle until started', () => {
  const { d, spawned } = mk()
  for (let i = 0; i < 200; i++) d.update(0.05)
  assert.equal(spawned.length, 0, 'no spawns while stopped')
  d.start()
  assert.ok(d.update(0.05) >= 0)
})

test('spawns on the cadence once started', () => {
  const { d, spawned } = mk()
  d.start()
  let total = 0
  for (let i = 0; i < 200; i++) total += d.update(0.05) // 10 s
  assert.ok(spawned.length >= 2, 'at least a couple of spawns in 10 s at base interval')
  assert.equal(total, spawned.length, 'update returns the spawn count')
})

test('respects the concurrency cap', () => {
  const { d, spawned } = mk({ liveCount: () => 24 })
  d.start()
  for (let i = 0; i < 400; i++) d.update(0.05)
  assert.equal(spawned.length, 0, 'no spawns when the 24-alive budget is full')
})

test('clusters spawns near the flag carrier', () => {
  const flag = new FlagState()
  // 'a' (lovis) carries the krag flag at the krag base.
  flag.tryPickup('a', 'lovis', 90, 90)
  const players = () => [
    { id: 'a', player: { isDead: false, position: { x: 90, z: 90 } } },
    { id: 'b', player: { isDead: false, position: { x: -90, z: -90 } } }
  ]
  const { d, spawned } = mk({ flag, players })
  d.start()
  let nearCarrier = 0
  for (let i = 0; i < 600; i++) d.update(0.05)
  for (const s of spawned) if (Math.hypot(s.x - 90, s.z - 90) < 12) nearCarrier++
  assert.ok(nearCarrier > 0, 'some spawns cluster around the carrier')
})

test('interval shrinks as the match scores escalate', () => {
  const flag = new FlagState()
  const { d } = mk({ flag })
  const base = d.interval()
  flag.scores.lovis = 2; flag.scores.krag = 1
  assert.ok(d.interval() < base, 'interval compresses with total score')
  flag.scores.lovis = 3; flag.scores.krag = 3
  assert.equal(d.interval(), 1.1, 'interval floors at MIN_INTERVAL')
})

test('deterministic: same seed yields the same spawn positions', () => {
  const a = mk({ rngSeed: 999 }); const b = mk({ rngSeed: 999 })
  a.d.start(); b.d.start()
  for (let i = 0; i < 100; i++) { a.d.update(0.05); b.d.update(0.05) }
  assert.deepEqual(a.spawned, b.spawned, 'identical spawn stream for the same seed')
})

test('dispose returns to idle and stops spawning', () => {
  const { d, spawned } = mk()
  d.start()
  for (let i = 0; i < 100; i++) d.update(0.05)
  const before = spawned.length
  d.dispose()
  for (let i = 0; i < 100; i++) d.update(0.05)
  assert.equal(spawned.length, before, 'no spawns after dispose')
})