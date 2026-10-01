import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { Zombie, DIFFICULTY } from '../src/game/Zombie.js'
import { AmmoDrops, MEDKIT_CHANCE, MEDKIT_HEAL, BULLETS_PER_DROP, SHELLS_PER_DROP } from '../src/game/AmmoDrops.js'
import { Axe } from '../src/game/Axe.js'

const scene = () => new THREE.Scene()
const fakeAudio = () => ({ pickup: () => {} })

test('DIFFICULTY carries the v37 R2 survival fields', () => {
  assert.equal(DIFFICULTY.frenzy.hpBase, 50)
  assert.equal(DIFFICULTY.frenzy.hpRamp, 10)
  assert.equal(DIFFICULTY.frenzy.hpMax, 90)
  assert.equal(DIFFICULTY.nightmare.startAmmoMult, 0.5)
  assert.equal(DIFFICULTY.nightmare.regenOff, true)
  // normal keeps its identity — no ramp, no ammo/regen modifiers.
  assert.equal(DIFFICULTY.normal.hpRamp, undefined)
  assert.equal(DIFFICULTY.normal.startAmmoMult, undefined)
})

test('frenzy zombie HP ramps 50 -> 90 by wave 5 instead of staying flat', () => {
  const s = scene()
  const hp = (w) => new Zombie(s, 'walker', 0, 0, w, 'frenzy').maxHealth
  // Wave 1 is the shipped flat-50 contract (2 pistol bodies / 1 headshot).
  assert.equal(hp(1), 50, 'wave-1 frenzy walker is still 50 HP')
  // The base ramps +10/wave up to the 90 cap, then 1.12^wave scales on top.
  assert.equal(hp(2), Math.round(60 * 1.12))
  assert.equal(hp(3), Math.round(70 * 1.12 ** 2))
  assert.equal(hp(4), Math.round(80 * 1.12 ** 3))
  assert.equal(hp(5), Math.round(90 * 1.12 ** 4))
  // Past the cap the base holds at 90 (no further ramp).
  assert.equal(hp(6), Math.round(90 * 1.12 ** 5))
  assert.ok(hp(5) > hp(1), 'later frenzy waves are genuinely tankier than wave 1')
})

test('nightmare keeps flat 50 HP (no ramp) but starts at wave 3', () => {
  const s = scene()
  const w1 = new Zombie(s, 'walker', 0, 0, 1, 'nightmare').maxHealth
  assert.equal(w1, 50, 'nightmare wave-1 walker is flat 50 HP')
  assert.equal(DIFFICULTY.nightmare.startWave, 3)
})

test('axe swings cost stamina and are refused when the player is out of breath', () => {
  const a = new Axe(scene(), new THREE.PerspectiveCamera(), fakeAudio())
  assert.equal(a.staminaCost, 8, 'axe carries a stamina cost')
  const swings = []
  a.onFire = (n) => swings.push(n)
  const player = { isDead: false, position: new THREE.Vector3(), yaw: 0, stamina: 10, addPitchKick: () => {} }
  a.player = player
  a.getZombies = () => []
  assert.equal(a.swing(), true, 'first swing fires with stamina available')
  assert.equal(player.stamina, 2, 'a swing drains the stamina cost')
  // Below the cost the swing is refused (no cooldown, no stamina drain).
  const before = player.stamina
  a._coolT = 0
  assert.equal(a.swing(), false, 'swing refused below the stamina floor')
  assert.equal(player.stamina, before, 'a refused swing does not drain stamina')
})

test('AmmoDrops setDifficulty halves future ammo yields', () => {
  const d = new AmmoDrops(scene(), fakeAudio())
  // Force: pass DROP_CHANCE (0), pick bullets (0 < 0.5), miss battery (0.9),
  // miss medkit (0.9) -> a bullets crate with the halved amount.
  const rolls = [0.0, 0.0, 0.9, 0.9]
  let i = 0
  d._rand = () => rolls[i++ % rolls.length]
  d.setDifficulty(0.5)
  const kind = d.maybeSpawn(0, 0)
  assert.equal(kind, 'bullets', 'a forced roll spawns a bullets crate')
  const drop = d._drops[0]
  assert.equal(drop.amount, Math.round(BULLETS_PER_DROP * 0.5), 'the drop carries the halved amount')
  d.dispose()
})

test('a medkit drop heals instead of restocking', () => {
  assert.ok(MEDKIT_CHANCE > 0 && MEDKIT_CHANCE < 0.2, 'medkit is a rare slice of drops')
  assert.equal(MEDKIT_HEAL, 35)
  const d = new AmmoDrops(scene(), fakeAudio())
  // Force the roll sequence: pass DROP_CHANCE, pick bullets, miss battery, hit medkit.
  const rolls = [0.0, 0.0, 0.5, 0.0]
  let i = 0
  d._rand = () => rolls[i++ % rolls.length]
  const kind = d.maybeSpawn(0, 0)
  assert.equal(kind, 'medkit', 'the fourth draw turns the crate into a medkit')
  assert.equal(d._drops[0].amount, MEDKIT_HEAL, 'the medkit carries its heal amount')
  d.dispose()
})