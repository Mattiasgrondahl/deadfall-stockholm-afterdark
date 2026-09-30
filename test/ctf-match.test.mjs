// CTF server-authoritative match test. Drives a two-player CTF Match headlessly
// (no sockets, no browser): team assignment, flag pickup/capture/drop-on-death,
// win-at-3, and the snapshot's ctf block + team fields.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match, TICK } from '../src/net/Match.js'
import { CTF_BASES } from '../src/world/CityCTF.js'

function run(match, seconds) {
  const n = Math.round(seconds / TICK)
  for (let i = 0; i < n; i++) match.step(TICK)
}

function ctfMatch() {
  // Two players auto-split across the two teams (round-robin).
  return new Match({ mode: 'ctf', players: [{ id: 'a' }, { id: 'b' }] })
}

function place(m, id, x, z) {
  const p = m.getPlayer(id).player
  p.position.set(x, p.position.y, z)
}

test('ctf match builds the bespoke map + flag state + assigns teams', () => {
  const m = ctfMatch()
  assert.equal(m.mode, 'ctf')
  assert.ok(m.flag, 'flag state present')
  assert.equal(m.players.get('a').team, 'lovis', 'first joiner -> lovis')
  assert.equal(m.players.get('b').team, 'krag', 'second joiner -> krag')
  assert.ok(m.city && m.city.bases, 'CTF map exposes bases')
  const snap = m.snapshot()
  assert.equal(snap.players.find((p) => p.id === 'a').team, 'lovis', 'team rides the snapshot')
  assert.ok(snap.ctf, 'snapshot carries ctf block')
  assert.equal(snap.ctf.scores.lovis, 0)
})

test('a player reaching the enemy base picks up the enemy flag', () => {
  const m = ctfMatch()
  // 'a' is lovis; walk to the krag base pedestal.
  place(m, 'a', CTF_BASES.krag.x, CTF_BASES.krag.z)
  run(m, 0.1)
  assert.equal(m.flag.flagOf('krag').carrier, 'a', 'lovis player carries the krag flag')
  const snap = m.snapshot()
  assert.ok(snap.events.some((e) => e.k === 'flagPickup' && e.by === 'a'), 'pickup event emitted')
})

test('carrying the enemy flag home scores a capture', () => {
  const m = ctfMatch()
  place(m, 'a', CTF_BASES.krag.x, CTF_BASES.krag.z) // grab krag flag
  run(m, 0.1)
  place(m, 'a', CTF_BASES.lovis.x, CTF_BASES.lovis.z) // bring it to lovis base
  run(m, 0.1)
  assert.equal(m.flag.scores.lovis, 1, 'lovis scored')
  assert.equal(m.flag.flagOf('krag').atBase, true, 'krag flag reset home')
  const snap = m.snapshot()
  assert.ok(snap.events.some((e) => e.k === 'flagCapture' && e.team === 'lovis'), 'capture event emitted')
})

test('a carrier who dies drops the flag', () => {
  const m = ctfMatch()
  place(m, 'a', CTF_BASES.krag.x, CTF_BASES.krag.z)
  run(m, 0.1)
  assert.equal(m.flag.flagOf('krag').carrier, 'a')
  m.getPlayer('a').player.damage(9999) // killed -> drop
  run(m, 0.1)
  assert.equal(m.flag.flagOf('krag').carrier, null, 'flag released')
  assert.ok(m.flag.flagOf('krag').dropped, 'flag dropped in the field')
  const snap = m.snapshot()
  assert.ok(snap.events.some((e) => e.k === 'flagDrop' && e.team === 'lovis'), 'drop event emitted')
})

test('a carrier who is HIT (non-lethal) drops the flag', () => {
  const m = ctfMatch()
  place(m, 'a', CTF_BASES.krag.x, CTF_BASES.krag.z)
  run(m, 0.1)
  assert.equal(m.flag.flagOf('krag').carrier, 'a')
  const p = m.getPlayer('a').player
  p.damage(1) // a scratch — not lethal, but the objective drops the flag on any hit
  assert.ok(p.health > 0 && !p.isDead, 'carrier survives the hit')
  // One tick observes the hit and releases the flag. The one-frame grace keeps
  // the carrier from instantly re-snatching it at their own feet, so the drop
  // is observable directly.
  m.step(TICK)
  const f = m.flag.flagOf('krag')
  assert.equal(f.carrier, null, 'flag released on a non-lethal hit')
  assert.ok(f.dropped, 'flag lies on the ground where the carrier was hit')
  assert.ok(m.events.some((e) => e.k === 'flagDrop' && e.team === 'lovis'), 'drop event emitted')
})

test('first team to 3 captures wins the match', () => {
  const m = ctfMatch()
  for (let i = 0; i < 3; i++) {
    place(m, 'a', CTF_BASES.krag.x, CTF_BASES.krag.z) // grab
    run(m, 0.1)
    place(m, 'a', CTF_BASES.lovis.x, CTF_BASES.lovis.z) // score
    run(m, 0.1)
  }
  assert.equal(m.flag.scores.lovis, 3, 'three captures')
  assert.equal(m.flag.winner, 'lovis', 'lovis wins')
  assert.equal(m.ended, true, 'match ended')
  assert.equal(m.endReason, 'ctf', 'ended by capture-win')
  const snap = m.snapshot()
  assert.ok(snap.events.some((e) => e.k === 'matchEnd'), 'matchEnd emitted')
})

test('survival mode has no flag state and keeps team null', () => {
  const m = new Match({ players: [{ id: 'a' }, { id: 'b' }] })
  assert.equal(m.mode, 'survival')
  assert.equal(m.flag, null, 'no flag in survival')
  assert.equal(m.players.get('a').team, null, 'no team in survival')
  const snap = m.snapshot()
  assert.equal(snap.ctf, undefined, 'no ctf block in survival snapshot')
})