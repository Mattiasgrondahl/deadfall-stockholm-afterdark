// FlagRender headless test — client-side CTF flag rendering from a snapshot.
// Verifies it builds headlessly, positions banners for at-base / carried /
// dropped states, and disposes cleanly (meshes removed + geos/mats disposed).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { FlagRender } from '../src/world/FlagRender.js'

function countMeshes(scene) {
  let n = 0
  scene.traverse((o) => { if (o.isMesh) n++ })
  return n
}

test('builds headlessly with two poles + two banners + two rings', () => {
  const scene = new THREE.Scene()
  const fr = new FlagRender({ scene, bases: { lovis: { x: -90, z: -90 }, krag: { x: 90, z: 90 } } })
  assert.equal(countMeshes(scene), 6, '6 meshes (2 pole + 2 banner + 2 ring)')
  fr.dispose()
})

test('carried banner rides above the carrier', () => {
  const scene = new THREE.Scene()
  const fr = new FlagRender({ scene })
  const ctf = { flags: { lovis: { carrier: null, dropped: null }, krag: { carrier: 'a', dropped: null } } }
  const players = [{ id: 'a', x: 10, y: 1.7, z: 20 }]
  fr.sync(ctf, players)
  const kragBanner = fr._parts.krag.banner
  assert.ok(Math.abs(kragBanner.position.x - 10) < 1 && Math.abs(kragBanner.position.z - 20) < 1, 'krag banner tracks carrier')
  assert.ok(kragBanner.position.y > 1.7, 'banner floats above the carrier')
  fr.dispose()
})

test('dropped banner lies at the drop spot', () => {
  const scene = new THREE.Scene()
  const fr = new FlagRender({ scene })
  const ctf = { flags: { lovis: { carrier: null, dropped: { x: 5, z: -3 } }, krag: { carrier: null, dropped: null } } }
  fr.sync(ctf, [])
  const lb = fr._parts.lovis.banner
  assert.ok(Math.abs(lb.position.x - 5) < 0.01 && Math.abs(lb.position.z - (-3)) < 0.01, 'banner at drop point')
  assert.ok(lb.position.y < 1, 'banner near the ground when dropped')
  fr.dispose()
})

test('at-base banner sits on its pedestal', () => {
  const scene = new THREE.Scene()
  const fr = new FlagRender({ scene, bases: { lovis: { x: -90, z: -90 }, krag: { x: 90, z: 90 } } })
  const ctf = { flags: { lovis: { carrier: null, dropped: null }, krag: { carrier: null, dropped: null } } }
  fr.sync(ctf, [])
  const lb = fr._parts.lovis.banner
  assert.ok(Math.abs(lb.position.x - (-90)) < 2 && Math.abs(lb.position.z - (-90)) < 1, 'banner near its own base')
  fr.dispose()
})

test('dispose removes all meshes and disposes geos+mats', () => {
  const scene = new THREE.Scene()
  const fr = new FlagRender({ scene })
  let disposed = 0
  for (const g of [fr._poleGeo, fr._bannerGeo, fr._ringGeo]) {
    g.addEventListener('dispose', () => disposed++)
  }
  let matDisposed = 0
  for (const m of fr._mats) m.addEventListener('dispose', () => matDisposed++)
  fr.dispose()
  assert.equal(countMeshes(scene), 0, 'no meshes left in scene')
  assert.equal(disposed, 3, 'all 3 geometries disposed')
  assert.equal(matDisposed, 6, 'all 6 materials disposed')
})