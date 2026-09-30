import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { ZombieShadows } from '../src/world/ZombieShadows.js'

// v28 R4: soft contact shadows under live zombies. One InstancedMesh of dark
// discs laid flat just above the ground, one instance per live zombie, count
// clamped to the pool, dead bodies skipped, full dispose. Headless-safe.

function fakeZombie(x, z, dead = false) {
  const group = new THREE.Object3D()
  group.position.set(x, 0, z)
  return { group, isDead: dead }
}

function newShadows(max = 24) {
  const scene = new THREE.Scene()
  return { scene, zs: new ZombieShadows(scene, max) }
}

test('zombieShadows: one InstancedMesh added, transparent, depthWrite off', () => {
  const { scene, zs } = newShadows()
  assert.equal(zs.mesh.isInstancedMesh, true)
  assert.equal(scene.children.includes(zs.mesh), true)
  assert.equal(zs.mat.transparent, true)
  assert.equal(zs.mat.depthWrite, false, 'a shadow must not write depth')
  assert.equal(zs.mesh.count, 0, 'nothing shown before the first update')
  zs.dispose()
})

test('zombieShadows: count reflects live zombies only', () => {
  const { zs } = newShadows()
  const zs_list = [fakeZombie(1, 1), fakeZombie(2, 2, true), fakeZombie(3, 3)]
  zs.update(zs_list)
  assert.equal(zs.mesh.count, 2, 'two live, one dead -> count 2')
  zs.dispose()
})

test('zombieShadows: count clamps to maxCount', () => {
  const { zs } = newShadows(3)
  const list = [fakeZombie(1, 1), fakeZombie(2, 2), fakeZombie(3, 3), fakeZombie(4, 4), fakeZombie(5, 5)]
  zs.update(list)
  assert.equal(zs.mesh.count, 3, 'clamped to the pool size')
  zs.dispose()
})

test('zombieShadows: empty / all-dead list hides everything', () => {
  const { zs } = newShadows()
  zs.update([fakeZombie(1, 1, true), fakeZombie(2, 2, true)])
  assert.equal(zs.mesh.count, 0)
  assert.equal(zs.mesh.visible, false, 'no live zombies -> mesh hidden')
  zs.update([])
  assert.equal(zs.mesh.count, 0)
  zs.dispose()
})

test('zombieShadows: live zombies are placed at ground level with a footprint', () => {
  const { zs } = newShadows()
  zs.update([fakeZombie(5, -7)])
  const m = new THREE.Matrix4()
  zs.mesh.getMatrixAt(0, m)
  const pos = new THREE.Vector3().setFromMatrixPosition(m)
  assert.ok(Math.abs(pos.x - 5) < 1e-6 && Math.abs(pos.z + 7) < 1e-6, 'disc under the zombie feet')
  zs.dispose()
})

test('zombieShadows: dispose removes the mesh and disposes geo/mat/map', () => {
  const { scene, zs } = newShadows()
  let geoDisposed = 0, matDisposed = 0
  zs.geo.addEventListener('dispose', () => geoDisposed++)
  zs.mat.addEventListener('dispose', () => matDisposed++)
  zs.dispose()
  assert.equal(scene.children.includes(zs.mesh), false, 'mesh removed from scene')
  assert.equal(geoDisposed, 1)
  assert.equal(matDisposed, 1)
  assert.equal(zs.mesh, null, 'mesh reference cleared')
})

test('zombieShadows: headless-safe (no document, plain scene)', () => {
  const scene = new THREE.Scene()
  const zs = new ZombieShadows(scene)
  zs.update([fakeZombie(0, 0)])
  zs.dispose()
  assert.ok(true)
})