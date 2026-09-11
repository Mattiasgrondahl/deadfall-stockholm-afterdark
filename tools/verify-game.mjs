/**
 * verify-game.mjs — staged headless playthrough (npm run verify).
 *
 * Drives the real Game class in Node (stub renderer, real scene/camera/
 * entities) through the full gameplay arc, stage by stage. Every stage is
 * gated on the subsystems it needs: a stage whose subsystems have not been
 * wired yet is SKIPPED, not failed. Progressive runs (while tasks land)
 * exit 0 as long as nothing FAILs; final acceptance requires zero FAILs
 * and zero SKIPPED stages.
 */
import * as THREE from 'three'
import { Game, GameState } from '../src/game/Game.js'
import { AmmoDrops, SHELLS_PER_DROP } from '../src/game/AmmoDrops.js'

const DT = 1 / 60
const g = new Game({ headless: true })
g.start()

let pass = 0
let fail = 0
const skips = []

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}
function step(n) { for (let i = 0; i < n; i++) g.step(DT) }
function pos() { return g.debug.playerPos() }
function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z) }

function stage(title, gate, fn) {
  console.log(`\n== ${title}`)
  let blocked = false
  try { blocked = !gate() } catch (err) { blocked = true; console.log(`  FAIL  stage crashed in gate: ${err.message}`); fail++ }
  if (blocked) { skips.push(title); console.log(`  SKIP  (subsystems not wired yet)`); return }
  try { fn() } catch (err) {
    fail++
    console.log(`  FAIL  stage crashed: ${err.stack || err}`)
  }
}

/** Force a clean PLAYING run from whatever state we are in. */
function freshRun() { g.debug.resetRun() }

/** Set player heading (yaw/pitch) and step once so the camera syncs. */
function aimAt(target, headHeight = 1.55) {
  const dx = target.position.x - g.player.position.x
  const dz = target.position.z - g.player.position.z
  const d = Math.hypot(dx, dz)
  g.player.yaw = Math.atan2(-dx, -dz)
  g.player.pitch = Math.atan2(g.player.position.y - headHeight, Math.max(d, 0.5))
  g.step(DT) // player.update syncs camera from yaw/pitch
}

/** Fire until `target` is dead (max `maxShots`), resyncing aim each shot. */
function kill(target, maxShots = 8) {
  let shots = 0
  while (!target.isDead && shots < maxShots && g.state === GameState.PLAYING) {
    aimAt(target)
    if (g.debug.shootOnce()) shots++
    else break
    g.step(60) // > 0.9 s shotgun fire interval
  }
  return shots
}

function aliveZombies() { return g.zombies.filter(z => !z.isDead) }

g.startGame() // leave the instance in PLAYING; stages reset as needed

// ---------------------------------------------------------------- S1 states
stage('S1 state machine (title / pause / resume)', () => true, () => {
  g.state = GameState.TITLE
  ok('boots at TITLE', g.debug.state() === GameState.TITLE)
  g.startGame()
  ok('startGame -> PLAYING', g.debug.state() === GameState.PLAYING)
  g.inputState.pause = true
  g.step(DT)
  ok('pause edge -> PAUSED', g.debug.state() === GameState.PAUSED)
  step(30)
  ok('stays PAUSED while paused', g.debug.state() === GameState.PAUSED)
  g.inputState.pause = true
  g.step(DT)
  ok('pause edge resumes -> PLAYING', g.debug.state() === GameState.PLAYING)
})

