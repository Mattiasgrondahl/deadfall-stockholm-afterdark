// test/sniper.test.mjs — the sniper rifle: long-range one-shot kill, scope
// zoom (FOV 75 -> 18 while zoom held, back to 75 on release), ammo/reload,
// wall occlusion + bullet holes, headshots, and determinism. Headless-safe.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { CollisionWorld } from '../src/game/CollisionWorld.js'
import { Sniper } from '../src/game/Sniper.js'
import { Zombie } from '../src/game/Zombie.js'

function makeSniper() {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 520)
  camera.position.set(0, 1.7, 12)
  camera.lookAt(0, 1.2, 0)
  const collision = new CollisionWorld(180, 180)
  const sniper = new Sniper(scene, camera, collision, null)
  return { scene, camera, collision, sniper }
}

function fireOnce(s) {
  s.inputState = { fire: true, reload: false, sprint: false, zoom: false }
  s.update(0)
}

test('sniper kills a regular zombie in one body shot at long range', () => {
  const { scene, camera, collision, sniper } = makeSniper()
  const z = new Zombie(scene, 'walker', 0, 0, 1)
  z.position.set(0, 0, -20) // 32 m away, within the 80 m range
  sniper.getZombies = () => [z]
  camera.lookAt(0, 1.2, -20)
  fireOnce(sniper)
  assert.equal(z.isDead, true, 'one sniper body shot kills a walker')
  assert.equal(sniper.ammo, sniper.magSize - 1)
})

test('sniper range reaches 80 m but not beyond', () => {
  const { scene, camera, collision, sniper } = makeSniper()
  const z = new Zombie(scene, 'walker', 0, 0, 1)
  z.position.set(0, 0, -75) // ~87 m away, past the 80 m range
  sniper.getZombies = () => [z]
  camera.lookAt(0, 1.2, -75)
  fireOnce(sniper)
  assert.equal(z.isDead, false, 'a target past max range is not hit')
})

test('sniper zoom narrows the FOV while held and restores on release', () => {
  const { scene, camera, collision, sniper } = makeSniper()
  assert.equal(camera.fov, 75, 'starts at the normal FOV')
  sniper.inputState = { fire: false, reload: false, sprint: false, zoom: true }
  for (let i = 0; i < 60; i++) sniper.update(1 / 60)
  assert.ok(camera.fov <= 18 + 1e-6 && camera.fov >= 18 - 1e-6, `scoped FOV ${camera.fov}`)
  assert.equal(sniper.scoped, true)
  sniper.inputState.zoom = false
  for (let i = 0; i < 120; i++) sniper.update(1 / 60)
  assert.ok(Math.abs(camera.fov - 75) < 1e-6, `restored FOV ${camera.fov}`)
  assert.equal(sniper.scoped, false)
})

test('sniper reload refills the magazine from reserve', () => {
  const { scene, camera, collision, sniper } = makeSniper()
  sniper.getZombies = () => []
  for (let i = 0; i < sniper.magSize; i++) { fireOnce(sniper); sniper._fireT = 0 }
  assert.equal(sniper.ammo, 0)
  assert.equal(sniper.isReloading, true, 'auto-reload on empty')
  for (let i = 0; i < Math.round(sniper.reloadTime * 60) + 5; i++) sniper.update(1 / 60)
  assert.equal(sniper.ammo, sniper.magSize)
})

test('sniper wall hit leaves a bullet hole (no zombie)', () => {
  const { camera, collision, sniper } = makeSniper()
  collision.addAABB(-2, 6, 2, 8, 23)
  sniper.getZombies = () => []
  const holes = []
  sniper.bulletHoles = { spawn: (x, y, z, n) => holes.push({ x, y, z, n }) }
  camera.lookAt(0, 1.2, 4)
  fireOnce(sniper)
  assert.equal(holes.length, 1, 'one hole per shot into a wall')
})

test('sniper headshot doubles damage and decapitates a fatal head hit', () => {
  const { scene, camera, collision, sniper } = makeSniper()
  const z = new Zombie(scene, 'walker', 0, 0, 1)
  z.position.set(0, 0, -10)
  sniper.getZombies = () => [z]
  let deca = 0
  sniper.onDecapitate = () => { deca++ }
  camera.lookAt(0, 1.8, -10) // aim at the head
  fireOnce(sniper)
  assert.equal(z.isDead, true)
  assert.equal(deca, 1, 'fatal headshot fires onDecapitate')
})

test('sniper fires deterministically (same shots -> same hits)', () => {
  const a = makeSniper(), b = makeSniper()
  const za = new Zombie(a.scene, 'walker', 0, 0, 1); za.position.set(0, 0, -15)
  const zb = new Zombie(b.scene, 'walker', 0, 0, 1); zb.position.set(0, 0, -15)
  a.sniper.getZombies = () => [za]; b.sniper.getZombies = () => [zb]
  a.camera.lookAt(0, 1.2, -15); b.camera.lookAt(0, 1.2, -15)
  fireOnce(a.sniper); fireOnce(b.sniper)
  assert.equal(za.isDead, zb.isDead)
})