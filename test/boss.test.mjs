// test/boss.test.mjs — the wave-5 boss (`brute`): stats, charge state machine,
// scaled hitboxes, the WaveManager finale gate (incoming -> delayed spawn ->
// clear), HUD boss bar, Score/Match kill economy, and frenzy interaction.
// Headless-safe: no DOM, no Math.random.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { CollisionWorld } from '../src/game/CollisionWorld.js'
import { Zombie, TABLE, MAT2, EYEMAT, FACEMAT, POSE2, CHARGE_RANGE, CHARGE_SPEED, CHARGE_TIME, ATTACK_RANGE } from '../src/game/Zombie.js'
import { WaveManager } from '../src/game/WaveManager.js'
import { Score } from '../src/game/Score.js'
import { HUD } from '../src/game/HUD.js'
import { DecapitatedHeadPool } from '../src/game/DecapitatedHeadPool.js'
import { Match } from '../src/net/Match.js'

// City's 12 spawn points, in City.getSpawnPoints() order (same as wave.test).
const PTS = [
  { x: 85, z: 0 }, { x: -85, z: 0 },
  { x: 0, z: -85 }, { x: 0, z: 85 },
  { x: 85, z: -85 }, { x: -85, z: -85 },
  { x: 85, z: 85 }, { x: -85, z: 85 },
  { x: 12, z: -12 }, { x: -12, z: -12 },
  { x: 12, z: 12 }, { x: -12, z: 12 }
]

