// Flag.js — server-authoritative Capture-the-Flag state for the CTF mode.
// Pure logic only: no three, no document/window/AudioContext, no Math.random,
// so the whole state machine is unit-testable headlessly and cheap to run on
// the authoritative server (the client only renders the broadcast snapshot).
//
// Model: two teams — 'lovis' (Lovisedal school base) and 'krag' (Kragstalund
// office base). Each team OWNS the flag standing at its own base. A team SCORES
// by carrying the OPPONENT's flag back to its OWN base; first to WIN_SCORE wins.
// A carrier who dies drops the flag in the field; anyone may pick a dropped
// flag up (steal for the enemy, `returnFlag` for the owner to restore it home).
//
// One flag per carrier is enforced on both entry points (tryPickup/tryCapture)
// because the client is untrusted and may send out-of-order or duplicated
// events; every method is idempotent against stale input rather than throwing.

export const WIN_SCORE = 3
// Pickup is tight (you must actually touch the flag) while capture is generous
// (reaching the base area should not feel pixel-perfect on a 20 Hz tick).
export const PICKUP_RADIUS = 2.0
export const CAPTURE_RADIUS = 4.0
// v35: a flag is only lifted after the player has STOOD inside its ring for this
// many seconds without leaving — standing on the pad is a commitment, not a
// drive-by grab. Callers pass the frame/tick `dt`; a caller that omits it keeps
// the old instant behaviour (back-compat for any headless probe).
export const PICKUP_DWELL = 3.0
export const TEAMS = ['lovis', 'krag']
// Opposite corners of the arena map; the map may override both via opts.bases.
export const BASE = { lovis: { x: -90, z: -90 }, krag: { x: 90, z: 90 } }

const R2 = (r) => r * r
const round2 = (v) => Math.round(v * 100) / 100
const other = (team) => (team === 'lovis' ? 'krag' : 'lovis')

function freshFlag(home) {
  return {
    home: { x: home.x, z: home.z },
    carrier: null,     // id of the player currently holding it
    carriedBy: null,   // that carrier's team (derived, kept for cheap reads)
    dropped: null,     // {x,z} where it lies in the field with no carrier
    atBase: true       // sitting at home: pickable by the enemy, scores for owner
  }
}

export class FlagState {
  /**
   * @param opts { bases?: {lovis:{x,z}, krag:{x,z}}, winScore?: number } —
   *   bases let the map move the flag pedestals without editing this module.
   */
  constructor(opts = {}) {
    const bases = opts.bases || {}
    // Copy homes into fresh objects: the caller's opts must never alias the
    // live state (a mutated opts.bases would otherwise drag `home` around).
    this.bases = {
      lovis: { x: Number(bases.lovis && bases.lovis.x) || BASE.lovis.x, z: Number(bases.lovis && bases.lovis.z) || BASE.lovis.z },
      krag: { x: Number(bases.krag && bases.krag.x) || BASE.krag.x, z: Number(bases.krag && bases.krag.z) || BASE.krag.z }
    }
    this.winScore = Number.isFinite(opts.winScore) && opts.winScore > 0 ? opts.winScore : WIN_SCORE
    this.scores = { lovis: 0, krag: 0 }
    this.winner = null
    this.flags = { lovis: freshFlag(this.bases.lovis), krag: freshFlag(this.bases.krag) }
    // v35: per-player pickup dwell. playerId -> { flag: <flag object>, t: seconds
    // stood inside its ring }. Reset whenever the player leaves the ring, the
    // target flag changes, or the flag is picked/dropped/captured.
    this._dwell = new Map()
  }

  /** The flag OWNED by `team` (which starts at that team's own base). */
  flagOf(owningTeam) {
    return this.flags[owningTeam] || null
  }

  /** The flag `team` must steal and bring home — the OTHER team's flag. */
  enemyFlagOf(team) {
    return this.flags[other(team)] || null
  }

  /** True once the match is decided; every mutating method short-circuits on it. */
  isOver() {
    return this.winner !== null
  }

  /** Id of the player on `team` currently carrying a flag, or null. */
  carrierOfTeam(team) {
    for (const t of TEAMS) {
      const f = this.flags[t]
      if (f.carrier !== null && f.carriedBy === team) return f.carrier
    }
    return null
  }

  /** True if `playerId` is carrying something (one flag per carrier). */
  isCarrying(playerId) {
    for (const t of TEAMS) if (this.flags[t].carrier === playerId) return true
    return false
  }

