import * as THREE from 'three'
import { raySphere } from './ray.js'

// Sniper: bolt-action long-range rifle. One trigger pull = one high-damage
// round (kills a regular zombie in one body shot, ~1/3 of the boss). Holding
// right mouse (or Q) zooms the camera into a scope (FOV 75 -> 18) for precise
// far shots; releasing returns to the normal view. Mirrors the WeaponBank
// surface (update/shoot/reload/reset/dispose, getZombies/inputState/blood/
// onHit/lamps/bulletHoles). Headless-safe; no Math.random (LCG seed 41).
//
// The rifle body carries a skin texture (assets/weapons/sniper.jpg) loaded in
// the browser only; headless keeps a flat wood/steel material.

// v27: DMG 90→100 so the sniper still drops a normal zombie in ONE body shot
// now that walker HP doubled to 100 (the sniper is the anti-boss weapon and is
// meant to one-shot regular zombies). Headshots are instant kills regardless.
const MAG = 5, RESERVE = 20, DMG = 100
const HEAD_MULT = 2, RANGE = 80, SPREAD = 0.004
const RELOAD_TIME = 1.6, FIRE_INTERVAL = 1.1
const FLASH_TIME = 0.06, RECOIL_KICK = 0.05, RECOIL_DECAY = 0.18
const KICK = 0.03
const SCOPE_FOV = 18, NORMAL_FOV = 75, SCOPE_LERP = 220 // deg/s toward the target FOV (snappy ~0.3 s)
const UP = new THREE.Vector3(0, 1, 0)

