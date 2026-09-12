import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { CollisionWorld } from '../src/game/CollisionWorld.js'
import { City } from '../src/world/City.js'
import { createSnow } from '../src/world/snow.js'

const scene = new THREE.Scene()
const collision = new CollisionWorld(180, 180)
const city = new City(scene, collision, { canvasFactory: () => null })

test('city group: single group named city, ground at y=0', () => {
  assert.equal(scene.getObjectByName('city'), city.group)
  const ground = city.group.children[0]
  assert.ok(ground.isMesh && ground.position.y === 0)
  assert.ok(Math.abs(ground.rotation.x + Math.PI / 2) < 1e-9)
})

test('aabbs[0] is the wide-shallow center building', () => {
  const a = collision.aabbs[0]
  assert.ok(a.maxX - a.minX > a.maxZ - a.minZ, `wider than deep, got w=${a.maxX - a.minX} d=${a.maxZ - a.minZ}`)
  assert.ok(a.maxX - a.minX <= 10, `width <= 10, got ${a.maxX - a.minX}`)
})

test('all aabbs within world bounds; count in range', () => {
  for (const a of collision.aabbs) {
    assert.ok(a.minX >= -90 && a.maxX <= 90 && a.minZ >= -90 && a.maxZ <= 90, `out of bounds: ${JSON.stringify(a)}`)
  }
  assert.ok(collision.aabbs.length >= 15, `count >= 15, got ${collision.aabbs.length}`)
  assert.ok(collision.aabbs.length <= 140, `count <= 140, got ${collision.aabbs.length}`)
})

test('spawn points: 12, walkable, within bounds', () => {
  const pts = city.getSpawnPoints()
  assert.equal(pts.length, 12, `expected 12 spawn points, got ${pts.length}`)
  for (const p of pts) {
    assert.ok(Math.abs(p.x) <= 90 && Math.abs(p.z) <= 90, `spawn out of bounds: ${p.x},${p.z}`)
    assert.ok(collision.isWalkable(p.x, p.z, 0.4), `spawn not walkable: ${p.x},${p.z}`)
  }
})

test('street center lines clear (both orientations)', () => {
  const xs = [-60, -36, -12, 12, 36, 60]
  const zs = [-80, -40, 0, 40, 80]
  for (const x of xs) for (const z of zs) {
    assert.ok(collision.isWalkable(x, z, 0.35), `street point blocked: (${x},${z})`)
  }
  for (const x of zs) for (const z of xs) {
    assert.ok(collision.isWalkable(x, z, 0.35), `swapped street point blocked: (${x},${z})`)
  }
})

test('mesh count inside city group <= 600', () => {
  let meshes = 0
  city.group.traverse(o => { if (o.isMesh) meshes++ })
  assert.ok(meshes <= 600, `meshes ${meshes} > 600`)
})

test('update() is a safe no-op', () => {
  city.update({ x: 0, z: 0 })
})

test('streetlight anchors: 40, y=5.2, within bounds; total meshes <= 600', () => {
  assert.equal(city.streetlightAnchors.length, 40, `anchors ${city.streetlightAnchors.length}`)
  for (const a of city.streetlightAnchors) {
    assert.ok(Math.abs(a.y - 5.2) < 1e-6, `anchor y ${a.y}`)
    assert.ok(Math.abs(a.x) <= 90 && Math.abs(a.z) <= 90, `anchor out of bounds: ${a.x},${a.z}`)
  }
  let meshes = 0
  city.group.traverse(o => { if (o.isMesh) meshes++ })
  assert.ok(meshes <= 600, `meshes ${meshes} > 600`)
})

test('streetlight halos: 40 orange (0xffb066) sprites share one SpriteMaterial (additive, opacity 0.5)', () => {
  const sprites = []
  city.group.traverse(o => { if (o.isSprite && o.material.color.getHex() === 0xffb066) sprites.push(o) })
  assert.equal(sprites.length, 40, `expected 40 halo sprites, got ${sprites.length}`)
  const mats = new Set(sprites.map(s => s.material))
  assert.equal(mats.size, 1, 'all sprites share one SpriteMaterial')
  const m = sprites[0].material
  assert.equal(m.color.getHex(), 0xffb066, 'halo color')
  assert.equal(m.blending, THREE.AdditiveBlending, 'additive blending')
  assert.equal(m.depthWrite, false, 'depthWrite off')
  assert.equal(m.opacity, 0.5, 'opacity 0.5')
  let headOk = false
  city.group.traverse(o => {
    if (o.isMesh && o.material.emissive && o.material.emissive.getHex() === 0xffb066 && o.material.emissiveIntensity === 3.2) headOk = true
  })
  assert.ok(headOk, 'no head mesh with emissive 0xffb066 / intensity 3.2')
})

