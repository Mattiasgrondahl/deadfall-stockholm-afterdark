// v6 visuals (2): quality-tiered fog + atmospheric layering. 'high' keeps the
// pinned baseline (density 0.022, color 0x0b1020); 'medium'/'low' are thinner
// but still inside both readability gates. vis(d) = exp(-(d*density)^2) must
// satisfy vis(30) >= 0.60 (zombie at 30 m readable) and vis(80) < 0.15 (city
// depth cue) for EVERY tier. Headless-safe: no window/document access.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { Game, FOG_TIERS } from '../src/game/Game.js'

const vis = (d, density) => Math.exp(-((d * density) ** 2))

function newHeadlessGame() {
  const game = new Game({ headless: true })
  game.start() // start() -> setupScene() creates scene.fog
  return game
}

test('fog: default (high) tier is FogExp2 with the pinned density and color', () => {
  const game = newHeadlessGame()
  assert.ok(game.scene.fog instanceof THREE.FogExp2, 'scene fog must be FogExp2')
  assert.equal(game.scene.fog.density, 0.022, 'high-tier density unchanged')
  assert.equal(game.scene.fog.color.getHex(), 0x0b1020, 'fog color unchanged')
  assert.equal(FOG_TIERS.high.density, 0.022)
  assert.equal(FOG_TIERS.high.color, 0x0b1020)
})

test('fog tiers: quality changes retune density live, thinner but inside gates', () => {
  const game = newHeadlessGame()
  for (const q of ['high', 'medium', 'low']) {
    game.settings.set('quality', q) // onChange -> applySettings -> setFogQuality
    const tier = FOG_TIERS[q]
    assert.equal(game.scene.fog.density, tier.density, `${q}: density follows tier`)
    assert.equal(game.scene.fog.color.getHex(), tier.color, `${q}: color unchanged`)
    // Thinner than the pinned baseline for the cheaper tiers.
    if (q !== 'high') assert.ok(tier.density < 0.022, `${q}: thinner fog than high`)
    assert.ok(vis(30, tier.density) >= 0.60, `${q}: 30 m visibility ${vis(30, tier.density).toFixed(4)} >= 0.60`)
    assert.ok(vis(80, tier.density) < 0.15, `${q}: 80 m visibility ${vis(80, tier.density).toFixed(4)} < 0.15`)
  }
  // Unknown tiers collapse to the cheapest one, mirroring Lighting.setQuality.
  assert.equal(game.setFogQuality('ultra').density, FOG_TIERS.low.density)
})

test('fog gates: high tier keeps near-range readability and far-range depth', () => {
  const rho = FOG_TIERS.high.density
  assert.ok(vis(30, rho) >= 0.60, `30 m visibility ${vis(30, rho).toFixed(4)} >= 0.60 (targets readable)`)
  assert.ok(vis(80, rho) < 0.15, `80 m visibility ${vis(80, rho).toFixed(4)} < 0.15 (city depth cue preserved)`)
})

test('atmosphere: ground haze adds 2 fog-free additive meshes, no lights/points', () => {
  const game = newHeadlessGame()
  const s = game.sceneStats()
  assert.ok(s.meshes <= 600, `mesh budget ${s.meshes} <= 600`)
  assert.ok(s.lights <= 40, `light budget ${s.lights} <= 40`)
  assert.ok(s.points <= 2500, `point budget ${s.points} <= 2500`)
  assert.ok(game.haze && game.haze.near && game.haze.far, 'haze layers exist')
  for (const m of [game.haze.near, game.haze.far]) {
    assert.equal(m.material.fog, false, 'haze must not be erased by scene fog')
    assert.equal(m.material.blending, THREE.AdditiveBlending, 'haze is additive')
    assert.equal(m.material.depthWrite, false, 'haze must not occlude')
    assert.equal(m.material.transparent, true)
  }
  // The near band must stay faint at the 30 m readability gate (never wash a
  // zombie out): it is a pool at the player's feet, not a wall of mist.
  const aNear30 = 1 - Math.exp(-((30 * game.haze.near.material.uniforms.uK.value) ** 2))
  assert.ok(aNear30 < 0.12, `near haze at 30 m ${aNear30.toFixed(4)} < 0.12`)
  assert.ok(game.haze.near.material.uniforms.uCap.value <= 0.16, 'near band capped at 0.16')
  // The far band is negligible at 30 m and capped past that, so it cannot bury
  // a zombie but still reads as receding mist toward the skyline.
  const aFar30 = 1 - Math.exp(-((30 * game.haze.far.material.uniforms.uK.value) ** 2))
  const aFar80 = Math.min(1 - Math.exp(-((80 * game.haze.far.material.uniforms.uK.value) ** 2)),
    game.haze.far.material.uniforms.uCap.value)
  assert.ok(aFar30 < 0.10, `far haze at 30 m ${aFar30.toFixed(4)} < 0.10`)
  assert.ok(aFar80 <= 0.22, `far haze at 80 m ${aFar80.toFixed(4)} <= 0.22 cap`)
  // Ground/road fog tuning is per-material and must not disable fog entirely.
  const gm = game.city.ground.material
  assert.equal(gm.fog, true, 'ground keeps scene fog')
  assert.equal(gm.fogDensity, 0.82, 'ground is more fog-transparent than buildings')
  // dispose() must remove both layers (no leaked meshes) and leave no haze.
  const before = game.sceneStats().meshes
  game.dispose()
  assert.equal(game.sceneStats().meshes, before - 2, 'dispose removes both haze meshes')
  assert.equal(game.haze, null, 'haze reference cleared')
})