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

// ---- v12: disconnect grace (MULTIPLAYER_PLAN §14 item 2) ----

test('v12: disconnect holds the slot for the grace window, then frees it', () => {
  const m = new Match({ players: [{ id: 'p0' }, { id: 'p1' }] })
  assert.equal(m.removePlayer('p0'), true, 'remove accepted')
  const slot = m.getPlayer('p0')
  assert.ok(slot && slot.disconnected, 'slot held, flagged disconnected')
  // Snapshot roster drops the disconnected player while grace is pending.
  m.step(TICK)
  const ids = m.snapshot().players.map((p) => p.id)
  assert.ok(!ids.includes('p0'), 'graced player absent from the roster')
  assert.ok(ids.includes('p1'), 'connected player still in the roster')
  // Before the 5 s grace elapses the slot is still held.
  run(m, 4.0)
  assert.ok(m.getPlayer('p0'), 'slot still held inside the grace window')
  // Cross the grace mark: the slot is freed and disposed.
  run(m, 1.5)
  assert.equal(m.getPlayer('p0'), null, 'slot freed once the grace elapses')
})

test('v12: reconnect within the grace window reclaims the same slot', () => {
  const m = new Match({ players: [{ id: 'p0', x: 4, z: 8 }] })
  const slot = m.getPlayer('p0')
  slot.score = 42
  m.score.set('p0', 42)
  m.kills.set('p0', 3)
  m.removePlayer('p0')
  m.step(TICK)
  // Rejoin (same id) inside the grace window: the held slot is reclaimed.
  const reclaimed = m.addPlayer('p0', undefined, undefined, 'Ada')
  assert.ok(reclaimed, 'reconnect reclaims the held slot')
  assert.equal(reclaimed, slot, 'same slot object, not a fresh one')
  assert.equal(reclaimed.disconnected, false, 'reclaimed slot is connected')
  assert.equal(m.score.get('p0'), 42, 'score survives the drop')
  assert.equal(m.kills.get('p0'), 3, 'kills survive the drop')
  m.step(TICK)
  const ids = m.snapshot().players.map((p) => p.id)
  assert.ok(ids.includes('p0'), 'reclaimed player is back in the roster')
})

test('v12: all-dead end ignores the graced slot — the last connected player decides', () => {
  // Shipped semantics (MULTIPLAYER_PLAN §12.1): the run ends when every
  // CONNECTED player is dead with none pending respawn. A slot held in
  // disconnect grace is out of the fight and does not keep the match alive.
  const m = new Match({ players: [{ id: 'p0' }, { id: 'p1' }] })
  m.getPlayer('p0').player.damage(9999)
  m._respawnAt.clear() // p0 dead with no pending respawn
  m.getPlayer('p1').player.damage(9999)
  m._respawnAt.clear() // p1 dead with no pending respawn either
  m.removePlayer('p1') // p1 drops (grace pending, not yet freed)
  m.step(TICK)
  assert.equal(m.ended, true, 'ended once the only connected player is dead')
  assert.equal(m.endReason, 'alldead')
  // The graced slot is still held, so the final scoreboard keeps its name.
  const sb = m.scoreboard()
  assert.equal(sb.length, 2, 'graced player still on the final scoreboard')
})

test('v12: a graced slot keeps the match alive while a connected player lives', () => {
  // With one player still alive, a drop must not end the match — and the
  // graced slot stays reclaimable until the window elapses.
  const m = new Match({ players: [{ id: 'p0' }, { id: 'p1' }] })
  m.removePlayer('p1')
  m.step(TICK)
  assert.equal(m.ended, false, 'match alive while p0 lives')
  const slot = m.getPlayer('p1')
  assert.equal(slot.disconnected, true, 'p1 held in grace, not deleted')
  const reclaimed = m.addPlayer('p1', undefined, undefined, 'Ada')
  assert.equal(reclaimed, slot, 'reconnect inside the window reclaims the slot')
})

test('v12: final scoreboard rows carry display names', () => {
  const m = new Match()
  m.addPlayer('p0', undefined, undefined, 'Ada')
  m.addPlayer('p1')
  m.score.set('p0', 100); m.score.set('p1', 300)
  m.kills.set('p0', 5); m.kills.set('p1', 12)
  const sb = m.scoreboard()
  assert.equal(sb[0].name, 'p1', 'unnamed slot falls back to the id')
  m.removePlayer('p0') // graced-out slot still contributes its name
  const sb2 = m.scoreboard()
  assert.equal(sb2[1].name, 'Ada', 'named row carries the display name even during grace')
})

test('v15: match ends at 72 team kills; scoreboard carries deaths/headshots/playerKills; winner is highest score', () => {
  const m = new Match({ players: [{ id: 'p0', name: 'Ada' }, { id: 'p1', name: 'Bo' }] })
  // p0 kills 70 walkers with headshots; p1 kills 2 more -> 72 total, ending the
  // match. p1 also friendly-fires p0 to death (a player kill + a death).
  for (let i = 0; i < 70; i++) {
    const z = m.spawnZombie('walker', 0, 0, 1)
    m.applyHit(z._matchId, 9999, true, 'p0')
  }
  for (let i = 0; i < 2; i++) {
    const z = m.spawnZombie('walker', 0, 0, 1)
    m.applyHit(z._matchId, 9999, false, 'p1')
  }
  // p1 kills p0 via friendly fire (enough to drop p0 to 0 from full health).
  m.applyFF('p0', 9999, 'p1')
  m.step(TICK)
  assert.equal(m.ended, true, 'match ended on the 72-kill target')
  assert.equal(m.endReason, 'killtarget', 'end reason is the kill target')
  const sb = m.scoreboard()
  assert.equal(sb.length, 2, 'both players on the scoreboard')
  assert.equal(sb[0].id, 'p0', 'p0 (70 headshot kills) has the highest score -> winner first')
  const p0 = sb.find((r) => r.id === 'p0')
  const p1 = sb.find((r) => r.id === 'p1')
  assert.equal(p0.kills, 70, 'p0 killed 70 zombies')
  assert.equal(p0.headshots, 70, 'every p0 kill was a headshot')
  assert.equal(p0.deaths, 1, 'p0 died once (friendly fire)')
  assert.equal(p0.playerKills, 0, 'p0 killed no players')
  assert.equal(p1.kills, 2, 'p1 killed 2 zombies')
  assert.equal(p1.headshots, 0, 'p1 had no headshots')
  assert.equal(p1.playerKills, 1, 'p1 killed a teammate (friendly fire)')
  assert.ok(p0.score > p1.score, 'winner has the strictly higher score')
})

test('v15: killTarget is configurable and below-target matches do not end early', () => {
  const m = new Match({ players: [{ id: 'p0' }], killTarget: 3 })
  for (let i = 0; i < 2; i++) {
    const z = m.spawnZombie('walker', 0, 0, 1)
    m.applyHit(z._matchId, 9999, false, 'p0')
  }
  m.step(TICK)
  assert.equal(m.ended, false, 'two kills do not end a 3-kill match')
  const z = m.spawnZombie('walker', 0, 0, 1)
  m.applyHit(z._matchId, 9999, false, 'p0')
  m.step(TICK)
  assert.equal(m.ended, true, 'the third kill ends it')
  assert.equal(m.endReason, 'killtarget')
})