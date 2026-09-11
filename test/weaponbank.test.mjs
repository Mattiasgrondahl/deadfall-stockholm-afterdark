import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { CollisionWorld } from '../src/game/CollisionWorld.js'
import { WeaponBank } from '../src/game/WeaponBank.js'
import { Zombie } from '../src/game/Zombie.js'

function fakeAudio() {
  const counts = { shoot: 0, hitZombie: 0, reload: 0, axeSwing: 0, weaponSwitch: 0 }
  return {
    counts,
    shoot() { counts.shoot++ },
    hitZombie() { counts.hitZombie++ },
    reload() { counts.reload++ },
    axeSwing() { counts.axeSwing++ },
    weaponSwitch() { counts.weaponSwitch++ }
  }
}

function fakePlayer(x, z, yaw = 0) {
  return { position: new THREE.Vector3(x, 1.7, z), velocity: new THREE.Vector3(), yaw, isDead: false, health: 100 }
}

function makeBank(player, zombies, audio = fakeAudio()) {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera()
  camera.position.copy(player.position)
  camera.lookAt(player.position.x, player.position.y, player.position.z - 10) // aim straight ahead
  const bank = new WeaponBank(scene, camera, new CollisionWorld(180, 180), audio)
  bank.getZombies = () => zombies
  bank.inputState = { fire: false, reload: false, switch1: false, switch2: false }
  return { bank, audio, camera }
}

test('construction: shotgun primary, visibility, getters', () => {
  const { bank } = makeBank(fakePlayer(0, 0), [])
  assert.equal(bank.current, bank.shotgun)
  assert.equal(bank.shotgun.view.visible, true)
  assert.equal(bank.axe.view.visible, false)
  assert.equal(bank.ammo, bank.shotgun.ammo)
  assert.equal(bank.reserve, bank.shotgun.reserve)
  assert.equal(bank.magSize, bank.shotgun.magSize)
  assert.equal(bank.axe.name, 'axe')
  assert.equal(bank.shotgun.name, 'shotgun')
  bank.dispose()
})

test('switch with 0.25 s lockout', () => {
  const { bank, audio } = makeBank(fakePlayer(0, 0), [])
  assert.equal(bank.switchTo('axe'), true)
  assert.equal(bank.current, bank.axe)
  assert.equal(bank.axe.view.visible, true)
  assert.equal(bank.shotgun.view.visible, false)
  assert.equal(audio.counts.weaponSwitch, 1)
  assert.equal(bank.switchTo('shotgun'), false) // inside lockout
  assert.equal(bank.switchTo('axe'), false)     // same weapon
  for (let i = 0; i < 16; i++) bank.update(1 / 60, null) // ~0.27 s
  assert.equal(bank.switchTo('shotgun'), true)
  bank.dispose()
})

test('fire routes to the current weapon only', () => {
  const zombies = [new Zombie(new THREE.Scene(), 'walker', 0, -5, 1)]
  const { bank, audio } = makeBank(fakePlayer(0, 0, 0), zombies)
  bank.inputState.fire = true
  bank.update(1 / 60, fakePlayer(0, 0, 0))
  assert.equal(bank.inputState.fire, false)
  assert.equal(audio.counts.shoot, 1)
  assert.equal(bank.shotgun.ammo, 4)
  assert.ok(zombies[0].health < zombies[0].maxHealth)
  assert.equal(bank.switchTo('axe'), true)
  bank.inputState.fire = true
  bank.update(1 / 60, fakePlayer(0, 0, 0))
  assert.equal(bank.inputState.fire, false)
  assert.equal(audio.counts.axeSwing, 1)
  assert.equal(audio.counts.shoot, 1) // shotgun untouched while axe is current
  assert.equal(bank.shotgun.ammo, 4)   // zombie at 5 m is out of axe reach: no damage
  bank.dispose()
})

test('switch1/switch2 input edges', () => {
  const { bank, audio } = makeBank(fakePlayer(0, 0), [])
  bank.inputState.switch1 = true
  bank.update(1 / 60, null)
  assert.equal(bank.inputState.switch1, false)
  assert.equal(bank.current, bank.axe)
  assert.equal(audio.counts.weaponSwitch, 1)
  bank.update(0.3, null) // clear the swap lockout
  bank.inputState.switch2 = true
  bank.update(1 / 60, null)
  assert.equal(bank.inputState.switch2, false)
  assert.equal(bank.current, bank.shotgun)
  assert.equal(audio.counts.weaponSwitch, 2)
  bank.dispose()
})

test('reset restores shotgun and clears both weapons', () => {
  const player = fakePlayer(0, 0, 0)
  const { bank } = makeBank(player, [])
  bank.switchTo('axe')
  bank.update(1 / 60, player)
  bank.axe.swing() // put the axe on cooldown
  for (let i = 0; i < 300; i++) bank.update(1 / 60, player)
  bank.switchTo('shotgun')
  for (let i = 0; i < 5; i++) {
    bank.shotgun.shoot()
    for (let j = 0; j < 55; j++) bank.update(1 / 60, player) // 0.917 s per interval
  }
  assert.equal(bank.shotgun.ammo, 0)
  assert.equal(bank.shotgun.isReloading, true) // auto-reload after the last round
  bank.reset()
  assert.equal(bank.current, bank.shotgun)
  assert.equal(bank.shotgun.ammo, 5)
  assert.equal(bank.shotgun.reserve, 30)
  assert.equal(bank.shotgun.isReloading, false)
  assert.equal(bank.axe._coolT, 0)
  assert.equal(bank.axe.view.visible, false)
  assert.equal(bank.shotgun.view.visible, true)
  bank.dispose()
})

test('dispose detaches both view models; double-safe', () => {
  const { bank, camera } = makeBank(fakePlayer(0, 0), [])
  assert.equal(camera.children.length, 2) // axe view + shotgun view
  bank.dispose()
  assert.equal(camera.children.length, 0)
  bank.dispose() // second call must not throw
})
