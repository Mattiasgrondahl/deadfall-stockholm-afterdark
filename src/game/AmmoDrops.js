import * as THREE from 'three'

// AmmoDrops — manages shotgun ammo drops left by killed zombies. A seeded-LCG
// roll (~55%) spawns a drop at the corpse on each kill; the player picks one up
// within 1.2 m to restock the shotgun reserve. Drops blink in their last 5 s,
// expire at 30 s, and are capped at 20 concurrent. All RNG is a seeded LCG (no
// Math.random); headless-safe (no DOM, audio optional).

const SEED = 1337
export const DROP_CHANCE = 0.55
export const SHELLS_PER_DROP = 8
export const PICKUP_RADIUS = 1.2
export const LIFETIME = 30
export const BLINK_AFTER = 25
export const MAX_DROPS = 20
const DROP_Y = 0.1

export class AmmoDrops {
  constructor(scene, audio) {
    this.scene = scene
    this.audio = audio
    this._seed = SEED
    this._drops = []
    // Shared geometry/material across all drop meshes: flat mesh budget,
    // each drop is just one mesh sharing one geo+mat.
    this._geo = new THREE.BoxGeometry(0.16, 0.09, 0.16)
    this._mat = new THREE.MeshStandardMaterial({
      color: 0xffaa44, emissive: 0x774400, emissiveIntensity: 0.6
    })
  }

  /** Seeded LCG in [0, 1). Deterministic for a fixed call order. The >>> 0
   * keeps Math.imul's signed 32-bit result non-negative before the mod, so
   * the roll is always in [0, 1). */
  _rand() {
    this._seed = (Math.imul(this._seed, 48271) >>> 0) % 65537
    return this._seed / 65537
  }

  get count() { return this._drops.length }

  /** Roll on a kill; spawn a drop at (x, z) if the roll hits and under cap. */
  maybeSpawn(x, z) {
    if (this._drops.length >= MAX_DROPS) return false
    if (this._rand() >= DROP_CHANCE) return false
    const mesh = new THREE.Mesh(this._geo, this._mat)
    mesh.position.set(x, DROP_Y, z)
    this.scene.add(mesh)
    this._drops.push({ x, z, t: 0, mesh })
    return true
  }

  /** Per frame: age, blink, expire, and pick up. onPickup(drop, player) per
   *  pickup. `player` may be a single player (solo Game) or an array of
   *  players (multiplayer Match): the first alive player in range takes the
   *  drop, in array order (deterministic). */
  update(dt, player, onPickup) {
    const players = Array.isArray(player) ? player : [player]
    for (let i = this._drops.length - 1; i >= 0; i--) {
      const d = this._drops[i]
      d.t += dt
      if (d.t >= LIFETIME) { this._remove(i); continue }
      d.mesh.visible = d.t >= BLINK_AFTER ? (Math.floor(d.t * 3) % 2 === 0) : true
      for (const p of players) {
        if (!p || p.isDead) continue
        const dx = p.position.x - d.x
        const dz = p.position.z - d.z
        if (dx * dx + dz * dz <= PICKUP_RADIUS * PICKUP_RADIUS) {
          if (onPickup) onPickup(d, p)
          this._remove(i)
          break
        }
      }
    }
  }

  _remove(i) {
    const d = this._drops[i]
    this.scene.remove(d.mesh)
    this._drops.splice(i, 1)
  }

  /** Remove all drops (reset / new run). */
  clear() {
    while (this._drops.length) this._remove(this._drops.length - 1)
  }

  dispose() {
    this.clear()
    this._geo.dispose()
    this._mat.dispose()
  }
}
