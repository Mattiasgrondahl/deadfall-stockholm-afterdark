import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { CollisionWorld } from '../src/game/CollisionWorld.js'
import { Shotgun } from '../src/game/Shotgun.js'
import { Player } from '../src/game/Player.js'

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

test('muzzle flash fades; camera kick via player', () => {
  const { camera, collision, shotgun: s } = makeShotgun()
  const player = new Player(camera, { turnX: 0, turnY: 0, forward: false, back: false, left: false, right: false, sprint: false }, collision, null)
  s.update(0, player)   // binds player
  s.shoot()
  assert.ok(s.flash.visible)
  assert.ok(s.flash instanceof THREE.Sprite)
  assert.equal(s.flash.material.blending, THREE.AdditiveBlending)
  assert.ok(s.flashLight.intensity > 0)
  assert.equal(player._pitchKick, 0.018)
  s.update(0.07, player)
  assert.ok(!s.flash.visible); assert.equal(s.flashLight.intensity, 0); assert.equal(s.flash.material.opacity, 0)
  player.update(0.5)    // kick decay lives in Player.update, not Shotgun.update
  assert.equal(player._pitchKick, 0)
  assert.equal(s.flash.material.map, null)  // headless: no document -> no texture
})

test('shoot OVER a low car: a high shot passes above a 1.1 m obstacle', () => {
  const { camera, collision, shotgun: s } = makeShotgun()
  collision.addAABB(-2, 5.5, 2, 6.5, 1.1) // a low car across the lane at z 5.5..6.5
  const z = fakeZombie(0, 8)              // behind the car from camera at z=12
  s.getZombies = () => [z]
  s.inputState = { fire: false, reload: false, sprint: false }
  s.update(0)
  // Aim at the zombie's head (y=2.0): the shot clears the 1.1 m car top on the
  // way in (bullet height ~2.15 m at the car) yet still reaches the head.
  camera.lookAt(0, 2.0, 8)
  fireOnce(s)
  assert.equal(s.ammo, 4, 'blast still fires')
  assert.ok(z.hits.length > 0, `pellets cleared the low car and hit the zombie (${z.hits.length})`)
})

test('bullet hole spawned when a pellet hits a wall (no zombie)', () => {
  const { camera, collision, shotgun: s } = makeShotgun()
  collision.addAABB(-2, 6, 2, 8, 23) // tall wall across the lane
  s.getZombies = () => []            // nothing to absorb the pellets
  const holes = []
  s.bulletHoles = { spawn: (x, y, z, n) => holes.push({ x, y, z, n }) }
  s.inputState = { fire: false, reload: false, sprint: false }
  s.update(0)
  camera.lookAt(0, 1.2, 4) // aim past the wall so every pellet strikes its near face
  fireOnce(s)
  assert.ok(holes.length > 0, `wall hit leaves bullet holes (${holes.length})`)
  // The shooter is at z=12, the box spans z 6..8, so the near face is z=8 and
  // its normal points back toward the shooter (+z).
  assert.ok(holes.every((h) => h.z >= 7.9 && h.z <= 8.1), `holes on the near wall face (z=${holes[0].z})`)
  assert.ok(holes.every((h) => h.n && h.n.z > 0), 'hole normals face the shooter (+z)')
})

test('shooting up at a lamp head breaks it (lamps.hitAt called, no bullet hole)', () => {
  const { camera, collision, shotgun: s } = makeShotgun()
  collision.addAABB(-0.3, 9.7, 0.3, 10.3, 5.3) // a lamp pole/head column at (0,10)
  collision.aabbs[collision.aabbs.length - 1].shootable = true
  s.getZombies = () => []
  const holes = []
  const breaks = []
  s.bulletHoles = { spawn: () => holes.push(1) }
  s.lamps = { hitAt: (x, y, z) => { breaks.push({ x, y, z }); return true } }
  s.inputState = { fire: false, reload: false, sprint: false }
  s.update(0)
  camera.lookAt(0, 5.2, 10) // aim up at the lamp head
  fireOnce(s)
  assert.ok(breaks.length > 0, `lamp head shot breaks a lamp (${breaks.length})`)
  assert.ok(breaks.every((b) => Math.abs(b.y - 5.2) < 2.0), 'break point is near the head height')
  assert.equal(holes.length, 0, 'a lamp hit leaves no bullet hole')
})

// v6 visuals (6): the shotgun's flash light is 500 cd over an 8 m reach. Same
// analytic model as the pistol: contribution = fY * I * 0.5 / d^2 inside the
// cutoff, 0 outside it. At 6 m it adds 2.43 linear (tonemapped 0.83 on a
// round-45 body); at 15 m it adds exactly 0, so a blast never washes out or
// blooms a target it cannot reach.
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linOf = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((v) => s2l(v / 255))
const lumY = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
const aces = (x) => Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14))
const FLASH_Y = lumY(linOf(0xffb878))
const flashAdd = (d) => (d <= 8 ? FLASH_Y * 500 * 0.5 / (d * d) : 0)

test('muzzle flash: 500 cd / 8 m reach — lights 6 m, adds nothing at 15 m', () => {
  const { shotgun: s } = makeShotgun()
  assert.equal(s.flashLight.distance, 8, '8 m cutoff')
  assert.equal(s.flashLight.decay, 2, 'inverse-square')
  s.shoot()
  assert.equal(s.flashLight.intensity, 500, 'peak 500 cd')
  assert.ok(flashAdd(6) > 1, `6 m contribution ${flashAdd(6).toFixed(3)} linear`)
  assert.equal(flashAdd(15), 0, '15 m is outside the cutoff: zero wash-out')
  assert.ok(aces((0.34553 + flashAdd(6)) * 1.2) < 1.0, 'never saturates to pure white')
})

test('setTier low: flash light dropped, sprite dimmed, peak halved', () => {
  const { shotgun: s } = makeShotgun()
  assert.equal(s.setTier('low'), 'low')
  assert.equal(s.flashLight.visible, false, "'low' pays no dynamic light")
  s.shoot()
  assert.equal(s.flashLight.intensity, 0, 'light pinned at 0 on low')
  assert.ok(s.flash.visible, 'sprite still flashes')
  assert.equal(s.flash.material.opacity, 0.45, 'sprite peak dimmed on low')
  s.update(0.07, null)
  assert.equal(s.flash.material.opacity, 0, 'sprite decays over the 0.07 s window')
  assert.equal(s.setTier('high'), 'high')
  s._flashT = 0
  s._fireT = 0 // clear the 0.9 s interval gate so the re-arm actually fires
  s.shoot()
  assert.equal(s.flashLight.visible, true)
  assert.equal(s.flashLight.intensity, 500)
  assert.equal(s.flash.material.opacity, 0.9)
})
