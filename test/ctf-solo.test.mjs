// Solo (local-authoritative) CTF run-flow test. Boots a headless Game in ctf
// mode and drives the local FlagState through _updateCtfFlags: pickup at the
// enemy base, capture at the own base, and drop-on-HIT (any damage, not just
// death) — the objective's "if a zombie hits them the flag is dropped".
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Game } from '../src/game/Game.js'

function bootCtf() {
  const game = new Game({ headless: true, mode: 'ctf' })
  game.start()
  game.startGame()
  return game
}

test('solo CTF builds the CTF map + flag state and suppresses the wave manager', () => {
  const g = bootCtf()
  assert.equal(g.mode, 'ctf')
  assert.ok(g.flag, 'local flag state present')
  assert.equal(g.waveManager, null, 'no wave manager in CTF')
  assert.ok(g.city && g.city.bases, 'CTF map exposes bases')
  g.dispose()
})

test('solo player picks up the enemy flag at the enemy base and captures at their own base', () => {
  const g = bootCtf()
  const krag = g.city.bases.krag
  const lovis = g.city.bases.lovis
  // Solo client is lovis; walk onto the krag pedestal to steal it.
  g.debug.setPlayerPos(krag.x, krag.z)
  g.step(1 / 60)
  assert.equal(g.flag.flagOf('krag').carrier, 'p1', 'picked up the enemy flag')
  // Carry it home to the lovis base to score.
  g.debug.setPlayerPos(lovis.x, lovis.z)
  g.step(1 / 60)
  assert.equal(g.flag.scores.lovis, 1, 'lovis scored a capture')
  assert.equal(g.flag.flagOf('krag').atBase, true, 'krag flag reset home')
  g.dispose()
})

test('a non-lethal hit drops the carried flag (drop-on-hit, not just death)', () => {
  const g = bootCtf()
  const krag = g.city.bases.krag
  g.debug.setPlayerPos(krag.x, krag.z)
  g.step(1 / 60)
  assert.equal(g.flag.flagOf('krag').carrier, 'p1', 'carrying the enemy flag')
  // Move off the pedestal so the drop spot is not instantly re-grabbable, then
  // take a scratch hit — the flag must drop even though the player survives.
  g.debug.setPlayerPos(krag.x - 10, krag.z - 10)
  g.step(1 / 60)
  g.debug.damagePlayer(1)
  g.step(1 / 60)
  assert.ok(g.player.health > 0 && !g.player.isDead, 'player survived the hit')
  assert.equal(g.flag.flagOf('krag').carrier, null, 'flag released on a non-lethal hit')
  assert.ok(g.flag.flagOf('krag').dropped, 'flag lies on the ground where the carrier was hit')
  g.dispose()
})

test('solo CTF spawns the player at their chosen base flag facing the enemy', () => {
  // Default side is lovis → spawn at the lovis base, facing toward krag.
  const g = bootCtf()
  const lovis = g.city.bases.lovis, krag = g.city.bases.krag
  assert.equal(g._myTeam, 'lovis', 'default side is lovis')
  assert.equal(g.player.position.x, lovis.x, 'spawned at the lovis base x')
  assert.equal(g.player.position.z, lovis.z, 'spawned at the lovis base z')
  // Facing the enemy base: forward moves along (-sin yaw, -cos yaw), so facing
  // from lovis (-90,-90) toward krag (90,90) (+x,+z) needs sin & cos negative.
  assert.ok(Math.sin(g.player.yaw) < -0.5, 'facing +x toward the enemy base')
  assert.ok(Math.cos(g.player.yaw) < -0.5, 'facing +z toward the enemy base')
  g.dispose()
})

test('solo CTF spawns a krag player at the krag base facing lovis', () => {
  const g = new Game({ headless: true, mode: 'ctf' })
  g.start()
  g._myTeam = 'krag' // chosen on the title screen
  g.startGame()
  const lovis = g.city.bases.lovis, krag = g.city.bases.krag
  assert.equal(g._myTeam, 'krag', 'krag side honored')
  assert.equal(g.player.position.x, krag.x, 'spawned at the krag base x')
  assert.equal(g.player.position.z, krag.z, 'spawned at the krag base z')
  assert.ok(Math.sin(g.player.yaw) > 0.5, 'facing -x toward the enemy base')
  assert.ok(Math.cos(g.player.yaw) > 0.5, 'facing -z toward the enemy base')
  g.dispose()
})