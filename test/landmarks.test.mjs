import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { Landmarks } from '../src/world/Landmarks.js'

// v28 R4: three Stockholm landmark silhouettes (Kaknästornet, Globen, Gamla stan
// spire) on the far skyline. They must share one dark fog-free material, sit
// under the camera far plane (520), be a separate scene group (not a Sky child),
// be deterministic, and fully dispose.

function newLandmarks() {
  const scene = new THREE.Scene()
  return { scene, lm: new Landmarks(scene) }
}

test('landmarks: three meshes in one group added to the scene', () => {
  const { scene, lm } = newLandmarks()
  assert.equal(lm.meshes.length, 3, 'tower + globe + spire')
  assert.equal(scene.children.includes(lm.group), true, 'group added to scene')
  assert.equal(lm.group.children.length, 3)
  for (const m of lm.meshes) {
    assert.equal(m.isMesh, true)
    assert.equal(m.material, lm.mat, 'all share the one dark material')
    assert.equal(m.material.fog, false, 'fog would erase them at 380 m')
  }
  lm.dispose()
})

test('landmarks: one shared material, three distinct geometries', () => {
  const { lm } = newLandmarks()
  assert.equal(lm.geos.length, 3)
  assert.notEqual(lm.towerGeo, lm.globeGeo)
  assert.notEqual(lm.globeGeo, lm.spireGeo)
  // The globe is a sphere (the Ericsson Globe), the spire a cone, the tower a
  // cylinder — recognizable Stockholm shapes, not generic boxes.
  assert.ok(lm.globeGeo.type === 'SphereGeometry', 'Globen is a sphere')
  assert.ok(lm.spireGeo.type === 'ConeGeometry', 'Gamla stan spire is a cone')
  assert.ok(lm.towerGeo.type === 'CylinderGeometry', 'Kaknästornet is a tapered mast')
  lm.dispose()
})

test('landmarks: every landmark sits under the camera far plane (520)', () => {
  const { lm } = newLandmarks()
  for (const m of lm.meshes) {
    const horiz = Math.hypot(m.position.x, m.position.z)
    assert.ok(horiz < 520, `landmark ${m.position.x},${m.position.z} beyond far plane`)
  }
  lm.dispose()
})

test('landmarks: deterministic layout (two builds match exactly)', () => {
  const a = newLandmarks()
  const b = newLandmarks()
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(a.lm.meshes[i].position.toArray(), b.lm.meshes[i].position.toArray(),
      `landmark ${i} position not deterministic`)
  }
  a.lm.dispose(); b.lm.dispose()
})

test('landmarks: dispose removes the group and disposes every resource', () => {
  const { scene, lm } = newLandmarks()
  let geoDisposed = 0, matDisposed = 0
  for (const g of lm.geos) g.addEventListener('dispose', () => geoDisposed++)
  lm.mat.addEventListener('dispose', () => matDisposed++)
  lm.dispose()
  assert.equal(scene.children.includes(lm.group), false, 'group removed from scene')
  assert.equal(geoDisposed, 3, 'all three geometries disposed')
  assert.equal(matDisposed, 1, 'shared material disposed')
  assert.equal(lm.group, null, 'group reference cleared')
})

test('landmarks: headless-safe (no document/window/AudioContext touched)', () => {
  // Constructing under a plain scene with no browser globals must not throw.
  const scene = new THREE.Scene()
  const lm = new Landmarks(scene)
  lm.update() // static, no-op
  lm.dispose()
  assert.ok(true)
})