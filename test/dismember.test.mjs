// test/dismember.test.mjs — the v3 dismemberment chain end-to-end.
//
// Covers the shared dropped-limb pool (tumble, settle, recycle, clear) and the
// chain as the game actually runs it: a real headless Game, a real Zombie, the
// real pistol firing real rounds. The chain is hit-counted (the user decision),
// so it must hold in every difficulty, and the 4th body round must kill through
// the normal death path (kill counted, corpse removed, no double-kill with the
// decap-head pool). Headless-safe: fixed dt, no timers, no Math.random.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { DroppedLimbPool } from '../src/game/DroppedLimbPool.js'
import { Zombie, GEO2 } from '../src/game/Zombie.js'
import { Game } from '../src/game/Game.js'

// GEO2 is re-exported by Zombie.js for exactly this kind of test.
void GEO2

function makeZombie(type = 'walker', x = 0, z = 0, wave = 1, difficulty = 'normal') {
  const scene = new THREE.Scene()
  const zombie = new Zombie(scene, type, x, z, wave, difficulty)
  return { scene, zombie }
}

// ---- the pool ---------------------------------------------------------------

test('pool: a dropped limb tumbles, then settles flat on the ground', () => {
  const scene = new THREE.Scene()
  const pool = new DroppedLimbPool(scene)
  let s = 1234
  const rand = () => { s = (Math.imul(s, 48271) >>> 0) % 65537; return s / 65537 }
  const mesh = pool.drop(GEO2.arm, new THREE.MeshStandardMaterial(), 2, 1.42, 3, rand)
  assert.equal(pool.count, 1)
  assert.equal(mesh.visible, true)
  const y0 = mesh.position.y
  pool.update(0.1)
  assert.ok(mesh.position.y < y0, 'the limb falls under gravity')
  for (let i = 0; i < 60; i++) pool.update(1 / 60)
  assert.equal(mesh.position.y, 0.06, 'settled at ground height')
  pool.dispose()
  assert.equal(pool.count, 0)
})

test('pool: recycling caps live limbs at 24 (mesh budget gate)', () => {
  const scene = new THREE.Scene()
  const pool = new DroppedLimbPool(scene)
  const rand = () => 0.5
  for (let i = 0; i < 40; i++) pool.drop(GEO2.leg, new THREE.MeshStandardMaterial(), 0, 1, 0, rand)
  assert.equal(pool.count, 24, 'the pool never exceeds its cap')
  assert.equal(pool.items.length, 24, 'no mesh leak: the pool reuses its own meshes')
  pool.clear()
  assert.equal(pool.count, 0)
  assert.equal(scene.children.length, 0, 'clear detaches every limb')
})

test('pool: drop is deterministic for the same LCG', () => {
  const mk = () => {
    const pool = new DroppedLimbPool(new THREE.Scene())
    let s = 99
    const rand = () => { s = (Math.imul(s, 48271) >>> 0) % 65537; return s / 65537 }
    return pool.drop(GEO2.arm, new THREE.MeshStandardMaterial(), 0, 1.4, 0, rand)
  }
  const a = mk(); const b = mk()
  assert.equal(a.rotation.x, b.rotation.x, 'same seed -> same tumble')
  assert.equal(a.rotation.z, b.rotation.z)
})

// ---- the chain on a real zombie --------------------------------------------

test('chain: limbs drop into the pool as the chain advances', () => {
  const scene = new THREE.Scene()
  const pool = new DroppedLimbPool(scene)
  const zombie = new Zombie(scene, 'walker', 5, -5, 1)
  zombie.drops = pool
  zombie.hitLimbAt(5 - 0.34, 1.42, -5 + 0.1)
  zombie._chainShot(1)
  assert.equal(zombie.armsLost, 1)
  assert.equal(pool.count, 1, 'the severed arm was dropped')
  zombie.hitLimbAt(5 + 0.34, 1.42, -5 + 0.1)
  zombie._chainShot(1)
  assert.equal(pool.count, 2)
  zombie.hitLimbAt(5 - 0.16, 0.47, -5)
  zombie._chainShot(1)
  assert.equal(pool.count, 3, 'three limbs on the ground')
  assert.equal(zombie.isDead, false)
})

test('chain: a headshot kills without touching the chain or the pool', () => {
  const scene = new THREE.Scene()
  const pool = new DroppedLimbPool(scene)
  const zombie = new Zombie(scene, 'walker', 0, 0, 1)
  zombie.drops = pool
  zombie.damage(zombie.health + 1, null, 'p1', true) // fatal headshot
  assert.equal(zombie.isDead, true)
  assert.equal(zombie._chainShots, 0, 'the chain never advanced')
  assert.equal(pool.count, 0, 'no limb was dropped')
})

