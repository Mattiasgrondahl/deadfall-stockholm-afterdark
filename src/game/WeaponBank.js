import { Axe } from './Axe.js'
import { Shotgun } from './Shotgun.js'

// WeaponBank — owns the axe and shotgun and manages the current weapon,
// switching with a 0.25 s lockout, per-frame input-edge routing, and view
// model visibility. The HUD-compat getters let the old single-weapon HUD keep
// working until the HUD task reworks it. Headless-safe, deterministic.

const SWAP_TIME = 0.25

export class WeaponBank {
  constructor(scene, camera, collision, audio) {
    this.scene = scene
    this.camera = camera
    this.audio = audio
    this.axe = new Axe(scene, camera, audio)
    this.shotgun = new Shotgun(scene, camera, collision, audio)
    this.axe.name = 'axe'
    this.shotgun.name = 'shotgun'
    this._getZombies = null
    this._inputState = null
    this._swapT = 0
    this.current = this.shotgun
    this.axe.view.visible = false
  }

  get getZombies() { return this._getZombies }
  set getZombies(fn) {
    this._getZombies = fn
    this.axe.getZombies = fn
    this.shotgun.getZombies = fn
  }

  get inputState() { return this._inputState }
  set inputState(st) {
    this._inputState = st
    this.axe.inputState = st
    this.shotgun.inputState = st
  }

  // HUD-compat: the current HUD reads weapon.ammo/reserve/isReloading/magSize.
  get ammo() { return this.current.ammo }
  get reserve() { return this.current.reserve }
  get isReloading() { return this.current.isReloading }
  get magSize() { return this.current.magSize }

  /** Switch weapons; false if same weapon or inside the swap lockout. */
  switchTo(name) {
    const target = name === 'axe' ? this.axe : this.shotgun
    if (!target || target === this.current || this._swapT > 0) return false
    this._swapT = SWAP_TIME
    this.current = target
    target.view.visible = true;
    (target === this.axe ? this.shotgun : this.axe).view.visible = false
    this.audio?.weaponSwitch?.() // voice lands with the audio task; null-safe
    return true
  }

  update(dt, player = null) {
    if (this._swapT > 0) this._swapT = Math.max(0, this._swapT - dt)
    const st = this._inputState
    if (st) {
      if (st.switch1) { st.switch1 = false; this.switchTo('axe') }
      if (st.switch2) { st.switch2 = false; this.switchTo('shotgun') }
    }
    this.current.update(dt, player)
  }

  reset() {
    this.axe.reset()
    this.shotgun.reset()
    this.current = this.shotgun
    this.shotgun.view.visible = true
    this.axe.view.visible = false
    this._swapT = 0
  }

  dispose() {
    this.axe.dispose()
    this.shotgun.dispose()
  }
}
