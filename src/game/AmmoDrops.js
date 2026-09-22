import * as THREE from 'three'

// AmmoDrops — manages ammo drops left by killed zombies. A seeded-LCG roll
// (~55%) spawns a drop at the corpse on each kill; the drop is either shotgun
// SHELLS or handgun BULLETS (a second LCG roll picks the kind). The player picks
// one up within 1.2 m to restock the matching weapon's reserve. Drops blink in
// their last 5 s, expire at 30 s, and are capped at 20 concurrent. All RNG is a
// seeded LCG (no Math.random); headless-safe (no DOM, audio optional).

const SEED = 1337
export const DROP_CHANCE = 0.55
export const SHELLS_PER_DROP = 8
export const BULLETS_PER_DROP = 12
export const BULLET_CHANCE = 0.5 // of drops, share that are handgun bullets (else shells)
export const PICKUP_RADIUS = 1.2
export const LIFETIME = 30
export const BLINK_AFTER = 25
export const MAX_DROPS = 20
const DROP_Y = 0.1
// Distinct visuals so the player can tell shells from bullets at a glance.
const SHELL_COLOR = 0xffaa44, SHELL_EMISSIVE = 0x774400
const BULLET_COLOR = 0x6fc2ff, BULLET_EMISSIVE = 0x1a4a77

export class AmmoDrops {
  constructor(scene, audio) {
    this.scene = scene
    this.audio = audio
    this._seed = SEED
    this._drops = []
    // Shared geometry across all drop meshes (flat mesh budget); one material
    // per kind so shells and bullets read differently without extra geometry.
    this._geo = new THREE.BoxGeometry(0.16, 0.09, 0.16)
    this._shellMat = new THREE.MeshStandardMaterial({
      color: SHELL_COLOR, emissive: SHELL_EMISSIVE, emissiveIntensity: 0.6
    })
    this._bulletMat = new THREE.MeshStandardMaterial({
      color: BULLET_COLOR, emissive: BULLET_EMISSIVE, emissiveIntensity: 0.6
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

  /** Roll on a kill; spawn a drop at (x, z) if the roll hits and under cap.
   *  A second LCG roll picks the kind: 'bullets' (handgun) or 'shells'
   *  (shotgun). Returns the spawned drop's kind, or null when no drop spawned. */
  maybeSpawn(x, z) {
    if (this._drops.length >= MAX_DROPS) return null
    if (this._rand() >= DROP_CHANCE) return null
    const kind = this._rand() < BULLET_CHANCE ? 'bullets' : 'shells'
    const mesh = new THREE.Mesh(this._geo, kind === 'bullets' ? this._bulletMat : this._shellMat)
    mesh.position.set(x, DROP_Y, z)
    this.scene.add(mesh)
    this._drops.push({ x, z, t: 0, mesh, kind })
    return kind
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
    this._shellMat.dispose()
    this._bulletMat.dispose()
  }
}
