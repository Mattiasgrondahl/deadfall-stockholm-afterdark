import * as THREE from 'three'
import { raySphere } from './ray.js'

// Pistol: semi-automatic sidearm; one trigger pull = one round (own jitter,
// wall occlusion, nearest-zombie hit). Fast fire, small spread, long range.
// A fatal head hit fires the optional onDecapitate callback (Task E wires the
// rolling-head pool to it). Mirrors the WeaponBank surface (update/shoot/
// reload/reset/dispose, getZombies/inputState/blood/onHit).
// Headless-safe; no Math.random (LCG seed 29, distinct from the shotgun's 13).

const MAG = 12, RESERVE = 36, DMG = 26
const HEAD_MULT = 2, RANGE = 24, SPREAD = 0.03
const RELOAD_TIME = 1.1, FIRE_INTERVAL = 0.28
const FLASH_TIME = 0.05, RECOIL_KICK = 0.02, RECOIL_DECAY = 0.12
const KICK = 0.012
const UP = new THREE.Vector3(0, 1, 0)

export class Pistol {
  constructor(scene, camera, collision, audio) {
    this.scene = scene
    this.camera = camera
    this.collision = collision
    this.audio = audio
    this.blood = null
    this.getZombies = null
    this.inputState = null
    this.player = null
    this.magSize = MAG
    this.ammo = MAG
    this.reserve = RESERVE
    this.damage = DMG
    this.headMultiplier = HEAD_MULT
    this.range = RANGE
    this.spread = SPREAD
    this.reloadTime = RELOAD_TIME
    this.fireInterval = FIRE_INTERVAL
    this.flashTime = FLASH_TIME
    this.recoilKick = RECOIL_KICK
    this.isReloading = false
    this.onDecapitate = null // (zombie, dir) -> Task E rolling-head pool
    this.owner = null // player id for kill attribution (multiplayer); null in solo
    this._reloadT = 0
    this._fireT = 0
    this._time = 0
    this._flashT = 0
    this._recoil = 0
    this._bobPhase = 0
    let s = 29
    this._rng = () => (s = (s * 48271) % 65537) / 65537
    this._dir = new THREE.Vector3()
    this._right = new THREE.Vector3()
    this._up = new THREE.Vector3()
    this._shot = new THREE.Vector3()
    this._hitP = new THREE.Vector3()

    // View model: slide, frame, barrel, grip — camera-attached.
    this.view = new THREE.Group()
    this.view.position.set(0.2, -0.24, -0.55)
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2e3033, roughness: 0.5, metalness: 0.6 })
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x4a5157, roughness: 0.4, metalness: 0.7 })
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.3), bodyMat)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.3), bodyMat)
    frame.position.set(0, -0.04, 0)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 8), steelMat)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0, -0.19)
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.08), bodyMat)
    grip.position.set(0, -0.09, 0.12)
    grip.rotation.x = 0.25
    this.view.add(slide, frame, barrel, grip)

    // Muzzle flash: fading additive sprite + short-lived point light at barrel tip.
    let flashMap = null
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64
      const g = c.getContext('2d')
      const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30)
      grad.addColorStop(0, 'rgba(255, 230, 180, 1)')
      grad.addColorStop(0.4, 'rgba(255, 200, 130, 0.7)')
      grad.addColorStop(1, 'rgba(255, 180, 100, 0)')
      g.fillStyle = grad; g.fillRect(0, 0, 64, 64)
      flashMap = new THREE.CanvasTexture(c)
    }
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd9a0, map: flashMap, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }))
    this.flash.position.set(0, 0, -0.26)
    this.flash.scale.setScalar(0.2)
    this.flash.visible = false
    this.view.add(this.flash)
    this.flashLight = new THREE.PointLight(0xffc988, 0, 6, 2)
    this.flashLight.position.copy(this.flash.position)
    this.view.add(this.flashLight)
    this.camera.add(this.view)
    scene.add(this.camera)
  }

  /** Per frame: bob/recoil recovery, flash decay, reload progress, input edges. */
  update(dt, player = null) {
    this._time += dt
    if (player) this.player = player
    const sp = this.player ? Math.hypot(this.player.velocity.x, this.player.velocity.z) : 0
    if (sp > 0.5) this._bobPhase += sp * dt * 2.2
    this._recoil = Math.max(0, this._recoil - (dt / RECOIL_DECAY) * RECOIL_KICK)
    const bob = Math.sin(this._bobPhase) * 0.008
    this.view.position.set(0.2, -0.24 + bob, -0.55 + this._recoil)
    if (this._flashT > 0) {
      this._flashT -= dt
      const f = this._flashT > 0 ? this._flashT / FLASH_TIME : 0
      this.flash.material.opacity = 0.9 * f
      this.flash.scale.setScalar(0.08 + 0.12 * f)
      this.flashLight.intensity = 300 * f
      if (this._flashT <= 0) this.flash.visible = false
    }
    if (this.isReloading) {
      this._reloadT -= dt
      if (this._reloadT <= 0) {
        this.isReloading = false
        const take = Math.min(this.magSize - this.ammo, this.reserve)
        this.ammo += take
        this.reserve -= take
      }
    }
    if (this.inputState) {
      if (this.inputState.fire) { this.inputState.fire = false; this.shoot() }
      if (this.inputState.reload) { this.inputState.reload = false; this.reload() }
    }
  }

  /** One round; returns false if not fired (reloading, empty, interval). */
  shoot() {
    if (this.isReloading || this.ammo <= 0 || this._time < this._fireT) { this.audio?.dryFire?.(); return false }
    this.ammo--
    this._fireT = this._time + FIRE_INTERVAL
    this._recoil = RECOIL_KICK
    if (this.player && typeof this.player.addPitchKick === 'function') this.player.addPitchKick(KICK)
    this._flashT = FLASH_TIME
    this.flash.material.opacity = 0.9
    this.flash.scale.setScalar(0.2)
    this.flash.visible = true
    this.flashLight.intensity = 300
    this.camera.getWorldDirection(this._dir)
    this._right.crossVectors(this._dir, UP)
    if (this._right.lengthSq() < 1e-8) this._right.set(1, 0, 0)
    this._right.normalize()
    this._up.crossVectors(this._right, this._dir).normalize()
    const o = this.camera.position
    // Single round with its own jitter (deterministic LCG).
    this._shot.copy(this._dir)
      .addScaledVector(this._right, (this._rng() * 2 - 1) * SPREAD)
      .addScaledVector(this._up, (this._rng() * 2 - 1) * SPREAD)
      .normalize()
    const wall = this.collision.castRay({ x: o.x, z: o.z }, this._shot, this.range)
    const wallT = wall ? wall.dist : this.range
    const zombies = this.getZombies ? this.getZombies() : []
    let hitZ = null
    let head = false
    let bestT = Infinity
    for (const z of zombies) {
      if (z.isDead) continue
      for (const hb of z.getHitboxes()) {
        const t = raySphere(o, this._shot, hb.center, hb.radius)
        if (t !== null && t < bestT && t <= wallT) { bestT = t; hitZ = z; head = hb.isHead }
      }
    }
    if (hitZ) {
      const dmg = this.damage * (head ? this.headMultiplier : 1)
      this._hitP.copy(o).addScaledVector(this._shot, bestT)
      this.blood?.burst(this._hitP.x, this._hitP.y, this._hitP.z, dmg, head)
      hitZ.damage(dmg, this._shot, this.owner)
      if (head && hitZ.isDead) this.onDecapitate?.(hitZ, this._shot) // fatal headshot
      this.audio?.hitZombie?.()
      this.onHit?.() // HUD hit marker
    }
    this.audio?.pistolShot?.() // voice lands with the audio task; null-safe
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
    this.flash.material.opacity = 0.9
    this.flash.scale.setScalar(0.2)
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