function fakePlayer(x, z, y = 1.7) {
  return {
    position: new THREE.Vector3(x, y, z),
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

function makeWave() {
  const scene = new THREE.Scene()
  const game = {
    zombies: [],
    spawnZombie(type, x, z) {
      const zb = new Zombie(scene, type, x, z, wm.wave)
      game.zombies.push(zb)
      return zb
    }
  }
  const starts = [], clears = [], bossIncoming = [], bossSpawn = []
  const wm = new WaveManager(scene, PTS, null, null, {
    onWaveStart: w => starts.push(w),
    onWaveCleared: w => clears.push(w),
    spawnZombie: (t, x, z) => game.spawnZombie(t, x, z),
    onBossIncoming: w => bossIncoming.push(w),
    onBossSpawn: w => bossSpawn.push(w)
  })
  const step = s => { for (let i = 0; i < Math.round(s * 60); i++) wm.update(1 / 60, game) }
  const alive = () => game.zombies.filter(z => !z.isDead).length
  const kill = z => { if (!z.isDead) z.damage(z.maxHealth + 10) }
  const killAll = () => game.zombies.forEach(kill)
  // Spawn the whole queue regardless of the concurrency cap. When the cap is
  // reached, kill the oldest live zombie, then step until the next spawn lands
  // (the spawn timer fires ~0.7 s later); the kill's alive-drop is counted on
  // the first of those frames (no spawn masks it), keeping `killed` accurate.
  const spawnAll = () => {
    let guard = 0
    while (wm.spawned < wm.total && guard++ < 5000) {
      const live = game.zombies.filter(z => !z.isDead)
      if (live.length >= wm.cap) {
        kill(live[0])
        const before = wm.spawned
        let inner = 0
        while (wm.spawned === before && inner++ < 60) wm.update(1 / 60, game)
      } else {
        wm.update(1 / 60, game)
      }
    }
  }
  // Run waves 1..4 via forceClear (debug path skips the boss gate).
  const toWave5 = () => {
    wm.reset()
    for (let i = 0; i < 4; i++) { step(1); wm.forceClear(game); step(3.1) }
  }
  return { wm, game, scene, starts, clears, bossIncoming, bossSpawn, step, alive, killAll, spawnAll, toWave5 }
}

// ---- stats ---------------------------------------------------------------

test('brute stats: 4x shambler hp, slow shamble, heavy melee, long cooldown', () => {
  assert.deepEqual(TABLE.brute, { speed: 0.7, hp: 4 * TABLE.shambler.hp, melee: 30, cooldown: 1.6 })
  const { zombie } = makeZombie('brute', 0, 0, 1)
  assert.equal(zombie.maxHealth, 360)
  assert.equal(zombie.speed, 0.7)
  assert.equal(zombie.isBoss, true)
  const { zombie: w } = makeZombie('walker', 0, 0, 1)
  assert.equal(w.isBoss, false)
})

test('brute wave scaling uses the same 1.12^wave curve', () => {
  const { zombie } = makeZombie('brute', 0, 0, 5)
  assert.equal(zombie.maxHealth, Math.round(360 * Math.pow(1.12, 4)))
})

test('brute visuals: own skin/eye/face materials, hulking pose', () => {
  const { zombie } = makeZombie('brute', 1, 1, 5)
  const head = zombie.group.children[1]
  // Torso wears the outfit pair (like every type); head + arms carry the brute skin.
  assert.equal(head.material, MAT2.brute)
  assert.equal(zombie.group.children[2].material, MAT2.brute)
  assert.ok(FACEMAT.brute.includes(head.children[2].material))
  for (const eye of head.children.slice(0, 2)) assert.equal(eye.material, EYEMAT.brute)
  assert.ok(POSE2.brute.torsoS[0] > 1 && POSE2.brute.torsoS[2] > 1, 'torso wider than a walker')
  // Load-bearing anchors unchanged.
  assert.equal(zombie.group.children[0].position.y, 1.2)
  assert.equal(zombie.group.children[1].position.y, 1.8)
})

test('brute hitboxes: same two-sphere contract, 1.4x radii', () => {
  const { zombie } = makeZombie('brute', 2, 4, 5)
  const hb = zombie.getHitboxes()
  assert.equal(hb.length, 2)
  assert.equal(hb[0].center.y, 1.2)
  assert.ok(Math.abs(hb[0].radius - 0.63) < 1e-9)
  assert.equal(hb[0].isHead, false)
  assert.ok(Math.abs(hb[1].radius - 0.42) < 1e-9)
  assert.equal(hb[1].isHead, true)
  // Regular types keep the exact 0.45 / 0.3 contract.
  const { zombie: w } = makeZombie('walker', 2, 4, 1)
  assert.equal(w.getHitboxes()[0].radius, 0.45)
  assert.equal(w.getHitboxes()[1].radius, 0.3)
})

// ---- charge state machine -------------------------------------------------

test('charge: triggers inside 7 m, lunges ~3.3 m, then melee resumes', () => {
  const { collision, zombie } = makeZombie('brute', 0, 8, 5) // 8 m from player at origin
  const player = fakePlayer(0, 0)
  // Outside charge range: plain shamble (0.7 m/s), no charge.
  zombie.update(1 / 60, player, [zombie], collision, null)
  assert.equal(zombie._chargeT, 0)
  // Step inside CHARGE_RANGE: commit the lunge.
  zombie.position.set(0, 0, CHARGE_RANGE - 0.5)
  zombie.update(1 / 60, player, [zombie], collision, null)
  assert.ok(zombie._chargeT > 0, 'charge committed inside range')
  const start = zombie.position.z
  for (let i = 0; i < Math.round(CHARGE_TIME * 60); i++) {
    zombie.update(1 / 60, player, [zombie], collision, null)
  }
  assert.equal(zombie._chargeT, 0, 'charge expires on its own timer')
  const moved = start - zombie.position.z
  const expect = CHARGE_SPEED * CHARGE_TIME
  assert.ok(Math.abs(moved - expect) < 0.15, `lunged ${moved.toFixed(2)} m (expected ~${expect})`)
  // After the lunge the brute sits ~2.7 m out (it lunges 3.3 m from 6 m), so
  // it must walk the last ~1.4 m into ATTACK_RANGE (1.3 m) before its 1.6 s
  // attack cooldown can land the heavy melee — budget ~3.6 s of stepping.
  for (let i = 0; i < Math.round(3.6 * 60); i++) zombie.update(1 / 60, player, [zombie], collision, null)
  assert.ok(player.health <= 1000 - TABLE.brute.melee, `player took ${1000 - player.health} (expected >= ${TABLE.brute.melee})`)
})

test('charge does not trigger outside 7 m or inside melee range', () => {
  const { collision, zombie } = makeZombie('brute', 0, 12, 5)
  const player = fakePlayer(0, 0)
  for (let i = 0; i < 60; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  assert.equal(zombie._chargeT, 0, 'no charge at 12 m')
  const b2 = makeZombie('brute', 0, 1, 5).zombie // inside ATTACK_RANGE
  const p2 = fakePlayer(0, 0)
  for (let i = 0; i < 60; i++) b2.update(1 / 60, p2, [b2], new CollisionWorld(180, 180), null)
  assert.equal(b2._chargeT, 0, 'no charge inside melee range')
})

test('brute knockback staggers like any zombie, then chase resumes', () => {
  const { collision, zombie } = makeZombie('brute', 0, -2, 5)
  const player = fakePlayer(0, 0)
  zombie.knockback(0, -1, 3)
  assert.equal(zombie._kbT, 0.35)
  for (let i = 0; i < 21; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  assert.ok(Math.abs(zombie.position.z + 2.5) < 1e-9)
})

test('brute death: sinks, parts go DEADMAT, corpse inert', () => {
  const { collision, zombie } = makeZombie('brute', 0, 0, 5)
  const player = fakePlayer(0, 0)
  zombie.damage(zombie.maxHealth + 10)
  assert.ok(zombie.isDead)
  for (let i = 0; i < 60; i++) zombie.update(1 / 60, player, [zombie], collision, null)
  assert.ok(zombie.position.y < 0, 'corpse sinks')
})

// ---- wave-5 finale gate ----------------------------------------------------

test('wave 5 finale: incoming fires once, boss spawns after the delay, kill clears', () => {
  const { wm, game, clears, bossIncoming, bossSpawn, step, alive, killAll, spawnAll, toWave5 } = makeWave()
  toWave5()
  assert.equal(wm.wave, 5)
  assert.equal(wm.total, 20)
  // Spawn the whole wave-5 queue (20 zombies), keeping the cap slot free.
  spawnAll()
  assert.equal(wm.spawned, 20)
  assert.equal(bossIncoming.length, 0, 'no boss yet while zombies are alive')
  killAll()
  step(0.5)
  assert.deepEqual(bossIncoming, [5], 'incoming fires on the last kill')
  assert.equal(clears.length, 0, 'wave 5 is held open, not cleared')
  assert.equal(alive(), 0)
  step(1.0) // less than BOSS_DELAY (1.5)
  assert.equal(bossSpawn.length, 0)
  step(0.6)
  assert.deepEqual(bossSpawn, [5])
  const boss = game.zombies.find(z => z.type === 'brute')
  assert.ok(boss, 'brute spawned')
  assert.equal(boss.maxHealth, Math.round(360 * Math.pow(1.12, 4)))
  assert.equal(boss.position.x, 0)
  assert.equal(boss.position.z, 85) // far north point
  assert.equal(alive(), 1)
  // The boss is not part of the queue total, so `remaining` must add it back:
  // remaining === total - killed + 1 (the +1 is the boss). The harness's
  // cap-management kills may not all be counted by the alive-diff, so assert
  // the contract relation rather than a hard-coded count.
  assert.equal(wm.remaining, wm.total - wm.killed + 1, 'HUD count includes the boss')
  // Killing the boss clears wave 5 and the run moves on.
  boss.damage(boss.maxHealth + 10)
  step(0.2)
  assert.deepEqual(clears, [5])
  step(3.1)
  assert.equal(wm.wave, 6)
  assert.equal(bossIncoming.length, 1, 'boss fires exactly once')
})

test('boss does not spawn when wave 5 is force-cleared (debug path)', () => {
  const w2 = makeWave()
  w2.toWave5()
  let guard = 0
  while (w2.wm.spawned < 3 && guard++ < 60) w2.step(1)
  w2.wm.forceClear(w2.game)
  // forceClear marks the boss consumed on the boss wave itself (before the
  // intermission to wave 6 resets the gate for the next wave).
  assert.equal(w2.wm._bossSpawned, true, 'forceClear marks the boss consumed')
  assert.equal(w2.bossSpawn.length, 0)
  assert.equal(w2.bossIncoming.length, 0)
  w2.step(3.1)
  assert.equal(w2.wm.wave, 6)
  // forceClear is the debug path: it never fires onWaveCleared (the wave
  // advances via the intermission), so clears stays empty.
  assert.deepEqual(w2.clears, [])
})

test('boss fight fits the concurrency budget (wave-5 cap 13 + boss <= 24)', () => {
  const { wm, alive, step, toWave5 } = makeWave()
  toWave5()
  let guard = 0
  while (wm.spawned < wm.total && guard++ < 200) step(1)
  assert.ok(alive() <= wm.cap, `alive ${alive()} cap ${wm.cap}`)
  assert.equal(wm.cap, 13)
})

// ---- economy ---------------------------------------------------------------

test('Score and Match credit the boss kill (150 + 50xwave)', () => {
  const s = new Score(null, () => 5)
  assert.equal(s.pointsFor('brute', 5), 150 + 250)
  const m = new Match({ players: [{ id: 'A' }] })
  // Match wave is 1 at construction; spawn the boss explicitly at wave 5.
  const z = m.spawnZombie('brute', 0, 0, 5)
  z.damage(z.maxHealth + 10, null, 'A')
  m.step()
  // Match._onKill credits KILL_VALUES + WAVE_BONUS * current wave (1 here).
  assert.equal(m.score.get('A'), 150 + 50)
  assert.equal(m.kills.get('A'), 1)
  assert.ok(m.events.some(e => e.k === 'kill' && e.type === 'brute'))
})

test('boss events surface in the Match snapshot stream', () => {
  const m = new Match({ players: [{ id: 'A' }] })
  // Drive waves 1..4 via forceClear (debug path skips the boss), then a
  // natural wave-5 clear triggers the boss events.
  for (let i = 0; i < 4; i++) {
    let guard = 0
    while (m.wave.spawned < m.wave.total && guard++ < 400) m.step()
    m.wave.forceClear(m)
    let guard2 = 0
    while (m.wave.wave < 2 + i && guard2++ < 200) m.step()
  }
  assert.equal(m.wave.wave, 5)
  // Spawn the whole wave-5 queue while keeping the cap slot free.
  let guard = 0
  while (m.wave.spawned < m.wave.total && guard++ < 3000) {
    const live = m.zombies.filter(z => !z.isDead)
    if (live.length >= m.wave.cap) live[0].damage(live[0].maxHealth + 10)
    m.step()
  }
  assert.equal(m.wave.spawned, 20)
  for (const z of m.zombies) if (!z.isDead) z.damage(z.maxHealth + 10)
  let sawIncoming = false, sawSpawn = false
  for (let i = 0; i < 200; i++) {
    m.step()
    const ev = m.snapshot().events
    if (ev.some(e => e.k === 'bossIncoming')) sawIncoming = true
    if (ev.some(e => e.k === 'bossSpawn')) sawSpawn = true
    if (sawSpawn) break
  }
  assert.ok(sawIncoming, 'bossIncoming event')
  assert.ok(sawSpawn, 'bossSpawn event')
  assert.ok(m.zombies.some(z => z.type === 'brute'))
})

// ---- HUD boss bar -----------------------------------------------------------

function makeNode() {
  const classes = new Set()
  const n = {
    textContent: '',
    style: {},
    children: [],
    get className() { return [...classes].join(' ') },
    set className(v) { classes.clear(); for (const c of String(v).split(' ')) if (c) classes.add(c) },
    classList: {
      add(c) { classes.add(c) },
      remove(c) { classes.delete(c) },
      toggle(c, force) {
        const want = force === undefined ? !classes.has(c) : !!force
        if (want) classes.add(c); else classes.delete(c)
        return want
      },
      contains(c) { return classes.has(c) }
    },
    appendChild(c) { n.children.push(c); return c },
    get firstChild() { return n.children[0] || null },
    removeChild(c) {
      const i = n.children.indexOf(c)
      if (i >= 0) n.children.splice(i, 1)
      return c
    },
    _listeners: {},
    addEventListener(ev, fn) { (n._listeners[ev] = n._listeners[ev] || []).push(fn) },
    removeEventListener(ev, fn) {
      if (n._listeners[ev]) n._listeners[ev] = n._listeners[ev].filter(f => f !== fn)
    }
  }
  return n
}

function find(root, cls) {
  for (const c of root.children) {
    if (c.classList.contains(cls)) return c
    const r = find(c, cls)
    if (r) return r
  }
  return null
}

test('HUD boss bar: hidden at rest, tracks health while the boss lives', () => {
  const doc = { createElement: () => makeNode() }
  const hudRoot = makeNode(); hudRoot.ownerDocument = doc
  const hud = new HUD(hudRoot, makeNode())
  const box = find(hudRoot, 'hud-boss')
  assert.ok(box, 'boss box built')
  assert.ok(box.classList.contains('hidden'), 'hidden while no boss')
  const fill = find(box, 'bar-fill')
  const boss = { isDead: false, health: 180, maxHealth: 360 }
  hud.boss = boss
  hud.update(null, null, { wave: 5, remaining: 1 })
  assert.ok(!box.classList.contains('hidden'), 'shown while boss alive')
  assert.equal(fill.style.width, '50%')
  boss.isDead = true
  hud.update(null, null, { wave: 5, remaining: 1 })
  assert.ok(box.classList.contains('hidden'), 'hidden once the boss dies')
  hud.dispose()
})

test('boss appears every 5 waves: wave 10 spawns a higher-HP brute', () => {
  const { wm, game, bossIncoming, bossSpawn, step, alive, killAll, spawnAll } = makeWave()
  wm.reset()
  // Advance to wave 10 via forceClear (debug path skips the boss gate each time).
  for (let i = 0; i < 9; i++) { step(1); wm.forceClear(game); step(3.1) }
  assert.equal(wm.wave, 10)
  spawnAll()
  killAll()
  step(0.5)
  assert.deepEqual(bossIncoming, [10], 'boss incoming fires on wave 10')
  step(1.6)
  assert.deepEqual(bossSpawn, [10], 'boss spawns on wave 10')
  const boss = game.zombies.find(z => z.type === 'brute')
  assert.ok(boss, 'brute spawned at wave 10')
  // HP scales with the wave: more than the wave-5 boss (>=5 pistol shots at L5,
  // and progressively more at 10/15).
  assert.equal(boss.maxHealth, Math.round(360 * Math.pow(1.12, 9)))
  assert.ok(boss.maxHealth > Math.round(360 * Math.pow(1.12, 4)), 'wave-10 boss is tougher than wave-5')
  assert.equal(alive(), 1)
})

test('boss never decapitates (pool skips isBoss)', () => {
  const scene = new THREE.Scene()
  const pool = new DecapitatedHeadPool(scene)
  const { zombie } = makeZombie('brute', 0, 0, 5)
  assert.equal(pool.spawn(zombie, { x: 1, z: 0 }), null)
  assert.equal(pool.count(), 0)
  const { zombie: w } = makeZombie('walker', 0, 0, 1)
  assert.ok(pool.spawn(w, { x: 1, z: 0 }))
  assert.equal(pool.count(), 1)
})

// ---- frenzy interaction ------------------------------------------------------

test('frenzy flattens the boss to 50 hp and doubles its shamble', () => {
  const { zombie } = makeZombie('brute', 0, 0, 1, 'frenzy')
  assert.equal(zombie.maxHealth, 50)
  assert.equal(zombie.speed, 1.4)
  const { zombie: f5 } = makeZombie('brute', 0, 0, 5, 'frenzy')
  assert.equal(f5.maxHealth, Math.round(50 * Math.pow(1.12, 4)))
})