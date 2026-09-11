import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { CollisionWorld } from '../src/game/CollisionWorld.js'
import { Zombie, TABLE } from '../src/game/Zombie.js'

function fakePlayer(x, z) {
  return {
    position: new THREE.Vector3(x, 1.7, z),
    isDead: false,
    health: 1000,
    damage(n, src) {
      if (!this.isDead) {
        this.health -= n
        if (this.health <= 0) this.isDead = true
      }
    }
  }
}

function makeZombie(type, x, z, wave = 1) {
  const scene = new THREE.Scene()
  const collision = new CollisionWorld(180, 180)
  const zombie = new Zombie(scene, type, x, z, wave)
  return { scene, collision, zombie }
}

test('stats: TABLE values exact, wave scaling rounds base * 1.12', () => {
  assert.deepEqual(TABLE.walker, { speed: .5 + 1, hp: 50, melee: 8, cooldown: 0.9 })
  assert.deepEqual(TABLE.shambler, { speed: 0.8, hp: 90, melee: 14, cooldown: 1.2 })
  assert.deepEqual(TABLE.screamer, { speed: 2.2, hp: 40, melee: 6, cooldown: 0.7 })
  const { zombie } = makeZombie('walker', 0, 0, 1)
  assert.equal(zombie.maxHealth, 50)
  const { zombie: w2 } = makeZombie('walker', 0, 0, 2)
  assert.equal(w2.maxHealth, 56) // Math.round(50 * 1.12)
  const { zombie: s2 } = makeZombie('shambler', 0, 0, 2)
  assert.equal(s2.maxHealth, 101) // Math.round(90 * 1.12)
})

test('unknown type throws', () => {
  const scene = new THREE.Scene()
  assert.throws(() => new Zombie(scene, 'ghoul', 0, 0, 1), /unknown zombie type: ghoul/)
})

