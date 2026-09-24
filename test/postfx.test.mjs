// test/postfx.test.mjs - V2P-10a: PostFX scaffold, headless-safe.
// V6 visuals (4): the bloom pin moved to a restrained, source-only setting
// (strength 0.18 / radius 0.35 / threshold 0.72) plus per-tier strengths.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
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

// Luminance of an emissive source, mirroring UnrealBloomPass.highPass: a plain
// dot with Rec.709 coefficients on the linear buffer (no sRGB decode).
const luma = (hex, intensity) => {
  const c = new THREE.Color(hex)
  return (c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722) * intensity
}

test('headless stub renderer: disabled, no-op methods, dispose safe', () => {
  const fx = new PostFX(mkScene(), mkCamera(), stubRenderer())
  assert.equal(fx.enabled, false)
  assert.equal(fx.composer, null)
  assert.equal(fx.bloom, null)
  assert.equal(fx.grade, null)
  assert.equal(fx.gtao, null)
  assert.equal(fx.strength, 0.18)
  fx.render()
  fx.setStrength(0.4)
  fx.setSize(640, 480)
  assert.equal(fx.enabled, false)
  assert.equal(fx.strength, 0.4)
  fx.dispose()
  assert.equal(fx.composer, null)
  assert.equal(fx.bloom, null)
  assert.equal(fx.grade, null)
  assert.equal(fx.gtao, null)
  fx.render()
})

test('WebGLRenderer guard: composer builds RenderPass + GTAO + grade + bloom (grade before bloom)', () => {
  const fx = new PostFX(mkScene(), mkCamera(), fakeGLRenderer())
  assert.equal(fx.enabled, true)
  assert.ok(fx.composer instanceof EffectComposer)
  assert.ok(fx.bloom instanceof UnrealBloomPass)
  assert.ok(fx.grade instanceof ShaderPass)
  assert.ok(fx.gtao instanceof GTAOPass)
  assert.equal(fx.composer.passes.length, 4)
  assert.ok(fx.composer.passes[0] instanceof RenderPass)
  // Graphics tier 3: GTAO runs right after RenderPass, compositing AO onto the
  // beauty buffer before grade + bloom.
  assert.ok(fx.composer.passes[1] === fx.gtao)
  // V3P-10 fix: grade runs BEFORE bloom so bloom is the final on-screen pass.
  assert.ok(fx.composer.passes[2] === fx.grade)
  assert.ok(fx.composer.passes[3] === fx.bloom)
  assert.equal(fx.gtao.output, 0, 'GTAO composites AO onto the beauty (Default output)')
  assert.equal(fx.gtao.blendIntensity, 0.5, 'GTAO blend kept subtle')
  // V6 visuals (4): restrained bloom. strength 0.25→0.18, radius 0.5→0.35,
  // threshold 0.0→0.72.
  assert.equal(fx.bloom.strength, 0.18)
  assert.equal(fx.bloom.radius, 0.35)
  assert.equal(fx.bloom.threshold, 0.72)
  // Grade uniforms at their tuned defaults (V3P-10): grain + vignette only.
  assert.equal(fx.grade.uniforms.uGrain.value, 0.012)
  assert.equal(fx.grade.uniforms.uVignette.value, 0.05)
  assert.equal(fx.grade.uniforms.uTime.value, 0)
})

