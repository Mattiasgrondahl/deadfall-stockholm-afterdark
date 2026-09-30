import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FlagState, WIN_SCORE, PICKUP_RADIUS, CAPTURE_RADIUS, TEAMS, BASE } from '../src/game/Flag.js'

// CTF mode: server-authoritative flag state. Pure logic (no three, no DOM, no
// Math.random) so it is testable headlessly. Rules under test: one flag per
// carrier, enemy-flag-at-base pickup, dropped-flag pickup/steal, owner return,
// capture only at the carrier's OWN base, win at WIN_SCORE, and dispose/reset.

const LOVIS = BASE.lovis   // {x:-90,z:-90}
const KRAG = BASE.krag     // {x: 90,z: 90}

function newMatch() {
  return new FlagState()
}

test('flag: initial state — both flags at home, scores 0, no winner', () => {
  const f = newMatch()
  assert.deepEqual(TEAMS, ['lovis', 'krag'])
  for (const t of TEAMS) {
    const fl = f.flagOf(t)
    assert.equal(fl.atBase, true, `${t} flag starts at base`)
    assert.equal(fl.carrier, null)
    assert.equal(fl.carriedBy, null)
    assert.equal(fl.dropped, null)
    assert.deepEqual(fl.home, BASE[t])
  }
  assert.deepEqual(f.scores, { lovis: 0, krag: 0 })
  assert.equal(f.winner, null)
  assert.equal(f.isCarrying('p1'), false)
  assert.equal(f.carrierOfTeam('lovis'), null)
})

test('flag: constructor bases override, and opts do not alias live state', () => {
  const bases = { lovis: { x: 10, z: 20 }, krag: { x: -10, z: -20 } }
  const f = new FlagState({ bases, winScore: 1 })
  assert.deepEqual(f.flagOf('lovis').home, { x: 10, z: 20 })
  assert.deepEqual(f.flagOf('krag').home, { x: -10, z: -20 })
  assert.equal(f.winScore, 1)
  bases.lovis.x = 999
  assert.equal(f.flagOf('lovis').home.x, 10, 'live home must not alias caller opts')
})

test('flag: lovis steals the krag flag from its base', () => {
  const f = newMatch()
  assert.equal(f.enemyFlagOf('lovis'), f.flagOf('krag'), 'lovis must steal krag flag')
  // Too far away first — must be inside PICKUP_RADIUS of the krag pedestal.
  assert.equal(f.tryPickup('p1', 'lovis', KRAG.x + PICKUP_RADIUS + 1, KRAG.z), false)
  assert.equal(f.tryPickup('p1', 'lovis', KRAG.x + 1, KRAG.z), true)
  const krag = f.flagOf('krag')
  assert.equal(krag.carrier, 'p1')
  assert.equal(krag.carriedBy, 'lovis')
  assert.equal(krag.atBase, false, 'flag left the base')
  assert.equal(krag.dropped, null)
  assert.equal(f.isCarrying('p1'), true)
  assert.equal(f.carrierOfTeam('lovis'), 'p1')
  assert.equal(f.carrierOfTeam('krag'), null)
})

test('flag: cannot pick a flag already carried by someone else', () => {
  const f = newMatch()
  assert.equal(f.tryPickup('p1', 'lovis', KRAG.x, KRAG.z), true)
  assert.equal(f.tryPickup('p2', 'lovis', KRAG.x, KRAG.z), false, 'flag is in hand, not on pedestal')
  assert.equal(f.flagOf('krag').carrier, 'p1', 'carrier unchanged')
})

test('flag: a carrier cannot pick up a second flag (one flag per carrier)', () => {
  const f = newMatch()
  assert.equal(f.tryPickup('p1', 'lovis', KRAG.x, KRAG.z), true)
  // Walk to own base where their own flag sits: still refused.
  assert.equal(f.tryPickup('p1', 'lovis', LOVIS.x, LOVIS.z), false)
  assert.equal(f.flagOf('lovis').carrier, null, 'own flag untouched')
  assert.equal(f.flagOf('krag').carrier, 'p1')
})

