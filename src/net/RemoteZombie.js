// src/net/RemoteZombie.js — a co-op zombie body driven by the server snapshot.
//
// The local zombie sim is suppressed in co-op, so remote zombies live only in
// the snapshot. This class renders one remote zombie with the SAME primitive
// body the local Zombie uses (clothes + face + eyes + hair + accessories), so
// co-op bodies read as people instead of black boxes. It mirrors the server's
// limb state (arms/legs/head severed), collapses + lingers on death, and faces
// the snapshot's facing angle. It also exposes a weapon-hit proxy so the local
// weapon can register hits + show feedback; a confirmed hit sends an
// authoritative HIT message (handled by Multiplayer) so the server applies the
// damage.
//
// Reversibility: everything it adds to the scene (the body group + any detached
// falling limbs) is tracked and removed in dispose(). Materials/geometry are
// shared (from Zombie.js) and never disposed here.
import * as THREE from 'three'
import { buildPrimitiveBody, DEADMAT, DEADEYEMAT } from '../game/Zombie.js'

// Deterministic LCG (no Math.random) so per-zombie phase is stable across a
// snapshot stream; seeded from the match id string.
function seedFromId(id) {
  let h = 2166136261
  const s = String(id)
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) & 0x7fffffff
  return h
}

// Falling-limb physics: a detached limb/head tumbles to the ground and stays
// briefly. Shared scratch avoids per-frame allocations.
const _v = new THREE.Vector3()

export class RemoteZombie {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.scene
   * @param {string} opts.id match id (drives deterministic phase)
   * @param {string} opts.type zombie type (walker/shambler/screamer/brute)
   * @param {(victim:string, dmg:number, head:boolean)=>void} [opts.onHit]
   *        called when the local weapon confirms a hit (sends authoritative HIT)
   */
  constructor(opts) {
    this.scene = opts.scene
    this.id = opts.id
    this.type = opts.type
    this.onHit = opts.onHit || null
    const phase = (seedFromId(this.id) / 0x7fffffff) * 2 * Math.PI
    const b = buildPrimitiveBody(this.type, phase)
    this.group = b.group
    this._parts = b.parts
    this._restMats = b.restMats
    this._head = b.head
    this._face = b.face
    this._eyes = b.eyes
    this._hair = b.hair
    this._acc = b.acc
    this._armL = b.armL; this._armR = b.armR
    this._legL = b.legL; this._legR = b.legR
    this._armRest = { l: b.armL.rotation.x, r: b.armR.rotation.x }
    this._limbs = { arms: 0, legs: 0, head: 0 }
    this.isDead = false
    this._deathT = 0
    this._removed = false
    this._falling = [] // detached limbs/heads tumbling to the ground
    this._x = 0; this._z = 0; this._facing = 0
    this._hp = 100
    this._predHp = null
    this._predictedDead = false
    this._flashT = 0
    this.scene.add(this.group)
  }

  /** Apply the latest snapshot: position, facing, limb state, death. */
  sync(z) {
    if (!z) return
    this._x = z.x; this._z = z.z
    if (z.facing != null) this._facing = z.facing
    const dead = z.dead || z.state === 'dead'
    // Mirror the server's limb state (arms/legs/head severed).
    const L = z.limbs || { arms: 0, legs: 0, head: 0 }
    this._applyLimb('armL', L.arms >= 1)
    this._applyLimb('armR', L.arms >= 2)
    this._applyLimb('legL', L.legs >= 1)
    this._applyLimb('legR', L.legs >= 2)
    this._applyHead(L.head >= 1)
    if (dead && !this.isDead) this._die()
    if (!dead) this._predictedDead = false
    if (!this.isDead) {
      this.group.position.set(this._x, 0, this._z)
      this.group.rotation.y = this._facing
      this.group.visible = true
    }
  }

  /** Hide a limb + spawn a tumbling replacement if it just got severed. */
  _applyLimb(which, off) {
    const mesh = this['_' + which]
    if (!mesh) return
    const wasOn = mesh.visible
    mesh.visible = !off
    if (off && wasOn) this._spawnFalling(mesh)
  }

  /** Hide the head + spawn a tumbling head if it just got severed. */
  _applyHead(off) {
    const wasOn = this._head.visible
    this._head.visible = !off
    if (this._face) this._face.visible = !off
    if (this._hair) this._hair.visible = !off
    if (this._acc && (this._acc.parent === this._head)) this._acc.visible = !off
    for (const e of this._eyes) e.visible = !off
    if (off && wasOn) this._spawnFalling(this._head)
  }

