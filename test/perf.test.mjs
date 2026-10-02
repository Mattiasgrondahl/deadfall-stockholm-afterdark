// v37 R6 perf/housekeeping tests: the CTF per-frame hot paths no longer
// allocate (swarm / carrier / minimap reuse module scratch), the Footprints
// update is gated on a dirty flag, and the Lighting nearest-anchor sort is
// throttled. Headless; no Math.random.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { Footprints } from '../src/game/Footprints.js'
import { Lighting } from '../src/world/Lighting.js'

// --- Footprints: the update() no-op path leaves the mesh untouched when idle ---
test('v37 R6: Footprints.update skips the rewrite when the pool is idle', () => {
  const scene = new THREE.Scene()
  const fp = new Footprints(scene)
  // No prints at all: update must be a clean no-op (no throw, mesh hidden).
  fp.update(1 / 60)
  assert.equal(fp.count, 0)
  assert.equal(fp._dirty, false, 'idle pool stays clean')
  // A single print marks the pool dirty so the next update rewrites matrices.
  fp.step('p', 0, 0, 0)
  fp.step('p', 0, -0.8, 0)
  assert.equal(fp.count, 1, 'a full step emitted a print')
  assert.equal(fp._dirty, true, 'adding a print sets the dirty flag')
  fp.update(1 / 60)
  assert.equal(fp._dirty, false, 'the rewrite clears the dirty flag')
  // Run past the print lifetime: the pool empties and the flag stays clean.
  for (let i = 0; i < 60 * 7; i++) fp.update(1 / 60)
  assert.equal(fp.count, 0, 'the print faded after its life')
  assert.equal(fp._dirty, false, 'an empty pool is clean')
  // An idle frame with no live prints is a clean no-op (does not throw / re-touch).
  fp.update(1 / 60)
  assert.equal(fp.count, 0)
  fp.dispose()
})

// --- Lighting: the nearest-anchor sort is throttled, not run every frame ---
test('v37 R6: Lighting throttles the per-frame anchor sort', () => {
  const scene = new THREE.Scene()
  const anchors = []
  for (let i = 0; i < 8; i++) anchors.push({ x: i * 10, z: (i % 2) * 10, intensity: 1, color: 0xffffff, distance: 20 })
  const city = { streetlightAnchors: anchors }
  const renderer = { shadowMap: { enabled: false }, capabilities: { getMaxAnisotropy: () => 4 } }
  const light = new Lighting(scene, city, renderer, 'low')
  // Track how many times the scratch array is sorted by spying on Array.prototype
  // is overkill; instead assert the throttle state advances and that a big move
  // forces a re-sort while a tiny move does not.
  const p = new THREE.Vector3(0, 1.7, 0)
  const before = light._sortTick
  light.update(p)
  assert.notEqual(light._sortTick, before, 'the sort tick advances each frame')
  // A large player move resets the tick (forced re-sort happened).
  p.set(50, 1.7, 50)
  light.update(p)
  assert.equal(light._sortTick, 0, 'a large move forces a re-sort and resets the tick')
  assert.equal(light._lastSortX, 50, 'the sort anchor position is recorded')
  // A tiny move does not force a re-sort (tick keeps advancing unless it hits 0).
  light._sortTick = 5
  p.set(50.05, 1.7, 50)
  light.update(p)
  assert.notEqual(light._sortTick, 0, 'a sub-threshold move does not force a re-sort')
  light.dispose?.()
})

// --- Game CTF hot path: _swarmPlayers reuses a scratch array (no per-frame alloc) ---
test('v37 R6: Game._swarmPlayers returns a reused scratch array', async () => {
  const { Game } = await import('../src/game/Game.js')
  const g = new Game({ headless: true })
  g.start()
  const a = g._swarmPlayers()
  const b = g._swarmPlayers()
  assert.equal(a, b, 'the same scratch array instance is returned each call')
  assert.equal(a.length, 1, 'the local player is present')
  assert.equal(a[0].id, 'p1')
  assert.equal(a[0].player, g.player)
})