// ------------------------------------------------------------ S2 movement
stage('S2 movement / look / collision / sprint', () => !!g.player, () => {
  freshRun()
  const start = pos().clone()
  g.inputState.forward = true
  step(60)
  g.inputState.forward = false
  const p = pos()
  const d = dist(start, p)
  const dir = { x: p.x - start.x, z: p.z - start.z }
  const dirLen = Math.hypot(dir.x, dir.z) || 1
  ok('walks forward ≥ 2.5 m in 1 s', d >= 2.5, `moved ${d.toFixed(2)} m`)
  const dot = (dir.x / dirLen) * -Math.sin(g.player.yaw) + (dir.z / dirLen) * -Math.cos(g.player.yaw)
  ok('moves along facing direction', dot > 0.9, `dot ${dot.toFixed(2)}`)
  ok('yaw unchanged by movement', Math.abs(g.player.yaw) < 0.01, `yaw ${g.player.yaw}`)

  const x0 = pos().x
  g.inputState.left = true
  step(30)
  g.inputState.left = false
  ok('strafe left moves -X (facing -Z)', pos().x < x0 - 0.4, `dx ${pos().x - x0}`)

  g.inputState.turnX = 100
  g.step(DT)
  ok('look right: yaw ≈ -0.22', Math.abs(g.player.yaw + 0.22) < 0.005, `yaw ${g.player.yaw}`)
  ok('look accumulator consumed', g.inputState.turnX === 0)
  g.inputState.turnY = -1e6
  g.step(DT)
  ok('pitch clamps at +1.45 (look up)', Math.abs(g.player.pitch - 1.45) < 1e-3, `pitch ${g.player.pitch}`)
  g.inputState.turnY = 1e6
  g.step(DT)
  ok('pitch clamps at -1.45 (look down)', Math.abs(g.player.pitch + 1.45) < 1e-3, `pitch ${g.player.pitch}`)

  // World-boundary collision: run east from x=88; must stop at x ≤ 90 - 0.35.
  g.player.yaw = -Math.PI / 2 // face +X
  g.player.pitch = 0
  g.debug.setPlayerPos(88, 0)
  g.inputState.forward = true
  step(600)
  g.inputState.forward = false
  ok('world boundary stops player', pos().x <= 90 - 0.35 + 1e-3, `x ${pos().x}`)
  ok('rest position is walkable', g.collision.isWalkable(pos().x, pos().z, 0.35))

  // Obstacle collision: teleport inside a registered AABB; resolve must eject.
  const box = g.collision.aabbs[0]
  if (box) {
    const cx = (box.minX + box.maxX) / 2
    const cz = (box.minZ + box.maxZ) / 2
    g.debug.setPlayerPos(cx, cz)
    g.inputState.forward = true
    step(180)
    g.inputState.forward = false
    const p = pos()
    const outside = p.x < box.minX - 0.35 || p.x > box.maxX + 0.35 ||
      p.z < box.minZ - 0.35 || p.z > box.maxZ + 0.35
    ok('obstacle ejects player (stays walkable)', g.collision.isWalkable(p.x, p.z, 0.35) && outside,
      `pos (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) vs box`)
  }

  // Sprint + stamina: hold forward + sprint, then continue walking.
  // Reset to a known open street (x = 12 is a street center line in both
  // the placeholder world and the city) so this phase is independent of
  // where the obstacle test left the player.
  g.player.yaw = 0
  g.debug.setPlayerPos(12, 0)
  const s0 = pos().clone()
  g.inputState.forward = true
  g.inputState.sprint = true
  step(60)
  g.inputState.sprint = false
  const sprintD = dist(s0, pos())
  const w0 = pos().clone()
  step(60)
  g.inputState.forward = false
  const walkD = dist(w0, pos())
  ok('sprint covers more ground than walk', sprintD > walkD + 0.5, `sprint ${sprintD.toFixed(2)} vs walk ${walkD.toFixed(2)}`)
  ok('stamina drained by sprint', g.debug.stamina() < 99, `stamina ${g.debug.stamina()}`)
  const st0 = g.debug.stamina()
  step(60)
  ok('stamina regenerates', g.debug.stamina() > st0 + 1.5, `${st0} -> ${g.debug.stamina()}`)
})

// ----------------------------------------------------------- S3 death/reset
stage('S3 death -> game over -> clean restart', () => !!g.player, () => {
  freshRun()
  g.debug.damagePlayer(100)
  ok('damage to 0 -> GAMEOVER', g.debug.state() === GameState.GAMEOVER)
  g.debug.resetRun()
  ok('restart -> PLAYING', g.debug.state() === GameState.PLAYING)
  ok('health restored to 100', g.debug.health() === 100)
  ok('position reset to spawn', Math.abs(pos().x) < 1e-6 && Math.abs(pos().z - 12) < 1e-6, `pos ${pos()}`)
  ok('kills reset to 0', g.debug.kills() === 0)
  ok('no zombies after restart', g.zombies.length === 0)
})

