import { test } from 'node:test'
import assert from 'node:assert'
import { CollisionWorld } from '../src/game/CollisionWorld.js'

const R = 0.35 // typical player radius

test('resolve: pushes out of a box from the side', () => {
  const w = new CollisionWorld(100, 100)
  w.addAABB(-2, -2, 2, 2, 5)
  const pos = { x: 1.0, z: 0 } // inside box edge zone
  w.resolve(pos, R)
  assert.ok(pos.x > 2 + R - 1e-6, `expected x >= ${2 + R}, got ${pos.x}`)
  assert.strictEqual(pos.z, 0)
})

test('resolve: corner push-out keeps circle outside', () => {
  const w = new CollisionWorld(100, 100)
  w.addAABB(-2, -2, 2, 2, 5)
  const pos = { x: 2.1, z: 2.1 } // just outside the corner
  w.resolve(pos, R)
  const cx = Math.min(pos.x, 2)
  const cz = Math.min(pos.z, 2)
  const d = Math.hypot(pos.x - cx, pos.z - cz)
  assert.ok(d >= R - 1e-6, `corner distance ${d} < radius`)
})

test('resolve: center inside box exits along nearest face', () => {
  const w = new CollisionWorld(100, 100)
  w.addAABB(-2, -2, 2, 2, 5)
  const pos = { x: 0, z: 0.2 } // inside, nearer top face
  w.resolve(pos, R)
  assert.ok(pos.z >= 2 + R - 1e-6, `exited top: z=${pos.z}`)
  assert.ok(Math.abs(pos.x) <= 2)
})

test('resolve: multiple overlapping boxes settle in two passes', () => {
  const w = new CollisionWorld(100, 100)
  w.addAABB(-3, -1, 0, 1, 5)
  w.addAABB(-1, -1, 2, 1, 5)
  const pos = { x: -1, z: 0 } // inside both
  w.resolve(pos, R)
  for (const b of w.aabbs) {
    const cx = Math.min(Math.max(pos.x, b.minX), b.maxX)
    const cz = Math.min(Math.max(pos.z, b.minZ), b.maxZ)
    assert.ok(Math.hypot(pos.x - cx, pos.z - cz) >= R - 1e-6)
  }
})

test('resolve: world bounds clamp', () => {
  const w = new CollisionWorld(40, 40)
  const pos = { x: 100, z: -100 }
  w.resolve(pos, R)
  assert.strictEqual(pos.x, 20 - R)
  assert.strictEqual(pos.z, -20 + R)
})

test('isWalkable', () => {
  const w = new CollisionWorld(40, 40)
  w.addAABB(-2, -2, 2, 2, 5)
  assert.ok(w.isWalkable(0, 0, R) === false)
  assert.ok(w.isWalkable(5, 0, R) === true)
  assert.ok(w.isWalkable(19.9, 0, R) === false) // world edge
})

test('castRay: hits box face at correct distance', () => {
  const w = new CollisionWorld(100, 100)
  w.addAABB(-2, -2, 2, 2, 5)
  const hit = w.castRay({ x: -10, z: 0 }, { x: 1, z: 0 }, 50)
  assert.ok(hit, 'expected a hit')
  assert.ok(Math.abs(hit.dist - 8) < 1e-6, `dist ${hit.dist}`)
})

test('castRay: misses a box; world bounds still occlude', () => {
  const w = new CollisionWorld(100, 100)
  w.addAABB(-2, -2, 2, 2, 5)
  // Parallel to the box, flies past it; the world edge (z=50) occludes.
  const hit = w.castRay({ x: 0, z: 10 }, { x: 0, z: 1 }, 50)
  assert.ok(hit, 'world bounds should occlude')
  assert.strictEqual(hit.point.z, 50)
  // Far away in x, beyond maxDist: nothing hit at all.
  assert.strictEqual(w.castRay({ x: -10, z: 5 }, { x: 1, z: 0 }, 5), null)
})

test('castRay: nearest of two obstacles wins', () => {
  const w = new CollisionWorld(100, 100)
  w.addAABB(-2, -2, 2, 2, 5)
  w.addAABB(-8, -1, -6, 1, 5)
  const hit = w.castRay({ x: -20, z: 0 }, { x: 1, z: 0 }, 50)
  assert.ok(hit)
  assert.ok(Math.abs(hit.dist - 12) < 1e-6, `dist ${hit.dist}`) // -20 -> -8
})

test('castRay: respects maxDist', () => {
  const w = new CollisionWorld(100, 100)
  w.addAABB(-2, -2, 2, 2, 5)
  assert.strictEqual(w.castRay({ x: -10, z: 0 }, { x: 1, z: 0 }, 5), null)
})

test('castRay: ray from inside an obstacle exits at far face', () => {
  const w = new CollisionWorld(100, 100)
  w.addAABB(-2, -2, 2, 2, 5)
  const hit = w.castRay({ x: 0, z: 0 }, { x: 1, z: 0 }, 50)
  assert.ok(hit)
  assert.ok(Math.abs(hit.dist - 2) < 1e-6, `dist ${hit.dist}`)
})

test('clear: removes all AABBs, keeps world bounds', () => {
  const w = new CollisionWorld(100, 100)
  w.addAABB(-2, -2, 2, 2, 5)
  w.addAABB(5, 5, 9, 9, 3)
  assert.equal(w.aabbs.length, 2)
  w.clear()
  assert.equal(w.aabbs.length, 0)
  // A point that was blocked is now walkable; bounds still apply.
  assert.ok(w.isWalkable(0, 0, R), 'cleared interior is walkable')
  assert.ok(!w.isWalkable(49.9, 0, R), 'world bound still blocks')
  // A ray now only hits the world boundary.
  const hit = w.castRay({ x: 0, z: 0 }, { x: 1, z: 0 }, 100)
  assert.ok(hit)
  assert.ok(Math.abs(hit.dist - 50) < 1e-6, `boundary dist ${hit.dist}`)
})

test('resolve: no tunneling at reasonable speeds', () => {
  const w = new CollisionWorld(100, 100)
  w.addAABB(-1, -2, 1, 2, 5)
  // 6 m/s * 0.016 s = 0.096 m per step; step 200 frames toward the wall
  // from the RIGHT side; the circle must stop just short of the near face.
  const pos = { x: 8, z: 0 }
  for (let i = 0; i < 200; i++) {
    pos.x -= 0.096
    w.resolve(pos, R)
  }
  assert.ok(pos.x <= 1 + R + 1e-5, `tunneled through: ${pos.x}`)
  assert.ok(pos.x >= 1 + R - 1e-4, `stopped too early: ${pos.x}`)
  assert.ok(w.isWalkable(pos.x, pos.z, R), 'resting position must be walkable')
})
