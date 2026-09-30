import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { LightShafts } from '../src/world/LightShafts.js'

// v28 R4: volumetric light shafts under the streetlights. One additive
// InstancedMesh of open cones hanging from each lamp anchor, count clamped to
// maxShafts, deterministic placement, full dispose. Headless-safe.

function anchors(n) {
  const out = []
  for (let i = 0; i < n; i++) out.push(new THREE.Vector3(i * 8 - 20, 5.05, (i % 3) * 10 - 10))
  return out
}

function newShafts(list, max = 12) {
  const scene = new THREE.Scene()
  return { scene, ls: new LightShafts(scene, list, max) }
}

test('lightShafts: one additive InstancedMesh added to the scene', () => {
  const { scene, ls } = newShafts(anchors(6))
  assert.equal(ls.mesh.isInstancedMesh, true)
  assert.equal(scene.children.includes(ls.mesh), true)
  assert.equal(ls.mat.blending, THREE.AdditiveBlending)
  assert.equal(ls.mat.transparent, true)
  assert.equal(ls.mat.depthWrite, false)
  assert.equal(ls.mat.fog, false, 'fog would erase the shafts')
  ls.dispose()
})

test('lightShafts: instance count equals min(anchors, maxShafts)', () => {
  const { ls } = newShafts(anchors(6), 12)
  assert.equal(ls.mesh.count, 6, 'six anchors -> six shafts')
  const b = newShafts(anchors(20), 12)
  assert.equal(b.ls.mesh.count, 12, 'clamped to maxShafts')
  ls.dispose(); b.ls.dispose()
})

test('lightShafts: shafts hang down from the lamp head toward the ground', () => {
  const list = anchors(4)
  const { ls } = newShafts(list)
  const m = new THREE.Matrix4()
  for (let i = 0; i < ls.mesh.count; i++) {
    ls.mesh.getMatrixAt(i, m)
    const pos = new THREE.Vector3().setFromMatrixPosition(m)
    // Cone centered between ground (0) and the lamp head (~5 m): center y in (0, 5.5).
    assert.ok(pos.y > 0 && pos.y < 6, `shaft ${i} center y ${pos.y} between ground and lamp`)
    // Anchored at the lamp's x/z.
    assert.ok(Math.abs(pos.x - list[i].x) < 1e-6 && Math.abs(pos.z - list[i].z) < 1e-6,
      `shaft ${i} sits at its anchor x/z`)
  }
  ls.dispose()
})

test('lightShafts: deterministic placement (two builds match)', () => {
  const a = newShafts(anchors(5))
  const b = newShafts(anchors(5))
  const ma = new THREE.Matrix4(), mb = new THREE.Matrix4()
  for (let i = 0; i < a.ls.mesh.count; i++) {
    a.ls.mesh.getMatrixAt(i, ma)
    b.ls.mesh.getMatrixAt(i, mb)
    assert.deepEqual(ma.elements, mb.elements, `shaft ${i} not deterministic`)
  }
  a.ls.dispose(); b.ls.dispose()
})

test('lightShafts: dispose removes the mesh and disposes geo + mat', () => {
  const { scene, ls } = newShafts(anchors(4))
  let geoDisposed = 0, matDisposed = 0
  ls.geo.addEventListener('dispose', () => geoDisposed++)
  ls.mat.addEventListener('dispose', () => matDisposed++)
  ls.dispose()
  assert.equal(scene.children.includes(ls.mesh), false, 'mesh removed from scene')
  assert.equal(geoDisposed, 1)
  assert.equal(matDisposed, 1)
  assert.equal(ls.mesh, null, 'mesh reference cleared')
})

test('lightShafts: headless-safe (plain scene, no browser globals)', () => {
  const scene = new THREE.Scene()
  const ls = new LightShafts(scene, anchors(3))
  ls.update()
  ls.dispose()
  assert.ok(true)
})