test('flag: dropFlag leaves the flag at the drop point; non-carriers get null', () => {
  const f = newMatch()
  f.tryPickup('p1', 'lovis', KRAG.x, KRAG.z)
  assert.equal(f.dropFlag('p2', 0, 0), null, 'p2 carries nothing')
  const krag = f.dropFlag('p1', 12.5, -7.25)
  assert.equal(krag, f.flagOf('krag'))
  assert.equal(krag.carrier, null)
  assert.equal(krag.carriedBy, null)
  assert.deepEqual(krag.dropped, { x: 12.5, z: -7.25 })
  assert.equal(krag.atBase, false, 'a flag in the field is not at base')
  assert.equal(f.isCarrying('p1'), false)
  assert.equal(f.dropFlag('p1', 1, 1), null, 'second drop by the same carrier is a no-op')
})

test('flag: a dropped flag can be stolen by the enemy or returned by its owner', () => {
  const f = newMatch()
  f.tryPickup('p1', 'lovis', KRAG.x, KRAG.z)
  f.dropFlag('p1', KRAG.x - 5, KRAG.z) // dropped just outside the enemy base
  const krag = f.flagOf('krag')
  // Out of range: nothing happens.
  assert.equal(f.tryPickup('p2', 'lovis', KRAG.x - 5 + PICKUP_RADIUS + 1, KRAG.z), false)
  assert.equal(f.returnFlag('p3', 'krag', KRAG.x - 5 + PICKUP_RADIUS + 1, KRAG.z), false)
  // Enemy steal.
  assert.equal(f.tryPickup('p2', 'lovis', KRAG.x - 5, KRAG.z), true)
  assert.equal(krag.carrier, 'p2')
  assert.equal(krag.carriedBy, 'lovis')
  assert.equal(krag.dropped, null)
  // Owner return restores the pedestal instead of scoring.
  f.dropFlag('p2', KRAG.x - 5, KRAG.z)
  assert.equal(f.returnFlag('p4', 'krag', KRAG.x - 5, KRAG.z), true)
  assert.equal(krag.atBase, true, 'owner return puts the flag home')
  assert.equal(krag.dropped, null)
  assert.equal(krag.carrier, null)
  assert.deepEqual(f.scores, { lovis: 0, krag: 0 }, 'returning is not a capture')
  assert.equal(f.returnFlag('p4', 'krag', KRAG.x - 5, KRAG.z), false, 'nothing to return now')
})

test('flag: capture scores for the carrier team and resets the flag home', () => {
  const f = newMatch()
  f.tryPickup('p1', 'lovis', KRAG.x, KRAG.z)
  // Outside CAPTURE_RADIUS of the lovis base — no score yet.
  assert.equal(f.tryCapture('p1', 'lovis', LOVIS.x + CAPTURE_RADIUS + 1, LOVIS.z), false)
  assert.equal(f.scores.lovis, 0)
  assert.equal(f.tryCapture('p1', 'lovis', LOVIS.x + 1, LOVIS.z), true)
  assert.equal(f.scores.lovis, 1)
  const krag = f.flagOf('krag')
  assert.equal(krag.carrier, null)
  assert.equal(krag.carriedBy, null)
  assert.equal(krag.dropped, null)
  assert.equal(krag.atBase, true, 'captured flag is back on its pedestal')
  assert.equal(f.winner, null, 'one point is not a win')
  assert.equal(f.tryCapture('p1', 'lovis', LOVIS.x, LOVIS.z), false, 'p1 carries nothing now')
})

test('flag: carrying the enemy flag to the WRONG base does not score', () => {
  const f = newMatch()
  f.tryPickup('p1', 'lovis', KRAG.x, KRAG.z)
  // Walking the krag flag onto the krag base (its own home) is not a capture.
  assert.equal(f.tryCapture('p1', 'lovis', KRAG.x, KRAG.z), false)
  assert.equal(f.tryCapture('p1', 'krag', KRAG.x, KRAG.z), false, 'wrong team claim')
  assert.deepEqual(f.scores, { lovis: 0, krag: 0 })
  assert.equal(f.flagOf('krag').carrier, 'p1', 'still in hand')
})

