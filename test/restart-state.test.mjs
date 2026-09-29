// test/restart-state.test.mjs — Game.startGame() (the restart path) must wipe
// every piece of run state, not just flip to PLAYING. Headless real Game; fixed
// dt steps only; no timers, no Math.random (all RNG is the entity LCGs).
import test from 'node:test'
import assert from 'node:assert/strict'
import { Game, GameState } from '../src/game/Game.js'

function boot() {
  const game = new Game({ headless: true })
  game.start()
  game.startGame()
  return game
}

/** Dirty a fresh run: kills + score + wave + damage + spent ammo + drops + clock. */
function dirty(game) {
  // Park the player at the city centre so debug-spawned zombies reach it and
  // attack (spawn points are the ring at +/-85 / inner +/-12).
  game.debug.setPlayerPos(0, 0)
  // Spend ammo from the starting shotgun mag.
  game.debug.shootOnce()
  game.debug.shootOnce()
  const ammoSpent = game.weapon.shotgun.magSize - game.debug.ammo()
  assert.ok(ammoSpent > 0, 'shots must consume magazine ammo')
  // Damage the player (below max, still alive).
  game.debug.damagePlayer(25)
  // Burn flashlight battery (review fix: startGame must restore it).
  game.flashlight.on = true
  for (let i = 0; i < 60; i++) game.flashlight.update(1 / 60, game.inputState)
  assert.ok(game.flashlight.battery < 1, 'flashlight battery must be drained')
  // Spawn a deterministic batch of walkers around the player and kill them all
  // through the normal damage path so kills/score/drops all move.
  const pts = [[12, -12], [-12, -12], [12, 12], [-12, 12], [0, -12], [0, 12]]
  for (const [x, z] of pts) game.debug.spawnZombie('walker', x, z)
  assert.ok(game.debug.zombiesAlive() > 0, 'debug spawns must be alive')
  game.debug.killAllZombies()
  // Advance frames: kill bookkeeping, drop rolls, corpse removal, wave clock.
  for (let i = 0; i < 120; i++) game.step(1 / 60)
  // Force the wave clear so the wave counter advances. forceClear only starts
  // the intermission; the wave ticks over when it expires (3 s after wave 1).
  game.debug.forceWaveClear()
  for (let i = 0; i < 240; i++) game.step(1 / 60)
  return { ammoSpent }
}

/** Assert every observable run-state field is back to its fresh-run value. */
function assertClean(game) {
  assert.equal(game.debug.state(), GameState.PLAYING, 'restart enters PLAYING')
  assert.equal(game.debug.zombiesAlive(), 0, 'no live zombies after restart')
  assert.equal(game.zombies.length, 0, 'zombie list emptied after restart')
  assert.equal(game.debug.kills(), 0, 'kill counter cleared')
  assert.equal(game.score.value, 0, 'score cleared')
  assert.equal(game.debug.wave(), 1, 'wave back to 1')
  assert.equal(game.debug.health(), 100, 'player health restored')
  assert.equal(game.timeInGame, 0, 'run clock reset')
  assert.equal(game.drops.count, 0, 'ammo drops cleared')
  assert.equal(game.debug.ammo(), game.weapon.shotgun.magSize, 'mag refilled')
  assert.equal(game.debug.reserve(), game.weapon.shotgun.reserve, 'reserve restored to start value')
  // Review fix: the guarded subsystem resets (Game.js:579/587) must run too.
  assert.equal(game.flashlight.battery, 1, 'flashlight battery restored')
  assert.equal(game.flashlight.on, false, 'flashlight off after restart')
  assert.equal(game._boss, null, 'boss reference cleared')
}

test('restart via debug.resetRun clears every run-state field', () => {
  const game = boot()
  const { ammoSpent } = dirty(game)

  // Sanity: the run is actually dirty before the restart.
  assert.equal(game.debug.state(), GameState.PLAYING)
  assert.ok(game.debug.kills() > 0, 'kills must be non-zero before restart')
  assert.ok(game.score.value > 0, 'score must be non-zero before restart')
  assert.ok(game.debug.wave() > 1, 'wave must have advanced before restart')
  assert.ok(game.debug.health() < 100, 'health must be damaged before restart')
  assert.ok(game.drops.count > 0, 'at least one ammo drop must exist before restart')
  assert.ok(game.timeInGame > 0, 'run clock must be non-zero before restart')
  assert.equal(game.debug.ammo(), game.weapon.shotgun.magSize - ammoSpent)

  game.debug.resetRun()

  assertClean(game)
})

test('restart from GAMEOVER via startGame clears run state too', () => {
  const game = boot()
  dirty(game)
  // Drive to GAMEOVER the way the engine does: kill the player outright.
  game.debug.damagePlayer(999)
  assert.equal(game.debug.state(), GameState.GAMEOVER, 'lethal damage ends the run')
  game.startGame()
  assertClean(game)
})

test('startGame while PLAYING is a no-op (early-return guard, Game.js:568)', () => {
  const game = boot()
  dirty(game)
  const kills = game.debug.kills()
  const score = game.score.value
  const wave = game.debug.wave()
  assert.ok(kills > 0 && score > 0 && wave > 1, 'run must be dirty first')
  game.startGame() // already PLAYING -> must not wipe the run
  assert.equal(game.debug.state(), GameState.PLAYING)
  assert.equal(game.debug.kills(), kills, 'kills survive a no-op startGame')
  assert.equal(game.score.value, score, 'score survives a no-op startGame')
  assert.equal(game.debug.wave(), wave, 'wave survives a no-op startGame')
})