// ------------------------------------------------------------- S4 weapon
stage('S4 weapon: fire / rate / reload / empty (shotgun)', () => !!g.weapon, () => {
  freshRun()
  ok('starts 5/30', g.debug.ammo() === 5 && g.debug.reserve() === 30,
    `${g.debug.ammo()}/${g.debug.reserve()}`)
  ok('first shot fires', g.debug.shootOnce() === true)
  ok('ammo decremented', g.debug.ammo() === 4, `ammo ${g.debug.ammo()}`)
  const before = g.debug.ammo()
  for (let i = 0; i < 5; i++) g.debug.shootOnce() // no time passes
  ok('fire interval limits burst without steps', g.debug.ammo() === before, `ammo ${g.debug.ammo()}`)
  step(60) // 1 s > 0.9 s shotgun fire interval
  const after = g.debug.shootOnce()
  ok('can fire again after interval', after === true && g.debug.ammo() === before - 1, `ammo ${g.debug.ammo()}`)
  // Drain magazine, then reload.
  let guard = 0
  while (g.debug.ammo() > 0 && guard++ < 60) { step(60); g.debug.shootOnce() }
  ok('magazine can be emptied', g.debug.ammo() === 0, `ammo ${g.debug.ammo()}`)
  ok('empty magazine refuses to fire', g.debug.shootOnce() === false)
  g.debug.reloadWeapon()
  step(90) // 1.5 s > 1.4 s reload
  ok('reload restores magazine', g.debug.ammo() === 5 && g.debug.reserve() === 25,
    `${g.debug.ammo()}/${g.debug.reserve()}`)
})

// ------------------------------------------------------------ S5 zombies
stage('S5 zombie: pursue / attack / kill / corpse', () => !!g.player && g.spawnZombie('walker', 30, 12) !== null, () => {
  freshRun()
  const z = g.debug.spawnZombie('walker', 30, 12)
  ok('spawn returns zombie, alive count 1', z !== null && g.debug.zombiesAlive() === 1)
  const d0 = dist(pos(), z.position)
  step(300) // 5 s
  const d1 = dist(pos(), z.position)
  ok('walker pursues player (distance drops ≥ 3 m)', d1 < d0 - 3, `${d0.toFixed(1)} -> ${d1.toFixed(1)}`)
  // Force close range and let it attack.
  const zp = z.position
  g.debug.setPlayerPos(zp.x + 1.0, zp.z)
  step(90) // 1.5 s
  ok('melee attack damages player', g.debug.health() < 100, `health ${g.debug.health()}`)
  // Kill it with shots (aim syncs each shot).
  const shots = kill(z)
  ok('kill in ≤ 8 shots', z.isDead && shots > 0, `shots ${shots}, dead ${z.isDead}`)
  ok('kill counted', g.debug.kills() >= 1, `kills ${g.debug.kills()}`)
  step(360) // > 5 s corpse timer
  ok('corpse removed after 5 s', !g.zombies.includes(z), `zombies left ${g.zombies.length}`)
  // Variant: shambler is slower than walker (same open street start point).
  const w = g.debug.spawnZombie('walker', 30, 12)
  const s = g.debug.spawnZombie('shambler', 30, 12)
  const wd0 = dist(w.position, g.player.position)
  const sd0 = dist(s.position, g.player.position)
  step(120)
  const wd = dist(w.position, g.player.position)
  const sd = dist(s.position, g.player.position)
  ok('shambler slower than walker', (sd0 - sd) < (wd0 - wd), `walker closed ${(wd0 - wd).toFixed(1)}, shambler ${(sd0 - sd).toFixed(1)}`)
  g.debug.killAllZombies()
  step(10)
})

