import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { Sky } from '../src/world/sky.js'

// Same moon math the module uses (moonDir must match Lighting.js MOON_OFFSET).
const MOON_DIR = new THREE.Vector3(-18, 30, -15).normalize()
const MOON_OFFSET = MOON_DIR.clone().multiplyScalar(380)

function newSky() {
  const scene = new THREE.Scene()
  return { scene, sky: new Sky(scene) }
}

function closeVec(a, b, eps = 1e-9, msg) {
  assert.ok(a.distanceTo(b) <= eps, msg || `${a} vs ${b} (eps ${eps})`)
}

test('counts: group has exactly 15 children; scene has 14 Mesh, 0 Light', () => {
  const { scene, sky } = newSky()
  assert.equal(sky.group.children.length, 15)
  let meshes = 0
  let lights = 0
  let points = 0
  scene.traverse(o => {
    if (o.isMesh) meshes++
    if (o.isLight) lights++
    if (o.isPoints) points++
  })
  assert.equal(meshes, 14, 'dome + moon + 12 silhouettes')
  assert.equal(points, 1, 'starfield is a single Points object')
  assert.equal(lights, 0)
  sky.dispose()
})

test('dome: ShaderMaterial with BackSide, radius 420, spec uniform colors', () => {
  const { sky } = newSky()
  assert.ok(sky.domeMat instanceof THREE.ShaderMaterial)
  assert.equal(sky.domeMat.side, THREE.BackSide)
  assert.equal(sky.domeGeo.parameters.radius, 420)
  assert.ok(sky.domeMat.uniforms.topColor.value.equals(new THREE.Color(0x04070f)))
  assert.ok(sky.domeMat.uniforms.horizonColor.value.equals(new THREE.Color(0x0d1626)))
  assert.ok(sky.domeMat.uniforms.glowColor.value.equals(new THREE.Color(0x2a3446)))
  sky.dispose()
})

test('fog off: moon and silhouette materials ignore scene fog', () => {
  const { sky } = newSky()
  assert.equal(sky.moonMat.fog, false, 'moon must be visible through FogExp2 at 380 m')
  assert.equal(sky.silhouetteMat.fog, false, 'silhouettes must be visible at 360-400 m')
  sky.dispose()
})

test('shared resources: all 12 silhouettes share one geometry and one material', () => {
  const { sky } = newSky()
  assert.equal(sky.silhouettes.length, 12)
  for (const m of sky.silhouettes) {
    assert.strictEqual(m.geometry, sky.silhouetteGeo, 'silhouette shares geometry reference')
    assert.strictEqual(m.material, sky.silhouetteMat, 'silhouette shares material reference')
  }
  sky.dispose()
})

test('LCG twin determinism: two instances produce identical layouts', () => {
  const a = newSky()
  const b = newSky()
  for (let i = 0; i < 12; i++) {
    closeVec(a.sky.silhouettes[i].position, b.sky.silhouettes[i].position, 1e-9, `silhouette ${i} position`)
    closeVec(a.sky.silhouettes[i].scale, b.sky.silhouettes[i].scale, 1e-9, `silhouette ${i} scale`)
  }
  closeVec(a.sky.dome.position, b.sky.dome.position, 1e-9, 'dome position')
  closeVec(a.sky.moon.position, b.sky.moon.position, 1e-9, 'moon position')
  assert.ok(a.sky.moonDir.equals(b.sky.moonDir), 'moonDir identical')
  const pa = a.sky.stars.points.geometry.attributes.position
  const pb = b.sky.stars.points.geometry.attributes.position
  assert.equal(pa.count, pb.count, 'star count identical')
  assert.equal(pa.array.toString(), pb.array.toString(), 'star positions identical')
  a.sky.dispose()
  b.sky.dispose()
})

test('update math: dome and moon follow player; silhouettes do not', () => {
  const { sky } = newSky()
  const before = sky.silhouettes.map(m => m.position.clone())
  const p1 = new THREE.Vector3(10, 0, -5)
  sky.update(p1)
  assert.ok(sky.dome.position.equals(p1), 'dome exactly at player')
  const m1 = p1.clone().add(MOON_OFFSET)
  closeVec(sky.moon.position, m1, 1e-3, `moon at p=(10,0,-5): ${sky.moon.position} vs ${m1}`)
  const p0 = new THREE.Vector3(0, 0, 0)
  sky.update(p0)
  assert.ok(sky.dome.position.equals(p0), 'dome exactly at origin')
  closeVec(sky.moon.position, MOON_OFFSET, 1e-3, `moon at origin: ${sky.moon.position} vs ${MOON_OFFSET}`)
  for (let i = 0; i < 12; i++) {
    assert.ok(sky.silhouettes[i].position.equals(before[i]), `silhouette ${i} must not follow player`)
  }
  sky.dispose()
})

test('headless safety: construct, update, dispose run in plain Node without browser globals', () => {
  assert.equal(typeof window, 'undefined', 'window must not exist in headless test')
  assert.equal(typeof document, 'undefined', 'document must not exist in headless test')
  const { scene, sky } = newSky()
  sky.update(new THREE.Vector3(3, 4, 5))
  assert.ok(sky.dome.position.equals(new THREE.Vector3(3, 4, 5)))
  sky.dispose()
  assert.equal(scene.children.length, 0)
})

test('dispose: group removed from scene and all eight resources dispatch dispose', () => {
  const { scene, sky } = newSky()
  const disposed = {}
  const keys = ['domeGeo', 'domeMat', 'moonGeo', 'moonMat', 'silhouetteGeo', 'silhouetteMat',
    'starGeo', 'starMat']
  for (const key of keys) {
    disposed[key] = 0
    sky[key].addEventListener('dispose', () => { disposed[key]++ })
  }
  sky.dispose()
  assert.equal(scene.children.length, 0, 'scene empty after dispose')
  assert.ok(!scene.children.includes(sky.group), 'group out of scene')
  for (const key of keys) {
    assert.ok(disposed[key] >= 1, `${key} never dispatched its dispose event`)
  }
})
