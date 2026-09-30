// SwarmDirector.js — continuous neutral-zombie pressure for the CTF mode.
//
// Where survival mode paces zombies through discrete WaveManager waves, a CTF
// match wants a steady, escalating HAZARD: a shared swarm that both teams fight
// off while racing for the flag. This module owns that cadence — it decides WHEN
// and WHERE new zombies appear, biased toward the live flag carrier (the
// carrier is the objective, so the swarm should converge on them) and toward the
// nearest live player otherwise. It is pure scheduling logic: no three, no DOM,
// no Math.random (seeded LCG only), no per-frame allocation, so it is unit-test
// able headlessly and cheap to run on the authoritative server.
//
// The director does NOT own the zombies themselves — the caller (Match/Game)
// passes a spawnZombie(type, x, z) callback and reads this.zombieCount via a
// liveCount() callback so the director can respect the ≤24 concurrency budget
// without importing the scene.

// Zombie types the swarm draws from, weighted by a deterministic LCG draw.
const TYPES = ['walker', 'walker', 'walker', 'shambler', 'shambler', 'screamer', 'brute']
const CARRIER_BIAS = 0.6 // fraction of spawns dropped near the carrier vs nearest player
const BASE_INTERVAL = 4.0 // seconds between spawns at score 0
const MIN_INTERVAL = 1.1 // floor once fully escalated
const SCORE_PRESSURE = 0.55 // interval shrink per total capture scored by both teams
const MAX_ALIVE = 24 // hard concurrency cap (verify-game S8 zombie budget)

// Spawn jitter radius around the chosen anchor point.
const JITTER = 6.0

export class SwarmDirector {
  /**
   * @param opts {
   *   spawnZombie: (type, x, z) => void,
   *   players: () => Array<{player:{position,isDead}}> — live roster snapshot,
   *   flag: FlagState,
   *   liveCount: () => number,
   *   bases: {lovis:{x,z}, krag:{x,z}},
   *   rngSeed?: number
   * }
   */
  constructor(opts = {}) {
    this._spawn = opts.spawnZombie || (() => {})
    this._players = opts.players || (() => [])
    this._flag = opts.flag || null
    this._liveCount = opts.liveCount || (() => 0)
    this._bases = opts.bases || { lovis: { x: -90, z: -90 }, krag: { x: 90, z: 90 } }
    this._seed = (opts.rngSeed >>> 0) || 0x5EED
    this._spawnT = 0 // time until the next spawn
    this._enabled = false
  }

  /** Deterministic LCG (shared repo shape). */
  _rand() {
    this._seed = (Math.imul(this._seed, 48271) >>> 0) % 65537
    return this._seed / 65537
  }

  /** Turn the swarm on (CTF run start). */
  start() { this._enabled = true }
  /** Turn it off (run end / dispose). */
  stop() { this._enabled = false }

  /** Current spawn interval, compressed by how far the match has progressed. */
  interval() {
    const s = this._flag ? (this._flag.scores.lovis + this._flag.scores.krag) : 0
    const iv = BASE_INTERVAL - s * SCORE_PRESSURE
    return iv < MIN_INTERVAL ? MIN_INTERVAL : iv
  }

  /** Pick the anchor point a spawn should cluster around: the flag carrier when
   *  the LCG roll clears the carrier bias, else the nearest live player, else
   *  the midpoint of the two bases (nobody alive). */
  _anchor() {
    const carrier = this._carrier()
    if (carrier && this._rand() < CARRIER_BIAS) return carrier
    const np = this._nearestPlayer()
    if (np) return np
    return { x: (this._bases.lovis.x + this._bases.krag.x) / 2, z: (this._bases.lovis.z + this._bases.krag.z) / 2 }
  }

  /** The live player carrying a flag (either team), or null. */
  _carrier() {
    if (!this._flag) return null
    for (const t of ['lovis', 'krag']) {
      const id = this._flag.carrierOfTeam(t)
      if (id === null) continue
      for (const slot of this._players()) {
        if (slot.id === id && slot.player && !slot.player.isDead) {
          return { x: slot.player.position.x, z: slot.player.position.z }
        }
      }
    }
    return null
  }

  /** Nearest live player to the swarm centroid (bases midpoint), or null. */
  _nearestPlayer() {
    const cx = (this._bases.lovis.x + this._bases.krag.x) / 2
    const cz = (this._bases.lovis.z + this._bases.krag.z) / 2
    let best = null, bestD2 = Infinity
    for (const slot of this._players()) {
      const p = slot.player
      if (!p || p.isDead) continue
      const dx = p.position.x - cx, dz = p.position.z - cz
      const d2 = dx * dx + dz * dz
      if (d2 < bestD2) { bestD2 = d2; best = { x: p.position.x, z: p.position.z } }
    }
    return best
  }

  /** Advance the swarm by dt: spawn when the timer elapses and the concurrency
   *  budget has room. Returns the number of zombies spawned this step. */
  update(dt) {
    if (!this._enabled) return 0
    this._spawnT -= dt
    if (this._spawnT > 0) return 0
    this._spawnT = this.interval()
    if (this._liveCount() >= MAX_ALIVE) return 0
    const a = this._anchor()
    const jx = (this._rand() * 2 - 1) * JITTER
    const jz = (this._rand() * 2 - 1) * JITTER
    const type = TYPES[(this._rand() * TYPES.length) | 0]
    this._spawn(type, a.x + jx, a.z + jz)
    return 1
  }

  /** Fully reverse to the constructor's idle state. */
  dispose() {
    this._enabled = false
    this._spawnT = 0
    this._seed = (0x5EED >>> 0)
  }
}