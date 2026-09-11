import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { AmmoDrops, DROP_CHANCE, SHELLS_PER_DROP, PICKUP_RADIUS, LIFETIME, BLINK_AFTER, MAX_DROPS } from '../src/game/AmmoDrops.js'

const fakeAudio = () => ({ pickup: () => {} })
const fakePlayer = (x, z, isDead = false) => ({ position: new THREE.Vector3(x, 1.7, z), isDead })

function makeManager() {
  const scene = new THREE.Scene()
  const drops = new AmmoDrops(scene, fakeAudio())
  return { scene, drops }
}

test('constants match the contract', () => {
  assert.equal(DROP_CHANCE, 0.55)
  assert.equal(SHELLS_PER_DROP, 8)
  assert.equal(PICKUP_RADIUS, 1.2)
  assert.equal(LIFETIME, 30)
  assert.equal(BLINK_AFTER, 25)
  assert.equal(MAX_DROPS, 20)
})

test('drop roll is a seeded LCG: identical sequences across instances', () => {
  const a = makeManager(), b = makeManager()
  const ra = [], rb = []
  for (let i = 0; i < 10; i++) { ra.push(a.drops._rand()); rb.push(b.drops._rand()) }
  assert.deepEqual(ra, rb)
  const sa = [], sb = []
  for (let i = 0; i < 30; i++) { sa.push(a.drops.maybeSpawn(i, 0)); sb.push(b.drops.maybeSpawn(i, 0)) }
  assert.deepEqual(sa, sb)
  assert.equal(a.drops.count, b.drops.count)
  assert.ok(a.drops.count < 30)
  a.drops.dispose(); b.drops.dispose()
})

test('cap: at most 20 concurrent drops', () => {
  const { drops } = makeManager()
  drops._rand = () => 0 // force every roll to hit
  for (let i = 0; i < 25; i++) drops.maybeSpawn(i, 0)
  assert.equal(drops.count, MAX_DROPS)
  assert.equal(drops.maybeSpawn(99, 0), false)
  drops.dispose()
})

test('lifetime: expires at 30 s; blinks after 25 s', () => {
  const { drops } = makeManager()
  drops._rand = () => 0
  drops.maybeSpawn(5, 5)
  const d = drops._drops[0]
  drops.update(20, null, null)
  assert.equal(d.mesh.visible, true)
  assert.equal(drops.count, 1)
  drops.update(5.1, null, null) // t = 25.1
  assert.equal(d.mesh.visible, false) // floor(25.1 * 3) = 75, odd
  drops.update(0.4, null, null) // t = 25.5
  assert.equal(d.mesh.visible, true)  // floor(76.5) = 76, even
  drops.update(4.5, null, null) // t = 30
  assert.equal(drops.count, 0)
  drops.dispose()
})

test('pickup within 1.2 m fires onPickup once and removes the drop', () => {
  const { drops } = makeManager()
  drops._rand = () => 0
  drops.maybeSpawn(5, 5)
  let pickups = 0
  drops.update(0.1, fakePlayer(5.5, 5), () => pickups++) // 0.5 m away
  assert.equal(pickups, 1)
  assert.equal(drops.count, 0)
  drops.maybeSpawn(5, 5)
  drops.update(0.1, fakePlayer(7, 5), () => pickups++) // 2 m away: no pickup
  assert.equal(pickups, 1)
  assert.equal(drops.count, 1)
  drops.update(0.1, fakePlayer(5, 5, true), () => pickups++) // dead player never picks up
  assert.equal(pickups, 1)
  drops.dispose()
})

test('clear + dispose remove everything and are double-safe', () => {
  const { scene, drops } = makeManager()
  drops._rand = () => 0
  drops.maybeSpawn(0, 0); drops.maybeSpawn(3, 3)
  assert.equal(drops.count, 2)
  assert.equal(scene.children.length, 2)
  drops.clear()
  assert.equal(drops.count, 0)
  assert.equal(scene.children.length, 0)
  drops.dispose()
  drops.dispose() // second call must not throw
})
