// test/envmap.test.mjs - IBL bake: headless-safe no-op contract.
// Game.js calls bakeSkyEnvironment unconditionally at init, so the
// non-WebGLRenderer path MUST return null and leave the scene untouched.
// (The real GL bake path needs a live WebGL context and is exercised in
// the browser; see tools/look-capture + metrics.)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { Sky } from '../src/world/sky.js'
import { bakeSkyEnvironment } from '../src/world/envmap.js'

// Headless stand-in: has the shape of a renderer but is NOT a WebGLRenderer.
const stub = { getSize: (v) => { v.x = 800; v.y = 600; return v } }

test('non-WebGLRenderer: returns null, scene untouched', () => {
  const scene = new THREE.Scene()
  const sky = new Sky(scene)
  assert.equal(bakeSkyEnvironment(stub, sky, scene), null)
  assert.equal(scene.environment, null, 'no environment assigned headless')
  assert.equal(scene.environmentIntensity, 1, 'default intensity unchanged')
  assert.equal(scene.children.length, 1, 'sky group still in scene')
  sky.dispose()
})

test('null renderer: returns null without throwing', () => {
  const scene = new THREE.Scene()
  assert.equal(bakeSkyEnvironment(null, null, scene), null)
  assert.equal(scene.environment, null)
})

test('opts are validated but irrelevant headless (still no-op)', () => {
  const scene = new THREE.Scene()
  const sky = new Sky(scene)
  assert.equal(bakeSkyEnvironment(stub, sky, scene, { size: 'bogus', intensity: NaN }), null)
  assert.equal(scene.environment, null)
  sky.dispose()
})
