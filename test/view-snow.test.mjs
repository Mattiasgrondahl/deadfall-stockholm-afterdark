import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { ViewSnow } from '../src/world/ViewSnow.js'

// v28 R4: frost that settles on the near view-model while standing still. One
// additive Points cluster parented to the camera; flakes accumulate while idle,
// age out on their own, and the whole thing disposes cleanly. Headless-safe.

function newViewSnow() {
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1000)
  return { camera, vs: new ViewSnow(camera) }
}

test('viewSnow: one additive Points cluster parented to the camera', () => {
  const { camera, vs } = newViewSnow()
  assert.equal(vs.points.isPoints, true)
  assert.equal(camera.children.includes(vs.points), true, 'cluster parented to camera')
  assert.equal(vs.mat.blending, THREE.AdditiveBlending)
  assert.equal(vs.mat.transparent, true)
  assert.equal(vs.mat.depthWrite, false)
  vs.dispose()
})

test('viewSnow: idle emission spawns flakes that age out', () => {
  const { vs } = newViewSnow()
  for (let i = 0; i < 5; i++) vs.emit(1) // fully idle for a few frames
  vs.update(0.016)
  let alive = 0
  for (let i = 0; i < vs._life.length; i++) if (vs._life[i] > 0) alive++
  assert.ok(alive > 0, 'idle emission spawned flakes')
  // Age past LIFE -> every flake melts off.
  for (let i = 0; i < 500; i++) vs.update(0.016) // ~8 s > LIFE 6 s
  alive = 0
  for (let i = 0; i < vs._life.length; i++) if (vs._life[i] > 0) alive++
  assert.equal(alive, 0, 'all flakes melt off after LIFE')
  vs.dispose()
})

test('viewSnow: zero intensity spawns nothing (moving shakes it off)', () => {
  const { vs } = newViewSnow()
  vs.emit(0)
  vs.update(0.016)
  let alive = 0
  for (let i = 0; i < vs._life.length; i++) if (vs._life[i] > 0) alive++
  assert.equal(alive, 0, 'no flakes while moving')
  vs.dispose()
})

test('viewSnow: flake pool wraps and never overflows MAX_FLAKES', () => {
  const { vs } = newViewSnow()
  for (let i = 0; i < 200; i++) { vs.emit(1); vs.update(0.016) }
  assert.equal(vs._cursor < 40, true, 'cursor wraps within the pool')
  let alive = 0
  for (let i = 0; i < vs._life.length; i++) if (vs._life[i] > 0) alive++
  assert.ok(alive <= 40, 'alive flakes never exceed the pool size')
  vs.dispose()
})

test('viewSnow: dispose removes the cluster and disposes geo + mat', () => {
  const { camera, vs } = newViewSnow()
  let geoDisposed = 0, matDisposed = 0
  vs.geo.addEventListener('dispose', () => geoDisposed++)
  vs.mat.addEventListener('dispose', () => matDisposed++)
  vs.dispose()
  assert.equal(camera.children.includes(vs.points), false, 'cluster removed from camera')
  assert.equal(geoDisposed, 1, 'geometry disposed')
  assert.equal(matDisposed, 1, 'material disposed')
  assert.equal(vs.points, null, 'points reference cleared')
})

test('viewSnow: headless-safe (plain Object3D camera, no browser globals)', () => {
  const cam = new THREE.Object3D()
  const vs = new ViewSnow(cam)
  vs.emit(0.5)
  vs.update(0.016)
  vs.dispose()
  assert.ok(true)
})