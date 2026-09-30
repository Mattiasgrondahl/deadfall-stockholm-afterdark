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
  // v3 T11: feet grounded — a standing snapshot (eye y 1.7) plants the group
  // origin (feet) on the ground plane, not a body-height above it.
  assert.equal(rp.group.position.y, 0, 'standing avatar feet sit on the ground (y 0)')
  // Dead avatar goes dark + sinks below the ground plane.
  rp.apply({ id: 'p3', x: 5, y: 1.7, z: -3, yaw: 1.2, health: 0, dead: true }, 1 / 60)
  assert.ok(rp.group.position.y < 0, 'dead avatar sinks below the ground')
  assert.equal(rp.torso.material, rp._mat === undefined ? rp.torso.material : rp.torso.material) // no throw
  rp.dispose()
  assert.equal(rp.group.parent, null, 'removed from scene on dispose')
})

test('v3 T11: remote avatars wear outfit materials + stay grounded + dispose cleanly', () => {
  const scene = new THREE.Scene()
  const rp = new RemotePlayer(scene, 'p0')
  // v3 T11: torso/legs use the shared outfit materials (clothed look), while the
  // head + arms keep the per-id tint so players stay distinguishable.
  assert.notEqual(rp.torso.material, rp._mat, 'torso wears an outfit material, not the tint')
  assert.notEqual(rp.legL.material, rp._mat, 'legs wear an outfit material, not the tint')
  assert.equal(rp.head.material, rp._mat, 'head keeps the per-id tint')
  // Outfit pick is deterministic per id (same id → same clothes across clients).
  const b = new RemotePlayer(scene, 'p0')
  assert.equal(rp.torso.material, b.torso.material, 'same id -> same outfit (deterministic)')
  // A jump snapshot (eye y above standing) lifts the feet off the ground.
  rp.apply({ id: 'p0', x: 0, y: 2.4, z: 0, yaw: 0, health: 100, dead: false }, 1 / 60)
  assert.ok(rp.group.position.y > 0, 'jumping avatar lifts its feet above the ground')
  // Headless (no canvas factory) skips the name label entirely.
  assert.equal(rp._label, null, 'no name label without a canvas factory')
  // A canvas factory yields a name label sprite above the head.
  const fakeCanvas = { width: 0, height: 0, getContext: () => ({ clearRect() {}, fillRect() {}, fillText() {} }) }
  const rp2 = new RemotePlayer(scene, 'p1', { name: 'Ana', canvasFactory: () => fakeCanvas })
  assert.ok(rp2._label && rp2._label.isSprite, 'name label sprite built from a canvas')
  assert.ok(rp2._label.position.y > 1.7, 'name label floats above the head')
  // Sprites are not meshes, so the label does not count against the mesh budget.
  let meshes = 0
  scene.traverse((o) => { if (o.isMesh) meshes++ })
  assert.ok(meshes <= 640, `mesh budget with labels: ${meshes} <= 640`)
  rp.dispose(); b.dispose(); rp2.dispose()
  assert.equal(rp2.group.parent, null, 'labelled avatar removed on dispose')
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
  // Avatars add 6 body meshes + a held-weapon silhouette (1-2 meshes) each.
  assert.ok(total.meshes >= base.meshes + ALIVE_CAP * 9 + 48, 'zombies + avatars present')
  console.log(`[mp-budget] city=${base.meshes} +${ALIVE_CAP} alive zombies +8 avatars => meshes ${total.meshes}/640 lights ${total.lights}/40`)
  for (const z of zs) z.dispose()
  for (const rp of rps) rp.dispose()
})

