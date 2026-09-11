import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { CollisionWorld } from '../src/game/CollisionWorld.js'
import { Shotgun } from '../src/game/Shotgun.js'

function makeShotgun() {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 400)
  camera.position.set(0, 1.7, 12)
  const collision = new CollisionWorld(180, 180)
  const shotgun = new Shotgun(scene, camera, collision, null)
  shotgun._rng = () => 0.5 // deterministic: zero pellet jitter
  return { scene, camera, collision, shotgun }
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

function fireOnce(s) {
  s.inputState.fire = true
  s.update(0)
}

test('shotgun stats match the contract', () => {
  const { shotgun: s } = makeShotgun()
  assert.equal(s.magSize, 5)
  assert.equal(s.ammo, 5)
  assert.equal(s.reserve, 30)
  assert.equal(s.damage, 22)
  assert.equal(s.pellets, 6)
  assert.equal(s.headMultiplier, 2)
  assert.equal(s.range, 18)
  assert.equal(s.spread, 0.16)
  assert.equal(s.reloadTime, 1.4)
  assert.equal(s.fireInterval, 0.9)
})

test('blast: one shot consumes one round; centered torso takes 6*22, head takes 6*44', () => {
  const { camera, shotgun: s } = makeShotgun()
  const torsoZ = fakeZombie(0, 6) // 6 m ahead; aim at torso center (0,1.2,6)
  const headZ = fakeZombie(4, 6)  // laterally offset, must stay untouched
  s.getZombies = () => [torsoZ, headZ]
  s.inputState = { fire: false, reload: false, sprint: false }
  s.update(0)
  camera.lookAt(0, 1.2, 6)
  fireOnce(s)
  assert.equal(s.ammo, 4, 'one blast consumes one round')
  assert.equal(torsoZ.hits.length, 6, 'all six pellets hit the centered torso')
  assert.equal(torsoZ.hits.reduce((a, h) => a + h.amount, 0), 132, '6 * 22 body damage')
  assert.equal(headZ.hits.length, 0, 'offset zombie untouched')
  camera.lookAt(4, 1.8, 6) // aim at the other zombie's head
  s.update(0.9)            // past the 0.9 s fire interval
  fireOnce(s)
  assert.equal(headZ.hits.length, 6, 'all six pellets hit the head')
  assert.equal(headZ.hits.reduce((a, h) => a + h.amount, 0), 264, '6 * 22 * 2 headshot')
  assert.equal(torsoZ.hits.length, 6, 'torso zombie not hit again')
})

test('walls stop pellets: zombie behind an AABB is not hit', () => {
  const { camera, collision, shotgun: s } = makeShotgun()
  collision.addAABB(-2, 6, 2, 8, 23) // wall across the lane at z 6..8
  const z = fakeZombie(0, 4)         // behind the wall from camera at z=12
  s.getZombies = () => [z]
  s.inputState = { fire: false, reload: false, sprint: false }
  s.update(0)
  camera.lookAt(0, 1.2, 4)
  fireOnce(s)
  assert.equal(s.ammo, 4, 'blast still fires')
  assert.equal(z.hits.length, 0, 'all pellets stopped by the wall')
})

test('burst interval: second blast within 0.9 s is blocked', () => {
  const { camera, shotgun: s } = makeShotgun()
  camera.lookAt(0, 1.2, 6)
  const z = fakeZombie(0, 6)
  s.getZombies = () => [z]
  s.inputState = { fire: false, reload: false, sprint: false }
  s.update(0)
  fireOnce(s)
  assert.equal(s.ammo, 4, 'first blast fires')
  fireOnce(s)
  assert.equal(s.ammo, 4, 'second blast blocked by 0.9 s interval')
  assert.equal(z.hits.length, 6, 'only one blast landed')
  s.update(0.9)
  fireOnce(s)
  assert.equal(s.ammo, 3, 'third blast fires after interval')
  assert.equal(z.hits.length, 12, 'two blasts landed')
})

test('auto-reload at empty; refills after 1.4 s', () => {
  const { camera, shotgun: s } = makeShotgun()
  camera.lookAt(0, 1.2, 6)
  s.getZombies = () => []
  s.inputState = { fire: false, reload: false, sprint: false }
  for (let i = 0; i < 5; i++) {
    s.inputState.fire = true
    s.update(i === 0 ? 0 : 0.9)
  }
  assert.equal(s.ammo, 0, 'magazine empty after 5 blasts')
  assert.ok(s.isReloading, 'auto-reload started when mag hit 0')
  s.update(1.4)
  assert.equal(s.isReloading, false, 'reload complete')
  assert.equal(s.ammo, 5, 'magazine refilled')
  assert.equal(s.reserve, 25, 'reserve drained by 5')
})

test('view model + dispose: 4 weapon meshes; detach from camera; double-safe', () => {
  const { camera, shotgun: s } = makeShotgun()
  const meshes = s.view.children.filter((c) => c.isMesh)
  assert.ok(meshes.length >= 4, 'receiver, barrel, pump, stock present')
  assert.ok(s.view.children.includes(s.flash), 'muzzle flash present')
  assert.ok(s.view.children.includes(s.flashLight), 'flash light present')
  s.dispose()
  assert.ok(!camera.children.includes(s.view), 'view detached from camera')
  s.dispose() // never throws when called twice
})
