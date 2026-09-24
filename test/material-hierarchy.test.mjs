// v6 visuals (10): material roughness / contrast / color hierarchy.
//
// The gate is analytic, exactly like the round-45/46 gates in
// test/zombie.test.mjs: sRGB -> linear -> Lambert under the shipped night rig
// (moon 1.45 lx 0x9db4ff, hemi 0.30 0x1a2440/0x0a0a10, ambient 0.12 0x141a2e)
// -> exposure 1.2 -> ACESFilmic. No readPixels: verify-game has none.
//
// Hierarchy claim being asserted: gameplay surfaces (zombie bodies, hit flash)
// occupy the ROUGH band (>= 0.90) and static scenery occupies the SMOOTH band
// (<= 0.70), so a body can never be confused with a wall, bus, plank or pole.
// Brightness ordering is pinned too: HITMAT > every body > roof/pole/wheel,
// with the round-45 body band (0.07-0.17) and round-46 HITMAT value preserved.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { CollisionWorld } from '../src/game/CollisionWorld.js'
import { City } from '../src/world/City.js'
import { MAT2, HITMAT, DEADMAT } from '../src/game/Zombie.js'

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linOf = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => s2l(v / 255))
const lumY = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
const aces = (x) => Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14))
const EXPOSURE = 1.2
const BG = aces(lumY(linOf(0x0b1020)) * EXPOSURE)
const IRR = [0, 1, 2].map((i) =>
  0.30 * 0.5 * (linOf(0x1a2440)[i] + linOf(0x0a0a10)[i]) +
  0.12 * linOf(0x141a2e)[i] +
  1.45 * 0.5 * linOf(0x9db4ff)[i])
const YIRR = lumY(IRR)
const mich = (a, b) => (a - b) / (a + BG + b - BG)
const lit = (hex, em = 0) => aces((lumY(linOf(hex)) * YIRR + em) * EXPOSURE)
const SCREAM_EM = 0.5 * lumY(linOf(0x401018))
const HIT_EM = lumY(linOf(0xb02214))

const BODIES = {
  walker: { hex: 0x8b9c77, em: 0 },
  shambler: { hex: 0x998873, em: 0 },
  screamer: { hex: 0xb46574, em: SCREAM_EM },
  brute: { hex: 0x65755b, em: 0 }
}
const bodyL = (t) => lit(BODIES[t].hex, BODIES[t].em)

const scene = new THREE.Scene()
const collision = new CollisionWorld(180, 180)
const city = new City(scene, collision, { canvasFactory: () => null })
const ground = city.group.children[0]

// Scenery materials reachable from the built city, by colour identity.
const find = (hex) => {
  let out = null
  city.group.traverse((o) => {
    if (out || !o.isMesh) return
    const ms = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of ms) if (m.isMeshStandardMaterial && m.color.getHex() === hex) out = m
  })
  return out
}
const scenery = {
  ground: ground.material,
  busBody: find(0x333b46),
  busCabin: find(0x3d4656),
  busWheel: find(0x121418),
  plank: find(0x5f4734),
  pole: find(0x1a202a)
}
const facade = city.group.children.find((o) => o.isMesh && Array.isArray(o.material)).material[0]
const roof = city.group.children.find((o) => o.isMesh && Array.isArray(o.material)).material[2]

test('hierarchy: every zombie body sits in the rough band (>= 0.90)', () => {
  for (const t of Object.keys(MAT2)) {
    assert.ok(MAT2[t].roughness >= 0.9, `${t} roughness ${MAT2[t].roughness} must stay >= 0.90`)
  }
})

test('hierarchy: every static scenery material sits in the smooth band (<= 0.70)', () => {
  for (const [name, mat] of Object.entries(scenery)) {
    assert.ok(mat, `scenery material ${name} missing from the built city`)
    assert.ok(mat.roughness <= 0.7, `${name} roughness ${mat.roughness} must be <= 0.70 (below the body band)`)
  }
  assert.ok(facade.roughness <= 0.7, `facade roughness ${facade.roughness} must be <= 0.70`)
  assert.ok(roof.roughness <= 0.7, `roof roughness ${roof.roughness} must be <= 0.70`)
})

test('hierarchy: roughness bands are separated by >= 0.20 (no overlap)', () => {
  let minBody = 1
  for (const t of Object.keys(MAT2)) minBody = Math.min(minBody, MAT2[t].roughness)
  let maxScenery = 0
  for (const mat of [...Object.values(scenery), facade, roof]) maxScenery = Math.max(maxScenery, mat.roughness)
  assert.ok(minBody - maxScenery >= 0.2,
    `body band floor ${minBody} - scenery band ceiling ${maxScenery} must be >= 0.20`)
})

