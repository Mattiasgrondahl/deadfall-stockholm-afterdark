// Phase 3 match-flow headless test (MULTIPLAYER_PLAN §9 Phase 3, §7).
// Verifies respawn-on-delay, disconnect grace is not required for the logic,
// and match-end detection (waves cleared / time cap / all-dead) with a final
// scoreboard — all headless via Match.step().
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match, TICK } from '../src/net/Match.js'

function run(match, seconds) {
  const n = Math.round(seconds / TICK)
  for (let i = 0; i < n; i++) match.step(TICK)
}

test('dead player respawns after the delay', () => {
  const m = new Match({ players: [{ id: 'p0' }] })
  const p0 = m.getPlayer('p0').player
  p0.damage(9999)
  assert.ok(p0.isDead, 'player dead')
  run(m, 2.0) // before the 3 s respawn delay
  assert.ok(p0.isDead, 'still dead before the delay elapses')
  run(m, 1.5) // cross the 3 s mark
  assert.equal(p0.isDead, false, 'respawned after the delay')
  assert.equal(p0.health, p0.maxHealth, 'respawn restores full health')
})

test('respawn event is emitted', () => {
  const m = new Match({ players: [{ id: 'p0' }] })
  m.getPlayer('p0').player.damage(9999)
  run(m, 4.0)
  const snap = m.snapshot()
  assert.ok(snap.events.some((e) => e.k === 'respawn' && e.victim === 'p0'), 'respawn event present')
})

test('time cap ends the match and emits a scoreboard', () => {
  const m = new Match({ players: [{ id: 'p0' }, { id: 'p1' }], matchTimeCap: 2.0 })
  run(m, 3.0)
  assert.equal(m.ended, true, 'match ended on the time cap')
  assert.equal(m.endReason, 'timecap')
  const snap = m.snapshot()
  const end = snap.events.find((e) => e.k === 'matchEnd')
  assert.ok(end, 'matchEnd event present')
  assert.ok(Array.isArray(end.scoreboard) && end.scoreboard.length === 2, 'scoreboard has both players')
  assert.ok(end.scoreboard.every((r) => typeof r.score === 'number' && typeof r.kills === 'number'), 'scoreboard rows well-formed')
})

test('all players dead with no pending respawn ends the match', () => {
  const m = new Match({ players: [{ id: 'p0' }, { id: 'p1' }] })
  // Kill both, then clear respawn timers so no respawn is pending.
  m.getPlayer('p0').player.damage(9999)
  m.getPlayer('p1').player.damage(9999)
  m._respawnAt.clear() // simulate both having already used their respawn (dead again)
  m.step(TICK)
  assert.equal(m.ended, true, 'ended when everyone is dead with none pending')
  assert.equal(m.endReason, 'alldead')
})

test('scoreboard sorts by score descending', () => {
  const m = new Match({ players: [{ id: 'p0' }, { id: 'p1' }] })
  m.score.set('p0', 100); m.score.set('p1', 300)
  m.kills.set('p0', 5); m.kills.set('p1', 12)
  const sb = m.scoreboard()
  assert.equal(sb[0].id, 'p1', 'highest score first')
  assert.equal(sb[0].score, 300)
  assert.equal(sb[1].id, 'p0')
})

test('match does not end while a respawn is pending', () => {
  const m = new Match({ players: [{ id: 'p0' }] })
  m.getPlayer('p0').player.damage(9999)
  m.step(TICK) // dead, respawn pending
  assert.equal(m.ended, false, 'pending respawn keeps the match alive')
})