test('chain: the boss is immune to severing and to the chain kill', () => {
  const { zombie } = makeZombie('brute', 0, 0, 5)
  for (let i = 0; i < 6; i++) {
    zombie.hitLimbAt(-0.34, 1.42, 0.1)
    zombie._chainShot(1)
  }
  assert.equal(zombie.armsLost, 0)
  assert.equal(zombie.isDead, false, 'six body rounds cannot chain-kill the boss')
})

// ---- the chain through the real Game ---------------------------------------

/** Fire the pistol at `zombie` until it is dead or the shot budget runs out.
 *  The chain is hit-counted, so the test pins the weapon: the shotgun's 6×22
 *  blast kills before the chain resolves, while the pistol (26/round) lets
 *  rounds 1-3 sever and round 4 land the chain kill. The chain target is a
 *  SHAMBLER (90 HP): the walker's 50 HP dies to two body rounds and ends the
 *  chain early, which is the shipped kill economy, not a chain failure.
 *
 *  Aim follows the real camera convention (Player.js: rotation order YXZ, yaw
 *  0 faces -Z): yaw = atan2(-dx, -dz) turns toward the target (same as
 *  match.test.mjs / e2e-browser.mjs), and pitch is negative when the target
 *  sits BELOW the eye — the torso center (y 1.2) is under the 1.7 m eye, so
 *  looking down is atan2(1.2 - eyeY, horizontal dist).
 *  The zombie drifts a little while the wave packs in, so the aim is re-solved
 *  before every round. */
function shootUntilDead(game, zombie, maxShots = 12) {
  game.weapon.switchTo('pistol')
  game.step(30) // past the 0.25 s swap lockout
  const p = game.player.position
  let shots = 0
  while (!zombie.isDead && shots < maxShots) {
    const dx = zombie.position.x - p.x
    const dz = zombie.position.z - p.z
    const d = Math.hypot(dx, dz)
    game.player.yaw = Math.atan2(-dx, -dz)
    // Aim at the chest (y 1.45), not the torso hit-sphere centre (y 1.2): the
  // impact point sits on the sphere shell, and 1.45 is the height where that
  // shell passes through the arm sockets, so a chest shot clips an arm.
  game.player.pitch = Math.atan2(1.45 - game.player.position.y, Math.max(d, 0.5))
    game.step(1 / 60) // camera sync
    if (game.debug.shootOnce()) shots++
    else game.step(6) // wait out the fire interval
  }
  return shots
}

test('game: four pistol body rounds dismember then chain-kill, and the kill is counted', () => {
  const game = new Game({ headless: true, difficulty: 'normal' })
  game.start()
  game.startGame()
  game.debug.setPlayerPos(0, 0)
  // shambler (90 HP) survives rounds 1-3 (90 − 3×26 = 12 HP) so the 4th
  // round is the chain kill, not the damage.
  const z = game.debug.spawnZombie('shambler', 0, -6)
  assert.ok(z, 'spawned')
  assert.equal(z.drops, game.limbs, 'the run owns the shared limb pool')
  const shots = shootUntilDead(game, z)
  assert.equal(shots, 4, `chain kill on the fourth body round (took ${shots})`)
  assert.equal(z.isDead, true, 'the fourth round killed it')
  assert.equal(z.armsLost, 2, 'both arms came off first')
  assert.equal(z.legsLost, 1, 'then a leg')
  assert.equal(game.limbs.count, 3, 'three limbs lie on the ground')
  game.step(1 / 60)
  assert.ok(game.debug.kills() >= 1, 'the chain kill went through the kill bookkeeping')
  game.dispose && game.dispose()
})

test('game: the chain holds in FRENZY (flat 50 HP ends it after the first arm)', () => {
  const game = new Game({ headless: true, difficulty: 'frenzy' })
  game.start()
  game.startGame()
  game.debug.setPlayerPos(0, 0)
  const z = game.debug.spawnZombie('walker', 0, -6)
  const shots = shootUntilDead(game, z)
  assert.ok(z.isDead, 'frenzy walker died')
  assert.equal(shots, 2, `flat 50 HP dies to two pistol body rounds (took ${shots})`)
  assert.equal(z.armsLost, 1, 'the chain ended after the first arm (hit-counted)')
  assert.equal(game.limbs.count, 1, 'the severed arm still dropped to the ground')
  game.dispose && game.dispose()
})