// ------------------------------------------------------------- S6 waves
stage('S6 waves: cadence / scaling / cap / intermission', () => !!g.waveManager, () => {
  freshRun()
  ok('wave 1 on start', g.debug.wave() === 1)
  step(300) // 5 s
  const alive = g.debug.zombiesAlive()
  ok('wave 1 spawning at ~0.7 s cadence', alive >= 4, `alive ${alive}`)
  ok('wave 1 total 5 + 3·1 = 8', g.waveManager.total === 8, `total ${g.waveManager.total}`)
  ok('concurrent cap min(8+wave,18)=9', alive <= 9, `alive ${alive}`)
  g.debug.forceWaveClear()
  step(270) // > 4 s intermission
  ok('wave 2 after intermission', g.debug.wave() === 2, `wave ${g.debug.wave()}`)
  ok('wave 2 total 11', g.waveManager.total === 11, `total ${g.waveManager.total}`)
  step(300)
  ok('wave 2 cap min(8+2,18)=10', g.debug.zombiesAlive() <= 10, `alive ${g.debug.zombiesAlive()}`)
  const walker2 = g.zombies.find(z => z.type === 'walker')
  if (walker2) ok('wave 2 hp scaled ×1.12', walker2.health >= 50 * 1.12 - 1, `hp ${walker2.health}`)
  // Natural clear -> wave 3, first screamers.
  g.debug.killAllZombies()
  step(300) // intermission + initial spawns
  ok('wave 3 after natural clear', g.debug.wave() === 3, `wave ${g.debug.wave()}`)
  step(240)
  ok('screamer appears in wave ≥ 3', g.zombies.some(z => z.type === 'screamer'),
    `types ${[...new Set(g.zombies.map(z => z.type))].join('/')}`)
  ok('wave 3 total 14, cap 11', g.waveManager.total === 14 && g.debug.zombiesAlive() <= 11,
    `total ${g.waveManager.total}, alive ${g.debug.zombiesAlive()}`)
})

// ---------------------------------------------- S7 full playthrough loop
// The harness restores player health often enough that converging zombies
// cannot attrite the player to death between kills (fast wave-3 screamers
// deal ~50-90 dmg/s in melee); combat is still genuinely
// exercised (aim, fire, spread, reload, melee damage, wave transitions).
stage('S7 full loop: clear 3 waves by shooting, then die', () =>
  !!g.player && !!g.weapon && !!g.waveManager && g.spawnZombie('walker', 30, 0) !== null, () => {
  g.debug.killAllZombies(); g.zombies = []; g.kills = 0
  g.debug.resetRun()
  let wave = 1
  let timedOut = false
  while (wave <= 3 && g.state === GameState.PLAYING && !timedOut) {
    // Wait for wave spawn, then clear it by shooting.
    let idle = 0
    while (g.debug.zombiesAlive() === 0 && idle++ < 600 && g.state === GameState.PLAYING) {
      step(1)
      if (g.debug.wave() !== wave) { wave = g.debug.wave(); break }
    }
    if (g.debug.wave() !== wave) wave = g.debug.wave()
    let guard = 0
    while (g.debug.zombiesAlive() > 0 && guard++ < 4000 && g.state === GameState.PLAYING) {
      if (guard % 8 === 0) g.debug.setPlayerHealth(100) // frequent restores: survive fast-wave melee rushes
      // Nearest in-range zombie with clear line of sight. Firing into a wall
      // wastes rounds (72 total for waves 1-3); zombies slide around
      // obstacles (Zombie.update), so occluded targets become shootable
      // once they clear cover.
      const p = pos()
      let z = null
      let best = Infinity
      for (const q of aliveZombies()) {
        const d = dist(q.position, p)
        if (d > 45 || d >= best) continue
        const dx = q.position.x - p.x
        const dz = q.position.z - p.z
        const wall = g.collision.castRay({ x: p.x, z: p.z }, { x: dx, z: dz }, d)
        if (wall && wall.dist < d) continue // occluded — wait for slide to open LOS
        z = q
        best = d
      }
      if (!z) { step(10); continue }
      aimAt(z)
      if (g.debug.shootOnce()) {
        step(8)
      } else {
        if (g.debug.ammo() === 0) {
          g.debug.reloadWeapon() // start/keep reload if dry
          if (g.debug.reserve() === 0) {
            // No reserve: walk to a nearby ammo drop (spawned on kills) and
            // pick it up; if none in reach, the harness resupplies reserve
            // (S9 verifies drop mechanics deterministically).
            const drops = g.drops ? g.drops._drops : []
            let near = null
            let nd = Infinity
            for (const d of drops) {
              const dd = Math.hypot(d.x - p.x, d.z - p.z)
              if (dd < nd) { nd = dd; near = d }
            }
            if (near && nd <= 6) { g.debug.setPlayerPos(near.x, near.z); step(3) }
            else { g.weapon.shotgun.reserve += 30 }
          }
        }
        step(20) // wait out reload / cooldown
      }
    }
    if (guard >= 4000 && g.debug.zombiesAlive() > 0) {
      ok(`wave ${wave} clear timed out`, false, 'zombies still alive')
      timedOut = true // exit stage cleanly; remaining checks report the failure
    }
    ok(`wave ${wave} cleared`, g.debug.zombiesAlive() === 0, `alive ${g.debug.zombiesAlive()}`)
    // Intermission to next wave.
    let wait = 0
    while (g.debug.wave() === wave && wait++ < 600 && g.state === GameState.PLAYING) step(1)
    wave = g.debug.wave()
  }
  ok('reached past wave 3', wave > 3, `wave ${wave}`)
  ok('kills accumulated', g.debug.kills() >= 8, `kills ${g.debug.kills()}`)
  g.debug.damagePlayer(100)
  ok('player death -> GAMEOVER', g.debug.state() === GameState.GAMEOVER)
  g.debug.resetRun()
  ok('restart is clean',
    g.debug.state() === GameState.PLAYING && g.debug.health() === 100 && g.zombies.length === 0 &&
    g.debug.kills() === 0 && g.debug.wave() === 1 && g.debug.ammo() === 5,
    `state ${g.debug.state()} health ${g.debug.health()} zombies ${g.zombies.length} wave ${g.debug.wave()} ammo ${g.debug.ammo()}`)
})

