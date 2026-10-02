// Upgrades.js — intermission pick-one progression (v37 R3).
//
// After a wave is cleared, the player is offered a choice of three permanent
// run upgrades and picks ONE (keys 1/2/3, or click via Screens) or skips it (F).
// The offer lives only during the intermission; the countdown auto-skips when it
// expires so the next wave always starts on time. Choices are cheap, legible
// power bumps: bigger magazine, deeper reserve, tougher body.
//
// Headless-safe: no DOM/window. Screens renders the offer and calls pick()/skip();
// Game drives update(dt) during PLAYING and reads state() for the HUD. All RNG is
// a seeded LCG (no Math.random). dispose() clears the pending offer.

// The three pickable upgrades. Each applies a permanent bump via the `apply`
// callback (wired by Game to the live player / weaponBank).
export const UPGRADES = [
  { id: 'mag', label: 'BIGGER MAGAZINE', desc: '+2 rounds in every mag', apply: (bank) => bank && bank.bumpMagazine(2) },
  { id: 'reserve', label: 'EXTRA AMMO', desc: '+20 pistol reserve', apply: (bank) => bank && bank.bumpReserve('pistol', 20) },
  { id: 'vitality', label: 'VITALITY', desc: '+15 max health', apply: (player) => player && player.bumpMaxHealth(15) }
]

// How long the offer stays open before it auto-skips and the next wave starts.
export const OFFER_TIME = 6.0

// Seeded LCG so the offer ordering is deterministic across a run (no Math.random).
const SEED = 20250

export class Upgrades {
  constructor() {
    this._seed = SEED
    // The pending offer: an ordered list of upgrade indices the player may pick
    // from, plus the countdown. null when nothing is on offer.
    this.offer = null
    this.timeLeft = 0
    this.active = false
    this._taken = [] // ids picked this run, for the HUD / game-over summary
  }

  _rand() {
    this._seed = (Math.imul(this._seed, 48271) >>> 0) % 65537
    return this._seed / 65537
  }

  /** Open a fresh offer (called on wave clear). Presents all three upgrades in a
   *  deterministic order. Idempotent: re-opening while one is pending resets it. */
  offerNext() {
    // Deterministic shuffle of the three indices via the seeded LCG so the offer
    // layout varies run-to-run but is reproducible for a fixed seed.
    const idx = [0, 1, 2]
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(this._rand() * (i + 1))
      const t = idx[i]; idx[i] = idx[j]; idx[j] = t
    }
    this.offer = idx
    this.timeLeft = OFFER_TIME
    this.active = true
  }

  /** Pick the upgrade at offer slot `i` (0-based). Applies it and closes the
   *  offer. Returns the chosen upgrade, or null when nothing is on offer / the
   *  index is out of range. */
  pick(i, player, weaponBank) {
    if (!this.active || !this.offer) return null
    if (!(i >= 0 && i < this.offer.length)) return null
    const up = UPGRADES[this.offer[i]]
    if (!up) return null
    up.apply(up.id === 'vitality' ? player : weaponBank)
    this._taken.push(up.id)
    this._close()
    return up
  }

  /** Skip the current offer (F key or the countdown expiring). */
  skip() {
    this._close()
  }

  _close() {
    this.offer = null
    this.timeLeft = 0
    this.active = false
  }

  /** Advance the countdown; auto-skip when it runs out. Called each PLAYING
   *  frame while an offer is active. */
  update(dt) {
    if (!this.active) return
    this.timeLeft -= dt
    if (this.timeLeft <= 0) this.skip()
  }

  /** Snapshot for the HUD / Screens: { active, timeLeft, choices:[{label,desc}] }. */
  state() {
    if (!this.active || !this.offer) return { active: false, timeLeft: 0, choices: [] }
    return {
      active: true,
      timeLeft: this.timeLeft,
      choices: this.offer.map((i) => ({ label: UPGRADES[i].label, desc: UPGRADES[i].desc }))
    }
  }

  /** Ids picked this run (for the game-over summary). */
  get taken() { return this._taken.slice() }

  /** New run: drop any pending offer and the taken list. */
  reset() {
    this._seed = SEED
    this._close()
    this._taken = []
  }

  dispose() {
    this._close()
    this._taken = []
  }
}