test('flag: win at WIN_SCORE — winner set, further captures ignored', () => {
  const f = newMatch()
  assert.equal(WIN_SCORE, 3)
  for (let i = 0; i < WIN_SCORE; i++) {
    assert.equal(f.tryPickup('p1', 'lovis', KRAG.x, KRAG.z), true, `capture ${i + 1} pickup`)
    assert.equal(f.tryCapture('p1', 'lovis', LOVIS.x, LOVIS.z), true, `capture ${i + 1}`)
  }
  assert.equal(f.scores.lovis, WIN_SCORE)
  assert.equal(f.winner, 'lovis')
  assert.equal(f.isOver(), true)
  // Match over: no more pickups, captures, or scores.
  assert.equal(f.tryPickup('p2', 'krag', LOVIS.x, LOVIS.z), false)
  assert.equal(f.tryCapture('p2', 'krag', KRAG.x, KRAG.z), false)
  assert.equal(f.scores.krag, 0)
  assert.equal(f.update(), 'lovis')
})

test('flag: snapshot shape, 2-decimal rounding, and dispose resets everything', () => {
  const f = newMatch()
  f.tryPickup('p1', 'lovis', KRAG.x, KRAG.z)
  f.dropFlag('p1', 12.3456, -7.8912)
  const s = f.snapshot()
  assert.deepEqual(Object.keys(s).sort(), ['flags', 'scores', 'winner'])
  assert.deepEqual(Object.keys(s.flags).sort(), ['krag', 'lovis'])
  assert.deepEqual(s.scores, { lovis: 0, krag: 0 })
  assert.equal(s.winner, null)
  assert.deepEqual(s.flags.krag.dropped, { x: 12.35, z: -7.89 }, 'positions rounded to 2 dp')
  assert.deepEqual(s.flags.krag.home, { x: 90, z: 90 })
  assert.equal(s.flags.krag.carrier, null)
  assert.equal(s.flags.lovis.atBase, true)
  assert.equal(JSON.stringify(s).includes('NaN'), false, 'payload is clean JSON')
  // Mutating the snapshot must not touch live state (it is a broadcast copy).
  s.scores.lovis = 99
  assert.equal(f.scores.lovis, 0)
  f.dispose()
  assert.deepEqual(f.scores, { lovis: 0, krag: 0 })
  assert.equal(f.winner, null)
  assert.equal(f.isOver(), false)
  for (const t of TEAMS) {
    const fl = f.flagOf(t)
    assert.equal(fl.atBase, true)
    assert.equal(fl.carrier, null)
    assert.equal(fl.carriedBy, null)
    assert.equal(fl.dropped, null)
    assert.deepEqual(fl.home, BASE[t])
  }
  assert.deepEqual(f.snapshot(), newMatch().snapshot(), 'dispose matches a fresh instance')
})

test('flag: determinism — identical scripts give identical snapshots', () => {
  const script = (f) => {
    f.tryPickup('p1', 'lovis', KRAG.x, KRAG.z)
    f.dropFlag('p1', 3.5, 4.5)
    f.returnFlag('p3', 'krag', 3.5, 4.5)
    f.tryPickup('p2', 'krag', LOVIS.x, LOVIS.z)
    f.tryCapture('p2', 'krag', KRAG.x, KRAG.z)
    f.tryPickup('p1', 'lovis', KRAG.x, KRAG.z)
    f.tryCapture('p1', 'lovis', LOVIS.x, LOVIS.z)
    f.update()
    return f.snapshot()
  }
  const a = script(newMatch())
  const b = script(newMatch())
  assert.deepEqual(a, b, 'same inputs must produce byte-identical snapshots')
  assert.equal(a.scores.lovis, 1)
  assert.equal(a.scores.krag, 1)
  assert.equal(a.winner, null)
})