  /**
   * Pick a flag up. Legal targets: (a) the ENEMY flag while it is still at its
   * own base, or (b) ANY dropped flag (including your own team's — you pick it
   * up to walk it home). Rejected: already carried by someone else, out of
   * PICKUP_RADIUS, or this player already carries a flag.
   *
   * v35: standing inside the ring is not enough — the player must HOLD position
   * there for PICKUP_DWELL seconds. Each call adds `dt` to that player's dwell
   * timer for the flag they are currently in range of; leaving the ring (or the
   * target changing) resets it, and the lift only fires once the timer reaches
   * the dwell. Omitting `dt` (a legacy caller) keeps the old instant grab.
   */
  tryPickup(playerId, team, x, z, dt) {
    if (this.isOver() || playerId == null || !this.flags[team]) return false
    if (this.isCarrying(playerId)) { this._dwell.delete(playerId); return false }
    const mine = this.flags[team], foe = this.flags[other(team)]
    const d2 = (fx, fz) => (x - fx) * (x - fx) + (z - fz) * (z - fz)
    let target = null
    // Enemy flag at its base: the classic grab. Own flag at base is NOT
    // pickable — it is already home, and lifting it would only lose it.
    if (foe.carrier === null && foe.dropped === null && foe.atBase) {
      if (d2(foe.home.x, foe.home.z) <= R2(PICKUP_RADIUS)) target = foe
    }
    if (!target && foe.carrier === null && foe.dropped) {
      if (d2(foe.dropped.x, foe.dropped.z) <= R2(PICKUP_RADIUS)) target = foe
    }
    if (!target && mine.carrier === null && mine.dropped) {
      if (d2(mine.dropped.x, mine.dropped.z) <= R2(PICKUP_RADIUS)) target = mine
    }
    if (!target) { this._dwell.delete(playerId); return false }
    // No dt → legacy instant pickup (headless probes, tests that predate v35).
    if (typeof dt !== 'number') {
      target.carrier = playerId
      target.carriedBy = team
      target.atBase = false
      target.dropped = null
      this._dwell.delete(playerId)
      return true
    }
    // Accumulate dwell only while the SAME flag stays the in-range target.
    let st = this._dwell.get(playerId)
    if (!st || st.flag !== target) st = { flag: target, t: 0 }
    st.t += dt
    this._dwell.set(playerId, st)
    if (st.t < PICKUP_DWELL) return false
    target.carrier = playerId
    target.carriedBy = team
    target.atBase = false
    target.dropped = null
    this._dwell.delete(playerId)
    return true
  }

  /** Carrier was hit/killed: the flag falls where they stand. Returns the flag
   *  object, or null when that player was not carrying anything. */
  dropFlag(playerId, x, z) {
    if (playerId == null) return null
    this._dwell.delete(playerId)
    for (const t of TEAMS) {
      const f = this.flags[t]
      if (f.carrier === playerId) {
        f.carrier = null
        f.carriedBy = null
        f.atBase = false
        f.dropped = { x: Number(x) || 0, z: Number(z) || 0 }
        return f
      }
    }
    return null
  }

  /**
   * A carrier touching their OWN team's dropped flag restores it to its pedestal
   * (dropped=null, atBase=true). This is the "return it to their base" rule: it
   * does not score, it only re-arms the flag so the enemy can steal it again.
   */
  returnFlag(playerId, team, x, z) {
    if (this.isOver() || playerId == null || !this.flags[team]) return false
    this._dwell.delete(playerId)
    const mine = this.flags[team]
    if (mine.carrier !== null || !mine.dropped) return false
    const dx = x - mine.dropped.x, dz = z - mine.dropped.z
    if (dx * dx + dz * dz > R2(PICKUP_RADIUS)) return false
    mine.dropped = null
    mine.atBase = true
    return true
  }

  /**
   * Carrier reaches their OWN base holding the enemy flag → score++ for `team`,
   * the captured flag resets to its home pedestal, and WIN_SCORE decides the
   * match. Returns true only when a point was actually awarded.
   */
  tryCapture(playerId, team, x, z) {
    if (this.isOver() || playerId == null || !this.flags[team]) return false
    const foe = this.enemyFlagOf(team)
    // Only counts if this player is the one carrying the enemy flag — a
    // spoofed capture from a player standing on base carrying nothing is inert.
    if (foe.carrier !== playerId || foe.carriedBy !== team) return false
    this._dwell.delete(playerId)
    const bx = this.bases[team].x, bz = this.bases[team].z
    if ((x - bx) * (x - bx) + (z - bz) * (z - bz) > R2(CAPTURE_RADIUS)) return false
    this.scores[team] += 1
    foe.carrier = null
    foe.carriedBy = null
    foe.dropped = null
    foe.atBase = true
    if (this.scores[team] >= this.winScore) this.winner = team
    return true
  }

  /** API symmetry with the other subsystems: nothing to age out per frame, so
   *  this only re-checks the win condition (cheap, allocation-free). */
  update() {
    if (this.winner === null) {
      for (const t of TEAMS) if (this.scores[t] >= this.winScore) { this.winner = t; break }
    }
    return this.winner
  }

  /** Plain serializable broadcast payload. Positions are rounded to 2 decimals
   *  to keep the wire small (1 cm is far below any gameplay-relevant error). */
  snapshot() {
    const flags = {}
    for (const t of TEAMS) {
      const f = this.flags[t]
      flags[t] = {
        home: { x: round2(f.home.x), z: round2(f.home.z) },
        carrier: f.carrier,
        carriedBy: f.carriedBy,
        dropped: f.dropped ? { x: round2(f.dropped.x), z: round2(f.dropped.z) } : null,
        atBase: f.atBase
      }
    }
    return { scores: { lovis: this.scores.lovis, krag: this.scores.krag }, winner: this.winner, flags }
  }

  /** Fully reverse to the constructor's initial state (same bases/winScore). */
  dispose() {
    this.scores.lovis = 0
    this.scores.krag = 0
    this.winner = null
    this.flags.lovis = freshFlag(this.bases.lovis)
    this.flags.krag = freshFlag(this.bases.krag)
    this._dwell.clear()
  }
}