test('pursuit: closes 10 m to ~8.5 m in 1 s and faces the player', () => {
  const { collision, zombie } = makeZombie('walker', 10, 0, 1)
  const player = fakePlayer(0, 0)
  for (let i = 0; i < 60; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  const d = Math.hypot(zombie.position.x, zombie.position.z)
  assert.ok(Math.abs(d - 8.5) < 0.3, `distance ${d} not ~8.5`)
  // Player is at -x from the zombie, so it must face -x: rotation.y = atan2(-10, 0).
  assert.ok(Math.abs(zombie.group.rotation.y + Math.PI / 2) < 1e-6, `rotation.y ${zombie.group.rotation.y}`)
})

test('melee within 1.3 m with per-type cooldown', () => {
  const { collision, zombie } = makeZombie('walker', 1.2, 0, 1)
  const player = fakePlayer(0, 0)
  for (let i = 0; i < 60; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  assert.equal(player.health, 992) // one 8-damage hit at t = 0.9 s
  for (let i = 0; i < 54; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  assert.equal(player.health, 984) // second hit at t = 1.8 s
})

test('kill: corpse sinks, deathTimer reaches 5 s', () => {
  const { collision, zombie } = makeZombie('walker', 3, 0, 1)
  const player = fakePlayer(-3, 0)
  zombie.damage(zombie.maxHealth + 10)
  assert.ok(zombie.isDead)
  assert.equal(zombie.health, 0)
  for (let i = 0; i < 302; i++) zombie.update(1 / 60, player, [zombie], collision, null) // ~5.03 s
  assert.ok(zombie.deathTimer >= 5, `deathTimer ${zombie.deathTimer}`)
  assert.ok(zombie.position.y < -0.5, `y ${zombie.position.y}`)
})

test('collision.resolve keeps the zombie out of the box; zombie routes around it', () => {
  const { collision, zombie } = makeZombie('walker', 3, 0, 1)
  collision.addAABB(-1, -1, 1, 1, 5)
  const player = fakePlayer(-3, 0)
  for (let i = 0; i < 180; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  // The zombie must never end up inside the box…
  assert.ok(collision.isWalkable(zombie.position.x, zombie.position.z, 0.5),
    `inside box at (${zombie.position.x}, ${zombie.position.z})`)
  // …and with wall-slide it now routes around the box (past the wall,
  // along its side) instead of vibrating against the face forever.
  assert.ok(zombie.position.x < 1.4, `x ${zombie.position.x} (expected to have passed the wall at 1 + radius)`)
})

test('head-on wall contact triggers slide along the face, no vibration', () => {
  // Zombie directly in front of a flat face, chasing straight into it.
  // The step is fully cancelled each frame (resolve restores pre-step
  // position), so the old `pushed`-based trigger never fired and the
  // zombie vibrated in place. It must now slide along the face.
  const { collision, zombie } = makeZombie('walker', 0, 41.1, 1)
  collision.addAABB(-2.75, 37.8, 2.75, 40.6, 5)
  const player = fakePlayer(0, 12) // straight-on chase
  for (let i = 0; i < 60; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  assert.ok(zombie.position.x > 0.5, `x ${zombie.position.x} (expected sliding along face)`)
  assert.ok(Math.abs(zombie.position.z - 41.1) < 1e-6, `z ${zombie.position.z} (must stay on face, 40.6 + radius 0.5)`)
  assert.ok(collision.isWalkable(zombie.position.x, zombie.position.z, 0.5))
})

test('hitboxes: torso r 0.45 @ y+1.2, head r 0.3 @ y+1.8, world space', () => {
  const { zombie } = makeZombie('shambler', 2, 4, 1)
  const hb = zombie.getHitboxes()
  assert.equal(hb.length, 2)
  assert.equal(hb[0].center.x, 2)
  assert.equal(hb[0].center.y, 1.2)
  assert.equal(hb[0].center.z, 4)
  assert.equal(hb[0].radius, 0.45)
  assert.equal(hb[0].isHead, false)
  assert.equal(hb[1].center.x, 2)
  assert.equal(hb[1].center.y, 1.8)
  assert.equal(hb[1].center.z, 4)
  assert.equal(hb[1].radius, 0.3)
  assert.equal(hb[1].isHead, true)
})

test('dead zombie inert: no movement, no damage to a live player', () => {
  const { collision, zombie } = makeZombie('walker', 1.2, 0, 1)
  const player = fakePlayer(0, 0)
  zombie.damage(zombie.maxHealth + 10)
  const bx = zombie.position.x
  const bz = zombie.position.z
  for (let i = 0; i < 60; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  assert.equal(zombie.position.x, bx)
  assert.equal(zombie.position.z, bz) // (y still sinks, per corpse behavior)
  assert.equal(player.health, 1000)
})

test('shared geometry/materials; dispose detaches only the group', () => {
  const scene = new THREE.Scene()
  const a = new Zombie(scene, 'walker', 0, 0, 1)
  const b = new Zombie(scene, 'walker', 2, 0, 1)
  assert.equal(a.group.children.length, 4)
  assert.equal(a.group.children[0].geometry, b.group.children[0].geometry)
  assert.equal(a.group.children[0].material, b.group.children[0].material)
  assert.equal(scene.children.length, 2) // two groups, no per-zombie geo
  a.dispose()
  assert.equal(scene.children.length, 1)
  b.dispose()
  assert.equal(scene.children.length, 0)
  a.dispose() // never throws, even when called twice
})

test('L-pocket: walker touching two boxes slides out and keeps moving', () => {
  // Pocket: thin box A [−2.75..2.75, 37.8..40.6] and box B [1..7.5, 40.5..47].
  // The walker starts at (0, 41.1), in contact with A's top face (and near B's
  // left face), chasing the player straight south. The old ±90°-of-want rule
  // picked the tangent running into B and stalled forever; the true contact
  // normal must send it out of the pocket.
  const { collision, zombie } = makeZombie('walker', 0, 41.1, 1)
  collision.addAABB(-2.75, 37.8, 2.75, 40.6, 5)
  collision.addAABB(1, 40.5, 7.5, 47, 5)
  const player = fakePlayer(0, 12)
  let moved = 0
  let px = zombie.position.x, pz = zombie.position.z
  for (let i = 0; i < 600; i++) {
    zombie.update(1 / 60, player, [zombie], collision, null)
    moved += Math.hypot(zombie.position.x - px, zombie.position.z - pz)
    px = zombie.position.x; pz = zombie.position.z
  }
  assert.ok(moved > 2, `total distance moved ${moved.toFixed(2)} m (expected > 2)`)
  assert.ok(zombie.position.z < 40 || Math.abs(zombie.position.x) > 3.3,
    `still stuck in pocket at (${zombie.position.x.toFixed(2)}, ${zombie.position.z.toFixed(2)})`)
  assert.ok(collision.isWalkable(zombie.position.x, zombie.position.z, 0.5))
})