test('v6 visuals (4): threshold sits above the lit night scene and below every emissive source', () => {
  const fx = new PostFX(mkScene(), mkCamera(), fakeGLRenderer())
  const t = fx.bloom.threshold
  assert.ok(t > 0, `threshold must be above 0 so the brightened night scene stops blooming wholesale, got ${t}`)
  // Lighting.js sets ACESFilmic tone mapping at exposure 1.2, so the value
  // UnrealBloomPass.highPass tests is the TONEMAPPED luminance, not the raw
  // HDR value. Evaluate the same curve here: x' = x(2.51x+0.03)/(x(2.43x+0.59)
  // +0.14), clamped, with x = lin * 1.2.
  const aces = (x) => Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14))
  const post = (hex, i) => aces(luma(hex, i) * 1.2)
  // Round 41 raised moon 1.45 / hemi 0.30 / ambient 0.12 / pools 70 cd. Every
  // *lit* surface (stone, snow, facades) lands in 0.50-0.72 post-tonemap, so
  // the cut has to clear that band: no ground/wall bloom at all.
  assert.ok(t >= 0.6 && t < 0.85, `threshold ${t} must clear the lit band (0.50-0.72), got ${t}`)
  // Lit surfaces reach ~0.6 linear only where the 70 cd pool lands directly;
  // the moon/hemi/ambient term on stone and snow sits at ≤0.5. The cut has to
  // clear that ambient band, and the pool-lit cores are exactly the pixels we
  // WANT to bloom, so the gate is the ambient band (≤0.5), not the pool peak.
  for (const lin of [0.2, 0.3, 0.4, 0.5]) {
    assert.ok(aces(lin * 1.2) <= t, `ambient-lit surface at linear ${lin} (${aces(lin * 1.2).toFixed(3)}) must stay under the cut ${t}`)
  }
  // Every emissive landmark stays above the cut, so sources still glow.
  const sources = {
    lampHead: post(0xffb066, 2.2),
    spire: post(0xffc878, 2.0),
    plazaPanel: post(0xffd9a5, 2.0),
    facadeWindow: post(0xffa64d, 1.5)
  }
  for (const [name, v] of Object.entries(sources)) {
    assert.ok(v > t, `${name} post-tonemap luminance ${v.toFixed(3)} must exceed threshold ${t}`)
  }
  // The dimmest source (corner beacons) must stay within 10% of the cut: it is
  // the reason the threshold cannot be pushed higher without losing markers.
  const beacon = post(0xff4433, 2.0)
  assert.ok(beacon <= t && beacon >= t - 0.1, `beacon ${beacon.toFixed(3)} must sit at/just under the cut ${t}`)
  // Halo additive contribution (opacity x map peak 1.0) must stay well under
  // the cut so the glow does not re-bloom itself.
  for (const [name, hex, o] of [['lamp', 0xffb066, 0.30], ['spire', 0xffc878, 0.38], ['beacon', 0xff4433, 0.34], ['plaza', 0xffd9a5, 0.35]]) {
    assert.ok(post(hex, o) < t - 0.2, `${name} halo ${post(hex, o).toFixed(3)} must be ≥0.2 under the cut ${t}`)
  }
  // Zombies must never bloom: body 0x401018x0.5 and the hit flash 0x661111 are
  // two orders of magnitude below the cut, so a walker at 30 m is untouched.
  assert.ok(post(0x401018, 0.5) < 0.01, 'zombie body emissive stays far below the bloom cut')
  assert.ok(post(0x661111, 1.0) < 0.1, 'zombie hit flash stays below the bloom cut')
  fx.dispose()
})

test('v6 visuals (4): halo reach is narrower than the round-41 baseline', () => {
  const fx = new PostFX(mkScene(), mkCamera(), fakeGLRenderer())
  // UnrealBloomPass spreads mip k by 0.5·radius·(2^k−1); the outermost mip
  // (k=5) sets the visible halo reach.
  const reach = (r) => 0.5 * r * (2 ** 5 - 1)
  assert.ok(reach(fx.bloom.radius) < reach(0.5), `halo reach ${reach(fx.bloom.radius).toFixed(2)} must be under the 0.5-radius baseline ${reach(0.5).toFixed(2)}`)
  assert.ok(fx.bloom.strength < 0.25, 'strength reduced below the 0.25 baseline')
  assert.ok(fx.bloom.strength > 0, 'bloom still present (restrained, not removed)')
  fx.dispose()
})

test('v6 visuals (4): per-tier bloom strength; tiers never enable post by themselves', () => {
  const fx = new PostFX(mkScene(), mkCamera(), fakeGLRenderer())
  assert.equal(fx.setTier('high'), 'high')
  assert.equal(fx.bloom.strength, 0.18)
  assert.equal(fx.setTier('medium'), 'medium')
  assert.equal(fx.bloom.strength, 0.12)
  assert.equal(fx.setTier('low'), 'low')
  assert.equal(fx.bloom.strength, 0.08)
  assert.equal(fx.setTier('nonsense'), 'high', 'unknown tier falls back to high')
  assert.equal(fx.bloom.strength, 0.18)
  // Cheap fallback: disabling post stops every composer render; the tier value
  // is retained but costs nothing while disabled.
  fx.setEnabled(false)
  assert.equal(fx.enabled, false)
  fx.setTier('low')
  fx.render()
  assert.equal(fx.bloom.strength, 0.08)
  fx.dispose()
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
  fx.setStrength(0.18)
  assert.equal(fx.bloom.strength, 0.18)
})

test('setSize + dispose on the enabled path', () => {
  const fx = new PostFX(mkScene(), mkCamera(), fakeGLRenderer())
  fx.setSize(640, 480)
  assert.equal(fx.enabled, true)
  fx.dispose()
  assert.equal(fx.enabled, false)
  assert.equal(fx.bloom, null)
  assert.equal(fx.grade, null)
  assert.equal(fx.gtao, null)
  assert.equal(fx.composer, null)
  fx.render()
})