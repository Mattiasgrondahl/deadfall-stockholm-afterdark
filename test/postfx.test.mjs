// test/postfx.test.mjs - V2P-10a: PostFX scaffold, headless-safe.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { PostFX } from '../src/game/PostFX.js'

// Headless stand-in: not a WebGLRenderer, so PostFX must stay disabled.
function stubRenderer(w = 800, h = 600) {
  return { getSize: (v) => { v.x = w; v.y = h; return v } }
}

// Satisfies instanceof WebGLRenderer without running the constructor
// (no WebGL context exists in Node); verified to construct the composer
// and bloom pass cleanly (three r185).
function fakeGLRenderer(w = 800, h = 600) {
  const r = Object.create(THREE.WebGLRenderer.prototype)
  r.width = w
  r.height = h
  r.getPixelRatio = () => 1
  r.getSize = (v) => { v.x = w; v.y = h; return v }
  r.capabilities = { isWebGL2: false }
  return r
}

const mkScene = () => new THREE.Scene()
const mkCamera = () => new THREE.PerspectiveCamera(70, 800 / 600, 0.1, 1000)

test('headless stub renderer: disabled, no-op methods, dispose safe', () => {
  const fx = new PostFX(mkScene(), mkCamera(), stubRenderer())
  assert.equal(fx.enabled, false)
  assert.equal(fx.composer, null)
  assert.equal(fx.bloom, null)
  assert.equal(fx.strength, 0.25)
  fx.render()
  fx.setStrength(0.4)
  fx.setSize(640, 480)
  assert.equal(fx.enabled, false)
  assert.equal(fx.strength, 0.4)
  fx.dispose()
  assert.equal(fx.composer, null)
  assert.equal(fx.bloom, null)
  fx.render()
})

test('WebGLRenderer guard: composer path builds RenderPass + UnrealBloomPass', () => {
  const fx = new PostFX(mkScene(), mkCamera(), fakeGLRenderer())
  assert.equal(fx.enabled, true)
  assert.ok(fx.composer instanceof EffectComposer)
  assert.ok(fx.bloom instanceof UnrealBloomPass)
  assert.equal(fx.composer.passes.length, 2)
  assert.ok(fx.composer.passes[0] instanceof RenderPass)
  assert.equal(fx.bloom.strength, 0.25)
  assert.equal(fx.bloom.radius, 0.5)
  assert.equal(fx.bloom.threshold, 0.0)
})

test('strength clamped to [0,1]; non-finite input keeps current value', () => {
  const fx = new PostFX(mkScene(), mkCamera(), fakeGLRenderer(), { strength: 9 })
  assert.equal(fx.strength, 1)
  assert.equal(fx.bloom.strength, 1)
  fx.setStrength(-3)
  assert.equal(fx.strength, 0)
  assert.equal(fx.bloom.strength, 0)
  fx.setStrength(NaN)
  assert.equal(fx.strength, 0)
  fx.setStrength(0.25)
  assert.equal(fx.bloom.strength, 0.25)
})

test('setSize + dispose on the enabled path', () => {
  const fx = new PostFX(mkScene(), mkCamera(), fakeGLRenderer())
  fx.setSize(640, 480)
  assert.equal(fx.enabled, true)
  fx.dispose()
  assert.equal(fx.enabled, false)
  assert.equal(fx.bloom, null)
  assert.equal(fx.composer, null)
  fx.render()
})
