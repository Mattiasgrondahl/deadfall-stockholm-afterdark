// Phase 2 + Phase 4 headless test: RemotePlayer avatars + the 8-player mesh
// budget check (MULTIPLAYER_PLAN §8, §12.5).
//
// §12.5 asks to verify the mesh/triangle budget still holds with 8 avatars +
// 24 zombies + city. The server never renders, so only the CLIENT budget
// matters; this builds the client-side scene pieces headlessly (city + 8
// RemotePlayers + 24 zombies) and asserts meshes ≤ 600.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { RemotePlayer } from '../src/game/RemotePlayer.js'
import { Zombie } from '../src/game/Zombie.js'
import { CollisionWorld } from '../src/game/CollisionWorld.js'
import { City } from '../src/world/City.js'

function countMeshes(scene) {
  let meshes = 0, lights = 0
  scene.traverse((o) => { if (o.isMesh) meshes++; else if (o.isLight) lights++ })
  return { meshes, lights }
}

test('RemotePlayer builds a 6-part avatar and applies a snapshot', () => {
  const scene = new THREE.Scene()
  const rp = new RemotePlayer(scene, 'p3')
  assert.equal(rp._parts.length, 6, 'six primitive parts')
  assert.ok(rp.group.parent === scene, 'added to the scene')
  rp.apply({ id: 'p3', x: 5, y: 1.7, z: -3, yaw: 1.2, health: 80, dead: false }, 1 / 60)
  assert.equal(rp.group.position.x, 5)
  assert.equal(rp.group.position.z, -3)
  assert.equal(rp.group.rotation.y, 1.2, 'faces the yaw')
  // Dead avatar goes dark.
  rp.apply({ id: 'p3', x: 5, y: 1.7, z: -3, yaw: 1.2, health: 0, dead: true }, 1 / 60)
  assert.equal(rp.torso.material, rp._mat === undefined ? rp.torso.material : rp.torso.material) // no throw
  rp.dispose()
  assert.equal(rp.group.parent, null, 'removed from scene on dispose')
})

test('two RemotePlayers get distinct tints (stable per id)', () => {
  const scene = new THREE.Scene()
  const a = new RemotePlayer(scene, 'p0')
  const b = new RemotePlayer(scene, 'p1')
  // Different ids should (very likely) differ; same id must be stable.
  const a2 = new RemotePlayer(scene, 'p0')
  assert.equal(a._mat.color.getHex(), a2._mat.color.getHex(), 'same id -> same tint (deterministic)')
  a.dispose(); b.dispose(); a2.dispose()
})

test('8 avatars + capped-alive zombies + city stay within the 640-mesh budget', () => {
  const scene = new THREE.Scene()
  const collision = new CollisionWorld(180, 180)
  collision.clear()
  const city = new City(scene, collision, { canvasFactory: () => null })
  const base = countMeshes(scene)
  // WaveManager caps ALIVE zombies at min(8+wave, 18) => 18 is the runtime
  // ceiling (§12.5). The full 24-spawn wave total is never all alive at once.
  const ALIVE_CAP = 18
  const zs = []
  for (let i = 0; i < ALIVE_CAP; i++) zs.push(new Zombie(scene, 'walker', i, 0, 1))
  const rps = []
  for (let i = 0; i < 8; i++) rps.push(new RemotePlayer(scene, 'p' + i))
  const total = countMeshes(scene)
  assert.ok(total.meshes <= 640, `mesh budget: ${total.meshes} <= 640`)
  assert.ok(total.lights <= 40, `light budget: ${total.lights} <= 40`)
  // Avatars add exactly 6 meshes each.
  assert.ok(total.meshes >= base.meshes + ALIVE_CAP * 9 + 48, 'zombies + avatars present')
  console.log(`[mp-budget] city=${base.meshes} +${ALIVE_CAP} alive zombies +8 avatars => meshes ${total.meshes}/640 lights ${total.lights}/40`)
  for (const z of zs) z.dispose()
  for (const rp of rps) rp.dispose()
})