// ---------------------------------------------------------- S8 scene sanity
stage('S8 scene sanity (budgets + renderer)', () => true, () => {
  const s = g.debug.sceneStats()
  ok('mesh budget ≤ 600', s.meshes <= 600, `meshes ${s.meshes}`)
  ok('light budget ≤ 40', s.lights <= 40, `lights ${s.lights}`)
  ok('points budget ≤ 2500', s.points <= 2500, `points ${s.points}`)
  ok('zombie budget ≤ 24', s.zombies <= 24, `zombies ${s.zombies}`)
  const f = g.debug.frameStats()
  ok('renderer counted frames', f.calls > 0, `calls ${f.calls}`)
  if (g.player) {
    const p = pos()
    ok('player position finite', Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))
  }
})

// ------------------------------------------- S9 ammo drops (deterministic)
stage('S9 ammo drops: deterministic spawns + headless pickup', () => !!g.drops, () => {
  // A: Determinism — two fresh pools given identical kill sequences must
  // produce identical drop layouts (seeded LCG, no Math.random).
  const s1 = new THREE.Scene(), s2 = new THREE.Scene()
  const a = new AmmoDrops(s1), b = new AmmoDrops(s2)
  const kills = [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8], [9, 9], [10, 10]]
  for (const [x, z] of kills) { a.maybeSpawn(x, z); b.maybeSpawn(x, z) }
  ok('identical kill sequences -> identical drop layouts',
    a.count === b.count && a._drops.every((d, i) => d.x === b._drops[i].x && d.z === b._drops[i].z),
    `pool A ${a.count}, pool B ${b.count}`)
  ok('drop roll fires (some drops over 10 kills)', a.count >= 1, `spawns ${a.count}/10`)
  a.dispose(); b.dispose()

  // B: In-game pickup — a drop under the player is collected on the next
  // update and refills the shotgun reserve by SHELLS_PER_DROP (+8).
  g.debug.killAllZombies(); g.zombies = []; g.kills = 0
  g.debug.resetRun()
  const p = pos()
  const reserveBefore = g.debug.reserve()
  const mesh = new THREE.Mesh(g.drops._geo, g.drops._mat)
  mesh.position.set(p.x, 0.1, p.z)
  g.scene.add(mesh)
  g.drops._drops.push({ x: p.x, z: p.z, t: 0, mesh })
  ok('drop spawned under player', g.drops.count === 1, `count ${g.drops.count}`)
  g.step(DT)
  ok('pickup removes the drop within one frame', g.drops.count === 0, `count ${g.drops.count}`)
  ok('pickup refills reserve by +8', g.debug.reserve() === reserveBefore + SHELLS_PER_DROP,
    `reserve ${reserveBefore} -> ${g.debug.reserve()}`)
})

