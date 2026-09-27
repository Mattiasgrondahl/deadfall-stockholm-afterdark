// DroppedLimbPool.js — detached-limb physics for the v3 dismemberment chain.
//
// When a firearm shot severs a zombie limb (Zombie.hitLimbAt), the limb mesh
// is hidden on the body and a clone is dropped here: it tumbles with the
// zombie's own LCG spin, falls under fixed gravity, and settles flat on the
// ground (y 0). Limb geometry + materials are the SHARED module-level pools
// in Zombie.js, so the pool never disposes them — it only removes its own
// meshes. Deterministic: the caller passes the zombie's LCG rand fn.
//
// Budget: the pool caps live + settled limbs at MAX_LIMBS (24); older drops
// are recycled first, so 24 zombies × 3 limbs can never exceed the mesh
// budget gate (S8 ≤ 640) — worst case adds 24 meshes.

import * as THREE from 'three'

const MAX_LIMBS = 24
const GRAVITY = 9.8
const FALL_TIME = 0.55 // seconds of tumble before the limb settles flat
const SPIN = 6.0 // rad/s initial tumble rate (scaled by the LCG sign)

export class DroppedLimbPool {
  /**
   * @param scene THREE.Scene to hold the dropped limbs
   */
  constructor(scene) {
    this.scene = scene
    this.items = [] // { mesh, vy, spin, t }
  }

  /**
   * Drop a limb clone at (x, y, z) with the owning zombie's LCG `rand`.
   * Reuses the oldest item when the pool is full (mesh is re-parented).
   * @param geometry shared limb geometry (never disposed here)
   * @param material shared limb material (never disposed here)
   * @returns the dropped mesh
   */
  drop(geometry, material, x, y, z, rand) {
    let it = this.items.find((e) => !e.mesh.visible)
    if (!it && this.items.length >= MAX_LIMBS) it = this.items[0]
    if (!it) {
      const mesh = new THREE.Mesh(geometry, material)
      it = { mesh, vy: 0, spin: 0, t: FALL_TIME }
      this.items.push(it)
      this.scene.add(mesh)
    }
    const r = typeof rand === 'function' ? rand() : 0.5
    it.mesh.geometry = geometry
    it.mesh.material = material
    it.mesh.position.set(x, y, z)
    it.mesh.rotation.set(r * 2 * Math.PI, 0, r * Math.PI)
    it.mesh.scale.setScalar(1)
    it.mesh.visible = true
    it.vy = -1.5 - r * 1.5 // small downward toss, deterministic per zombie
    it.spin = (r < 0.5 ? -1 : 1) * SPIN * (0.6 + r * 0.8)
    it.t = 0
    return it.mesh
  }

  /** Advance every live limb: fall + tumble, then settle flat on the ground. */
  update(dt) {
    for (const it of this.items) {
      if (!it.mesh.visible || it.t >= FALL_TIME) continue
      it.t += dt
      if (it.t >= FALL_TIME) {
        it.mesh.position.y = 0.06
        it.mesh.rotation.set(-Math.PI / 2, it.mesh.rotation.y, 0) // lie flat
        continue
      }
      it.vy -= GRAVITY * dt
      it.mesh.position.y += it.vy * dt
      if (it.mesh.position.y < 0.06) it.mesh.position.y = 0.06
      it.mesh.rotation.x += it.spin * dt
    }
  }

  /** Remove every dropped limb from the scene (run reset / dispose). */
  clear() {
    for (const it of this.items) {
      it.mesh.visible = false
      this.scene.remove(it.mesh)
    }
    this.items = []
  }

  /** Pool occupancy (tests + budget checks). */
  get count() { return this.items.filter((e) => e.mesh.visible).length }

  dispose() { this.clear() }
}