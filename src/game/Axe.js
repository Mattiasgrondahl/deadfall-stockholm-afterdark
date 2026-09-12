import * as THREE from 'three'

// Axe — two-handed melee weapon. One trigger press = one swing: an arc hit
// within range/arc of the player's facing, headshot only up close.
// Infinite ammo. Deterministic (no Math.random). Headless-safe: no DOM, no
// textures. Mirrors the fire weapon surface (update/shoot→swing/reset/dispose,
// getZombies/inputState/player) so the V3 WeaponBank can manage both uniformly.

const DMG = 25
const HEAD_MULT = 2
const HEAD_RANGE = 0.6 // headshot only within this horizontal distance
const RANGE = 1.5      // max horizontal reach of the swing
const ARC = 0.7        // half-width of the swing arc, radians
const COOLDOWN = 0.9
const SWING_TIME = 0.25
const SWING_START = -0.9
const SWING_END = 1.1

export class Axe {
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
    this._coolT = 0
    this._swingT = 0
    this._swinging = false

    // View model: shaft + head, camera-attached (same placement convention as
    // the fire weapons). Static until the swing animation runs it.
    this.view = new THREE.Group()
    this.view.position.set(0.3, -0.3, -0.5)
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b5433, roughness: 0.9 })
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x5a6066, roughness: 0.5, metalness: 0.5 })
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.7, 0.03), woodMat)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.06), steelMat)
    head.position.set(0, 0.3, 0)
    this.view.add(shaft, head)
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
      if (typeof p.addPitchKick === 'function') p.addPitchKick(0.008) // small melee kick; guarded for minimal fake players
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
        z.damage(this.dmg * (head ? this.headMultiplier : 1), null)
        this.blood?.burst(z.position.x, z.position.y + (head ? 1.8 : 1.2), z.position.z, this.dmg * (head ? this.headMultiplier : 1), head)
        hitSet.push(z)
      }
      for (const z of hitSet) this.audio?.hitZombie?.()
      if (hitSet.length) this.onHit?.() // V5P-1: HUD hit marker
    }
    this.audio?.axeSwing?.() // voice added in the audio task; null-safe no-op until then
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
