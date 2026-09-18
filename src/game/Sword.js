import * as THREE from 'three'

// Sword — one-handed slashing weapon. One trigger press = one swing: an arc
// hit within range/arc of the player's facing, headshot only up close.
// Infinite ammo. Deterministic (no Math.random). Headless-safe: no DOM, no
// textures. Mirrors the WeaponBank surface (update/swing/reset/dispose,
// getZombies/inputState/blood/onHit). A fatal head hit fires the optional
// onDecapitate callback (Task E wires the rolling-head pool to it).
// Heavier than the axe: more damage, wider arc, longer reach, slower swing.

const DMG = 45
const HEAD_MULT = 2
const HEAD_RANGE = 0.7 // headshot only within this horizontal distance
const RANGE = 1.8      // max horizontal reach of the swing
const ARC = 0.8        // half-width of the swing arc, radians
const COOLDOWN = 1.15
const SWING_TIME = 0.32
const SWING_START = -1.1
const SWING_END = 1.3

export class Sword {
  constructor(scene, camera, audio) {
    this.scene = scene
    this.camera = camera
    this.audio = audio
    this.blood = null
    this.getZombies = null
    this.inputState = null
    this.player = null
    this.dmg = DMG
    this.headMultiplier = HEAD_MULT
    this.headRange = HEAD_RANGE
    this.range = RANGE
    this.arc = ARC
    this.cooldown = COOLDOWN
    this.swingTime = SWING_TIME
    this.infiniteAmmo = true
    this.onDecapitate = null // (zombie, dir) -> Task E rolling-head pool
    this._coolT = 0
    this._swingT = 0
    this._swinging = false

    // View model: blade, guard, grip — camera-attached. Static until the
    // swing animation runs it.
    this.view = new THREE.Group()
    this.view.position.set(0.28, -0.28, -0.6)
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.35, metalness: 0.7 })
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.6, metalness: 0.4 })
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.65, 0.025), steelMat)
    blade.position.set(0, 0.32, 0)
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.06), darkMat)
    guard.position.set(0, -0.03, 0)
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.05), darkMat)
    grip.position.set(0, -0.12, 0)
    this.view.add(blade, guard, grip)
    this.camera.add(this.view)
    scene.add(this.camera)
  }

  /** Per frame: cooldown recovery, swing animation, fire input edge. */
  update(dt, player = null) {
    if (player) this.player = player
    if (this._coolT > 0) this._coolT = Math.max(0, this._coolT - dt)
    if (this._swinging) {
      this._swingT += dt
      if (this._swingT >= this.swingTime) {
        this._swingT = 0
        this._swinging = false
        this.view.rotation.y = 0
      } else {
        const k = this._swingT / this.swingTime
        this.view.rotation.y = SWING_START + (SWING_END - SWING_START) * k
      }
    }
    if (this.inputState && this.inputState.fire) {
      this.inputState.fire = false
      this.swing()
    }
  }

  /** One swing; returns false while on cooldown. */
  swing() {
    if (this._coolT > 0) return false
    this._coolT = this.cooldown
    this._swingT = 0
    this._swinging = true
    const p = this.player
    if (p && !p.isDead) {
      if (typeof p.addPitchKick === 'function') p.addPitchKick(0.01) // melee kick; guarded for minimal fake players
      // yaw 0 faces -Z (city center); horizontal facing vector from yaw.
      const fx = -Math.sin(p.yaw)
      const fz = -Math.cos(p.yaw)
      const cosArc = Math.cos(this.arc)
      const hitSet = []
      for (const z of (this.getZombies ? this.getZombies() : [])) {
        if (z.isDead) continue
        const dx = z.position.x - p.position.x
        const dz = z.position.z - p.position.z
        const hdist = Math.hypot(dx, dz)
        if (hdist < 1e-6 || hdist > this.range) continue
        if ((dx / hdist) * fx + (dz / hdist) * fz < cosArc) continue
        const head = hdist <= this.headRange
        const dmg = this.dmg * (head ? this.headMultiplier : 1)
        z.damage(dmg, null)
        this.blood?.burst(z.position.x, z.position.y + (head ? 1.8 : 1.2), z.position.z, dmg, head)
        if (head && z.isDead) this.onDecapitate?.(z, { x: fx, z: fz }) // fatal headshot
        hitSet.push(z)
      }
      for (const z of hitSet) this.audio?.hitZombie?.()
      if (hitSet.length) this.onHit?.() // HUD hit marker
    }
    this.audio?.swordSwing?.() // voice lands with the audio task; null-safe
    return true
  }

  reset() {
    this._coolT = 0
    this._swingT = 0
    this._swinging = false
    this.view.rotation.y = 0
  }

  dispose() {
    this.camera.remove(this.view)
    for (const m of this.view.children) {
      // Guard: no lights here, but keep the pattern uniform with Shotgun.
      if (m.geometry && m.material) {
        m.geometry.dispose()
        m.material.dispose()
      }
    }
  }
}
