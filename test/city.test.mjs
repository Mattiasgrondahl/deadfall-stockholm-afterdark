import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { CollisionWorld } from '../src/game/CollisionWorld.js'
import { City } from '../src/world/City.js'

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

test('snow: 1500 flakes, update falls, setSnowCount changes drawRange', () => {
  const pts = city.snow.points
  assert.ok(pts.isPoints, 'snow is a THREE.Points')
  const pos = pts.geometry.attributes.position
  assert.equal(pos.count, 1500, '1500 flakes')
  for (let i = 0; i < pos.count; i += 100) {
    assert.ok(pos.getX(i) >= -30 && pos.getX(i) <= 30, 'x in box')
    assert.ok(pos.getY(i) >= 0 && pos.getY(i) <= 60, 'y in box')
    assert.ok(pos.getZ(i) >= -30 && pos.getZ(i) <= 30, 'z in box')
  }
  city.update(new THREE.Vector3(5, 0, 5), 1)
  assert.equal(pts.position.x, 5, 'points follow player x')
  assert.equal(pts.position.z, 5, 'points follow player z')
  for (let i = 0; i < pos.count; i += 100) {
    assert.ok(pos.getY(i) >= 0 && pos.getY(i) < 60, 'y recycles after fall')
  }
  city.setSnowCount(750)
  assert.equal(pts.geometry.drawRange.count, 750, 'setSnowCount(750)')
  city.setSnowCount(1500)
  assert.equal(pts.geometry.drawRange.count, 1500, 'setSnowCount(1500)')
})

console.log(`city OK: ${collision.aabbs.length + 0} aabbs total, ${city.getSpawnPoints().length} spawn points`)

test('dispose removes group from scene and all city aabbs', () => {
  const all = [...collision.aabbs]
  assert.ok(all.length > 0)
  city.dispose()
  assert.ok(!scene.getObjectByName('city'), 'group still in scene')
  for (const a of all) assert.ok(!collision.aabbs.includes(a), `aabb still registered: ${JSON.stringify(a)}`)
  assert.equal(collision.aabbs.length, 0)
  assert.ok(city._disposed, '_disposed flag set')
})


