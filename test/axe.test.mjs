import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { Axe } from '../src/game/Axe.js'
import { Zombie } from '../src/game/Zombie.js'

function fakePlayer(x, z, yaw = 0) {
  return { position: new THREE.Vector3(x, 1.7, z), yaw, isDead: false }
}

function makeSetup(player, zombies) {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera()
  camera.position.copy(player.position)
  const axe = new Axe(scene, camera, null)
  axe.getZombies = () => zombies
  return { scene, camera, axe }
}

test('stats: contract values exact', () => {
  const { axe } = makeSetup(fakePlayer(0, 0), [])
  assert.equal(axe.dmg, 25)
  assert.equal(axe.headMultiplier, 2)
  assert.equal(axe.headRange, 0.6)
  assert.equal(axe.range, 1.5)
  assert.equal(axe.arc, 0.7)
  assert.equal(axe.cooldown, 0.9)
  assert.equal(axe.swingTime, 0.25)
  assert.equal(axe.infiniteAmmo, true)
  axe.dispose()
})

test('arc hit: forward zombie hit, side and far untouched', () => {
  const player = fakePlayer(0, 0, 0) // yaw 0 faces -Z
  const front = new Zombie(new THREE.Scene(), 'walker', 0, -1.0, 1)
  const side = new Zombie(new THREE.Scene(), 'walker', 1.0, 0, 1)
  const far = new Zombie(new THREE.Scene(), 'walker', 0, -2.0, 1)
  const { axe } = makeSetup(player, [front, side, far])
  axe.update(0.016, player)
  assert.equal(axe.swing(), true)
  assert.equal(front.health, front.maxHealth - 25) // body
  assert.equal(side.health, side.maxHealth)        // 90 deg right, outside arc
  assert.equal(far.health, far.maxHealth)          // 2 m > 1.5 m reach
  axe.dispose()
})

test('headshot only up close (<= 0.6 m)', () => {
  const player = fakePlayer(0, 0, 0)
  const close = new Zombie(new THREE.Scene(), 'walker', 0, -0.5, 1)
  const mid = new Zombie(new THREE.Scene(), 'walker', 0, -1.0, 1)
  const { axe } = makeSetup(player, [close, mid])
  axe.update(0.016, player)
  axe.swing()
  assert.equal(close.health, close.maxHealth - 50) // headshot
  assert.equal(mid.health, mid.maxHealth - 25)     // body
  axe.dispose()
})

test('cooldown blocks rapid swings', () => {
  const player = fakePlayer(0, 0, 0)
  const { axe } = makeSetup(player, [])
  axe.update(0.016, player)
  assert.equal(axe.swing(), true)
  assert.equal(axe.swing(), false) // still in cooldown
  for (let i = 0; i < 55; i++) axe.update(1 / 60, player) // ~0.917 s
  assert.equal(axe.swing(), true)
  axe.dispose()
})

test('swing animation: windup, forward slash strike, recovery to rest', () => {
  const player = fakePlayer(0, 0, 0)
  const { axe } = makeSetup(player, [])
  axe.update(0.016, player)
  axe.swing()
  // Mid-strike (cumulative ~0.086 s, k~0.34): the head pitches forward,
  // translates toward the target, and the trail flashes on.
  axe.update(0.07, player)
  assert.ok(axe.view.rotation.y > -0.9 && axe.view.rotation.y < 1.1)
  assert.ok(axe.view.rotation.x < -0.3, `forward pitch ${axe.view.rotation.x.toFixed(3)}`)
  assert.ok(axe.view.position.z < -0.5, `forward push ${axe.view.position.z.toFixed(3)}`)
  assert.ok(axe._trailMat.opacity > 0.2, `trail ${axe._trailMat.opacity.toFixed(3)}`)
  // Recovery settles back to the exact rest pose once swingTime elapses.
  axe.update(0.3, player) // cumulative ~0.386 s >= swing time
  assert.equal(axe._swinging, false)
  assert.equal(axe.view.rotation.y, 0)
  assert.equal(axe.view.rotation.x, 0)
  assert.equal(axe.view.position.z, -0.5)
  assert.equal(axe._trailMat.opacity, 0)
  axe.dispose()
})

test('dispose detaches view from camera; double-safe', () => {
  const player = fakePlayer(0, 0, 0)
  const { camera, axe } = makeSetup(player, [])
  assert.ok(camera.children.length >= 1)
  axe.dispose()
  assert.equal(camera.children.length, 0)
  axe.dispose() // second call must not throw
})
