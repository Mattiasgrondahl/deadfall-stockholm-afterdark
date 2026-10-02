import * as THREE from 'three'

// Axe — two-handed melee weapon. One trigger press = one swing: an arc hit
// within range/arc of the player's facing, headshot only up close.
// Infinite ammo. Deterministic (no Math.random). Headless-safe: no DOM, no
// textures. Mirrors the fire weapon surface (update/shoot→swing/reset/dispose,
// getZombies/inputState/player) so the V3 WeaponBank can manage both uniformly.
// The swing is a phased slash: a short windup, a fast forward strike (pitch +
// translation through the arc, with a fading trail), then a recovery to rest.
// Hit zombies are staggered backward via Zombie.knockback.

const DMG = 25
const HEAD_MULT = 2
const HEAD_RANGE = 0.6 // headshot only within this horizontal distance
// v37 R2: axe swings now cost stamina (lighter than the sword's 12) so the
// starting melee can't be spammed through a whole horde without a breather.
const STAMINA_COST = 8
const RANGE = 2.1      // v3 T3: max horizontal reach of the swing (was 1.5)
const ARC = 0.7        // half-width of the swing arc, radians
const COOLDOWN = 0.18  // v4 co-op: rapid re-swing — a double-click lands two swings (was 0.6)
const SWING_TIME = 0.2 // v3 T3: shorter swing cycle (was 0.25)
const SWING_START = -0.9
const SWING_END = 1.1
// v3 T3 overhead diagonal: the windup RAISES the axe overhead (negative pitch
// = up), then the strike sweeps down and across the body with a diagonal ROLL
// (camera-local Z) so the axe cleaves the zombie on a diagonal instead of
// slicing flat. Slash animation (fractions of SWING_TIME): windup [0, WINDUP],
// strike [WINDUP, STRIKE_END], recovery [STRIKE_END, 1]. The axe is faster
// than the sword, so its strike is shorter and the forward push smaller.
const WINDUP = 0.15
const STRIKE_END = 0.5
const RAISE_PITCH = 0.7  // v3 T3: rad of overhead raise during the windup
const SLASH_PITCH = 0.4
const SLASH_FWD = 0.12
const SLASH_ROLL = 0.6   // v3 T3: rad of diagonal roll at mid-strike (the cut)
const TRAIL_OPACITY = 0.45
const KNOCKBACK = 3      // m/s stagger applied to hit zombies
const smoothstep = (v) => { const t = Math.min(1, Math.max(0, v)); return t * t * (3 - 2 * t) }
// Asset base for optional weapon-surface textures (browser only; empty under
// Node so headless tests never load images).
const ASSET_BASE = (typeof document !== 'undefined' ? ((import.meta.env?.BASE_URL || '').replace(/\/$/, '') + '/') : '')

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
    this.staminaCost = STAMINA_COST
    this.range = RANGE
    this.arc = ARC
    this.cooldown = COOLDOWN
    this.swingTime = SWING_TIME
    this.infiniteAmmo = true
    this.owner = null // player id for kill attribution (multiplayer); null in solo
    this._coolT = 0
    this._swingT = 0
    this._swinging = false

    // View model: shaft, head, slash trail — camera-attached (same placement
    // convention as the fire weapons). Static until the swing animation runs
    // it; _viewBase is the rest pose.
    this.view = new THREE.Group()
    this.view.position.set(0.3, -0.3, -0.5)
    this._viewBase = this.view.position.clone()
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b5433, roughness: 0.9 })
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x5a6066, roughness: 0.5, metalness: 0.5 })
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.7, 0.03), woodMat)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.06), steelMat)
    head.position.set(0, 0.3, 0)
    this._head = head
    this._texMat = null
    // Slash trail: a crescent arc in the swing plane, double-sided additive.
    // Its opacity is animated only during the strike phase (see update()).
    const trailShape = new THREE.Shape()
    const A0 = -0.7, A1 = 0.7, R0 = 0.42, R1 = 0.68
    trailShape.moveTo(Math.cos(A0) * R0, Math.sin(A0) * R0)
    for (let i = 1; i <= 16; i++) { const a = A0 + (A1 - A0) * (i / 16); trailShape.lineTo(Math.cos(a) * R0, Math.sin(a) * R0) }
    for (let i = 16; i >= 0; i--) { const a = A0 + (A1 - A0) * (i / 16); trailShape.lineTo(Math.cos(a) * R1, Math.sin(a) * R1) }
    trailShape.closePath()
    const trailMat = new THREE.MeshBasicMaterial({ color: 0xb8a878, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
    const trail = new THREE.Mesh(new THREE.ShapeGeometry(trailShape), trailMat)
    trail.position.set(0, 0.3, 0.02)
    this._trailMat = trailMat
    this.view.add(shaft, head, trail)
    this.camera.add(this.view)
    scene.add(this.camera)

    // Optional weapon-surface texture (browser only): when the generated
    // axe-head image loads, replace the head's wide faces (+z/-z; box face
    // order is +x -x +y -y +z -z) with a textured material. Flat steel
    // remains in Node/headless and if the file is missing.
    // v6 look (weapons): the AI axe.jpg photo skin is dropped — it read as a flat
    // decal over the head, so the head keeps its flat steelMat look instead. The
    // TextureLoader block that built a white+map material and swapped it onto the
    // head's wide faces is gone; `steelMat` stays the head's only material.
    // dispose() still guards `mat.map`, which is null-safe because no textured
    // material is ever assigned. The jpg stays in public/assets/weapons/ for the
    // asset tooling that references it.
  }

  /** Per frame: cooldown recovery, phased slash animation, fire input edge.
   *  Windup pulls the head back; the strike yaws through the arc while
   *  pitching forward and pushing toward the target (mid = sin(pi*s), 1 at
   *  mid-strike); recovery returns everything to rest. Deterministic
   *  smoothstep easing throughout; no Math.random. */
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
        // v3 T3: raise the axe overhead — pitch back up (negative X) and pull
        // it back as the windup, so the strike can come down from above.
        const s = smoothstep(k / WINDUP)
        this.view.rotation.set(-RAISE_PITCH * s, SWING_START * s, 0)
        this.view.position.set(this._viewBase.x, this._viewBase.y, this._viewBase.z - 0.04 * s)
        this._trailMat.opacity = 0
      } else if (k < STRIKE_END) {
        const s = smoothstep((k - WINDUP) / (STRIKE_END - WINDUP))
        const mid = Math.sin(Math.PI * s) // 0 at windup/strike edges, 1 at mid-strike
        // v3 T3: come down from overhead (pitch swings from the raised back
        // pose through forward) while ROLLING diagonally across the body, so
        // the axe cleaves on a diagonal rather than slicing flat.
        const pitch = -RAISE_PITCH * (1 - mid) - SLASH_PITCH * mid
        this.view.rotation.set(pitch, SWING_START + (SWING_END - SWING_START) * s, SLASH_ROLL * mid)
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
    // v37 R2: a swing costs stamina; too little breath and the swing is refused
    // (no cooldown, no animation) so melee-spam runs the player out. Guarded for
    // headless / fake players without a numeric stamina.
    const p0 = this.player
    if (p0 && typeof p0.stamina === 'number' && p0.stamina < this.staminaCost) return false
    if (p0 && typeof p0.stamina === 'number') p0.stamina = Math.max(0, p0.stamina - this.staminaCost)
    this._coolT = this.cooldown
    this._swingT = 0
    this._swinging = true
    // v25: notify the owner (server) that a swing actually started so co-op can
    // show a swing/impact flash on this player's remote avatar.
    this.onFire?.(this.name)
    const p = this.player
    if (p && !p.isDead) {
      if (typeof p.addPitchKick === 'function') p.addPitchKick(0.008) // small melee kick; guarded for minimal fake players
      // yaw 0 faces -Z (city center); horizontal facing vector from yaw.
      const fx = -Math.sin(p.yaw)
      const fz = -Math.cos(p.yaw)
      const cosArc = Math.cos(this.arc)
      const hitSet = []
      let headHit = false
      for (const z of (this.getZombies ? this.getZombies() : [])) {
        if (z.isDead) continue
        const dx = z.position.x - p.position.x
        const dz = z.position.z - p.position.z
        const hdist = Math.hypot(dx, dz)
        if (hdist < 1e-6 || hdist > this.range) continue
        if ((dx / hdist) * fx + (dz / hdist) * fz < cosArc) continue
        const head = hdist <= this.headRange
        const dmg = this.dmg * (head ? this.headMultiplier : 1)
        z.damage(dmg, null, this.owner, head)
        // Hit reaction: stagger the zombie along the player->zombie direction
        // (away from the player). No-op if the hit was fatal.
        z.knockback(dx / hdist, dz / hdist, KNOCKBACK)
        this.blood?.burst(z.position.x, z.position.y + (head ? 1.8 : 1.2), z.position.z, dmg, head)
        hitSet.push(z)
        if (head) headHit = true
      }
      for (const z of hitSet) this.audio?.hitZombie?.()
      if (hitSet.length) this.onHit?.(headHit ? 'head' : 'body') // V5P-1: HUD hit marker
    }
    this.audio?.axeSwing?.() // voice added in the audio task; null-safe no-op until then
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
      if (m.geometry && m.material) {
        m.geometry.dispose()
        // v4 VISUALS (B): the textured head swaps in a material ARRAY
        // ([steel,steel,steel,steel,texMat,texMat]); dispose every entry and
        // free the loaded texture map so it does not leak (matches Sword).
        const mats = Array.isArray(m.material) ? m.material : [m.material]
        for (const mat of mats) {
          if (mat.map) mat.map.dispose()
          mat.dispose()
        }
      }
    }
  }
}