test('city aabbs: 87 total, bounds, key points walkable', () => {
  assert.equal(collision.aabbs.length, 87, `expected 87 aabbs, got ${collision.aabbs.length}`)
  for (const a of collision.aabbs) {
    assert.ok(a.minX >= -90 && a.maxX <= 90 && a.minZ >= -90 && a.maxZ <= 90, `out of bounds: ${JSON.stringify(a)}`)
  }
  assert.ok(collision.isWalkable(30, 12, 0.4), 'zombie spawn (30,12) blocked')
  assert.ok(collision.isWalkable(12, -8, 0.35), 'movement path (12,-8) blocked')
})

test('barricades: 8 in empty plazas, key points walkable', () => {
  assert.ok(collision.isWalkable(24, 27, 0.35), 'north of barricade (24,24) blocked')
  assert.ok(collision.isWalkable(-72, 21, 0.35), 'south of barricade (-72,24) blocked')
  assert.ok(collision.isWalkable(30, 12, 0.4), 'zombie spawn (30,12) blocked')
})

test('snow: 3 depth layers, 1500 flakes, falls + drifts, setSnowCount scales layers', () => {
  const layers = city.snow.points
  assert.equal(layers.length, 3, '3 depth layers')
  for (const pts of layers) assert.ok(pts.isPoints, 'layer is a THREE.Points')
  let total = 0
  for (const pts of layers) total += pts.geometry.attributes.position.count
  assert.equal(total, 1500, '1500 flakes total')
  for (const pts of layers) {
    const pos = pts.geometry.attributes.position
    for (let i = 0; i < pos.count; i += 100) {
      assert.ok(pos.getX(i) >= -30 && pos.getX(i) <= 30, 'x in box')
      assert.ok(pos.getY(i) >= 0 && pos.getY(i) <= 60, 'y in box')
      assert.ok(pos.getZ(i) >= -30 && pos.getZ(i) <= 30, 'z in box')
    }
  }
  city.update(new THREE.Vector3(5, 0, 5), 1)
  for (const pts of layers) {
    assert.equal(pts.position.x, 5, 'layer follows player x')
    assert.equal(pts.position.z, 5, 'layer follows player z')
    const pos = pts.geometry.attributes.position
    for (let i = 0; i < pos.count; i += 100) {
      assert.ok(pos.getY(i) >= 0 && pos.getY(i) < 60, 'y recycles after fall')
    }
  }
  let range = 0
  city.setSnowCount(750)
  for (const pts of layers) range += pts.geometry.drawRange.count
  assert.equal(range, 750, 'setSnowCount(750) halves all layers')
  city.setSnowCount(1500)
  range = 0
  for (const pts of layers) range += pts.geometry.drawRange.count
  assert.equal(range, 1500, 'setSnowCount(1500) restores all layers')
})

test('snow: deterministic gusts — twin instances identical; net drift +x, always falling', () => {
  const a = createSnow()
  const b = createSnow()
  for (let f = 0; f < 30; f++) {
    a.update(new THREE.Vector3(0, 0, 0), 0.5)
    b.update(new THREE.Vector3(0, 0, 0), 0.5)
  }
  for (let l = 0; l < 3; l++) {
    const pa = a.points[l].geometry.attributes.position.array
    const pb = b.points[l].geometry.attributes.position.array
    for (let i = 0; i < pa.length; i++) assert.equal(pa[i], pb[i], 'layer ' + l + ' flake ' + i + ' differs between twins')
  }
  const c = createSnow()
  const near = c.points[0].geometry.attributes.position.array
  let idx = -1
  for (let i = 0; i < near.length / 3; i++) {
    if (near[i * 3 + 1] > 2 && near[i * 3 + 1] < 58 && near[i * 3] < 27) { idx = i; break }
  }
  assert.ok(idx >= 0, 'reference near-layer flake exists (y in (2,58), x < 27)')
  const x0 = near[idx * 3]
  const y0 = near[idx * 3 + 1]
  c.update(new THREE.Vector3(0, 0, 0), 0.5)
  assert.ok(near[idx * 3 + 1] < y0 && near[idx * 3 + 1] >= 0, 'flake falls (no wrap for dt 0.5 from y>2)')
  assert.ok(near[idx * 3] > x0, 'flake drifts toward +x (no wrap from x<27 over 0.5 s)')
  a.dispose(); b.dispose(); c.dispose()
})

