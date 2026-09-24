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

// v6 gameplay (5): the reload dips the view model (deterministic sin(π·p)
// envelope over the 1.1 s timer) so a reload is visibly readable.
test('reload dip: view dips mid-reload and returns to exact rest pose', () => {
  const { camera, pistol: p } = makePistol()
  camera.lookAt(0, 1.2, 6)
  p.getZombies = () => []
  p.inputState = { fire: false, reload: false }
  p.update(0)
  const restY = p.view.position.y, restZ = p.view.position.z
  assert.equal(restY, -0.24, 'rest pose, no bob while idle')
  for (let i = 0; i < 8; i++) { // 8 rounds fired, mag not full: 4 rounds down
    p.inputState.fire = true
    p.update(i === 0 ? 0 : 0.28)
  }
  assert.equal(p.ammo, 4)
  p._recoil = 0 // start the reload from the clean rest pose (no live recoil)
  assert.ok(p.reload(), 'manual reload starts from a non-full mag')
  const dt = 1 / 60
  let midY = Infinity, midZ = -Infinity
  for (let i = 0; i < 33; i++) { // ~0.55 s in: near the sin peak
    p.update(dt)
    midY = Math.min(midY, p.view.position.y)
    midZ = Math.max(midZ, p.view.position.z)
  }
  assert.ok(midY < restY - 0.03, `view dips below rest mid-reload (y=${midY.toFixed(4)})`)
  assert.ok(midZ > restZ + 0.03, `view pulls back mid-reload (z=${midZ.toFixed(4)})`)
  for (let i = 0; i < 33; i++) p.update(dt) // finish the 1.1 s
  assert.equal(p.isReloading, false, 'reload complete')
  // Review fix: the reload branch now runs BEFORE the view write, so the
  // completion frame itself lands on exact rest (no stale-dip frame).
  assert.equal(p.view.position.y, restY, 'exact rest y on the completion frame')
  assert.equal(p.view.position.z, restZ, 'exact rest z on the completion frame')
  assert.equal(p.ammo, 12, 'magazine refilled')
  assert.equal(p.reserve, 28, 'reserve drained by 8')
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

// v6 visuals (6): muzzle flash + hit feedback. The flash light is analytic,
// not taste: 300 cd at decay 2 over a 6 m reach adds luminance
//   fY * I * 0.5 / d^2   (fY = luminance of 0xffc988, N.L = 0.5 front-facing)
// to whatever the light reaches. At 5 m that is 3.889 linear on top of the
// round-45 body irradiance (tonemapped 0.88 — a visible pop, not a wash), and
// at 15 m it is exactly 0 because the 6 m cutoff is already spent, so the
// flash can never lift a distant body over the 0.72 bloom cut.
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linOf = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((v) => s2l(v / 255))
const lumY = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
const aces = (x) => Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14))
const FLASH_Y = lumY(linOf(0xffc988))
const flashAdd = (d) => (d <= 6 ? FLASH_Y * 300 * 0.5 / (d * d) : 0)

test('muzzle flash: 300 cd / 6 m reach — lights 5 m, adds nothing at 15 m', () => {
  const { pistol: p } = makePistol()
  p.inputState = { fire: false, reload: false }
  assert.equal(p.flashLight.intensity, 0, 'starts dark')
  assert.equal(p.flashLight.distance, 6, '6 m cutoff')
  assert.equal(p.flashLight.decay, 2, 'inverse-square')
  p.shoot()
  assert.equal(p.flashLight.intensity, 300, 'peak 300 cd')
  assert.ok(flashAdd(5) > 1, `5 m contribution ${flashAdd(5).toFixed(3)} linear is a real pop`)
  assert.equal(flashAdd(15), 0, '15 m is outside the cutoff: zero wash-out')
  // The 5 m hit lands below 1.0 but above the 0.72 cut: a brief pop, not a
  // white-out of the target.
  assert.ok(aces((0.34553 + flashAdd(5)) * 1.2) < 1.0, 'never saturates to pure white')
})

test('setTier low: flash light dropped, sprite dimmed, feedback still reads', () => {
  const { pistol: p } = makePistol()
  p.inputState = { fire: false, reload: false }
  assert.equal(p.setTier('low'), 'low')
  assert.equal(p.flashLight.visible, false, "'low' pays no dynamic light")
  p.shoot()
  assert.equal(p.flashLight.intensity, 0, 'light stays pinned at 0 on low')
  assert.ok(p.flash.visible, 'sprite still flashes')
  assert.equal(p.flash.material.opacity, 0.45, 'sprite peak halved-ish on low')
  p.update(0.05, null)
  assert.equal(p.flash.material.opacity, 0, 'sprite decays over the 0.05 s window')
  assert.equal(p.setTier('high'), 'high')
  p._flashT = 0
  p._fireT = 0 // clear the 0.28 s interval gate so the re-arm actually fires
  p.shoot()
  assert.equal(p.flashLight.visible, true, 'high restores the light')
  assert.equal(p.flashLight.intensity, 300)
  assert.equal(p.flash.material.opacity, 0.9)
})
