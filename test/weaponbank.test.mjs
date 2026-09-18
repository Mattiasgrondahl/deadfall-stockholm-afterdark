import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { CollisionWorld } from '../src/game/CollisionWorld.js'
import { WeaponBank } from '../src/game/WeaponBank.js'
import { Zombie } from '../src/game/Zombie.js'

function fakeAudio() {
  const counts = { shoot: 0, hitZombie: 0, reload: 0, axeSwing: 0, pistolShot: 0, swordSwing: 0, weaponSwitch: 0 }
  return {
    counts,
    shoot() { counts.shoot++ },
    hitZombie() { counts.hitZombie++ },
    reload() { counts.reload++ },
    axeSwing() { counts.axeSwing++ },
    pistolShot() { counts.pistolShot++ },
    swordSwing() { counts.swordSwing++ },
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
  bank.inputState = { fire: false, reload: false, switch1: false, switch2: false, switch3: false, switch4: false }
  return { bank, audio, camera }
}

test('construction: shotgun primary, visibility, getters', () => {
  const { bank } = makeBank(fakePlayer(0, 0), [])
  assert.equal(bank.current, bank.shotgun)
  assert.equal(bank.shotgun.view.visible, true)
  assert.equal(bank.axe.view.visible, false)
  assert.equal(bank.pistol.view.visible, false)
  assert.equal(bank.sword.view.visible, false)
  assert.equal(bank.ammo, bank.shotgun.ammo)
  assert.equal(bank.reserve, bank.shotgun.reserve)
  assert.equal(bank.magSize, bank.shotgun.magSize)
  assert.equal(bank.axe.name, 'axe')
  assert.equal(bank.shotgun.name, 'shotgun')
  assert.equal(bank.pistol.name, 'pistol')
  assert.equal(bank.sword.name, 'sword')
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

test('switch3/switch4 input edges route to pistol and sword', () => {
  const { bank, audio } = makeBank(fakePlayer(0, 0), [])
  bank.inputState.switch3 = true
  bank.update(1 / 60, null)
  assert.equal(bank.inputState.switch3, false)
  assert.equal(bank.current, bank.pistol)
  assert.equal(bank.pistol.view.visible, true)
  assert.equal(bank.shotgun.view.visible, false)
  assert.equal(audio.counts.weaponSwitch, 1)
  bank.update(0.3, null) // clear the swap lockout
  bank.inputState.switch4 = true
  bank.update(1 / 60, null)
  assert.equal(bank.inputState.switch4, false)
  assert.equal(bank.current, bank.sword)
  assert.equal(bank.sword.view.visible, true)
  assert.equal(audio.counts.weaponSwitch, 2)
  bank.dispose()
})

test('fire routes to the current weapon only (pistol and sword)', () => {
  const zombies = [new Zombie(new THREE.Scene(), 'walker', 0, -5, 1)]
  const { bank, audio } = makeBank(fakePlayer(0, 0, 0), zombies)
  bank.switchTo('pistol')
  bank.pistol._rng = () => 0.5 // zero spread
  bank.inputState.fire = true
  bank.update(1 / 60, fakePlayer(0, 0, 0))
  assert.equal(bank.inputState.fire, false)
  assert.equal(audio.counts.pistolShot, 1)
  assert.equal(bank.pistol.ammo, 11)
  assert.ok(zombies[0].health < zombies[0].maxHealth)
  bank.update(0.3, fakePlayer(0, 0, 0)) // clear the swap lockout
  bank.switchTo('sword')
  bank.inputState.fire = true
  bank.update(1 / 60, fakePlayer(0, 0, 0))
  assert.equal(bank.inputState.fire, false)
  assert.equal(audio.counts.swordSwing, 1)
  assert.equal(audio.counts.pistolShot, 1) // pistol untouched while sword is current
  assert.equal(bank.pistol.ammo, 11)
  bank.dispose()
})

test('fatal headshot through the bank fires onDecapitate', () => {
  // Camera at (0,1.7,0) facing -Z; a zombie 2.5 m ahead is head-shot by a
  // straight pistol round (head box center (0,1.8,-2.5), r 0.3).
  const zombies = [new Zombie(new THREE.Scene(), 'walker', 0, -2.5, 1)]
  const { bank, audio } = makeBank(fakePlayer(0, 0, 0), zombies)
  const decapCalls = []
  bank.onDecapitate = (z, dir) => decapCalls.push([z, dir])
  bank.switchTo('pistol')
  bank.pistol._rng = () => 0.5 // zero spread
  bank.inputState.fire = true
  bank.update(1 / 60, fakePlayer(0, 0, 0))
  assert.equal(zombies[0].isDead, true, '52-dmg headshot kills a wave-1 walker')
  assert.equal(decapCalls.length, 1, 'bank forwards the decap callback')
  assert.equal(decapCalls[0][0], zombies[0])
  bank.dispose()
})

test('reset restores shotgun and clears all weapons', () => {
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
  bank.switchTo('pistol')
  bank.pistol.shoot()
  bank.switchTo('sword')
  bank.sword.swing()
  bank.reset()
  assert.equal(bank.current, bank.shotgun)
  assert.equal(bank.shotgun.ammo, 5)
  assert.equal(bank.shotgun.reserve, 30)
  assert.equal(bank.shotgun.isReloading, false)
  assert.equal(bank.pistol.ammo, 12)
  assert.equal(bank.pistol.reserve, 36)
  assert.equal(bank.pistol.isReloading, false)
  assert.equal(bank.sword._coolT, 0)
  assert.equal(bank.axe._coolT, 0)
  assert.equal(bank.axe.view.visible, false)
  assert.equal(bank.shotgun.view.visible, true)
  assert.equal(bank.pistol.view.visible, false)
  assert.equal(bank.sword.view.visible, false)
  bank.dispose()
})

test('shoot() delegates to the current weapon', () => {
  const zombies = [new Zombie(new THREE.Scene(), 'walker', 0, -5, 1)]
  const { bank, audio } = makeBank(fakePlayer(0, 0, 0), zombies)
  assert.equal(bank.shoot(), true)
  assert.equal(audio.counts.shoot, 1)
  assert.equal(bank.shotgun.ammo, 4)
  bank.switchTo('axe')
  assert.equal(bank.shoot(), true)
  assert.equal(audio.counts.axeSwing, 1)
  assert.equal(audio.counts.shoot, 1) // shotgun untouched
  bank.dispose()
})

test('reload() delegates to the current weapon; axe is a no-op', () => {
  const player = fakePlayer(0, 0, 0)
  const { bank } = makeBank(player, [])
  assert.equal(bank.reload(), false) // shotgun, full mag: nothing to reload
  for (let i = 0; i < 5; i++) { bank.shotgun.shoot(); bank.update(1, player) }
  assert.equal(bank.shotgun.ammo, 0)
  bank.reload() // auto-reload already started on the last shot
  assert.equal(bank.shotgun.isReloading, true)
  bank.update(1.5, player) // > 1.4 s
  assert.equal(bank.shotgun.ammo, 5)
  assert.equal(bank.shotgun.isReloading, false)
  bank.update(0.3, player) // clear the switch lockout
  bank.switchTo('axe')
  assert.equal(bank.reload(), true) // axe has no magazine: no-op success
  bank.update(0.3, player) // clear the switch lockout
  bank.switchTo('sword')
  assert.equal(bank.reload(), true) // sword has no magazine: no-op success
  bank.dispose()
})

test('dispose detaches all four view models; double-safe', () => {
  const { bank, camera } = makeBank(fakePlayer(0, 0), [])
  assert.equal(camera.children.length, 4) // axe + shotgun + pistol + sword views
  bank.dispose()
  assert.equal(camera.children.length, 0)
  bank.dispose() // second call must not throw
})