  /** Detach a limb/head from the body and let it tumble to the ground. */
  _spawnFalling(mesh) {
    // Copy world position so the detached piece starts where it was attached.
    mesh.updateWorldMatrix(true, false)
    const wp = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld)
    const piece = new THREE.Mesh(mesh.geometry, mesh.material)
    piece.castShadow = true
    piece.position.copy(wp)
    piece.rotation.set(0, this._facing, 0)
    // Give it a small outward + upward tumble velocity.
    piece._vy = 1.2
    piece._vx = (Math.sin(this._facing) * 0.6)
    piece._vz = (Math.cos(this._facing) * 0.6)
    piece._spin = 4
    piece._life = 0
    this.scene.add(piece)
    this._falling.push(piece)
  }

  /** Begin the death collapse: swap to dead materials, start sinking/flopping. */
  _die() {
    this.isDead = true
    this._deathT = 0
    for (let i = 0; i < this._parts.length; i++) this._parts[i].material = DEADMAT
    for (const e of this._eyes) e.material = DEADEYEMAT
    if (this._face) this._face.material = DEADMAT
  }

  /** Advance timers: collapse the corpse, tumble falling limbs, expire them. */
  update(dt) {
    // Tumble falling limbs/heads to the ground; expire after a short linger.
    for (let i = this._falling.length - 1; i >= 0; i--) {
      const p = this._falling[i]
      p._life += dt
      p._vy -= 9 * dt
      p.position.x += p._vx * dt
      p.position.z += p._vz * dt
      p.position.y += p._vy * dt
      if (p.position.y < 0.06) { p.position.y = 0.06; p._vy = 0; p._vx *= 0.6; p._vz *= 0.6 }
      p.rotation.x += p._spin * dt
      if (p._life > 4) { this.scene.remove(p); this._falling.splice(i, 1) }
    }
    if (!this.isDead) return
    this._deathT += dt
    // Sink + flop over + splay limbs so the corpse reads dead, not frozen.
    const flop = Math.min(this._deathT / 1.5, 1)
    this.group.position.set(this._x, -Math.min(this._deathT * 0.35, 0.8), this._z)
    this.group.rotation.x = -flop * 1.2
    this.group.rotation.z = flop * 0.25
    if (this._armL && this._armL.visible) { this._armL.rotation.x = this._armRest.l - flop * 0.7; this._armL.rotation.z = -flop * 0.6 }
    if (this._armR && this._armR.visible) { this._armR.rotation.x = this._armRest.r + flop * 0.5; this._armR.rotation.z = flop * 0.6 }
    if (this._legL && this._legL.visible) this._legL.rotation.x = flop * 0.4
    if (this._legR && this._legR.visible) this._legR.rotation.x = -flop * 0.3
    if (this._head && this._head.visible) this._head.rotation.x = flop * 0.5
    // Linger ~5 s, then fade + remove the corpse.
    if (this._deathT > 5) {
      const fade = Math.max(0, 1 - (this._deathT - 5) / 1.5)
      this.group.visible = fade > 0.02
      for (const p of this._parts) if (p.material.opacity !== undefined) { p.material.transparent = true; p.material.opacity = fade }
      if (this._deathT > 6.5) this._removed = true
    }
  }

  /** True once the corpse has fully expired and should be dropped from the map. */
  get gone() { return this._removed }

  /** A weapon-hit proxy for the local weapon (server hitbox contract). */
  getTarget() {
    const self = this
    return {
      isDead: this.isDead || this._predictedDead,
      _id: this.id,
      getHitboxes() {
        return [
          { center: new THREE.Vector3(self._x, 1.2, self._z), radius: 0.45, isHead: false },
          { center: new THREE.Vector3(self._x, 1.8, self._z), radius: 0.3, isHead: true }
        ]
      },
      damage(amount, dir, by, head) {
        self._predHp = (self._predHp == null ? self._hp : self._predHp) - amount
        if (self._predHp <= 0) { self._predictedDead = true; this.isDead = true }
        if (self.onHit) self.onHit(self.id, amount, head)
      },
      hitLimbAt(x, y, z) {
        // Client-side prediction: sever the nearest limb for instant feedback.
        const near = (lx, ly, r) => {
          const dx = x - (self._x + lx), dz = z - (self._z + 0), dy = y - ly
          return dx * dx + dz * dz + dy * dy < r * r
        }
        if (self._limbs.legs < 2) {
          if (self._legL && self._legL.visible && near(-0.16, 0.47, 0.34)) { self._applyLimb('legL', true); self._limbs.legs++; return 'leg' }
          if (self._legR && self._legR.visible && near(0.16, 0.47, 0.34)) { self._applyLimb('legR', true); self._limbs.legs++; return 'leg' }
        }
        if (self._limbs.arms < 2) {
          if (self._armL && self._armL.visible && near(-0.34, 1.42, 0.3)) { self._applyLimb('armL', true); self._limbs.arms++; return 'arm' }
          if (self._armR && self._armR.visible && near(0.34, 1.42, 0.3)) { self._applyLimb('armR', true); self._limbs.arms++; return 'arm' }
        }
        return null
      }
    }
  }

  /** Remove the body + any falling pieces from the scene. */
  dispose() {
    this.scene.remove(this.group)
    for (const p of this._falling) this.scene.remove(p)
    this._falling.length = 0
  }
}