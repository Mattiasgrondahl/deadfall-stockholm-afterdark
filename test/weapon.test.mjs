import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { CollisionWorld } from '../src/game/CollisionWorld.js'
import { Weapon } from '../src/game/Weapon.js'

function makeWeapon() {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 400)
  camera.position.set(0, 1.7, 12)
  const collision = new CollisionWorld(180, 180)
  const weapon = new Weapon(scene, camera, collision, null)
  weapon._rng = () => 0.5 // deterministic: zero spread jitter
  return { scene, camera, collision, weapon }
}

function fakeZombie(x, z) {
  return {
    isDead: false,
    hits: [],
    getHitboxes: () => [
      { center: new THREE.Vector3(x, 1.2, z), radius: 0.45, isHead: false },
      { center: new THREE.Vector3(x, 1.8, z), radius: 0.3, isHead: true }
    ],
    damage(amount, dir) { this.hits.push({ amount, dir }) }
  }
}

test('weapon stats match the contract', () => {
  const { weapon } = makeWeapon()
  assert.equal(weapon.magSize, 12)
  assert.equal(weapon.ammo, 12)
  assert.equal(weapon.reserve, 60)
  assert.equal(weapon.damage, 34)
  assert.equal(weapon.headMultiplier, 2)
  assert.equal(weapon.range, 60)
  assert.equal(weapon.reloadTime, 2.2)
})

test('semi-auto: one shot per edge, 0.12 s interval enforced', () => {
  const { weapon } = makeWeapon()
  weapon.inputState = { fire: false, reload: false, sprint: false }
  weapon.update(0)
  weapon.inputState.fire = true
  weapon.update(0)
  assert.equal(weapon.ammo, 11, 'first shot fires')
  weapon.inputState.fire = true
  weapon.update(0.05)
  assert.equal(weapon.ammo, 11, 'second shot blocked by fire interval')
  weapon.inputState.fire = true
  weapon.update(0.08) // 0.13 s total since first shot
  assert.equal(weapon.ammo, 10, 'third shot fires after interval')
})

test('hit: headshot deals 2x damage; torso deals base', () => {
  const { camera, weapon } = makeWeapon()
  const headZ = fakeZombie(0, 2)  // 10 m ahead, aimed at head (0,1.8,2)
  const torsoZ = fakeZombie(3, 2) // laterally offset
  weapon.getZombies = () => [headZ, torsoZ]
  weapon.inputState = { fire: false, reload: false, sprint: false }
  weapon.update(0)
  camera.lookAt(0, 1.8, 2) // aim exactly at the head
  weapon.inputState.fire = true
  weapon.update(0)
  assert.equal(headZ.hits.length, 1, 'head hit')
  assert.equal(headZ.hits[0].amount, 68, 'headshot = 34 * 2')
  assert.equal(torsoZ.hits.length, 0, 'other zombie untouched')
  camera.lookAt(3, 1.2, 2) // aim at the other torso center
  weapon.inputState.fire = true
  weapon.update(0.13)      // past the 0.12 s interval
  assert.equal(torsoZ.hits.length, 1, 'torso hit')
  assert.equal(torsoZ.hits[0].amount, 34, 'torso base damage')
  assert.equal(headZ.hits.length, 1, 'first zombie still untouched twice')
})

test('walls stop bullets: zombie behind an AABB is not hit', () => {
  const { collision, weapon } = makeWeapon()
  collision.addAABB(-2, 6, 2, 8, 23) // wall across the lane at z 6..8
  const z = fakeZombie(0, 4)         // behind the wall from camera at z=12
  weapon.getZombies = () => [z]
  weapon.inputState = { fire: false, reload: false, sprint: false }
  weapon.update(0)
  weapon.inputState.fire = true
  weapon.update(0)
  assert.equal(weapon.ammo, 11, 'shot still fires')
  assert.equal(z.hits.length, 0, 'bullet stopped by wall')
})

test('auto-reload at empty magazine; refills after 2.2 s', () => {
  const { weapon } = makeWeapon()
  weapon.inputState = { fire: false, reload: false, sprint: false }
  for (let i = 0; i < 12; i++) {
    weapon.inputState.fire = true
    weapon.update(i === 0 ? 0 : 0.13)
  }
  assert.equal(weapon.ammo, 0, 'magazine empty after 12 shots')
  assert.ok(weapon.isReloading, 'auto-reload started when mag hit 0')
  weapon.update(2.2)
  assert.equal(weapon.isReloading, false, 'reload complete')
  assert.equal(weapon.ammo, 12, 'magazine refilled')
  assert.equal(weapon.reserve, 48, 'reserve drained by 12')
})

test('reset: full mag, full reserve, no reload', () => {
  const { weapon } = makeWeapon()
  weapon.reload()
  weapon.ammo = 3
  weapon.reserve = 10
  weapon.reset()
  assert.equal(weapon.ammo, 12)
  assert.equal(weapon.reserve, 60)
  assert.equal(weapon.isReloading, false)
})
