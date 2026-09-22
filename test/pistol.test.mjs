import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { CollisionWorld } from '../src/game/CollisionWorld.js'
import { Pistol } from '../src/game/Pistol.js'
import { Player } from '../src/game/Player.js'

function makePistol() {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 400)
  camera.position.set(0, 1.7, 12)
  const collision = new CollisionWorld(180, 180)
  const pistol = new Pistol(scene, camera, collision, null)
  pistol._rng = () => 0.5 // deterministic: zero jitter
  return { scene, camera, collision, pistol }
}

function fakeZombie(x, z, hp = 50) {
  return {
    isDead: false,
    health: hp,
    hits: [],
    getHitboxes: () => [
      { center: new THREE.Vector3(x, 1.2, z), radius: 0.45, isHead: false },
      { center: new THREE.Vector3(x, 1.8, z), radius: 0.3, isHead: true }
    ],
    damage(amount, dir) {
      this.hits.push({ amount, dir })
      this.health -= amount
      if (this.health <= 0) { this.health = 0; this.isDead = true }
    }
  }
}

function fakeBlood() {
  return { bursts: [], burst(...args) { this.bursts.push(args) } }
}

function fireOnce(p) {
  p.inputState.fire = true
  p.update(0)
}

test('pistol stats match the contract', () => {
  const { pistol: p } = makePistol()
  assert.equal(p.magSize, 12)
  assert.equal(p.ammo, 12)
  assert.equal(p.reserve, 36)
  assert.equal(p.damage, 26)
  assert.equal(p.headMultiplier, 2)
  assert.equal(p.range, 24)
  assert.equal(p.spread, 0.03)
  assert.equal(p.reloadTime, 1.1)
  assert.equal(p.fireInterval, 0.28)
})

test('single round: centered torso takes 26, head takes 52; offset zombie untouched', () => {
  const { camera, pistol: p } = makePistol()
  const torsoZ = fakeZombie(0, 6)
  const headZ = fakeZombie(4, 6)
  p.getZombies = () => [torsoZ, headZ]
  p.inputState = { fire: false, reload: false }
  p.update(0)
  camera.lookAt(0, 1.2, 6)
  fireOnce(p)
  assert.equal(p.ammo, 11, 'one shot consumes one round')
  assert.equal(torsoZ.hits.length, 1, 'single round, single hit')
  assert.equal(torsoZ.hits[0].amount, 26, 'body damage')
  assert.equal(headZ.hits.length, 0, 'offset zombie untouched')
  camera.lookAt(4, 1.8, 6) // aim at the other zombie's head
  p.update(0.3)            // past the 0.28 s fire interval
  fireOnce(p)
  assert.equal(headZ.hits.length, 1)
  assert.equal(headZ.hits[0].amount, 52, '26 * 2 headshot')
  assert.equal(torsoZ.hits.length, 1, 'torso zombie not hit again')
})

test('fatal headshot fires onDecapitate; non-fatal headshot does not', () => {
  const { camera, pistol: p } = makePistol()
  const deadZ = fakeZombie(0, 6, 50)   // one 52-dmg headshot kills
  const aliveZ = fakeZombie(4, 6, 100)  // one 52-dmg headshot does not kill
  const decapCalls = []
  p.onDecapitate = (z, dir) => decapCalls.push([z, dir])
  p.getZombies = () => [deadZ, aliveZ]
  p.inputState = { fire: false, reload: false }
  p.update(0)
  camera.lookAt(0, 1.8, 6)
  fireOnce(p)
  assert.equal(deadZ.isDead, true)
  assert.equal(aliveZ.isDead, false)
  assert.equal(decapCalls.length, 1, 'only the fatal headshot decapitated')
  assert.equal(decapCalls[0][0], deadZ)
  assert.ok(decapCalls[0][1] instanceof THREE.Vector3, 'direction passed through')
  // A second fatal headshot (new zombie) decapitates again
  const dead2 = fakeZombie(0, 6, 50)
  p.getZombies = () => [dead2]
  p.update(0.3)
  fireOnce(p)
  assert.equal(decapCalls.length, 2)
  assert.equal(decapCalls[1][0], dead2)
})

