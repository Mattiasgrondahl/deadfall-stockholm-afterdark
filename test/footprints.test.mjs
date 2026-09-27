import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { Footprints } from '../src/game/Footprints.js'

function newFP() {
  const scene = new THREE.Scene()
  return { scene, fp: new Footprints(scene) }
}

test('v3 T13: footprints are emitted only after real travel, alternating sides', () => {
  const { fp } = newFP()
  fp.step('p', 0, 0, 0)               // first call seeds the stride, no print
  assert.equal(fp.count, 0, 'first step seeds the accumulator only')
  fp.step('p', 0, -0.3, 0)            // 0.3 m < STEP_DIST
  assert.equal(fp.count, 0, 'sub-step travel emits nothing')
  fp.step('p', 0, -0.8, 0)            // total 0.8 m >= STEP_DIST -> one print
  assert.equal(fp.count, 1, 'a full step emits one print')
  fp.step('p', 0, -1.6, 0)            // another 0.8 m -> second print
  assert.equal(fp.count, 2, 'second full step emits a second print')
  // The two prints land on opposite sides of the facing line (alternating track).
  const a = fp._pos[0].x, b = fp._pos[1].x
  assert.ok(Math.sign(a) !== Math.sign(b) && a !== 0 && b !== 0, 'prints alternate left/right across the path')
  fp.dispose()
})

test('v3 T13: prints age out and the pool compacts (prefix invariant)', () => {
  const { fp } = newFP()
  fp.step('p', 0, 0, 0)
  fp.step('p', 0, -0.8, 0)
  fp.step('p', 0, -1.6, 0)
  assert.equal(fp.count, 2)
  // Step time well past LIFE: every print should have faded out.
  for (let i = 0; i < 60 * 7; i++) fp.update(1 / 60)
  assert.equal(fp.count, 0, 'all prints faded after LIFE seconds')
  assert.equal(fp._mesh.count, 0)
  assert.equal(fp._mesh.visible, false)
  fp.dispose()
})

test('v3 T13: pool evicts oldest-first at the cap and stays one mesh', () => {
  const { scene, fp } = newFP()
  fp.step('p', 0, 0, 0)
  let z = -0.8
  for (let i = 0; i < 80; i++) { fp.step('p', 0, z, 0); z -= 0.8 }
  assert.ok(fp.count <= 64, 'pool capped at 64')
  assert.equal(fp.count, 64, 'full pool after enough steps')
  // One InstancedMesh in the scene, nothing else.
  let meshes = 0
  scene.traverse(o => { if (o.isMesh) meshes++ })
  assert.equal(meshes, 1, 'footprints are a single InstancedMesh')
  fp.dispose()
  assert.equal(scene.children.length, 0, 'dispose removes the mesh')
})

test('v3 T13: per-walker stride is keyed by object; forget drops it', () => {
  const { fp } = newFP()
  const zA = { id: 'A' }, zB = { id: 'B' }
  fp.step(zA, 0, 0, 0)
  fp.step(zB, 10, 0, 0)
  fp.step(zA, 0, -0.8, 0)   // A travels a full step -> print
  fp.step(zB, 10, -0.3, 0)  // B barely moves -> no print
  assert.equal(fp.count, 1, 'only the walker that covered a step leaves a print')
  fp.forget(zA)
  assert.equal(fp._stride.has(zA), false, 'forget drops the stride accumulator')
  fp.dispose()
})

test('v3 T13: headless has no alpha map, prints still track; dispose is clean', () => {
  assert.equal(typeof document, 'undefined', 'headless: no document')
  const { scene, fp } = newFP()
  assert.equal(fp._mat.map, null, 'no canvas alpha map in headless')
  fp.step('p', 0, 0, 0)
  fp.step('p', 0, -0.8, 0)
  assert.equal(fp.count, 1)
  fp.clear()
  assert.equal(fp.count, 0)
  fp.dispose()
  assert.equal(scene.children.length, 0)
})