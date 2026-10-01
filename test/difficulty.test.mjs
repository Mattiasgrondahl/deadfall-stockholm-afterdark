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
  assert.deepEqual(DIFFICULTY.normal, { speedMult: 1, hpBase: null, startWave: 1 })
  // v37 R2: frenzy no longer flattens to a flat 50 — it ramps 50 -> 90 across
  // the first five waves (hpRamp/hpMax) so later waves are tankier.
  assert.deepEqual(DIFFICULTY.frenzy, { speedMult: 2, hpBase: 50, hpRamp: 10, hpMax: 90, startWave: 1 })
  // v3 difficulty (1): nightmare stacks on frenzy — 3x speed, flat 50 HP, opens
  // at wave 3. v37 R2 adds the survival modifiers (half start ammo, no regen).
  assert.deepEqual(DIFFICULTY.nightmare, { speedMult: 3, hpBase: 50, startWave: 3, startAmmoMult: 0.5, regenOff: true })
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

test('frenzy wave scaling ramps the base 50 -> 90 then applies on top', () => {
  // v37 R2: the base ramps +10/wave up to the 90 cap, then 1.12^wave scales it.
  const { zombie: f2 } = makeZombie('shambler', 0, 0, 2, 'frenzy')
  assert.equal(f2.maxHealth, Math.round(60 * 1.12)) // base 60 at wave 2
  const { zombie: f3 } = makeZombie('walker', 0, 0, 3, 'frenzy')
  assert.equal(f3.maxHealth, Math.round(70 * 1.12 ** 2)) // base 70 at wave 3
  const { zombie: f4 } = makeZombie('walker', 0, 0, 4, 'frenzy')
  assert.equal(f4.maxHealth, Math.round(80 * 1.12 ** 3)) // base 80 at wave 4
  const { zombie: f5 } = makeZombie('walker', 0, 0, 5, 'frenzy')
  assert.equal(f5.maxHealth, Math.round(90 * 1.12 ** 4)) // base caps at 90
  const { zombie: f6 } = makeZombie('walker', 0, 0, 6, 'frenzy')
  assert.equal(f6.maxHealth, Math.round(90 * 1.12 ** 5)) // base holds at 90 past the cap
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

  // Sword headshot (90) also one-shots; contrast with normal shambler (v27:
  // HP doubled to 180, so it takes 7 pistol bodies; frenzy flattens to 50 = 2).
  ;({ zombie } = makeZombie('screamer', 0, 0, 1, 'frenzy'))
  zombie.damage(90, null)
  assert.ok(zombie.isDead, 'sword headshot kills in one shot')
  const { zombie: n } = makeZombie('shambler', 0, 0, 1, 'normal')
  for (let i = 0; i < 6; i++) n.damage(26, null)
  assert.ok(!n.isDead, 'normal shambler survives 6 pistol bodies (156 < 180)')
  n.damage(26, null)
  assert.ok(n.isDead, 'normal shambler dies on the 7th (182 >= 180)')
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

  // Control: an explicit normal Game spawns baseline stats (v3: the DEFAULT
  // is frenzy now — see the next test).
  const g2 = new Game({ headless: true, difficulty: 'normal' })
  g2.start()
  g2.startGame()
  for (let i = 0; i < 1800 && g2.debug.zombiesAlive() === 0; i++) g2.step(1 / 60)
  assert.ok(g2.debug.zombiesAlive() > 0, 'control game spawned zombies')
  const wave2 = g2.waveManager.wave
  assert.equal(wave2, 1, 'normal opens at wave 1')
  for (const z of g2.zombies) {
    assert.equal(z.speed, TABLE[z.type].speed, `${z.type} baseline speed in game`)
    assert.equal(z.maxHealth, Math.round(TABLE[z.type].hp * Math.pow(1.12, wave2 - 1)), `${z.type} baseline hp at wave ${wave2}`)
  }
})

test('v3: a default Game is FRENZY, and nightmare opens the run at wave 3', () => {
  const g = new Game({ headless: true })
  assert.equal(g.difficulty, 'frenzy', 'frenzy is the shipped default now')
  g.start()
  g.startGame()
  assert.equal(g.waveManager.wave, 1, 'frenzy still opens at wave 1')

  const n = new Game({ headless: true, difficulty: 'nightmare' })
  n.start()
  n.startGame()
  assert.equal(n.waveManager.wave, 3, 'nightmare opens at wave 3')
  for (let i = 0; i < 1800 && n.debug.zombiesAlive() === 0; i++) n.step(1 / 60)
  assert.ok(n.debug.zombiesAlive() > 0, 'nightmare spawned zombies')
  for (const z of n.zombies) {
    assert.equal(z.speed, 3 * TABLE[z.type].speed, `${z.type} nightmare speed`)
    assert.equal(z.maxHealth, Math.round(50 * Math.pow(1.12, 3 - 1)), `${z.type} flat hp at wave 3`)
  }
})
