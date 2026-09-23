// src/game/RemotePlayer.js — Phase 2 of MULTIPLAYER_PLAN.md (§6, §11): a cheap
// avatar for OTHER players, driven entirely by snapshots.
//
// The local player has no visible body (first-person), so remote players need a
// simple third-person silhouette. This is a 6-part primitive body (torso, head,
// two arms, two legs) using SHARED module-level geometry + materials, so 8
// avatars add only 48 meshes to the client scene — well inside the ≤600 budget.
// It never simulates: the Game feeds it x/y/z/yaw/pitch/health/dead from the
// snapshot each frame and it just positions + poses the parts. Headless-safe:
// it builds plain THREE objects and touches no DOM/WebGL.
import * as THREE from 'three'

// Shared geometry (one instance reused by every avatar).
const GEO = {
  torso: new THREE.BoxGeometry(0.5, 1.0, 0.35),
  head: new THREE.BoxGeometry(0.28, 0.3, 0.28),
  arm: new THREE.BoxGeometry(0.13, 0.6, 0.13),
  leg: new THREE.BoxGeometry(0.16, 0.9, 0.16),
}
// Per-id tint so players read as distinct; falls back to a neutral color.
const PALETTE = [0x3f7fbf, 0xbf7f3f, 0x3fbf7f, 0xbf3f7f, 0x7f3fbf, 0xbfbf3f, 0x3fbfbe, 0xbe3fbf]
const DEAD_MAT = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 1 })

function tintFor(id) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export class RemotePlayer {
  /**
   * @param {THREE.Scene} scene
   * @param {string} id player id (used for a stable tint)
   */
  constructor(scene, id) {
    this.id = id
    this.group = new THREE.Group()
    const color = tintFor(id)
    // Bright tint + matching emissive so the avatar reads in the dim co-op
    // scene (a plain MeshStandardMaterial box group read as a black blob).
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, emissive: color, emissiveIntensity: 0.45 })
    this._mat = mat
    const mk = (geo, x, y, z) => {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(x, y, z)
      this.group.add(m)
      return m
    }
    this.torso = mk(GEO.torso, 0, 1.1, 0)
    this.head = mk(GEO.head, 0, 1.75, 0)
    this.armL = mk(GEO.arm, -0.36, 1.1, 0)
    this.armR = mk(GEO.arm, 0.36, 1.1, 0)
    this.legL = mk(GEO.leg, -0.12, 0.45, 0)
    this.legR = mk(GEO.leg, 0.12, 0.45, 0)
    this._parts = [this.torso, this.head, this.armL, this.armR, this.legL, this.legR]
    this._walkPhase = 0
    scene.add(this.group)
  }

  /**
   * Apply one snapshot player entry. Positions the group, faces it toward the
   * yaw, and drives a cheap procedural limb swing from movement delta so the
   * avatar reads as walking (the same idea as the zombie primitive walk).
   */
  apply(p, dt = 0) {
    if (!p) return
    this.group.position.set(p.x, p.y, p.z)
    this.group.rotation.y = p.yaw || 0
    const moving = !p.dead && (Math.abs(p.x - (this._lastX ?? p.x)) + Math.abs(p.z - (this._lastZ ?? p.z))) > 0.001
    this._lastX = p.x; this._lastZ = p.z
    if (moving) {
      this._walkPhase += dt * 8
      const s = Math.sin(this._walkPhase) * 0.5
      this.armL.rotation.x = s
      this.armR.rotation.x = -s
      this.legL.rotation.x = -s
      this.legR.rotation.x = s
    } else {
      this.armL.rotation.x = this.armR.rotation.x = this.legL.rotation.x = this.legR.rotation.x = 0
    }
    // Dead avatars go dark + sink slightly.
    if (p.dead) {
      for (const m of this._parts) m.material = DEAD_MAT
      this.group.position.y = (p.y ?? 1.7) - 0.6
    } else {
      for (const m of this._parts) m.material = this._mat
    }
  }

  dispose() {
    // Materials are per-instance (tinted); geometry + DEAD_MAT are shared and
    // must NOT be disposed here.
    this._mat.dispose()
    if (this.group.parent) this.group.parent.remove(this.group)
    this.group.clear()
  }
}