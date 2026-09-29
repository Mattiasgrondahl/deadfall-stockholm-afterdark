import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { Aurora } from '../src/world/Aurora.js'

// v28 R1: the aurora is one additive curtain mesh hung on the northern horizon.
// It must stay under the camera far plane (520), follow the player, advance its
// shader clock, take an external intensity, and fully dispose.

function newAurora() {
  const scene = new THREE.Scene()
  return { scene, aurora: new Aurora(scene) }
}

test('aurora: one additive curtain mesh added to the scene', () => {
  const { scene, aurora } = newAurora()
  assert.equal(aurora.mesh.isMesh, true)
  assert.equal(scene.children.includes(aurora.mesh), true)
  assert.equal(aurora.mat.blending, THREE.AdditiveBlending)
  assert.equal(aurora.mat.transparent, true)
  assert.equal(aurora.mat.depthWrite, false)
  assert.equal(aurora.mat.fog, false, 'fog would erase the curtain at 380 m')
  aurora.dispose()
})

test('aurora: band radius stays under the camera far plane (520)', () => {
  const { aurora } = newAurora()
  const pos = aurora.geo.attributes.position.array
  let maxR = 0
  for (let i = 0; i < pos.length; i += 3) {
    const r = Math.hypot(pos[i], pos[i + 2])
    if (r > maxR) maxR = r
  }
  assert.ok(maxR < 520, `horizontal radius ${maxR} must stay under far plane 520`)
  aurora.dispose()
})

test('aurora: follows the player and advances uTime', () => {
  const { aurora } = newAurora()
  const p = new THREE.Vector3(12, 0, -34)
  aurora.update(p, 1 / 60)
  assert.ok(aurora.mesh.position.equals(p), 'curtain follows the player')
  assert.ok(aurora.mat.uniforms.uTime.value > 0, 'uTime advanced')
  const t1 = aurora.mat.uniforms.uTime.value
  aurora.update(p, 1 / 60)
  assert.ok(aurora.mat.uniforms.uTime.value > t1, 'uTime keeps advancing')
  aurora.dispose()
})

test('aurora: setIntensity clamps to [0,1] and drives the uniform', () => {
  const { aurora } = newAurora()
  aurora.setIntensity(0.5)
  assert.equal(aurora.mat.uniforms.uIntensity.value, 0.5)
  aurora.setIntensity(2)
  assert.equal(aurora.mat.uniforms.uIntensity.value, 1, 'clamped to 1')
  aurora.setIntensity(-3)
  assert.equal(aurora.mat.uniforms.uIntensity.value, 0, 'clamped to 0')
  aurora.setIntensity(NaN)
  assert.equal(aurora.mat.uniforms.uIntensity.value, 0, 'non-finite -> 0')
  aurora.dispose()
})

test('aurora: dispose removes the mesh and disposes geo + material', () => {
  const { scene, aurora } = newAurora()
  const geo = aurora.geo, mat = aurora.mat
  let geoDisposed = false, matDisposed = false
  geo.addEventListener('dispose', () => { geoDisposed = true })
  mat.addEventListener('dispose', () => { matDisposed = true })
  aurora.dispose()
  assert.equal(scene.children.includes(aurora.mesh), false, 'mesh removed from scene')
  assert.equal(geoDisposed, true, 'geometry dispose event fired')
  assert.equal(matDisposed, true, 'material dispose event fired')
})

test('aurora: headless construct/update/dispose run without browser globals', () => {
  const { scene, aurora } = newAurora()
  aurora.update(new THREE.Vector3(0, 0, 0), 1 / 60)
  aurora.setIntensity(0.8)
  aurora.dispose()
  assert.equal(scene.children.length, 0, 'scene emptied after dispose')
})