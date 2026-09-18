import * as THREE from 'three'

// Sword — one-handed slashing weapon. One trigger press = one swing: an arc
// hit within range/arc of the player's facing, headshot only up close.
// Infinite ammo. Deterministic (no Math.random). Headless-safe: no DOM, no
// textures. Mirrors the WeaponBank surface (update/swing/reset/dispose,
// getZombies/inputState/blood/onHit). A fatal head hit fires the optional
// onDecapitate callback (Task E wires the rolling-head pool to it).
// Heavier than the axe: more damage, wider arc, longer reach, slower swing.
// The swing is a phased slash: a short windup, a fast forward strike (pitch +
// translation through the arc, with a fading trail), then a recovery to rest.
// Hit zombies are staggered backward via Zombie.knockback.

const DMG = 45
const HEAD_MULT = 2
const HEAD_RANGE = 0.7 // headshot only within this horizontal distance
const RANGE = 1.8      // max horizontal reach of the swing
const ARC = 0.8        // half-width of the swing arc, radians
const COOLDOWN = 1.15
const SWING_TIME = 0.32
const SWING_START = -1.1
const SWING_END = 1.3
// Slash animation (fractions of SWING_TIME): windup [0, WINDUP],
// strike [WINDUP, STRIKE_END], recovery [STRIKE_END, 1]. During the strike the
// view pitches forward (SLASH_PITCH) and translates toward the target
// (SLASH_FWD), so the blade travels through the arc instead of spinning in
// place; a fading arc trail sells the whoosh. Deterministic easing throughout.
const WINDUP = 0.12
const STRIKE_END = 0.45
const SLASH_PITCH = 0.5  // rad of forward dip at mid-strike
const SLASH_FWD = 0.14   // m of forward push (camera-local -z) at mid-strike
const TRAIL_OPACITY = 0.45
const KNOCKBACK = 3      // m/s stagger applied to hit zombies
const smoothstep = (v) => { const t = Math.min(1, Math.max(0, v)); return t * t * (3 - 2 * t) }
// Asset base for optional weapon-surface textures (browser only; empty under
// Node so headless tests never load images).
const ASSET_BASE = (typeof document !== 'undefined' ? ((import.meta.env?.BASE_URL || '').replace(/\/$/, '') + '/') : '')

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
    this.owner = null // player id for kill attribution (multiplayer); null in solo
    this._coolT = 0
    this._swingT = 0
    this._swinging = false

    // View model: blade, guard, grip, slash trail — camera-attached. Static
    // until the swing animation runs it; _viewBase is the rest pose.
    this.view = new THREE.Group()
    this.view.position.set(0.28, -0.28, -0.6)
    this._viewBase = this.view.position.clone()
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.35, metalness: 0.7 })
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.6, metalness: 0.4 })
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.65, 0.025), steelMat)
    blade.position.set(0, 0.32, 0)
    this._blade = blade
    this._texMat = null
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.06), darkMat)
    guard.position.set(0, -0.03, 0)
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.05), darkMat)
    grip.position.set(0, -0.12, 0)
    // Slash trail: a crescent arc in the swing plane, double-sided additive.
    // Its opacity is animated only during the strike phase (see update()).
    const trailShape = new THREE.Shape()
    const A0 = -0.85, A1 = 0.85, R0 = 0.42, R1 = 0.72
    trailShape.moveTo(Math.cos(A0) * R0, Math.sin(A0) * R0)
    for (let i = 1; i <= 16; i++) { const a = A0 + (A1 - A0) * (i / 16); trailShape.lineTo(Math.cos(a) * R0, Math.sin(a) * R0) }
    for (let i = 16; i >= 0; i--) { const a = A0 + (A1 - A0) * (i / 16); trailShape.lineTo(Math.cos(a) * R1, Math.sin(a) * R1) }
    trailShape.closePath()
    const trailMat = new THREE.MeshBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
    const trail = new THREE.Mesh(new THREE.ShapeGeometry(trailShape), trailMat)
    trail.position.set(0, 0.32, 0.02)
    this._trailMat = trailMat
    this.view.add(blade, guard, grip, trail)
    this.camera.add(this.view)
    scene.add(this.camera)

    // Optional weapon-surface texture (browser only): when the generated
    // blade image loads, replace the blade's wide faces (+z/-z; box face
    // order is +x -x +y -y +z -z) with a textured material. Flat steel
    // remains in Node/headless and if the file is missing.
    if (typeof document !== 'undefined') {
      new THREE.TextureLoader().load(ASSET_BASE + 'assets/weapons/sword.jpg', (tex) => {
        if (!this.camera.children.includes(this.view)) return // disposed in flight
        tex.colorSpace = THREE.SRGBColorSpace
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.45, metalness: 0.55 })
        this._blade.material = [steelMat, steelMat, steelMat, steelMat, mat, mat]
        this._texMat = mat
      })
    }
  }

  /** Per frame: cooldown recovery, phased slash animation, fire input edge.
   *  Windup pulls the blade back; the strike yaws through the arc while
   *  pitching forward and pushing toward the target (mid = sin(pi*s), 1 at
   *  mid-strike); recovery returns everything to rest. All motion is
   *  deterministic smoothstep-eased; no Math.random. */
  update(dt, player = null) {
    if (player) this.player = player
    if (this._coolT > 0) this._coolT = Math.max(0, this._coolT - dt)
    if (this._swinging) {
      this._swingT += dt
      const k = this._swingT / this.swingTime
      if (k >= 1) {
        this._swingT = 0
        this._swinging = false
        this.view.rotation.set(0, 0, 0)
        this.view.position.copy(this._viewBase)
        this._trailMat.opacity = 0
      } else if (k < WINDUP) {
        const s = smoothstep(k / WINDUP)
        this.view.rotation.set(0, SWING_START * s, 0)
        this.view.position.set(this._viewBase.x, this._viewBase.y, this._viewBase.z - 0.04 * s)
        this._trailMat.opacity = 0
      } else if (k < STRIKE_END) {
        const s = smoothstep((k - WINDUP) / (STRIKE_END - WINDUP))
        const mid = Math.sin(Math.PI * s) // 0 at windup/strike edges, 1 at mid-strike
        this.view.rotation.set(-SLASH_PITCH * mid, SWING_START + (SWING_END - SWING_START) * s, 0)
        this.view.position.set(this._viewBase.x, this._viewBase.y, this._viewBase.z - SLASH_FWD * mid)
        this._trailMat.opacity = TRAIL_OPACITY * mid
      } else {
        const s = smoothstep((k - STRIKE_END) / (1 - STRIKE_END))
        this.view.rotation.set(0, SWING_END * (1 - s), 0)
        this.view.position.copy(this._viewBase)
        this._trailMat.opacity = 0
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
        z.damage(dmg, null, this.owner)
        // Hit reaction: stagger the zombie along the player->zombie direction
        // (away from the player). No-op if the hit was fatal.
        z.knockback(dx / hdist, dz / hdist, KNOCKBACK)
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
    this.view.rotation.set(0, 0, 0)
    this.view.position.copy(this._viewBase)
    this._trailMat.opacity = 0
  }

  dispose() {
    this.camera.remove(this.view)
    for (const m of this.view.children) {
      // Guard: no lights here, but keep the pattern uniform with Shotgun.
      if (m.geometry) m.geometry.dispose()
      if (Array.isArray(m.material)) {
        m.material.forEach((mat) => mat.dispose())
        if (this._texMat?.map) this._texMat.map.dispose()
      } else if (m.material) {
        m.material.dispose()
        if (m.material.map) m.material.map.dispose()
      }
    }
    this._texMat = null
  }
}
