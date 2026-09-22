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

test('swing animation: windup, forward slash strike, recovery to rest', () => {
  const player = fakePlayer(0, 0, 0)
  const { sword } = makeSetup(player, [])
  sword.update(0.016, player)
  sword.swing()
  // Mid-strike (cumulative ~0.106 s, k~0.33): the blade pitches forward,
  // translates toward the target, and the trail flashes on.
  sword.update(0.09, player)
  assert.ok(sword.view.rotation.y > -1.1 && sword.view.rotation.y < 1.3)
  assert.ok(sword.view.rotation.x < -0.3, `forward pitch ${sword.view.rotation.x.toFixed(3)}`)
  assert.ok(sword.view.position.z < -0.6, `forward push ${sword.view.position.z.toFixed(3)}`)
  assert.ok(sword._trailMat.opacity > 0.2, `trail ${sword._trailMat.opacity.toFixed(3)}`)
  // Recovery settles back to the exact rest pose once swingTime elapses.
  sword.update(0.25, player) // cumulative ~0.356 s >= swing time
  assert.equal(sword._swinging, false)
  assert.equal(sword.view.rotation.y, 0)
  assert.equal(sword.view.rotation.x, 0)
  assert.equal(sword.view.position.z, -0.6)
  assert.equal(sword._trailMat.opacity, 0)
  sword.dispose()
})

test('dispose detaches view from camera; double-safe', () => {
  const player = fakePlayer(0, 0, 0)
  const { camera, sword } = makeSetup(player, [])
  const meshes = sword.view.children.filter((c) => c.isMesh)
  assert.equal(meshes.length, 4, 'blade, guard, grip, slash trail present')
  sword.dispose()
  assert.equal(camera.children.length, 0)
  sword.dispose() // second call must not throw
})

test('alternating diagonal slash: roll flips sign each swing (R->L then L->R)', () => {
  const player = fakePlayer(0, 0, 0)
  const { camera, sword } = makeSetup(player, [])
  // First swing: right-to-left diagonal (one roll sign at mid-strike).
  sword.swing()
  sword.update(0.09, player) // reach mid-strike (roll near peak)
  const roll1 = sword.view.rotation.z
  assert.ok(Math.abs(roll1) > 0.3, `first swing rolls diagonally (${roll1.toFixed(3)})`)
  // Recovery to rest clears the roll.
  sword.update(0.25, player)
  assert.equal(sword.view.rotation.z, 0, 'rest pose clears the roll')
  // Second swing (after cooldown): opposite diagonal sign.
  sword._coolT = 0
  sword.swing()
  sword.update(0.09, player)
  const roll2 = sword.view.rotation.z
  assert.ok(Math.abs(roll2) > 0.3, `second swing rolls diagonally (${roll2.toFixed(3)})`)
  assert.ok(Math.sign(roll1) !== Math.sign(roll2), `roll alternates sign (${roll1.toFixed(3)} vs ${roll2.toFixed(3)})`)
  sword.dispose()
})
