import { Axe } from './Axe.js'
import { Shotgun } from './Shotgun.js'
import { Pistol } from './Pistol.js'
import { Sword } from './Sword.js'
import { Sniper } from './Sniper.js'

// WeaponBank — owns the five weapons (axe, shotgun, pistol, sword, sniper) and
// manages the current weapon, switching with a 0.25 s lockout, per-frame
// input-edge routing (switch1..switch5), and view model visibility. The
// HUD-compat getters let the HUD read the current weapon's ammo state.
// Headless-safe, deterministic.

const SWAP_TIME = 0.25

export class WeaponBank {
  constructor(scene, camera, collision, audio) {
    this.scene = scene
    this.camera = camera
    this.audio = audio
    this.axe = new Axe(scene, camera, audio)
    this.shotgun = new Shotgun(scene, camera, collision, audio)
    this.pistol = new Pistol(scene, camera, collision, audio)
    this.sword = new Sword(scene, camera, audio)
    this.sniper = new Sniper(scene, camera, collision, audio)
    this.axe.name = 'axe'
    this.shotgun.name = 'shotgun'
    this.pistol.name = 'pistol'
    this.sword.name = 'sword'
    this.sniper.name = 'sniper'
    this._getZombies = null
    this._inputState = null
    this._onHit = null
    this._onDecapitate = null
    this._owner = null
    this._swapT = 0
    this._swapFrom = null
    this.current = this.shotgun
    // Only the current weapon's view model is visible.
    this.axe.view.visible = false
    this.pistol.view.visible = false
    this.sword.view.visible = false
    this.sniper.view.visible = false
  }

  /**
   * v6 visuals (6): forward the quality tier to the two weapons that own a
   * muzzle-flash light (shotgun, pistol). 'low' drops their dynamic point
   * lights and dims the sprite; axe/sword/sniper have no flash light, so the
   * tier is a no-op for them. Returns the applied tier.
   */
  setTier(q) {
    this.shotgun.setTier(q)
    this.pistol.setTier(q)
    return q === 'low' ? 'low' : 'high'
  }

  get getZombies() { return this._getZombies }
  set getZombies(fn) {
    this._getZombies = fn
    this.axe.getZombies = fn
    this.shotgun.getZombies = fn
    this.pistol.getZombies = fn
    this.sword.getZombies = fn
    this.sniper.getZombies = fn
  }

  get inputState() { return this._inputState }
  set inputState(st) {
    this._inputState = st
    this.axe.inputState = st
    this.shotgun.inputState = st
    this.pistol.inputState = st
    this.sword.inputState = st
    this.sniper.inputState = st
  }

  // Hit callback forwarded to all weapons; Game wires it to the HUD.
  get onHit() { return this._onHit }
  set onHit(fn) {
    this._onHit = fn
    this.axe.onHit = fn
    this.shotgun.onHit = fn
    this.pistol.onHit = fn
    this.sword.onHit = fn
    this.sniper.onHit = fn
  }

  // v25: confirmed-shot callback forwarded to all weapons. The server wires it to
  // a `shoot` snapshot event so teammates see a muzzle flash / swing on this
  // player's remote avatar. `fn(name)` receives the weapon name that fired.
  get onFire() { return this._onFire }
  set onFire(fn) {
    this._onFire = fn
    this.axe.onFire = fn
    this.shotgun.onFire = fn
    this.pistol.onFire = fn
    this.sword.onFire = fn
    this.sniper.onFire = fn
  }

  // Fatal-headshot callback forwarded to all weapons; Game wires it to the
  // DecapitatedHeadPool (Task E).
  get onDecapitate() { return this._onDecapitate }
  set onDecapitate(fn) {
    this._onDecapitate = fn
    this.axe.onDecapitate = fn
    this.shotgun.onDecapitate = fn
    this.pistol.onDecapitate = fn
    this.sword.onDecapitate = fn
    this.sniper.onDecapitate = fn
  }

  // Owner player id, forwarded to all weapons so their hits can be attributed
  // to a killer (multiplayer kill credit). null in solo play.
  get owner() { return this._owner }
  set owner(id) {
    this._owner = id
    this.axe.owner = id
    this.shotgun.owner = id
    this.pistol.owner = id
    this.sword.owner = id
    this.sniper.owner = id
  }

  // HUD-compat: the HUD reads weapon.ammo/reserve/isReloading/magSize.
  get ammo() { return this.current.ammo }
  get reserve() { return this.current.reserve }
  get isReloading() { return this.current.isReloading }
  get magSize() { return this.current.magSize }

