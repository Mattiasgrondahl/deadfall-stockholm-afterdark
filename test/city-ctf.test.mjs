// CityCTF headless test — the bespoke two-base CTF arena.
// Verifies it builds headlessly, exposes the City-compatible surface
// (getSpawnPoints / bases / streetlightAnchors), registers collision AABBs,
// stays under the mesh budget, and disposes cleanly (group removed, AABBs
// spliced out, snow gone). No DOM, no three renderer needed.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { CityCTF, CTF_BASES } from '../src/world/CityCTF.js'
import { CollisionWorld } from '../src/game/CollisionWorld.js'

function build() {
  const scene = new THREE.Scene()
  const collision = new CollisionWorld(220, 220)
  const city = new CityCTF(scene, collision, { canvasFactory: () => null })
  return { scene, collision, city }
}

function countMeshes(scene) {
  let n = 0
  scene.traverse((o) => { if (o.isMesh) n++ })
  return n
}

test('builds headlessly and exposes the CTF arena', () => {
  const { city } = build()
  assert.equal(city.bases.lovis.x, -90, 'lovis base at the SW corner')
  assert.equal(city.bases.krag.x, 90, 'krag base at the NE corner')
  assert.deepEqual(Object.keys(CTF_BASES), ['lovis', 'krag'])
  assert.ok(city.streetlightAnchors && city.streetlightAnchors.length > 0, 'streetlight anchors for shafts/pools')
})

test('exposes two base spawns, one per flag', () => {
  const { city } = build()
  const sp = city.getSpawnPoints()
  assert.equal(sp.length, 2, 'one spawn per base')
  for (const s of sp) assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z), 'spawn has finite x/z')
  city.dispose()
})

test('registers collision AABBs for the solid props', () => {
  const { collision, city } = build()
  assert.ok(collision.aabbs.length > 8, 'buildings / station / cars / walls register AABBs')
  city.dispose()
})

test('stays under the mesh budget', () => {
  const { scene, city } = build()
  const meshes = countMeshes(scene)
  assert.ok(meshes <= 200, 'mesh count ' + meshes + ' within the CTF budget')
  city.dispose()
})

test('dispose removes the group, splices AABBs, and clears refs', () => {
  const { scene, collision, city } = build()
  const before = collision.aabbs.length
  const meshesBefore = countMeshes(scene)
  assert.ok(meshesBefore > 0)
  city.dispose()
  assert.equal(countMeshes(scene), 0, 'group removed from the scene')
  assert.ok(collision.aabbs.length < before, 'this map AABBs spliced out')
  assert.equal(city.snow, null, 'snow cleared')
  assert.equal(city.group, null, 'group nulled')
  assert.equal(city.ground, null, 'ground nulled')
})

test('dispose is idempotent', () => {
  const { scene, city } = build()
  city.dispose()
  city.dispose()
  assert.equal(countMeshes(scene), 0, 'second dispose is a no-op')
})