// -------------------------------------- S10 flashlight + score (deterministic)
stage('S10 flashlight toggle/battery + score increments', () => !!g.flashlight && !!g.score, () => {
  g.debug.killAllZombies(); g.zombies = []; g.kills = 0
  g.debug.resetRun()

  // A: Flashlight — F edge toggles, battery drains only while on,
  // holds while off, reset restores full state.
  ok('starts off with full battery', g.flashlight.on === false && g.flashlight.battery === 1,
    `on ${g.flashlight.on} battery ${g.flashlight.battery}`)
  g.inputState.flashlight = true
  g.step(DT)
  ok('F edge turns it on and is consumed', g.flashlight.on === true && g.inputState.flashlight === false,
    `on ${g.flashlight.on} edge ${g.inputState.flashlight}`)
  ok('intensity up while on', g.flashlight.spot.intensity > 0, `intensity ${g.flashlight.spot.intensity}`)
  const b0 = g.flashlight.battery
  step(60)
  ok('battery drains while on (~1/120 per second)',
    Math.abs((b0 - g.flashlight.battery) - 1 / 120) < 0.001,
    `${b0.toFixed(4)} -> ${g.flashlight.battery.toFixed(4)}`)
  g.inputState.flashlight = true
  g.step(DT)
  ok('F edge turns it off (intensity 0)', g.flashlight.on === false && g.flashlight.spot.intensity === 0,
    `on ${g.flashlight.on} intensity ${g.flashlight.spot.intensity}`)
  const b1 = g.flashlight.battery
  step(60)
  ok('battery holds while off', Math.abs(g.flashlight.battery - b1) < 1e-9,
    `${b1.toFixed(4)} -> ${g.flashlight.battery.toFixed(4)}`)
  g.flashlight.reset()
  ok('reset restores off + full battery', g.flashlight.on === false && g.flashlight.battery === 1,
    `on ${g.flashlight.on} battery ${g.flashlight.battery}`)

  // B: Score — a wave-1 walker kill is worth 10 + 50×1 = 60 points.
  // Fresh reset first (Part A's 2 s let wave 1 spawn shamblers/walkers);
  // spawn exactly one walker, force-kill it immediately (before the wave
  // spawner can add more), then let the kill hook process.
  g.debug.killAllZombies(); g.zombies = []; g.kills = 0
  g.debug.resetRun()
  ok('score starts at 0 after reset', g.score.value === 0, `score ${g.score.value}`)
  const z = g.debug.spawnZombie('walker', 30, 12)
  ok('walker spawned', z !== null && g.debug.zombiesAlive() === 1, `alive ${g.debug.zombiesAlive()}`)
  const s0 = g.score.value
  g.debug.killAllZombies() // synchronous; the only live zombie is this walker
  step(30) // death + kill hook processing
  ok('kill increments score', z.isDead && g.score.value > s0, `${s0} -> ${g.score.value}`)
  ok('wave-1 walker is worth 60 (10 + 50×1)', g.score.value === s0 + 60, `score ${g.score.value}`)
  ok('kill counter agrees', g.debug.kills() === 1, `kills ${g.debug.kills()}`)
})

// ---------------------------------------------------------------- summary
console.log(`\n=== verify-game: ${pass} ok, ${fail} fail, ${skips.length} skipped`)
if (skips.length) console.log('skipped stages: ' + skips.join(' | '))
if (fail === 0 && skips.length === 0) console.log('FULL ACCEPTANCE: all stages passed headless.')
else if (fail === 0) console.log('Progressive pass: no failures; remaining stages unlock as subsystems land.')
else console.log('FAILURES present — see above.')
process.exitCode = fail === 0 ? 0 : 1
