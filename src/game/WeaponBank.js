import { Axe } from './Axe.js'
import { Shotgun } from './Shotgun.js'
import { Pistol } from './Pistol.js'
import { Sword } from './Sword.js'

// WeaponBank — owns the four weapons (axe, shotgun, pistol, sword) and
// manages the current weapon, switching with a 0.25 s lockout, per-frame
// input-edge routing (switch1..switch4), and view model visibility. The
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
    this.axe.name = 'axe'
    this.shotgun.name = 'shotgun'
    this.pistol.name = 'pistol'
    this.sword.name = 'sword'
    this._getZombies = null
    this._inputState = null
    this._onHit = null
    this._onDecapitate = null
    this._owner = null
    this._swapT = 0
    this.current = this.shotgun
    // Only the current weapon's view model is visible.
    this.axe.view.visible = false
    this.pistol.view.visible = false
    this.sword.view.visible = false
  }

  get getZombies() { return this._getZombies }
  set getZombies(fn) {
    this._getZombies = fn
    this.axe.getZombies = fn
    this.shotgun.getZombies = fn
    this.pistol.getZombies = fn
    this.sword.getZombies = fn
  }

  get inputState() { return this._inputState }
  set inputState(st) {
    this._inputState = st
    this.axe.inputState = st
    this.shotgun.inputState = st
    this.pistol.inputState = st
    this.sword.inputState = st
  }

  // Hit callback forwarded to all weapons; Game wires it to the HUD.
  get onHit() { return this._onHit }
  set onHit(fn) {
    this._onHit = fn
    this.axe.onHit = fn
    this.shotgun.onHit = fn
    this.pistol.onHit = fn
    this.sword.onHit = fn
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
      name === 'sword' ? this.sword : null
    if (!target || target === this.current || this._swapT > 0) return false
    this._swapT = SWAP_TIME
    this.current = target
    for (const w of [this.axe, this.shotgun, this.pistol, this.sword]) {
      w.view.visible = (w === target)
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
      default: return this.shotgun.reload()
    }
  }

  update(dt, player = null) {
    if (this._swapT > 0) this._swapT = Math.max(0, this._swapT - dt)
    const st = this._inputState
    if (st) {
      if (st.switch1) { st.switch1 = false; this.switchTo('axe') }
      if (st.switch2) { st.switch2 = false; this.switchTo('shotgun') }
      if (st.switch3) { st.switch3 = false; this.switchTo('pistol') }
      if (st.switch4) { st.switch4 = false; this.switchTo('sword') }
    }
    this.current.update(dt, player)
  }

  reset() {
    this.axe.reset()
    this.shotgun.reset()
    this.pistol.reset()
    this.sword.reset()
    this.current = this.shotgun
    for (const w of [this.axe, this.shotgun, this.pistol, this.sword]) {
      w.view.visible = (w === this.shotgun)
    }
    this._swapT = 0
  }

  dispose() {
    this.axe.dispose()
    this.shotgun.dispose()
    this.pistol.dispose()
    this.sword.dispose()
  }
}
