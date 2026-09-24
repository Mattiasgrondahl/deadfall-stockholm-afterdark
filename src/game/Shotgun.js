import * as THREE from 'three'
import { raySphere } from './ray.js'

// Shotgun: pump-action; one trigger pull = 6-pellet blast, each pellet an
// independent ray (own jitter, wall occlusion, nearest-zombie hit).
// Mirrors Weapon: view model, LCG spread, flash, recoil, reload, input edges.
// Headless-safe; no Math.random.

const MAG = 5, RESERVE = 30, DMG = 22, PELLETS = 6
const HEAD_MULT = 2, RANGE = 18, SPREAD = 0.16
/** Base stagger speed (m/s) per pellet landed, capped at 4 pellets' worth. */
const STAGGER_BASE = 0.9
const RELOAD_TIME = 1.4, FIRE_INTERVAL = 0.9
const FLASH_TIME = 0.07, RECOIL_KICK = 0.09, RECOIL_DECAY = 0.15
// v6 visuals (6): muzzle-flash peak. 500 cd over an 8 m reach adds 2.43 linear
// luminance to a zombie at 6 m (tonemapped 0.83) and 0 beyond 8 m, so a blast
// lights only what it can actually hit and never washes out a 15 m target.
// 'low' drops the light entirely (peak 0) and dims the sprite.
const FLASH_PEAK = 500, FLASH_PEAK_LOW = 0, FLASH_OPACITY = 0.9, FLASH_OPACITY_LOW = 0.45
const KICK = 0.018
// v6 gameplay (5): reload "dip" — the view model drops and pulls back while
// reloading so the action reads without a HUD cue. Envelope is sin(π·p) over
// reload progress p: 0 at the start and the end, max at the midpoint, so the
// pose returns to the exact rest value when the reload completes.
const DIP_Y = -0.05, DIP_Z = 0.06
const UP = new THREE.Vector3(0, 1, 0)