  /** Switch weapons; false if same weapon or inside the swap lockout. */
  switchTo(name) {
    const target =
      name === 'axe' ? this.axe :
      name === 'shotgun' ? this.shotgun :
      name === 'pistol' ? this.pistol :
      name === 'sword' ? this.sword :
      name === 'sniper' ? this.sniper : null
    if (!target || target === this.current || this._swapT > 0) return false
    this._swapT = SWAP_TIME
    this._swapFrom = this.current
    this.current = target
    // During the swap both the outgoing and incoming views stay visible so the
    // change reads as a raise/lower instead of a hard visibility pop. The
    // incoming view scales up from 0 and the outgoing scales down across
    // SWAP_TIME (scale is owned here; each weapon's update() owns position/
    // rotation, so there is no conflict). Deterministic, no allocation.
    for (const w of [this.axe, this.shotgun, this.pistol, this.sword, this.sniper]) {
      w.view.visible = (w === target || w === this._swapFrom)
      if (w === target) w.view.scale.setScalar(0.001)
    }
    this.audio?.weaponSwitch?.() // voice lands with the audio task; null-safe
    return true
  }

  /** Fire the current weapon once (debug/harness convenience; live game input
    * routes through inputState.fire in update()). Returns whether it fired. */
  shoot() {
    switch (this.current) {
      case this.axe: return this.axe.swing()
      case this.sword: return this.sword.swing()
      case this.pistol: return this.pistol.shoot()
      case this.sniper: return this.sniper.shoot()
      default: return this.shotgun.shoot()
    }
  }

  /** Reload the current weapon (harness/debug entry; live input uses the
    * reload edge). The axe and sword have no magazine: reload is a no-op
    * success. */
  reload() {
    switch (this.current) {
      case this.axe: return true
      case this.sword: return true
      case this.pistol: return this.pistol.reload()
      case this.sniper: return this.sniper.reload()
      default: return this.shotgun.reload()
    }
  }

  update(dt, player = null) {
    if (this._swapT > 0) {
      this._swapT = Math.max(0, this._swapT - dt)
      // Ease the incoming view up and the outgoing view down over the swap.
      const t = 1 - this._swapT / SWAP_TIME // 0..1 across the swap
      const e = t * t * (3 - 2 * t) // smoothstep
      if (this._swapFrom) this._swapFrom.view.scale.setScalar(Math.max(0.001, 1 - e))
      this.current.view.scale.setScalar(Math.max(0.001, e))
      if (this._swapT === 0) {
        // Swap finished: hide the outgoing view, snap the incoming to full size.
        if (this._swapFrom) {
          this._swapFrom.view.visible = false
          this._swapFrom.view.scale.setScalar(1)
        }
        this.current.view.scale.setScalar(1)
        this._swapFrom = null
      }
    }
    const st = this._inputState
    if (st) {
      if (st.switch1) { st.switch1 = false; this.switchTo('axe') }
      if (st.switch2) { st.switch2 = false; this.switchTo('shotgun') }
      if (st.switch3) { st.switch3 = false; this.switchTo('pistol') }
      if (st.switch4) { st.switch4 = false; this.switchTo('sword') }
      if (st.switch5) { st.switch5 = false; this.switchTo('sniper') }
      // v3: mouse-wheel weapon cycling. Scroll down advances to the next weapon
      // in the bank order; scroll up goes to the previous one.
      if (st.scrollDown) { st.scrollDown = false; this.cycle(1) }
      if (st.scrollUp) { st.scrollUp = false; this.cycle(-1) }
    }
    this.current.update(dt, player)
  }

  /** Cycle to the next (dir=+1) or previous (dir=-1) weapon in the bank order,
   *  wrapping around. Respects the swap lockout via switchTo. */
  cycle(dir) {
    const order = [this.axe, this.shotgun, this.pistol, this.sword, this.sniper]
    const i = order.indexOf(this.current)
    if (i < 0) return false
    const next = order[((i + dir) % order.length + order.length) % order.length]
    return this.switchTo(next.name)
  }

  reset() {
    this.axe.reset()
    this.shotgun.reset()
    this.pistol.reset()
    this.sword.reset()
    this.sniper.reset()
    this.current = this.shotgun
    for (const w of [this.axe, this.shotgun, this.pistol, this.sword, this.sniper]) {
      w.view.visible = (w === this.shotgun)
    }
    this._swapT = 0
    this._swapFrom = null
    for (const w of [this.axe, this.shotgun, this.pistol, this.sword, this.sniper]) {
      w.view.scale.setScalar(1)
    }
  }

  dispose() {
    this.axe.dispose()
    this.shotgun.dispose()
    this.pistol.dispose()
    this.sword.dispose()
    this.sniper.dispose()
  }
}