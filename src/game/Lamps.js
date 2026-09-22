// Lamps.js — shootable streetlamps. A bullet that strikes a lamp head breaks
// its glass: the head goes dark (emissive off), its halo + light-shaft sprites
// hide, and it is excluded from the point-light pool. After RELIGHT_SECONDS the
// lamp repairs itself and lights up again. Pure bookkeeping + material/visibility
// toggles (no new meshes), headless-safe (a null material/scene is tolerated).
//
// Wired from Game: Game.lamps = new Lamps(city.lamps); a weapon reports a lamp
// hit via Lamps.hitAt(x, y, z) (the weapons test the wall AABBs, and a lamp AABB
// hit routes here). update(dt) advances the relight timers.

const RELIGHT_SECONDS = 60

export class Lamps {
  constructor(lamps) {
    this.lamps = lamps || []
    this.audio = null // optional AudioBank for the glass-break voice
    this.shards = null // optional shard-burst pool (set by Game)
  }

  /**
   * Break the lamp whose head AABB contains (x, y, z) (within a small radius).
   * Returns the broken lamp, or null if none matched. Already-broken lamps are
   * ignored (the glass is already gone).
   */
  hitAt(x, y, z) {
    let best = null, bestD = 0.6 // 0.6 m capture radius around a head
    for (const l of this.lamps) {
      if (l.broken) continue
      const dx = x - l.x, dz = z - l.z
      const d = Math.hypot(dx, dz)
      if (d < bestD && Math.abs(y - 5.2) < 2.0) { bestD = d; best = l }
    }
    if (!best) return null
    this._break(best)
    return best
  }

  _break(lamp) {
    lamp.broken = true
    lamp.timer = RELIGHT_SECONDS
    if (lamp.material) {
      lamp.material.emissiveIntensity = 0
      if (lamp.material.emissive) lamp.material.emissive.setHex(0x000000)
    }
    if (lamp.halo) lamp.halo.visible = false
    if (lamp.shaft) lamp.shaft.visible = false
    this.audio?.glassBreak?.()
    this.shards?.burst?.(lamp.x, 5.2, lamp.z)
  }

  _relight(lamp) {
    lamp.broken = false
    if (lamp.material) {
      lamp.material.emissive.setHex(0xffb066)
      lamp.material.emissiveIntensity = 3.2
    }
    if (lamp.halo) lamp.halo.visible = true
    if (lamp.shaft) lamp.shaft.visible = true
  }

  /** Advance relight timers; auto-repair lamps whose timer reaches 0. */
  update(dt) {
    for (const l of this.lamps) {
      if (!l.broken) continue
      l.timer -= dt
      if (l.timer <= 0) this._relight(l)
    }
  }

  /** True if a lamp at this anchor index is currently broken (for the light pool). */
  isBrokenAt(index) {
    const l = this.lamps[index]
    return !!l && l.broken
  }

  brokenCount() {
    let n = 0
    for (const l of this.lamps) if (l.broken) n++
    return n
  }

  /** Restore every lamp to lit (restart). */
  reset() {
    for (const l of this.lamps) { l.broken = false; l.timer = 0; if (!l.material || l.material.emissiveIntensity !== 3.2) this._relight(l) }
  }

  dispose() {
    this.lamps = []
    this.audio = null
    this.shards = null
  }
}