export class Sniper {
  constructor(scene, camera, collision, audio) {
    this.scene = scene
    this.camera = camera
    this.collision = collision
    this.audio = audio
    this.blood = null
    this.bulletHoles = null
    this.lamps = null
    this.getZombies = null
    this.inputState = null
    this.player = null
    this.name = 'sniper'
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
    this.scoped = false
    this._reloadT = 0
    this._fireT = 0
    this._time = 0
    this._flashT = 0
    this._recoil = 0
    this._bobPhase = 0
    this._fov = NORMAL_FOV
    this._baseFov = NORMAL_FOV
    let s = 41
    this._rng = () => (s = (s * 48271) % 65537) / 65537
    this._dir = new THREE.Vector3()
    this._right = new THREE.Vector3()
    this._up = new THREE.Vector3()
    this._shot = new THREE.Vector3()
    this._hitP = new THREE.Vector3()

    // View model: a single wooden stock+receiver box that carries the rifle skin —
    // camera-attached. Deliberately ONE mesh so adding the sniper as a fifth
    // weapon keeps the whole scene inside the 600-mesh budget.
    this.view = new THREE.Group()
    this.view.position.set(0.22, -0.22, -0.6)
    // v6 look (weapons): the AI sniper.jpg photo skin read as a flat decal, so it
    // is dropped and the stock/receiver is flat DARK GUNMETAL metal (the wood
    // look is gone; the variable name stays `woodMat` to avoid touching refs).
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.45, metalness: 0.8 })
    // Receiver/stock box carries the rifle skin (loaded in the browser).
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.9), woodMat)
    stock.position.set(0, 0, -0.2)
    this.view.add(stock)
    this._skinMat = woodMat
    this._skinLoaded = false

    // No muzzle-flash sprite/light: the bolt-action report is carried by the
    // audio voice, and dropping the flash keeps the scene inside the mesh and
    // light budgets with the sniper as a fifth weapon.
    // v4 VISUALS (B3): muzzle-flash sprite + short point light at the muzzle.
    // A Sprite is not a mesh (no mesh-budget cost) and the light is within the
    // 40-light budget. Headless keeps no sprite (no document); the report is
    // still carried by the audio voice.
    let flashMap = null
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64
      const g = c.getContext('2d')
      const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30)
      grad.addColorStop(0, 'rgba(255, 236, 190, 1)')
      grad.addColorStop(0.4, 'rgba(255, 205, 140, 0.7)')
      grad.addColorStop(1, 'rgba(255, 185, 110, 0)')
      g.fillStyle = grad; g.fillRect(0, 0, 64, 64)
      flashMap = new THREE.CanvasTexture(c)
    }
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd9a0, map: flashMap, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }))
    this.flash.position.set(0, 0.02, -0.68)
    this.flash.scale.setScalar(0.24)
    this.flash.visible = false
    this.view.add(this.flash)
    this.flashLight = new THREE.PointLight(0xffc988, 0, 7, 2)
    this.flashLight.position.copy(this.flash.position)
    this.view.add(this.flashLight)
    this.camera.add(this.view)
    scene.add(this.camera)
    this._loadSkin()
  }

  // v6 look (weapons): no-op. The photo skin is dropped — the stock material is
  // flat dark gunmetal metal now, so no texture is ever loaded onto _skinMat.
  // The method and its headless guard stay so callers and dispose() are unchanged.
  _loadSkin() {
    return // weapon skins switched to flat dark gunmetal; photo overlay dropped
    if (typeof document === 'undefined') return
    const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL)
      ? (import.meta.env.BASE_URL.replace(/\/$/, '') + '/') : ''
    const loader = new THREE.TextureLoader()
    loader.load(base + 'assets/weapons/sniper.jpg', (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 4
      this._skinMat.color.set(0xffffff)
      this._skinMat.map = tex
      this._skinMat.needsUpdate = true
      this._skinLoaded = true
    }, undefined, () => { /* keep flat wood */ })
  }

  /** Per frame: recoil recovery, flash decay, reload, scope FOV, input edges. */
  update(dt, player = null) {
    this._time += dt
    if (player) this.player = player
    const sp = this.player ? Math.hypot(this.player.velocity.x, this.player.velocity.z) : 0
    if (sp > 0.5) this._bobPhase += sp * dt * 2.2
    this._recoil = Math.max(0, this._recoil - (dt / RECOIL_DECAY) * RECOIL_KICK)
    const bob = Math.sin(this._bobPhase) * 0.006
    // When scoped, pull the view model aside so it doesn't block the scope.
    const scoped = !!(this.inputState && this.inputState.zoom)
    this.scoped = scoped
    const vx = scoped ? 0.0 : 0.22
    const vy = scoped ? -0.5 : -0.22 + bob
    this.view.position.set(vx, vy, -0.6 + this._recoil)
    this.view.visible = !scoped
    // v4 VISUALS (B3): muzzle-flash sprite + light decay over FLASH_TIME.
    if (this._flashT > 0) {
      this._flashT -= dt
      const f = this._flashT > 0 ? this._flashT / FLASH_TIME : 0
      this.flash.material.opacity = 0.95 * f
      this.flash.scale.setScalar(0.1 + 0.16 * f)
      this.flashLight.intensity = 260 * f
      if (this._flashT <= 0) { this.flash.visible = false; this.flashLight.intensity = 0 }
    }
    // Ease the camera FOV toward the scoped/normal target (deterministic).
    const target = scoped ? SCOPE_FOV : this._baseFov
    const step = SCOPE_LERP * dt
    if (this._fov < target) this._fov = Math.min(target, this._fov + step)
    else if (this._fov > target) this._fov = Math.max(target, this._fov - step)
    if (Math.abs(this.camera.fov - this._fov) > 1e-4) {
      this.camera.fov = this._fov
      this.camera.updateProjectionMatrix()
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
    // v25: notify the owner (server) that a round actually left the barrel so
    // co-op can show a muzzle flash on this player's remote avatar.
    this.onFire?.(this.name)
    this.flash.visible = true
    this.camera.getWorldDirection(this._dir)
    this._right.crossVectors(this._dir, UP)
    if (this._right.lengthSq() < 1e-8) this._right.set(1, 0, 0)
    this._right.normalize()
    this._up.crossVectors(this._right, this._dir).normalize()
    const o = this.camera.position
    this._shot.copy(this._dir)
      .addScaledVector(this._right, (this._rng() * 2 - 1) * SPREAD)
      .addScaledVector(this._up, (this._rng() * 2 - 1) * SPREAD)
      .normalize()
    const wall = this.collision.castRay({ x: o.x, z: o.z, y: o.y }, this._shot, this.range)
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
      this.blood?.burst(this._hitP.x, this._hitP.y, this._hitP.z, dmg, head, this._shot)
      // v3 chain (round-60 order, same as Pistol): sever first, then count
      // the landed round, then apply damage — so a body round that lands as
      // the 4th resolves as the chain kill instead of dying to HP drain
      // first. The sniper's 90 damage usually kills before the chain
      // matters, but the ordering keeps the chain contract identical across
      // weapons.
      // v3 chain: a headshot bypasses the chain — no limb sever on head hits.
      if (!head) {
        const limb = hitZ.hitLimbAt ? hitZ.hitLimbAt(this._hitP.x, this._hitP.y, this._hitP.z) : null
        if (limb) this.audio?.dismember?.()
      }
      // v3 gameplay (2): a body round advances the dismemberment chain once.
      // The sniper's 90 damage usually kills before the chain resolves, which
      // is fine — the chain only ever severs or finishes off what is left.
      if (!head && !hitZ.isDead && typeof hitZ._chainShot === 'function') hitZ._chainShot(1)
      hitZ.damage(dmg, this._shot, this.owner, head)
      if (head && hitZ.isDead) this.onDecapitate?.(hitZ, this._shot)
      this.audio?.hitZombie?.()
      this.onHit?.(head ? 'head' : 'body') // HUD hit marker (headshot variant)
    } else if (wall) {
      if (!this.lamps?.hitAt(wall.point.x, wall.point.y, wall.point.z)) {
        if (!this.windows?.hitAt(wall.point.x, wall.point.y, wall.point.z)) {
          this.bulletHoles?.spawn(wall.point.x, wall.point.y, wall.point.z, wall.normal)
        }
      }
    }
    this.audio?.sniperShot?.()
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

  /** Set the un-scoped base FOV (degrees, from Settings). Clamped to the
   *  sniper's sane range; the scope FOV (18) is unaffected. */
  setBaseFov(deg) {
    const d = Number(deg)
    if (!Number.isFinite(d)) return
    this._baseFov = Math.max(60, Math.min(100, d))
    if (!this.scoped && Math.abs(this.camera.fov - this._baseFov) > 1e-4) {
      this.camera.fov = this._baseFov
      this.camera.updateProjectionMatrix()
    }
  }

  reset() {
    this.ammo = this.magSize
    this.reserve = RESERVE
    this.isReloading = false
    this._flashT = 0
    this._recoil = 0
    this._fireT = this._time
    this.scoped = false
    if (this.flash) { this.flash.visible = false; this.flash.material.opacity = 0 }
    if (this.flashLight) this.flashLight.intensity = 0
    this._fov = this._baseFov
    if (Math.abs(this.camera.fov - this._baseFov) > 1e-4) {
      this.camera.fov = this._baseFov
      this.camera.updateProjectionMatrix()
    }
  }

  dispose() {
    this.camera.remove(this.view)
    for (const m of this.view.children) {
      if (m.geometry && m.material) {
        m.geometry.dispose()
        if (m.material.map) m.material.map.dispose()
        m.material.dispose()
      }
    }
    // v4 VISUALS (B3): the muzzle-flash sprite shares the view group but is a
    // Sprite (no geometry) — free its material + map explicitly.
    if (this.flash) {
      if (this.flash.material.map) this.flash.material.map.dispose()
      this.flash.material.dispose()
    }
  }
}