import * as THREE from 'three'
import { GEO2, DEADMAT } from './Zombie.js'

// DecapitatedHeadPool — game-owned pool of at most 3 severed heads that roll
// across the street after a fatal headshot. Each head reuses the SHARED
// GEO2.head geometry and the zombie's death material (DEADMAT, shared), so
// spawning and clearing never dispose shared resources — only scene
// attach/detach happens here. Deterministic (own LCG seed 991), headless-safe.

const RADIUS = 0.15   // head half-height; the head rests at y = RADIUS
const MAX_HEADS = 3
const LIFETIME = 12   // seconds after spawn before the head starts sinking
const SINK_SPEED = 0.4
const SINK_FLOOR = -0.3
const GRAVITY = -9.8

export class DecapitatedHeadPool {
  constructor(scene) {
    this.scene = scene
    this.heads = [] // [mesh, {vx, vy, vz, age, sinking}]
    let s = 991
    this._rng = () => (s = (s * 48271) % 65537) / 65537
    this._axis = new THREE.Vector3() // scratch, reused every frame
  }

  /** Spawn a severed head at the zombie's head height, thrown along `dir`
    * (any horizontal direction; null/zero falls back to a deterministic LCG
    * direction). Evicts the oldest head when the pool is full. */
  spawn(zombie, dir = null) {
    if (this.heads.length >= MAX_HEADS) {
      // heads entries are [mesh, state] pairs; shift() yields the pair,
      // so destructure it to get the mesh.
      const [old] = this.heads.shift()
      this.scene.remove(old)
    }
    // Shared geometry + shared death material: no per-head resources at all.
    const mesh = new THREE.Mesh(GEO2.head, DEADMAT)
    mesh.position.set(zombie.position.x, zombie.position.y + 1.8, zombie.position.z)
    let dx = dir ? dir.x : 0
    let dz = dir ? dir.z : 0
    const len = Math.hypot(dx, dz)
    if (len < 1e-6) {
      const a = this._rng() * 2 * Math.PI
      dx = Math.sin(a); dz = Math.cos(a)
    } else {
      dx /= len; dz /= len
    }
    const speed = 2.0 + this._rng() * 1.5
    mesh.castShadow = true
    this.scene.add(mesh)
    this.heads.push([mesh, { vx: dx * speed, vy: 0.8, vz: dz * speed, age: 0, sinking: false }])
    return mesh
  }

  /** Per frame: gravity, ground bounces, rolling; aged heads sink out. */
  update(dt) {
    for (let i = this.heads.length - 1; i >= 0; i--) {
      const [mesh, h] = this.heads[i]
      h.age += dt
      if (h.sinking) {
        mesh.position.y -= SINK_SPEED * dt
        if (mesh.position.y < SINK_FLOOR) {
          this.scene.remove(mesh)
          this.heads.splice(i, 1)
        }
        continue
      }
      if (h.age >= LIFETIME) { h.sinking = true; continue }
      h.vy += GRAVITY * dt
      mesh.position.x += h.vx * dt
      mesh.position.y += h.vy * dt
      mesh.position.z += h.vz * dt
      if (mesh.position.y < RADIUS) {
        mesh.position.y = RADIUS
        h.vy = -h.vy * 0.35 // bounce
        h.vx *= 0.6          // ground friction
        h.vz *= 0.6
        // Roll in the direction of travel: spin about the horizontal axis
        // perpendicular to the velocity (axis = (vz, 0, -vx) makes the top
        // of the head move with the head; verified by cross-product).
        const hs = Math.hypot(h.vx, h.vz)
        if (hs > 1e-4) {
          this._axis.set(h.vz, 0, -h.vx).normalize()
          mesh.rotateOnWorldAxis(this._axis, (hs * dt) / RADIUS)
        }
      }
    }
  }

  count() { return this.heads.length }

  /** Remove all heads (game reset). Shared resources untouched. */
  clear() {
    for (const [mesh] of this.heads) this.scene.remove(mesh)
    this.heads.length = 0
  }

  /** Detach remaining heads from the scene. Shared geometry/materials are
    owned by Zombie.js and must NOT be disposed here. */
  dispose() {
    this.clear()
  }
}
