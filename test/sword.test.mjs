import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { Sword } from '../src/game/Sword.js'
import { Zombie } from '../src/game/Zombie.js'

function fakePlayer(x, z, yaw = 0) {
  return { position: new THREE.Vector3(x, 1.7, z), yaw, isDead: false }
}

function fakeBlood() {
  return { bursts: [], burst(...args) { this.bursts.push(args) } }
}

function makeSetup(player, zombies) {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera()
  camera.position.copy(player.position)
  const sword = new Sword(scene, camera, null)
  sword.getZombies = () => zombies
  return { scene, camera, sword }
}

test('stats: contract values exact', () => {
  const { sword } = makeSetup(fakePlayer(0, 0), [])
  assert.equal(sword.dmg, 45)
  assert.equal(sword.headMultiplier, 2)
  assert.equal(sword.headRange, 0.7)
  assert.equal(sword.range, 1.8)
  assert.equal(sword.arc, 0.8)
  assert.equal(sword.cooldown, 1.15)
  assert.equal(sword.swingTime, 0.32)
  assert.equal(sword.infiniteAmmo, true)
  sword.dispose()
})

test('arc hit: forward zombie hit, side and far untouched', () => {
  const player = fakePlayer(0, 0, 0) // yaw 0 faces -Z
  const front = new Zombie(new THREE.Scene(), 'walker', 0, -1.0, 1)
  const side = new Zombie(new THREE.Scene(), 'walker', 1.5, 0, 1)
  const far = new Zombie(new THREE.Scene(), 'walker', 0, -2.0, 1)
  const { sword } = makeSetup(player, [front, side, far])
  sword.update(0.016, player)
  assert.equal(sword.swing(), true)
  assert.equal(front.health, front.maxHealth - 45) // body
  assert.equal(side.health, side.maxHealth)        // outside the 0.8 rad arc
  assert.equal(far.health, far.maxHealth)          // 2 m > 1.8 m reach
  sword.dispose()
})

test('headshot only up close (<= 0.7 m)', () => {
  const player = fakePlayer(0, 0, 0)
  const close = new Zombie(new THREE.Scene(), 'walker', 0, -0.5, 1)
  const mid = new Zombie(new THREE.Scene(), 'walker', 0, -1.0, 1)
  const { sword } = makeSetup(player, [close, mid])
  sword.update(0.016, player)
  sword.swing()
  assert.equal(close.health, 0, 'headshot: 45 * 2 exceeds a 50 hp walker (clamped)')
  assert.equal(close.isDead, true)
  assert.equal(mid.health, mid.maxHealth - 45)     // body
  sword.dispose()
})

test('fatal headshot fires onDecapitate; body kill does not', () => {
  const player = fakePlayer(0, 0, 0)
  const close = new Zombie(new THREE.Scene(), 'walker', 0, -0.5, 1) // 90 dmg kills
  const mid = new Zombie(new THREE.Scene(), 'walker', 0, -1.0, 1)   // 45 dmg does not
  const decapCalls = []
  const { sword } = makeSetup(player, [close, mid])
  sword.onDecapitate = (z, dir) => decapCalls.push([z, dir])
  sword.update(0.016, player)
  sword.swing()
  assert.equal(close.isDead, true)
  assert.equal(mid.isDead, false)
  assert.equal(decapCalls.length, 1, 'only the fatal headshot decapitated')
  assert.equal(decapCalls[0][0], close)
  assert.ok(decapCalls[0][1], 'facing direction passed through')
  assert.ok(Math.abs(decapCalls[0][1].x) < 1e-9)
  assert.equal(decapCalls[0][1].z, -1) // yaw 0 faces -Z
  sword.dispose()
})

test('blood bursts on hits with scaled damage', () => {
  const player = fakePlayer(0, 0, 0)
  const close = new Zombie(new THREE.Scene(), 'walker', 0, -0.5, 1)
  const { sword } = makeSetup(player, [close])
  sword.blood = fakeBlood()
  sword.update(0.016, player)
  sword.swing()
  assert.equal(sword.blood.bursts.length, 1)
  assert.equal(sword.blood.bursts[0][3], 90, 'headshot burst scaled 2x')
  assert.equal(sword.blood.bursts[0][4], true, 'headHit flag set')
  sword.dispose()
})

test('cooldown blocks rapid swings', () => {
  const player = fakePlayer(0, 0, 0)
  const { sword } = makeSetup(player, [])
  sword.update(0.016, player)
  assert.equal(sword.swing(), true)
  assert.equal(sword.swing(), false) // still in cooldown
  for (let i = 0; i < 70; i++) sword.update(1 / 60, player) // ~1.167 s
  assert.equal(sword.swing(), true)
  sword.dispose()
})

test('swing animation: backswing to follow-through, back to rest', () => {
  const player = fakePlayer(0, 0, 0)
  const { sword } = makeSetup(player, [])
  sword.update(0.016, player)
  sword.swing()
  sword.update(0.08, player)
  assert.ok(sword.view.rotation.y > -1.1 && sword.view.rotation.y < 1.3)
  sword.update(0.16, player) // cumulative 0.24 s
  assert.ok(sword.view.rotation.y > -0.3) // progressed toward follow-through
  sword.update(0.16, player) // cumulative 0.40 s >= swing time
  assert.equal(sword._swinging, false)
  assert.equal(sword.view.rotation.y, 0)
  sword.dispose()
})

test('dispose detaches view from camera; double-safe', () => {
  const player = fakePlayer(0, 0, 0)
  const { camera, sword } = makeSetup(player, [])
  const meshes = sword.view.children.filter((c) => c.isMesh)
  assert.equal(meshes.length, 3, 'blade, guard, grip present')
  sword.dispose()
  assert.equal(camera.children.length, 0)
  sword.dispose() // second call must not throw
})
