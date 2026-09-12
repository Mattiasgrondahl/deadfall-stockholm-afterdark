import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { CollisionWorld } from '../src/game/CollisionWorld.js'
import { City } from '../src/world/City.js'
import { Lighting } from '../src/world/Lighting.js'

function makeScene() {
  const scene = new THREE.Scene()
  const collision = new CollisionWorld(180, 180)
  const city = new City(scene, collision, { canvasFactory: () => null })
  const renderer = {
    info: { render: { calls: 0, triangles: 0 }, memory: {} },
    shadowMap: { enabled: false, type: 0 },
    toneMapping: 0
  }
  return { scene, city, renderer }
}

const lightCount = (scene) => {
  let n = 0
  scene.traverse(o => { if (o.isLight) n++ })
  return n
}

test('lighting: 15 lights (1 moon, 1 hemi, 1 ambient, 12 point); r185 settings; dispose', () => {
  const { scene, city, renderer } = makeScene()
  const li = new Lighting(scene, city, renderer, 'high')
  assert.equal(lightCount(scene), 15)
  assert.ok(li.moon.isDirectionalLight)
  assert.equal(li.moon.intensity, 1.1)
  assert.ok(li.moon.castShadow)
  assert.equal(li.moon.shadow.mapSize.x, 2048)
  assert.equal(li.moon.shadow.bias, 0.004)
  assert.equal(li.moon.shadow.normalBias, 0.05)
  assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping)
  assert.equal(renderer.toneMappingExposure, 1.2)
  assert.ok(renderer.shadowMap.enabled, 'high quality enables shadows')
  li.dispose()
  assert.equal(lightCount(scene), 0, 'dispose removes all lights')
  assert.equal(renderer.shadowMap.enabled, false, 'dispose disables shadows')
})

test('update: moon follows player; 12 distinct nearest anchors at 35 cd', () => {
  const { scene, city, renderer } = makeScene()
  const li = new Lighting(scene, city, renderer, 'high')
  const p = { x: -80, z: 0 }
  li.update(p)
  assert.equal(li.moon.position.x, -80 - 18)
  assert.equal(li.moon.position.y, 30)
  assert.equal(li.moon.position.z, 0 - 15)
  assert.equal(li.moon.target.position.x, -80)
  assert.equal(li.moon.target.position.z, 0)
  const seen = new Set()
  for (const l of li.lights) {
    assert.equal(l.intensity, 35, `light ${l.position.x},${l.position.z} not 35 cd`)
    assert.equal(l.distance, 20)
    assert.equal(l.decay, 2)
    const a = city.streetlightAnchors.find(a => Math.abs(a.x - l.position.x) < 1e-6 && Math.abs(a.y - l.position.y) < 1e-6 && Math.abs(a.z - l.position.z) < 1e-6)
    assert.ok(a, `light not at a streetlight anchor: ${l.position.x},${l.position.z}`)
    seen.add(`${a.x},${a.z}`)
  }
  assert.equal(seen.size, 12, '12 distinct anchors used')
  li.dispose()
})

test('setQuality low: 6 lights, shadows off, snow halved; high restores', () => {
  const { scene, city, renderer } = makeScene()
  const li = new Lighting(scene, city, renderer, 'high')
  li.update({ x: 0, z: 0 })
  li.setQuality('low')
  assert.equal(li.lights.filter(l => l.intensity === 35).length, 6)
  assert.equal(renderer.shadowMap.enabled, false)
  assert.equal(city.snow.points.geometry.drawRange.count, 750, 'snow halved')
  li.setQuality('high')
  assert.equal(li.lights.filter(l => l.intensity === 35).length, 12)
  assert.ok(renderer.shadowMap.enabled)
  assert.equal(city.snow.points.geometry.drawRange.count, 1500, 'snow restored')
  li.dispose()
})