test('game: the sniper resolves the chain before damage (round-60 order)', () => {
  const game = new Game({ headless: true, difficulty: 'normal' })
  game.start()
  game.startGame()
  game.debug.setPlayerPos(0, 0)
  // The brute is the boss — immune to the chain — so it cannot demonstrate
  // the chain itself. A shambler with its HP raised above four 90-damage
  // rounds does: rounds 1-2 sever the arms, round 3 spends the chain on a
  // torso round that clips no limb, and round 4 trips the kill gate (the
  // chain kill severs the surviving leg and finishes it). The HP is 400 so
  // the 90-damage rounds cannot drain it to death before the chain resolves
  // — with damage BEFORE the chain (the pre-round-60 order) the zombie would
  // die to HP drain on round 3 and the chain gate would never fire. This
  // pins the round-60 ordering for the sniper, same as Pistol. The aim walks
  // the surviving arm socket (left, then right) so both sever cleanly.
  game.weapon.switchTo('sniper')
  game.step(30) // past the 0.25 s swap lockout
  const z = game.debug.spawnZombie('shambler', 0, -10)
  z.health = z.maxHealth = 400
  let shots = 0
  while (!z.isDead && shots < 12) {
    const sx = z.armsLost === 0 ? z.position.x - 0.34 : z.position.x + 0.34
    const sz = z.position.z + 0.1
    const p = game.player.position
    const dx = sx - p.x
    const dz = sz - p.z
    const d = Math.hypot(dx, dz)
    game.player.yaw = Math.atan2(-dx, -dz)
    game.player.pitch = Math.atan2(1.42 - game.player.position.y, Math.max(d, 0.5))
    game.step(1 / 60) // camera sync
    if (game.debug.shootOnce()) shots++
    else game.step(60) // wait out the bolt cycle
  }
  assert.equal(shots, 4, `chain kill on the fourth body round (took ${shots})`)
  assert.equal(z.isDead, true, 'the chain kill finished it')
  assert.equal(z.armsLost, 2, 'both arms came off first')
  assert.equal(z.legsLost, 1, 'then a leg (the chain kill severs one more)')
  assert.equal(game.limbs.count, 3, 'three limbs lie on the ground')
  game.step(1 / 60)
  assert.ok(game.debug.kills() >= 1, 'the chain kill went through the kill bookkeeping')
  game.dispose && game.dispose()
})

test('game: restart clears dropped limbs and the scene stays in budget', () => {
  const game = new Game({ headless: true, difficulty: 'normal' })
  game.start()
  game.startGame()
  game.debug.setPlayerPos(0, 0)
  // shambler so the full chain resolves (three limbs dropped before death)
  const z = game.debug.spawnZombie('shambler', 0, -6)
  shootUntilDead(game, z)
  assert.ok(game.limbs.count > 0, 'limbs were dropped')
  game.debug.resetRun()
  assert.equal(game.limbs.count, 0, 'restart wiped the dropped limbs')
  const stats = game.debug.sceneStats()
  assert.ok(stats.meshes <= 640, `mesh budget holds after a dismembered run (${stats.meshes})`)
  game.dispose && game.dispose()
})

test('game: a headshot kill never drops limbs and never double-kills', () => {
  const game = new Game({ headless: true, difficulty: 'normal' })
  game.start()
  game.startGame()
  game.debug.setPlayerPos(0, 0)
  const z = game.debug.spawnZombie('walker', 0, -6)
  const p = game.player.position
  const d = Math.hypot(z.position.x - p.x, z.position.z - p.z)
  // Same convention as shootUntilDead: yaw toward the target, pitch negative
  // because the head center (y 1.8) is below the 1.7 m eye only at close
  // range — here it aims at the head sphere, not the torso.
  game.player.yaw = Math.atan2(-(z.position.x - p.x), -(z.position.z - p.z))
  game.player.pitch = Math.atan2(1.8 - game.player.position.y, Math.max(d, 0.5))
  game.step(1 / 60)
  game.debug.shootOnce() // one round at the head hitbox
  assert.equal(z.isDead, true, 'one headshot kills a wave-1 walker')
  assert.equal(game.limbs.count, 0, 'a headshot never severs a limb')
  game.step(1 / 60)
  assert.equal(game.debug.kills(), 1, 'exactly one kill counted')
  game.dispose && game.dispose()
})