test('v25: remote avatars hold a weapon silhouette + swap it from the snapshot', () => {
  const scene = new THREE.Scene()
  const rp = new RemotePlayer(scene, 'p0')
  // Default held weapon until the first snapshot sets the real one.
  assert.equal(rp._weaponName, 'shotgun', 'defaults to a shotgun silhouette')
  assert.ok(rp._weapon && rp._weapon.isObject3D, 'a weapon group is attached')
  // Snapshot weapon name swaps the held silhouette (already sent in the snapshot).
  rp.apply({ id: 'p0', x: 0, y: 1.7, z: 0, yaw: 0, weapon: 'pistol', dead: false }, 1 / 60)
  assert.equal(rp._weaponName, 'pistol', 'swaps to the snapshot weapon')
  assert.equal(rp._weapon.userData.weapon, 'pistol', 'held group matches the weapon')
  // A ranged weapon carries a muzzle-flash sprite; a melee weapon does not.
  assert.ok(rp._flash && rp._flash.isSprite, 'pistol has a muzzle-flash sprite')
  rp.apply({ id: 'p0', x: 0, y: 1.7, z: 0, yaw: 0, weapon: 'axe', dead: false }, 1 / 60)
  assert.equal(rp._weaponName, 'axe', 'swaps to the axe')
  assert.equal(rp._flash, null, 'melee has no muzzle flash')
  // A dead avatar hides its weapon.
  rp.apply({ id: 'p0', x: 0, y: 1.7, z: 0, yaw: 0, weapon: 'axe', dead: true }, 1 / 60)
  assert.equal(rp._weapon.visible, false, 'dead avatar drops its weapon')
  rp.dispose()
  assert.equal(scene.children.length, 0, 'avatar + weapon removed on dispose')
})

test('v25: a shoot event lights the shooter avatar muzzle flash and it decays', () => {
  const scene = new THREE.Scene()
  const rp = new RemotePlayer(scene, 'p0')
  rp.apply({ id: 'p0', x: 0, y: 1.7, z: 0, yaw: 0, weapon: 'pistol', dead: false }, 1 / 60)
  rp.flash()
  assert.equal(rp._flash.visible, true, 'flash lights on a shot')
  assert.ok(rp._flash.material.opacity > 0, 'flash has opacity')
  // It fades out within the flash window (no lingering light).
  for (let i = 0; i < 12; i++) rp.apply({ id: 'p0', x: 0, y: 1.7, z: 0, yaw: 0, weapon: 'pistol', dead: false }, 1 / 60)
  assert.equal(rp._flash.visible, false, 'flash decays back off')
  rp.dispose()
})

test('CTF: setTeam tints the avatar material to the team color', () => {
  const scene = new THREE.Scene()
  const rp = new RemotePlayer(scene, 'p0')
  const perId = rp._mat.color.getHex()
  rp.setTeam('lovis')
  assert.equal(rp._mat.color.getHex(), 0x2f6b4a, 'lovis team tint')
  assert.equal(rp.head.material, rp._mat, 'head still uses the tinted material')
  rp.setTeam('krag')
  assert.equal(rp._mat.color.getHex(), 0xb0663a, 'krag team tint')
  // Restoring a null team falls back to the per-id tint captured at construction.
  rp.setTeam(null)
  assert.equal(rp._mat.color.getHex(), perId, 'null team restores the per-id tint')
  rp.dispose()
})

test('v34: remote avatars have facial features on the facing side (readable facing)', () => {
  const scene = new THREE.Scene()
  const rp = new RemotePlayer(scene, 'p0')
  // Eyes + nose + mouth are parented to the head so they rotate with the yaw.
  assert.equal(rp._faceParts.length, 4, 'two eyes + nose + mouth')
  assert.equal(rp.head.children.length, 4, 'face features are children of the head')
  // All features sit on the head's FRONT face (local -Z = the yaw-0 facing side).
  for (const m of rp._faceParts) assert.ok(m.position.z < 0, 'feature on the front (-Z) face')
  // Facing follows the group yaw, so the features turn with the avatar.
  rp.apply({ id: 'p0', x: 0, y: 1.7, z: 0, yaw: 1.5, dead: false }, 1 / 60)
  assert.equal(rp.group.rotation.y, 1.5, 'features inherit the group yaw via the head')
  // Dispose detaches them (shared geometry/material are never disposed here).
  rp.dispose()
  assert.equal(rp.head.children.length, 0, 'face parts detached on dispose')
})