import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { DecapitatedHeadPool } from '../src/game/DecapitatedHeadPool.js'
import { GEO2, DEADMAT } from '../src/game/Zombie.js'

const DT = 1 / 60
const fakeZombie = (x, z, y = 0) => ({ position: new THREE.Vector3(x, y, z) })

test('spawn: shared resources, head height, thrown along dir', () => {
  const scene = new THREE.Scene()
  const pool = new DecapitatedHeadPool(scene)
  const mesh = pool.spawn(fakeZombie(10, 10), { x: 1, z: 0 })
  assert.equal(pool.count(), 1)
  assert.ok(scene.children.includes(mesh))
  assert.strictEqual(mesh.geometry, GEO2.head, 'reuses shared head geometry')
  assert.strictEqual(mesh.material, DEADMAT, 'reuses shared death material')
  assert.equal(mesh.position.y, 1.8, 'spawns at head height above the zombie')
  const h = pool.heads[0][1]
  assert.ok(h.vx > 0 && h.vz === 0, 'thrown along dir')
  assert.ok(h.vx > 2 && h.vx < 3.5, 'speed in the 2..3.5 m/s band')
  pool.dispose()
  assert.equal(pool.count(), 0)
  assert.ok(!scene.children.includes(mesh), 'dispose detaches from scene')
})

test('null dir falls back to a deterministic LCG direction', () => {
  const scene = new THREE.Scene()
  const pool = new DecapitatedHeadPool(scene)
  const mesh = pool.spawn(fakeZombie(0, 0), null)
  for (let i = 0; i < 120; i++) pool.update(DT) // 2 s
  assert.ok(Math.hypot(mesh.position.x, mesh.position.z) > 1, 'head travels a real distance')
  pool.dispose()
})

test('physics: bounces, rolls in the travel direction, rests at radius height', () => {
  const scene = new THREE.Scene()
  const pool = new DecapitatedHeadPool(scene)
  pool.spawn(fakeZombie(0, 0), { x: 1, z: 0 }) // thrown in +X
  const [mesh] = pool.heads[0]
  for (let i = 0; i < 30; i++) pool.update(DT) // 0.5 s
  assert.ok(mesh.position.x > 0.5, 'travels in throw direction early on')
  assert.ok(mesh.position.y > 0.15, 'still airborne at 0.5 s')
  for (let i = 0; i < 90; i++) pool.update(DT) // 2 s total
  assert.ok(mesh.position.x > 1.5 && mesh.position.x < 5, 'travels a few metres')
  assert.ok(Math.abs(mesh.position.y - 0.15) < 0.1, 'settles at rest height')
  // dir +X -> roll axis (vz, 0, -vx) = (0, 0, -1): rotation accumulates on -Z,
  // so the top of the head moves with the travel (+X) direction. (Rotation is
  // applied on ground-contact frames, so a few bounces give ~0.5 rad.)
  assert.ok(mesh.rotation.z < -0.5, 'rolled over in the travel direction')
  pool.dispose()
})

test('pool cap 3 with oldest-first eviction', () => {
  const scene = new THREE.Scene()
  const pool = new DecapitatedHeadPool(scene)
  const m1 = pool.spawn(fakeZombie(0, 0), { x: 1, z: 0 })
  const m2 = pool.spawn(fakeZombie(1, 0), { x: 1, z: 0 })
  const m3 = pool.spawn(fakeZombie(2, 0), { x: 1, z: 0 })
  assert.equal(pool.count(), 3, 'at capacity')
  const m4 = pool.spawn(fakeZombie(3, 0), { x: 1, z: 0 })
  assert.equal(pool.count(), 3, 'cap holds after fourth spawn')
  assert.ok(!scene.children.includes(m1), 'oldest head evicted')
  assert.ok(scene.children.includes(m2) && scene.children.includes(m3) && scene.children.includes(m4))
  pool.dispose()
  assert.equal(scene.children.length, 0)
})

test('heads sink out after 12 s and are removed from the scene', () => {
  const scene = new THREE.Scene()
  const pool = new DecapitatedHeadPool(scene)
  pool.spawn(fakeZombie(0, 0), { x: 1, z: 0 })
  for (let i = 0; i < 60 * 11; i++) pool.update(DT) // 11 s
  assert.equal(pool.count(), 1, 'still present before 12 s')
  assert.equal(pool.heads[0][1].sinking, false)
  for (let i = 0; i < 60 * 3; i++) pool.update(DT) // 14 s total
  // Sinking starts at 12 s from y ≈ 0.15 at 0.4 m/s -> floor (-0.3) at ~13.125 s.
  assert.equal(pool.count(), 0, 'sunk out and removed')
  assert.equal(scene.children.length, 0)
  pool.dispose() // no-op after full drain
})

test('clear removes all heads (game reset); pool reusable', () => {
  const scene = new THREE.Scene()
  const pool = new DecapitatedHeadPool(scene)
  pool.spawn(fakeZombie(0, 0), { x: 1, z: 0 })
  pool.spawn(fakeZombie(1, 0), { x: 1, z: 0 })
  pool.clear()
  assert.equal(pool.count(), 0)
  assert.equal(scene.children.length, 0)
  const m = pool.spawn(fakeZombie(2, 0), { x: 1, z: 0})
  assert.ok(scene.children.includes(m), 'pool reusable after clear')
  pool.dispose()
})

test('deterministic: same spawn sequence -> same trajectories', () => {
  const a = new DecapitatedHeadPool(new THREE.Scene())
  const b = new DecapitatedHeadPool(new THREE.Scene())
  a.spawn(fakeZombie(2, 3), { x: 1, z: 0.5 })
  b.spawn(fakeZombie(2, 3), { x: 1, z: 0.5 })
  const sa = [], sb = []
  for (let i = 0; i < 240; i++) {
    a.update(DT); b.update(DT)
    const snap = (p) => JSON.stringify(p.heads.map(([m]) => [
      m.position.x, m.position.y, m.position.z,
      m.rotation.x, m.rotation.y, m.rotation.z
    ]))
    sa.push(snap(a)); sb.push(snap(b))
  }
  assert.deepStrictEqual(sa, sb)
  a.dispose(); b.dispose()
})

test('dispose never touches shared GEO2/DEADMAT', () => {
  const scene = new THREE.Scene()
  const pool = new DecapitatedHeadPool(scene)
  pool.spawn(fakeZombie(0, 0), { x: 1, z: 0 })
  pool.dispose()
  // Shared resources must still be usable by later spawns (Zombie.js owns them).
  const pool2 = new DecapitatedHeadPool(scene)
  const m = pool2.spawn(fakeZombie(5, 5), { x: 1, z: 0 })
  assert.strictEqual(m.geometry, GEO2.head)
  assert.strictEqual(m.material, DEADMAT)
  pool2.dispose()
})
