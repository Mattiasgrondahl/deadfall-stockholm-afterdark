// test/upgrades.test.mjs — intermission pick-one progression (v37 R3).
// Headless: Upgrades has no DOM; Game/Screens wiring is covered by the state
// contract. Deterministic (seeded LCG), so the offer order is fixed per run.
import assert from 'node:assert'
import { test } from 'node:test'
import { Upgrades, UPGRADES, OFFER_TIME } from '../src/game/Upgrades.js'

function fakeBank() {
  return {
    mag: 0, pistolReserve: 0,
    bumpMagazine(n) { this.mag += n },
    bumpReserve(name, n) { if (name === 'pistol') this.pistolReserve += n }
  }
}
function fakePlayer() {
  return { hp: 0, bumpMaxHealth(n) { this.hp += n } }
}

test('offer opens with all three upgrades and an active countdown', () => {
  const u = new Upgrades()
  assert.equal(u.active, false)
  u.offerNext()
  assert.equal(u.active, true)
  assert.equal(u.offer.length, 3)
  assert.equal(u.timeLeft, OFFER_TIME)
  const st = u.state()
  assert.equal(st.active, true)
  assert.equal(st.choices.length, 3)
  assert.ok(st.choices.every((c) => c.label && c.desc))
})

test('pick applies the chosen upgrade to the right target and closes the offer', () => {
  const u = new Upgrades()
  const bank = fakeBank(), player = fakePlayer()
  u.offerNext()
  // Find the vitality slot and pick it -> player bumps max health.
  const vitIdx = u.offer.indexOf(UPGRADES.findIndex((x) => x.id === 'vitality'))
  const up = u.pick(vitIdx, player, bank)
  assert.equal(up.id, 'vitality')
  assert.equal(player.hp, 15)
  assert.equal(bank.mag, 0) // bank untouched by a vitality pick
  assert.equal(u.active, false)
  assert.deepEqual(u.taken, ['vitality'])
  // Picking again with no offer is a no-op.
  assert.equal(u.pick(0, player, bank), null)
})

test('magazine + reserve picks hit the weapon bank', () => {
  const u = new Upgrades()
  const bank = fakeBank(), player = fakePlayer()
  u.offerNext()
  const magIdx = u.offer.indexOf(UPGRADES.findIndex((x) => x.id === 'mag'))
  u.pick(magIdx, player, bank)
  assert.equal(bank.mag, 2)
  assert.equal(player.hp, 0)
  u.offerNext()
  const resIdx = u.offer.indexOf(UPGRADES.findIndex((x) => x.id === 'reserve'))
  u.pick(resIdx, player, bank)
  assert.equal(bank.pistolReserve, 20)
})

test('skip closes the offer without applying anything', () => {
  const u = new Upgrades()
  const bank = fakeBank(), player = fakePlayer()
  u.offerNext()
  u.skip()
  assert.equal(u.active, false)
  assert.equal(bank.mag, 0)
  assert.equal(player.hp, 0)
  assert.deepEqual(u.taken, [])
})

test('countdown auto-skips when it runs out', () => {
  const u = new Upgrades()
  u.offerNext()
  let t = OFFER_TIME
  while (u.active && t > 0) { const step = Math.min(0.5, t); u.update(step); t -= step }
  assert.equal(u.active, false)
})

test('deterministic offer order for a fixed seed', () => {
  const a = new Upgrades(); a.offerNext()
  const b = new Upgrades(); b.offerNext()
  assert.deepEqual(a.offer, b.offer)
})

test('reset clears the pending offer and the taken list', () => {
  const u = new Upgrades()
  const bank = fakeBank(), player = fakePlayer()
  u.offerNext()
  u.pick(u.offer.indexOf(UPGRADES.findIndex((x) => x.id === 'mag')), player, bank)
  assert.equal(u.taken.length, 1)
  u.reset()
  assert.equal(u.active, false)
  assert.deepEqual(u.taken, [])
})

test('dispose fully reverses (no lingering offer)', () => {
  const u = new Upgrades()
  u.offerNext()
  u.dispose()
  assert.equal(u.active, false)
  assert.equal(u.offer, null)
})