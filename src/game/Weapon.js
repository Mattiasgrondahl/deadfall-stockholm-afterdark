import * as THREE from 'three'

// Task 9a: rifle — view model, semi-auto fire, reload, headshot multiplier,
// muzzle flash (billboard quad + 40 ms PointLight), recoil + bob.
// Headless-safe: no DOM, no textures. Spread jitter uses a deterministic LCG.

const MAG = 12
const RESERVE = 60
const DMG = 34
const HEAD_MULT = 2
const RANGE = 60
const SPREAD_BASE = 0.015
const SPREAD_MOVE = 0.02
const SPREAD_SPRINT = 0.03
const RELOAD_TIME = 2.2
const FIRE_INTERVAL = 0.12
const RECOIL_KICK = 0.05
const RECOIL_DECAY = 0.15 // seconds to fully recover
const FLASH_TIME = 0.04
const UP = new THREE.Vector3(0, 1, 0)

export class Weapon {
  constructor(scene, camera, collision, audio) {
    this.scene = scene
    this.camera = camera
    this.collision = collision
    this.audio = audio
    this.getZombies = null // wiring: () => game.zombies
    this.inputState = null // wiring: game.inputState (fire/reload edges, sprint)
    this.player = null     // set each frame via update(dt, player)

    this.magSize = MAG
    this.ammo = MAG
    this.reserve = RESERVE
    this.damage = DMG
    this.headMultiplier = HEAD_MULT
    this.range = RANGE
    this.reloadTime = RELOAD_TIME
    this.isReloading = false

    this._reloadT = 0
    this._fireT = 0
    this._time = 0
    this._flashT = 0
    this._recoil = 0
    this._bobPhase = 0
    let s = 7
    this._rng = () => (s = (s * 48271) % 65537) / 65537
    this._dir = new THREE.Vector3()
    this._right = new THREE.Vector3()
    this._up = new THREE.Vector3()

    // View model: procedural rifle attached to the camera.
    this.view = new THREE.Group()
    this.view.position.set(0.26, -0.26, -0.55)
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.6, metalness: 0.4 })
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x4a5157, roughness: 0.4, metalness: 0.7 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.42), bodyMat)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.34, 8), steelMat)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.015, -0.36)
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.07), bodyMat)
    mag.position.set(0, -0.11, 0.05)
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.18), bodyMat)
    stock.position.set(0, -0.01, 0.3)
    this.view.add(body, barrel, mag, stock)

    // Muzzle flash: billboard quad + short-lived point light at barrel tip.
    // No texture (headless-safe); the quad faces the camera because it is a
    // child of the camera-attached view group (plane normal +Z, flash at -Z).
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.28, 0.28),
      new THREE.MeshBasicMaterial({ color: 0xffcf8a, transparent: true, opacity: 0.9 })
    )
    this.flash.position.set(0, 0.015, -0.53)
    this.flash.visible = false
    this.view.add(this.flash)
    this.flashLight = new THREE.PointLight(0xffb878, 0, 8, 2)
    this.flashLight.position.copy(this.flash.position)
    this.view.add(this.flashLight)
    this.camera.add(this.view)
    scene.add(this.camera) // view model renders only if the camera is in the scene graph
  }

  /** One frame: bob/recoil recovery, flash decay, reload progress, input edges. */
  update(dt, player = null) {
    this._time += dt
    if (player) this.player = player
    const sp = this.player ? Math.hypot(this.player.velocity.x, this.player.velocity.z) : 0
    if (sp > 0.5) this._bobPhase += sp * dt * 2.2
    this._recoil = Math.max(0, this._recoil - (dt / RECOIL_DECAY) * RECOIL_KICK)
    const bob = Math.sin(this._bobPhase) * 0.008
    this.view.position.set(0.26, -0.26 + bob, -0.55 + this._recoil)

    if (this._flashT > 0) {
      this._flashT -= dt
      if (this._flashT <= 0) {
        this.flash.visible = false
        this.flashLight.intensity = 0
      }
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

  /** Semi-auto shot. Returns false if not fired (reloading, empty, interval). */
  shoot() {
    if (this.isReloading || this.ammo <= 0 || this._time < this._fireT) return false
    this.ammo--
    this._fireT = this._time + FIRE_INTERVAL
    this._recoil = RECOIL_KICK
    this._flashT = FLASH_TIME
    this.flash.visible = true
    this.flashLight.intensity = 400

    // Ray from the camera with spread jitter (deterministic LCG).
    this.camera.getWorldDirection(this._dir)
    const moving = this.player ? Math.hypot(this.player.velocity.x, this.player.velocity.z) > 0.5 : false
    const sprint = moving && this.inputState && this.inputState.sprint
    const spread = SPREAD_BASE + (moving ? SPREAD_MOVE : 0) + (sprint ? SPREAD_SPRINT : 0)
    this._right.crossVectors(this._dir, UP)
    if (this._right.lengthSq() < 1e-8) this._right.set(1, 0, 0)
    this._right.normalize()
    this._up.crossVectors(this._right, this._dir).normalize()
    this._dir.addScaledVector(this._right, (this._rng() * 2 - 1) * spread)
      .addScaledVector(this._up, (this._rng() * 2 - 1) * spread)
      .normalize()

    // Wall occlusion (2D xz ray against collision AABBs + world bounds).
    const o = this.camera.position
    const wall = this.collision.castRay({ x: o.x, z: o.z }, this._dir, this.range)
    const wallT = wall ? wall.dist : this.range

    // Nearest zombie hitbox hit, strictly before the wall hit.
    const zombies = this.getZombies ? this.getZombies() : []
    let hitZ = null
    let head = false
    let bestT = Infinity
    for (const z of zombies) {
      if (z.isDead) continue
      for (const hb of z.getHitboxes()) {
        const t = raySphere(o, this._dir, hb.center, hb.radius)
        if (t !== null && t < bestT && t <= wallT) {
          bestT = t; hitZ = z; head = hb.isHead
        }
      }
    }
    if (hitZ) {
      hitZ.damage(this.damage * (head ? this.headMultiplier : 1), this._dir)
      this.audio?.hitZombie?.()
    }
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
    this.flashLight.dispose()
  }
}

/** Nearest forward ray-sphere hit parameter, or null if no hit. */
function raySphere(origin, dir, center, radius) {
  const ox = origin.x - center.x
  const oy = origin.y - center.y
  const oz = origin.z - center.z
  const b = ox * dir.x + oy * dir.y + oz * dir.z
  const c = ox * ox + oy * oy + oz * oz - radius * radius
  const disc = b * b - c
  if (disc < 0) return null
  const t = -b - Math.sqrt(disc)
  return t > 1e-6 ? t : null
}