export class Shotgun {
  constructor(scene, camera, collision, audio) {
    this.scene = scene
    this.camera = camera
    this.collision = collision
    this.audio = audio
    this.blood = null
    this.getZombies = null
    this.inputState = null
    this.player = null
    this.owner = null // player id for kill attribution (multiplayer); null in solo
    this.magSize = MAG
    this.ammo = MAG
    this.reserve = RESERVE
    this.damage = DMG
    this.pellets = PELLETS
    this.headMultiplier = HEAD_MULT
    this.range = RANGE
    this.spread = SPREAD
    this.reloadTime = RELOAD_TIME
    this.fireInterval = FIRE_INTERVAL
    this.flashTime = FLASH_TIME
    this.recoilKick = RECOIL_KICK
    this.isReloading = false
    this._reloadT = 0
    this._fireT = 0
    this._time = 0
    this._flashT = 0
    this._recoil = 0
    this._bobPhase = 0
    let s = 13
    this._rng = () => (s = (s * 48271) % 65537) / 65537
    this._dir = new THREE.Vector3()
    this._right = new THREE.Vector3()
    this._up = new THREE.Vector3()
    this._pellet = new THREE.Vector3()
    this._hitP = new THREE.Vector3()

    // View model: receiver, barrel, pump, stock — camera-attached.
    this.view = new THREE.Group()
    this.view.position.set(0.26, -0.26, -0.55)
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a3328, roughness: 0.7, metalness: 0.3 })
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x4a5157, roughness: 0.4, metalness: 0.7 })
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.34), bodyMat)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 8), steelMat)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.02, -0.34)
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.14), bodyMat)
    pump.position.set(0, 0, -0.18)
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.16), bodyMat)
    stock.position.set(0, -0.02, 0.28)
    this.view.add(receiver, barrel, pump, stock)

    // Muzzle flash: fading additive sprite + short-lived point light at barrel tip.
    let flashMap = null
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64
      const g = c.getContext('2d')
      const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30)
      grad.addColorStop(0, 'rgba(255, 220, 160, 1)')
      grad.addColorStop(0.4, 'rgba(255, 190, 120, 0.7)')
      grad.addColorStop(1, 'rgba(255, 170, 90, 0)')
      g.fillStyle = grad; g.fillRect(0, 0, 64, 64)
      flashMap = new THREE.CanvasTexture(c)
    }
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffcf8a, map: flashMap, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }))
    this.flash.position.set(0, 0.02, -0.5)
    this.flash.scale.setScalar(0.3)
    this.flash.visible = false
    this.view.add(this.flash)
    this.flashLight = new THREE.PointLight(0xffb878, 0, 8, 2)
    this.flashLight.position.copy(this.flash.position)
    this.view.add(this.flashLight)
    // v6 visuals (6): tier-aware flash peak (see Pistol.setTier).
    this.tier = 'high'
    this._peak = FLASH_PEAK
    this.camera.add(this.view)
    scene.add(this.camera)
  }

  /**
   * v6 visuals (6): quality tier for the muzzle flash. 'low' drops the dynamic
   * point light and halves the sprite peak; the sprite alone still reads and
   * HITMAT-based hit feedback needs no light. Returns the applied tier.
   */
  setTier(q) {
    this.tier = q === 'low' ? 'low' : 'high'
    this._peak = this.tier === 'low' ? FLASH_PEAK_LOW : FLASH_PEAK
    this.flashLight.visible = this.tier !== 'low'
    this.flashLight.intensity = 0
    return this.tier
  }

  /** Per frame: bob/recoil recovery, flash decay, reload progress, input edges. */
  update(dt, player = null) {
    this._time += dt
    if (player) this.player = player
    const sp = this.player ? Math.hypot(this.player.velocity.x, this.player.velocity.z) : 0
    if (sp > 0.5) this._bobPhase += sp * dt * 2.2
    this._recoil = Math.max(0, this._recoil - (dt / RECOIL_DECAY) * RECOIL_KICK)
    // Reload progress runs BEFORE the view write so the completion frame
    // already has isReloading=false and the dip lands on exact rest.
    if (this.isReloading) {
      this._reloadT -= dt
      if (this._reloadT <= 0) {
        this.isReloading = false
        const take = Math.min(this.magSize - this.ammo, this.reserve)
        this.ammo += take
        this.reserve -= take
      }
    }
    const bob = Math.sin(this._bobPhase) * 0.01
    // Reload dip (gameplay 5): deterministic sin(π·p) envelope, no RNG.
    const p = this.isReloading ? Math.min(1, 1 - this._reloadT / RELOAD_TIME) : 0
    const dip = Math.sin(Math.PI * p)
    this.view.position.set(0.26, -0.26 + bob + DIP_Y * dip, -0.55 + this._recoil + DIP_Z * dip)
    if (this._flashT > 0) {
      this._flashT -= dt
      const f = this._flashT > 0 ? this._flashT / FLASH_TIME : 0
      this.flash.material.opacity = FLASH_OPACITY * f
      this.flash.scale.setScalar(0.1 + 0.2 * f)
      this.flashLight.intensity = this._peak * f
      if (this._flashT <= 0) this.flash.visible = false
    }
    if (this.inputState) {
      if (this.inputState.fire) { this.inputState.fire = false; this.shoot() }
      if (this.inputState.reload) { this.inputState.reload = false; this.reload() }
    }
  }

  /** One 6-pellet blast; returns false if not fired (reloading, empty, interval). */
  shoot() {
    if (this.isReloading || this.ammo <= 0 || this._time < this._fireT) { this.audio?.dryFire?.(); return false }
    this.ammo--
    this._fireT = this._time + FIRE_INTERVAL
    this._recoil = RECOIL_KICK
    if (this.player && typeof this.player.addPitchKick === 'function') this.player.addPitchKick(KICK)
    this._flashT = FLASH_TIME
    this.flash.material.opacity = this.tier === 'low' ? FLASH_OPACITY_LOW : FLASH_OPACITY
    this.flash.scale.setScalar(0.3)
    this.flash.visible = true
    this.flashLight.intensity = this._peak
    this.camera.getWorldDirection(this._dir)
    this._right.crossVectors(this._dir, UP)
    if (this._right.lengthSq() < 1e-8) this._right.set(1, 0, 0)
    this._right.normalize()
    this._up.crossVectors(this._right, this._dir).normalize()
    const o = this.camera.position
    const hitSet = [] // distinct zombies hit by this blast
    let headHit = false
    for (let i = 0; i < this.pellets; i++) {
      // Per-pellet jitter around the aim direction (deterministic LCG).
      this._pellet.copy(this._dir)
        .addScaledVector(this._right, (this._rng() * 2 - 1) * SPREAD)
        .addScaledVector(this._up, (this._rng() * 2 - 1) * SPREAD)
        .normalize()
      const wall = this.collision.castRay({ x: o.x, z: o.z, y: o.y }, this._pellet, this.range)
      const wallT = wall ? wall.dist : this.range
      const zombies = this.getZombies ? this.getZombies() : []
      let hitZ = null
      let head = false
      let bestT = Infinity
      for (const z of zombies) {
        if (z.isDead) continue
        for (const hb of z.getHitboxes()) {
          const t = raySphere(o, this._pellet, hb.center, hb.radius)
          if (t !== null && t < bestT && t <= wallT) { bestT = t; hitZ = z; head = hb.isHead }
        }
      }
      if (hitZ) {
        // Boss armor: the brute's hide shrugs off most buckshot (shotgunArmor
        // < 1), so a full blast deals far less than 6×22 — the boss needs many
        // blasts. Regular zombies are unarmored (×1).
        const armor = hitZ.shotgunArmor != null ? hitZ.shotgunArmor : 1
        const dmg = this.damage * (head ? this.headMultiplier : 1) * armor
        this._hitP.copy(o).addScaledVector(this._pellet, bestT)
        this.blood?.burst(this._hitP.x, this._hitP.y, this._hitP.z, dmg, head, this._pellet)
        hitZ.damage(dmg, this._pellet, this.owner, head)
        // Limb damage: a pellet landing near an arm/leg severs it.
        const limb = hitZ.hitLimbAt ? hitZ.hitLimbAt(this._hitP.x, this._hitP.y, this._hitP.z) : null
        if (limb) this.audio?.dismember?.()
        hitZ._lastBlastHits = (hitZ._lastBlastHits || 0) + 1
        if (!hitSet.includes(hitZ)) hitSet.push(hitZ)
        if (head) headHit = true
      } else if (wall) {
        // No zombie absorbed this pellet: break a lamp if the wall was one,
        // otherwise leave a bullet hole on the surface it hit.
        if (!this.lamps?.hitAt(wall.point.x, wall.point.y, wall.point.z)) {
          this.bulletHoles?.spawn(wall.point.x, wall.point.y, wall.point.z, wall.normal)
        }
      }
    }
    // Stagger: a close, multi-pellet hit shoves the target back — the
    // shotgun's crowd-control identity. The push scales with how many pellets
    // landed (a point-blank blast staggers hard; a single grazing pellet
    // barely moves them). The brute's armor resists the shove.
    for (const z of hitSet) {
      const n = z._lastBlastHits || 1
      const armor = z.shotgunArmor != null ? z.shotgunArmor : 1
      // Stagger source: the impact point (falls back to the camera when the
      // target has no world position, e.g. test stand-ins).
      const hb = z.getHitboxes ? z.getHitboxes()[0] : null
      const sx = hb ? hb.center.x : this.camera.position.x
      const sz = hb ? hb.center.z : this.camera.position.z
      const dx = sx - this.camera.position.x
      const dz = sz - this.camera.position.z
      const hd = Math.hypot(dx, dz) || 1
      if (typeof z.knockback === 'function') z.knockback(dx / hd, dz / hd, STAGGER_BASE * Math.min(n, 4) * armor)
      this.audio?.hitZombie?.()
    }
    if (hitSet.length) this.onHit?.(headHit ? 'head' : 'body') // V5P-1: HUD hit marker
    for (const z of hitSet) z._lastBlastHits = 0
    this.audio?.shoot?.()
    if (this.ammo === 0) this.reload()
    return true
  }

  /** Start reloading; refills when update() completes the timer. */
  reload() {
    if (this.isReloading || this.ammo >= this.magSize || this.reserve <= 0) return false
    this.isReloading = true
    this._reloadT = this.reloadTime
    this.audio?.reload?.()
    return true
  }

  reset() {
    this.ammo = this.magSize
    this.reserve = RESERVE
    this.isReloading = false
    this._flashT = 0
    this.flash.material.opacity = this.tier === 'low' ? FLASH_OPACITY_LOW : FLASH_OPACITY
    this.flash.scale.setScalar(0.3)
    this.flash.visible = false
    this.flashLight.intensity = 0
    this._recoil = 0
    this._fireT = this._time
  }

  dispose() {
    this.camera.remove(this.view)
    for (const m of this.view.children) {
      // Guard: flashLight is a PointLight with no geometry/material.
      if (m.geometry && m.material) {
        m.geometry.dispose()
        m.material.dispose()
      }
    }
    // Sprite has no .geometry, so the child loop above skips it: dispose explicitly.
    if (this.flash.material) {
      if (this.flash.material.map) this.flash.material.map.dispose()
      this.flash.material.dispose()
    }
    this.flashLight.dispose()
  }
}
