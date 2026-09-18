// Difficulty presets (DIFFICULTY in Zombie.js): normal = shipped baseline,
// frenzy = 2x speed + flat 50 HP (2 body shots or 1 headshot to kill at
// wave 1). Headless-safe: plain math, no DOM.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { CollisionWorld } from '../src/game/CollisionWorld.js'
import { Zombie, TABLE, DIFFICULTY } from '../src/game/Zombie.js'
import { Game } from '../src/game/Game.js'

function fakePlayer(x, z) {
  return {
    position: new THREE.Vector3(x, 1.7, z),
    isDead: false,
    health: 1000,
    damage(n) {
      if (!this.isDead) {
        this.health -= n
        if (this.health <= 0) this.isDead = true
      }
    }
  }
}

function makeZombie(type, x, z, wave = 1, difficulty = 'normal') {
  const scene = new THREE.Scene()
  const collision = new CollisionWorld(180, 180)
  const zombie = new Zombie(scene, type, x, z, wave, difficulty)
  return { scene, collision, zombie }
}

test('DIFFICULTY presets: normal is identity, frenzy doubles speed and flattens HP to 50', () => {
  assert.deepEqual(DIFFICULTY.normal, { speedMult: 1, hpBase: null })
  assert.deepEqual(DIFFICULTY.frenzy, { speedMult: 2, hpBase: 50 })
})

test('normal zombies are unchanged: speed and HP come straight from TABLE', () => {
  for (const type of ['walker', 'shambler', 'screamer']) {
    const { zombie } = makeZombie(type, 0, 0, 1, 'normal')
    assert.equal(zombie.speed, TABLE[type].speed, `${type} speed unchanged`)
    assert.equal(zombie.maxHealth, TABLE[type].hp, `${type} hp unchanged`)
  }
})

test('frenzy zombies: 2x speed and flat 50 HP for every type at wave 1', () => {
  for (const type of ['walker', 'shambler', 'screamer']) {
    const { zombie: f } = makeZombie(type, 0, 0, 1, 'frenzy')
    assert.equal(f.speed, 2 * TABLE[type].speed, `${type} frenzy speed`)
    assert.equal(f.maxHealth, 50, `${type} frenzy flat hp`)
  }
})

test('frenzy wave scaling still applies on top of the flat base', () => {
  const { zombie: f2 } = makeZombie('shambler', 0, 0, 2, 'frenzy')
  assert.equal(f2.maxHealth, 56) // Math.round(50 * 1.12)
  const { zombie: f3 } = makeZombie('walker', 0, 0, 3, 'frenzy')
  assert.equal(f3.maxHealth, 63) // Math.round(50 * 1.12^2)
  const { zombie: f4 } = makeZombie('walker', 0, 0, 4, 'frenzy')
  assert.equal(f4.maxHealth, 70) // Math.round(50 * 1.12^3) = 70.25 -> 70
})

test('frenzy kill economy: 2 body shots or 1 headshot at wave 1', () => {
  // Pistol: body 26, head 52 -> frenzy 50 HP dies to 2 bodies or 1 head.
  let { zombie } = makeZombie('shambler', 0, 0, 1, 'frenzy')
  zombie.damage(26, null)
  assert.ok(!zombie.isDead, 'first body shot must not kill')
  assert.equal(zombie.health, 24)
  zombie.damage(26, null)
  assert.ok(zombie.isDead, 'second body shot kills')

  ;({ zombie } = makeZombie('shambler', 0, 0, 1, 'frenzy'))
  zombie.damage(52, null) // headshot
  assert.ok(zombie.isDead, 'headshot kills in one shot')

  // Axe: body 25, head 50 -> exactly 2 bodies / 1 head.
  ;({ zombie } = makeZombie('walker', 0, 0, 1, 'frenzy'))
  zombie.damage(25, null)
  assert.ok(!zombie.isDead, 'first axe body hit must not kill')
  zombie.damage(25, null)
  assert.ok(zombie.isDead, 'second axe body hit kills (50 >= 50)')
  ;({ zombie } = makeZombie('walker', 0, 0, 1, 'frenzy'))
  zombie.damage(50, null) // axe headshot
  assert.ok(zombie.isDead, 'axe headshot kills in one shot')

  // Sword headshot (90) also one-shots; contrast with normal shambler (90 HP
  // takes 4 pistol body hits, frenzy takes 2).
  ;({ zombie } = makeZombie('screamer', 0, 0, 1, 'frenzy'))
  zombie.damage(90, null)
  assert.ok(zombie.isDead, 'sword headshot kills in one shot')
  const { zombie: n } = makeZombie('shambler', 0, 0, 1, 'normal')
  for (let i = 0; i < 3; i++) n.damage(26, null)
  assert.ok(!n.isDead, 'normal shambler survives 3 pistol bodies')
  n.damage(26, null)
  assert.ok(n.isDead, 'normal shambler dies on the 4th')
})

test('frenzy zombies actually run 2x fast: 1 s of pursuit covers 2x distance', () => {
  const { collision, zombie: n } = makeZombie('walker', 10, 0, 1, 'normal')
  const { collision: c2, zombie: f } = makeZombie('walker', 10, 0, 1, 'frenzy')
  const p1 = fakePlayer(0, 0)
  const p2 = fakePlayer(0, 0)
  for (let i = 0; i < 60; i++) {
    n.update(1 / 60, p1, [n], collision, null)
    f.update(1 / 60, p2, [f], c2, null)
  }
  const dn = Math.hypot(n.position.x, n.position.z)
  const df = Math.hypot(f.position.x, f.position.z)
  assert.ok(Math.abs(dn - 8.5) < 0.3, `normal covered ${10 - dn} m in 1 s`)
  assert.ok(Math.abs(df - 7.0) < 0.3, `frenzy covered ${10 - df} m in 1 s`)
})

test('headless Game spawns frenzy zombies when started with difficulty frenzy', () => {
  const game = new Game({ headless: true, difficulty: 'frenzy' })
  game.start()
  game.startGame()
  for (let i = 0; i < 1800 && game.debug.zombiesAlive() === 0; i++) game.step(1 / 60)
  assert.ok(game.debug.zombiesAlive() > 0, 'wave 1 spawned zombies')
  const wave = game.waveManager.wave
  for (const z of game.zombies) {
    assert.equal(z.speed, 2 * TABLE[z.type].speed, `${z.type} frenzy speed in game`)
    assert.equal(z.maxHealth, Math.round(50 * Math.pow(1.12, wave - 1)), `${z.type} flat hp at wave ${wave}`)
  }

  // Control: a default Game spawns baseline stats.
  const g2 = new Game({ headless: true })
  g2.start()
  g2.startGame()
  for (let i = 0; i < 1800 && g2.debug.zombiesAlive() === 0; i++) g2.step(1 / 60)
  assert.ok(g2.debug.zombiesAlive() > 0, 'control game spawned zombies')
  const wave2 = g2.waveManager.wave
  for (const z of g2.zombies) {
    assert.equal(z.speed, TABLE[z.type].speed, `${z.type} baseline speed in game`)
    assert.equal(z.maxHealth, Math.round(TABLE[z.type].hp * Math.pow(1.12, wave2 - 1)), `${z.type} baseline hp at wave ${wave2}`)
  }
})
