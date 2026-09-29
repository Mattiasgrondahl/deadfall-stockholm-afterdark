import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { Breath } from '../src/world/Breath.js'

// v28 R2: breath plumes — a Points pool emitted in front of the player when
// sprinting in the cold. Must be additive/fog-agnostic, deterministic, follow the
// emit->rise->fade lifecycle, dispose cleanly, and run headless.

function newBreath() {
  const scene = new THREE.Scene()
  return { scene, breath: new Breath(scene) }
}

test('breath: one additive Points pool added to the scene', () => {
  const { scene, breath } = newBreath()
  assert.equal(breath.points.isPoints, true)
  assert.equal(scene.children.includes(breath.points), true)
  assert.equal(breath.mat.blending, THREE.AdditiveBlending)
  assert.equal(breath.mat.transparent, true)
  assert.equal(breath.mat.depthWrite, false)
  breath.dispose()
})

test('breath: emit spawns puffs ahead of the facing and update ages them', () => {
  const { breath } = newBreath()
  // Player at origin facing -Z (yaw 0): puffs must land at negative z.
  breath.emit(0, 0, 0, 5)
  const pos = breath._pos, life = breath._life
  let born = 0, ahead = 0
  for (let i = 0; i < life.length; i++) {
    if (life[i] > 0) { born++; if (pos[i * 3 + 2] < 0) ahead++ }
  }
  assert.ok(born > 0, 'emitting intensity 5 spawns puffs')
  assert.equal(ahead, born, 'all puffs spawn in front of a yaw-0 player (-Z)')
  const y0 = life.find((l) => l > 0)
  breath.update(0.5)
  const after = life.find((l) => l > 0)
  assert.ok(after < y0, 'update ages live puffs')
  breath.dispose()
})

test('breath: puffs expire after their lifetime', () => {
  const { breath } = newBreath()
  breath.emit(0, 0, 0, 3)
  for (let i = 0; i < 120; i++) breath.update(1 / 60) // 2 s > LIFE 1.1 s
  assert.ok(breath._life.every((l) => l <= 0), 'all puffs faded out')
  breath.dispose()
})

test('breath: emit(…, 0) is a no-op and pool recycles oldest-first', () => {
  const { breath } = newBreath()
  breath.emit(0, 0, 0, 0)
  assert.ok(breath._life.every((l) => l <= 0), 'zero intensity spawns nothing')
  // Overfill the pool: the cursor must wrap (recycle), never overflow.
  for (let i = 0; i < 200; i++) breath.emit(0, 0, 0, 1)
  assert.ok(breath._cursor < breath._life.length, 'cursor wraps within the pool')
  breath.dispose()
})

test('breath: dispose removes the Points and disposes geo + material', () => {
  const { scene, breath } = newBreath()
  let geoDisposed = false, matDisposed = false
  breath.geo.addEventListener('dispose', () => { geoDisposed = true })
  breath.mat.addEventListener('dispose', () => { matDisposed = true })
  breath.dispose()
  assert.equal(scene.children.includes(breath.points), false, 'points removed from scene')
  assert.equal(geoDisposed, true, 'geometry dispose event fired')
  assert.equal(matDisposed, true, 'material dispose event fired')
})

test('breath: headless construct/emit/update/dispose run without browser globals', () => {
  const { scene, breath } = newBreath()
  breath.emit(3, -4, 1.2, 2)
  breath.update(1 / 60)
  breath.dispose()
  assert.equal(scene.children.length, 0, 'scene emptied after dispose')
})