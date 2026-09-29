// v25 co-op: RemoteWeapon held-weapon silhouettes + muzzle-flash lifecycle.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import {
  buildRemoteWeapon, buildMuzzleFlash, updateMuzzleFlash, triggerMuzzleFlash,
} from '../src/game/RemoteWeapon.js'
import { Match } from '../src/net/Match.js'

test('buildRemoteWeapon makes a held silhouette per weapon kind', () => {
  for (const name of ['axe', 'shotgun', 'pistol', 'sword', 'sniper']) {
    const g = buildRemoteWeapon(name)
    assert.ok(g && g.isObject3D, `${name}: a group is built`)
    assert.ok(g.children.length >= 1, `${name}: has at least one mesh`)
    assert.ok(g.children.every((m) => m.isMesh), `${name}: children are meshes`)
    assert.equal(g.userData.weapon, name, `${name}: tagged with its kind`)
  }
  // Unknown / empty weapon yields nothing (caller keeps the current weapon).
  assert.equal(buildRemoteWeapon(''), null, 'empty name -> null')
  assert.equal(buildRemoteWeapon('bazooka'), null, 'unknown name -> null')
})

test('muzzle flash lights on a shot and decays back off', () => {
  const s = buildMuzzleFlash('pistol')
  assert.ok(s && s.isSprite, 'pistol has a flash sprite')
  assert.equal(s.visible, false, 'starts hidden')
  triggerMuzzleFlash(s)
  assert.equal(s.visible, true, 'lights on trigger')
  assert.ok(s.material.opacity > 0, 'opacity set')
  // Decays to off within the flash window.
  for (let i = 0; i < 12; i++) updateMuzzleFlash(s, 1 / 60)
  assert.equal(s.visible, false, 'decays back off')
  assert.equal(s.material.opacity, 0, 'opacity cleared')
  // Melee weapons have no muzzle flash.
  assert.equal(buildMuzzleFlash('axe'), null, 'axe has no muzzle flash')
  assert.equal(buildMuzzleFlash('sword'), null, 'sword has no muzzle flash')
  // update/trigger on a null sprite are safe no-ops.
  updateMuzzleFlash(null, 1 / 60)
  triggerMuzzleFlash(null)
})

test('server emits a shoot event when a player fires', () => {
  const m = new Match({ players: [{ id: 'a' }, { id: 'b' }] })
  const slot = m.players.get('a')
  slot.inputState.fire = true
  m.step(0.05)
  const snap = m.snapshot()
  const shoot = snap.events.filter((e) => e.k === 'shoot')
  assert.equal(shoot.length, 1, 'one shoot event for the shot')
  assert.equal(shoot[0].by, 'a', 'attributed to the shooter')
  assert.equal(shoot[0].weapon, 'shotgun', 'carries the fired weapon name')
})

test('server emits a shoot event when a player swings a melee weapon', () => {
  const m = new Match({ players: [{ id: 'a' }, { id: 'b' }] })
  const slot = m.players.get('a')
  slot.weapon.switchTo('axe')
  slot.inputState.fire = true
  m.step(0.05)
  const shoot = m.snapshot().events.filter((e) => e.k === 'shoot')
  assert.equal(shoot.length, 1, 'a swing produces a shoot event')
  assert.equal(shoot[0].weapon, 'axe', 'carries the melee weapon name')
})