test('walls stop rounds: zombie behind an AABB is not hit', () => {
  const { camera, collision, pistol: p } = makePistol()
  collision.addAABB(-2, 6, 2, 8, 23) // wall across the lane at z 6..8
  const z = fakeZombie(0, 4)
  p.getZombies = () => [z]
  p.inputState = { fire: false, reload: false }
  p.update(0)
  camera.lookAt(0, 1.2, 4)
  fireOnce(p)
  assert.equal(p.ammo, 11, 'shot still fires')
  assert.equal(z.hits.length, 0, 'round stopped by the wall')
})

test('fire interval: second shot within 0.28 s is blocked', () => {
  const { camera, pistol: p } = makePistol()
  camera.lookAt(0, 1.2, 6)
  const z = fakeZombie(0, 6, 1000)
  p.getZombies = () => [z]
  p.inputState = { fire: false, reload: false }
  p.update(0)
  fireOnce(p)
  assert.equal(p.ammo, 11, 'first shot fires')
  fireOnce(p)
  assert.equal(p.ammo, 11, 'second shot blocked by 0.28 s interval')
  assert.equal(z.hits.length, 1, 'only one round landed')
  p.update(0.28)
  fireOnce(p)
  assert.equal(p.ammo, 10, 'third shot fires after interval')
  assert.equal(z.hits.length, 2, 'two rounds landed')
})

test('auto-reload at empty; refills after 1.1 s', () => {
  const { camera, pistol: p } = makePistol()
  camera.lookAt(0, 1.2, 6)
  p.getZombies = () => []
  p.inputState = { fire: false, reload: false }
  for (let i = 0; i < 12; i++) {
    p.inputState.fire = true
    p.update(i === 0 ? 0 : 0.28)
  }
  assert.equal(p.ammo, 0, 'magazine empty after 12 rounds')
  assert.ok(p.isReloading, 'auto-reload started when mag hit 0')
  p.update(1.1)
  assert.equal(p.isReloading, false, 'reload complete')
  assert.equal(p.ammo, 12, 'magazine refilled')
  assert.equal(p.reserve, 24, 'reserve drained by 12')
})

test('blood bursts on hits with scaled damage', () => {
  const { camera, pistol: p } = makePistol()
  p.blood = fakeBlood()
  const headZ = fakeZombie(0, 6, 100)
  p.getZombies = () => [headZ]
  p.inputState = { fire: false, reload: false }
  p.update(0)
  camera.lookAt(0, 1.8, 6)
  fireOnce(p)
  assert.equal(p.blood.bursts.length, 1)
  assert.equal(p.blood.bursts[0][3], 52, 'headshot burst scaled 2x')
  assert.equal(p.blood.bursts[0][4], true, 'headHit flag set')
})

test('muzzle flash fades; camera kick via player', () => {
  const { camera, collision, pistol: p } = makePistol()
  const player = new Player(camera, { turnX: 0, turnY: 0, forward: false, back: false, left: false, right: false, sprint: false }, collision, null)
  p.update(0, player)   // binds player
  p.shoot()
  assert.ok(p.flash.visible)
  assert.ok(p.flash instanceof THREE.Sprite)
  assert.equal(p.flash.material.blending, THREE.AdditiveBlending)
  assert.ok(p.flashLight.intensity > 0)
  assert.equal(player._pitchKick, 0.012)
  p.update(0.05, player)
  assert.ok(!p.flash.visible); assert.equal(p.flashLight.intensity, 0); assert.equal(p.flash.material.opacity, 0)
  player.update(0.5)    // kick decay lives in Player.update, not Pistol.update
  assert.equal(player._pitchKick, 0)
  assert.equal(p.flash.material.map, null)  // headless: no document -> no texture
})

test('view model + dispose: 3 weapon meshes; detach from camera; double-safe', () => {
  const { camera, pistol: p } = makePistol()
  const meshes = p.view.children.filter((c) => c.isMesh)
  assert.equal(meshes.length, 3, 'receiver, barrel, grip present')
  assert.ok(p.view.children.includes(p.flash), 'muzzle flash present')
  assert.ok(p.view.children.includes(p.flashLight), 'flash light present')
  p.dispose()
  assert.ok(!camera.children.includes(p.view), 'view detached from camera')
  p.dispose() // never throws when called twice
})