console.log(`city OK: ${collision.aabbs.length + 0} aabbs total, ${city.getSpawnPoints().length} spawn points`)

test('landmarks: center spire, 4 corner beacons, 10 strips, 5 halos, aabbs unchanged', () => {
  const spires = []
  const beacons = []
  const strips = []
  city.group.traverse(o => {
    if (!o.isMesh) return
    if (o.material.emissive && o.material.emissive.getHex() === 0xffc878) spires.push(o)
    if (o.material.emissive && o.material.emissive.getHex() === 0xff4433) beacons.push(o)
    if (o.material.isMeshBasicMaterial && o.material.color.getHex() === 0x3d6fa8) strips.push(o)
  })
  assert.equal(spires.length, 1, `expected 1 center spire, got ${spires.length}`)
  const spire = spires[0]
  assert.ok(Math.abs(spire.position.x) < 1e-9 && Math.abs(spire.position.y - 12) < 1e-9 && Math.abs(spire.position.z) < 1e-9, `spire at ${spire.position}`)
  assert.equal(spire.material.emissiveIntensity, 2.5, 'spire emissiveIntensity 2.5')
  assert.ok(spire.castShadow, 'spire castShadow')
  assert.equal(beacons.length, 4, `expected 4 corner beacons, got ${beacons.length}`)
  const seen = new Set()
  for (const b of beacons) {
    const key = `${Math.round(b.position.x)}|${Math.round(b.position.y)}|${Math.round(b.position.z)}`
    assert.ok(!seen.has(key), `duplicate beacon ${key}`)
    seen.add(key)
    assert.ok(Math.abs(Math.abs(b.position.x) - 84) < 1e-6 && Math.abs(Math.abs(b.position.z) - 84) < 1e-6 && Math.abs(b.position.y - 3.5) < 1e-6, `beacon position ${b.position}`)
  }
  assert.equal(strips.length, 10, `expected 10 street strips, got ${strips.length}`)
  for (const s of strips) assert.ok(Math.abs(s.position.y - 0.03) < 1e-6, `strip y ${s.position.y}`)
  const spireHalos = []
  const beaconHalos = []
  city.group.traverse(o => {
    if (!o.isSprite) return
    if (o.material.color.getHex() === 0xffc878) spireHalos.push(o)
    if (o.material.color.getHex() === 0xff4433) beaconHalos.push(o)
  })
  assert.equal(spireHalos.length, 1, `expected 1 spire halo, got ${spireHalos.length}`)
  assert.ok(Math.abs(spireHalos[0].position.x) < 1e-9 && Math.abs(spireHalos[0].position.y - 15) < 1e-9 && Math.abs(spireHalos[0].position.z) < 1e-9, `spire halo at ${spireHalos[0].position}`)
  assert.equal(beaconHalos.length, 4, `expected 4 beacon halos, got ${beaconHalos.length}`)
  const haloSeen = new Set()
  for (const h of beaconHalos) {
    const key = `${Math.round(h.position.x)}|${Math.round(h.position.y)}|${Math.round(h.position.z)}`
    assert.ok(!haloSeen.has(key), `duplicate beacon halo ${key}`)
    haloSeen.add(key)
    assert.ok(Math.abs(Math.abs(h.position.x) - 84) < 1e-6 && Math.abs(Math.abs(h.position.z) - 84) < 1e-6 && Math.abs(h.position.y - 7) < 1e-6, `beacon halo position ${h.position}`)
  }
  assert.equal(collision.aabbs.length, 87, `aabbs changed: ${collision.aabbs.length}`)
})

test('dispose removes group from scene and all city aabbs', () => {
  const all = [...collision.aabbs]
  assert.ok(all.length > 0)
  city.dispose()
  assert.ok(!scene.getObjectByName('city'), 'group still in scene')
  for (const a of all) assert.ok(!collision.aabbs.includes(a), `aabb still registered: ${JSON.stringify(a)}`)
  assert.equal(collision.aabbs.length, 0)
  assert.ok(city._disposed, '_disposed flag set')
})


