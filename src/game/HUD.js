// HUD.js — in-game heads-up display (health, stamina, wave, ammo, reload,
// crosshair) plus damage vignette / low-health pulse FX. Browser-only: headless
// runs never construct it (Game.js guards with `if (this.env.document)`).
// All DOM is created once in the constructor via document.createElement
// (no innerHTML); update() only mutates style/text and toggles classes, so
// there is no per-frame node creation. `document` is read from the root
// element's ownerDocument, so the module stays DOM-free at import time.

export class HUD {
  constructor(hudRoot, fxRoot) {
    this._doc = hudRoot.ownerDocument
    this._hudRoot = hudRoot
    this._fxRoot = fxRoot
    this._lastHealth = null
    this._vignetteT = 0
    this._lastNow = this._now()
    this._build()
  }

  _now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
  }

  _build() {
    const d = this._doc

    // Health (bottom-left in CSS)
    const health = d.createElement('div'); health.className = 'hud-health'
    const hLabel = d.createElement('div'); hLabel.className = 'hud-label'; hLabel.textContent = 'Health'
    const hBar = d.createElement('div'); hBar.className = 'bar'
    this._healthFill = d.createElement('div'); this._healthFill.className = 'bar-fill'
    hBar.appendChild(this._healthFill)
    this._healthValue = d.createElement('div'); this._healthValue.className = 'hud-value'; this._healthValue.textContent = '100'
    health.appendChild(hLabel); health.appendChild(hBar); health.appendChild(this._healthValue)
    this._healthBox = health
    this._hudRoot.appendChild(health)

    // Stamina
    const stamina = d.createElement('div'); stamina.className = 'hud-stamina'
    const sLabel = d.createElement('div'); sLabel.className = 'hud-label'; sLabel.textContent = 'Stamina'
    const sBar = d.createElement('div'); sBar.className = 'bar'
    this._staminaFill = d.createElement('div'); this._staminaFill.className = 'bar-fill'
    sBar.appendChild(this._staminaFill)
    stamina.appendChild(sLabel); stamina.appendChild(sBar)
    this._hudRoot.appendChild(stamina)

    // Wave + remaining (top-center)
    const wave = d.createElement('div'); wave.className = 'hud-wave'
    this._waveValue = d.createElement('div'); this._waveValue.className = 'hud-value'; this._waveValue.textContent = 'WAVE 1'
    wave.appendChild(this._waveValue)
    this._hudRoot.appendChild(wave)
    this._threat = d.createElement('div'); this._threat.className = 'hud-threat'; this._threat.textContent = 'left: 0'
    this._hudRoot.appendChild(this._threat)

    // Ammo + reload (bottom-right)
    const ammo = d.createElement('div'); ammo.className = 'hud-ammo'
    this._ammoValue = d.createElement('div'); this._ammoValue.className = 'hud-value'; this._ammoValue.textContent = '0 / 0'
    const reload = d.createElement('div'); reload.className = 'hud-reload'
    this._reloadText = d.createElement('span'); this._reloadText.textContent = 'RELOADING…'
    reload.appendChild(this._reloadText)
    ammo.appendChild(this._ammoValue); ammo.appendChild(reload)
    this._ammoBox = ammo
    this._hudRoot.appendChild(ammo)

    // Crosshair (static; spread FX deferred)
    const ch = d.createElement('div'); ch.className = 'crosshair'
    const dot = d.createElement('div'); dot.className = 'ch-dot'
    for (const b of ['top', 'bottom', 'left', 'right']) {
      const bar = d.createElement('div'); bar.className = 'ch-bar ' + b; ch.appendChild(bar)
    }
    ch.appendChild(dot)
    this._hudRoot.appendChild(ch)

    // FX layer: damage vignette + low-health pulse
    this._vignette = d.createElement('div'); this._vignette.className = 'fx-damage'
    this._fxRoot.appendChild(this._vignette)
    this._lowHealth = d.createElement('div'); this._lowHealth.className = 'fx-lowhealth'
    this._fxRoot.appendChild(this._lowHealth)
  }

  update(player, weapon, waveManager) {
    // Each arg is null-checked; a missing arg is a no-op for that section.
    const dt = Math.max(0, (this._now() - this._lastNow) / 1000)
    this._lastNow = this._now()

    if (player) {
      const maxH = player.maxHealth || 1
      const pct = Math.max(0, Math.min(1, player.health / maxH))
      this._healthFill.style.width = (pct * 100) + '%'
      this._healthValue.textContent = String(Math.max(0, Math.ceil(player.health)))
      // Damage vignette: trigger on a health drop, then fade over 0.3 s.
      if (this._lastHealth !== null && player.health < this._lastHealth) this._vignetteT = 0.3
      this._lastHealth = player.health
      this._vignetteT = Math.max(0, this._vignetteT - dt)
      this._vignette.style.opacity = this._vignetteT > 0
        ? String(0.5 * (this._vignetteT / 0.3)) : '0'
      // Low-health pulse.
      const low = pct < 0.3
      if (low) { this._lowHealth.classList.add('on'); this._healthBox.classList.add('critical') }
      else { this._lowHealth.classList.remove('on'); this._healthBox.classList.remove('critical') }
      // Stamina.
      const maxS = player.maxStamina || 100
      const sPct = Math.max(0, Math.min(1, (player.stamina !== undefined ? player.stamina : maxS) / maxS))
      this._staminaFill.style.width = (sPct * 100) + '%'
    }

    if (weapon) {
      this._ammoValue.textContent = weapon.ammo + ' / ' + weapon.reserve
      this._ammoBox.classList.toggle('reloading', !!weapon.isReloading)
      this._ammoBox.classList.toggle('empty', weapon.ammo === 0)
    }

    if (waveManager) {
      this._waveValue.textContent = 'WAVE ' + (waveManager.wave || 1)
      this._threat.textContent = 'left: ' + (waveManager.remaining !== undefined ? waveManager.remaining : 0)
    }
  }

  show() { this._hudRoot.classList.add('visible') }
  hide() { this._hudRoot.classList.remove('visible') }

  dispose() {
    // Consistency only (unused at runtime): remove our children from the roots.
    while (this._hudRoot.firstChild) this._hudRoot.removeChild(this._hudRoot.firstChild)
    while (this._fxRoot.firstChild) this._fxRoot.removeChild(this._fxRoot.firstChild)
  }
}