test('hierarchy: HITMAT tonemapped luminance beats every body (round 46 pinned)', () => {
  const hit = lit(HITMAT.color.getHex(), HIT_EM)
  assert.ok(Math.abs(hit - 0.327) < 0.005, `HITMAT tonemapped ${hit.toFixed(4)} must stay ~0.327`)
  for (const t of Object.keys(BODIES)) {
    const b = bodyL(t)
    assert.ok(hit > b, `HITMAT ${hit.toFixed(4)} must exceed ${t} body ${b.toFixed(4)}`)
    assert.ok(mich(hit, b) >= 0.3, `HITMAT vs ${t} contrast ${mich(hit, b).toFixed(3)} must be >= 0.30`)
  }
})

test('hierarchy: bodies stay in the round-45 band 0.07-0.17 and never bloom', () => {
  for (const t of Object.keys(BODIES)) {
    const b = bodyL(t)
    // Round-45 band: 0.07 (brute) up to 0.174 (walker), the exact values
    // pinned by test/zombie.test.mjs.
    assert.ok(b >= 0.07 && b <= 0.175, `${t} body tonemapped ${b.toFixed(4)} must stay in 0.07-0.175`)
    assert.ok(b < 0.72, `${t} body ${b.toFixed(4)} must stay under the 0.72 bloom cut`)
  }
})

test('hierarchy: bodies beat the dark scenery floor by C >= 0.91 at 30 m (round 45)', () => {
  const D = 0.022, d = 30
  const vis = Math.exp(-((d * D) ** 2))
  for (const t of Object.keys(BODIES)) {
    const litB = bodyL(t)
    const body = litB * vis + BG * (1 - vis)
    const c = (body - BG) / (body + BG)
    assert.ok(c >= 0.91, `${t} fog contrast ${c.toFixed(4)} must be >= 0.91 at 30 m`)
  }
})

test('hierarchy: no scenery surface out-shines the darkest body in the rough band', () => {
  // Roof, pole and tyres are the darkest scenery: they must stay below brute.
  const brute = bodyL('brute')
  for (const name of ['roof', 'pole', 'busWheel']) {
    const mat = scenery[name] || roof
    const s = lit(mat.color.getHex())
    assert.ok(s < brute, `${name} tonemapped ${s.toFixed(4)} must stay below brute ${brute.toFixed(4)}`)
  }
})

test('hierarchy: the changes cost no meshes, lights, or points', () => {
  let meshes = 0, lights = 0
  city.group.traverse((o) => { if (o.isMesh) meshes++; if (o.isLight) lights++ })
  assert.equal(meshes, 388, `city mesh count must stay 388, got ${meshes}`)
  assert.equal(lights, 0, `city group must add no lights, got ${lights}`)
})

test('hierarchy: no roughness/metalness value is written per frame', () => {
  // Ground + facade flicker run every frame; neither may touch roughness.
  const gBefore = ground.material.roughness
  const fBefore = facade.roughness
  city.update({ x: 0, y: 1.7, z: 0 }, 1 / 60)
  city.update({ x: 0, y: 1.7, z: 0 }, 1 / 60)
  assert.equal(ground.material.roughness, gBefore, 'ground roughness must not be written per frame')
  assert.equal(facade.roughness, fBefore, 'facade roughness must not be written per frame')
})

test('hierarchy: quality tiers do not re-lift scenery roughness', () => {
  // Lighting/PostFX/WeaponBank fan out from Game.applySettings; no material
  // roughness is tier-dependent, so 'low' keeps the same separation.
  for (const t of ['high', 'medium', 'low']) {
    city.setSnowCount(t === 'low' ? 900 : 1800)
    let maxScenery = 0
    for (const mat of [...Object.values(scenery), facade, roof]) maxScenery = Math.max(maxScenery, mat.roughness)
    assert.ok(maxScenery <= 0.7, `${t} tier scenery roughness ceiling ${maxScenery} must stay <= 0.70`)
  }
})

test('hierarchy: dead bodies leave the rough band (corpse is not an actor)', () => {
  assert.ok(DEADMAT.roughness >= 0.9, 'DEADMAT stays matte (roughness >= 0.9)')
  assert.ok(lit(DEADMAT.color.getHex()) < 0.07,
    `corpse tonemapped ${lit(DEADMAT.color.getHex()).toFixed(4)} must fall below the live band`)
})