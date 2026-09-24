// HUD.js — in-game heads-up display (health, stamina, wave, weapons, battery,
// score, crosshair) plus damage vignette / low-health pulse FX. Browser-only: headless
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
    this._markerT = 0 // hit/kill marker lifetime (s); decayed in update()
    this._vignettePeak = 0 // V5P-2: current vignette peak opacity
    this._dmgEdgeT = 0 // V5P-2: edge-glow lifetime (s), decayed in update()
    this._dmgHitPending = false // V5P-2: hook already accounted for this drop
    this._pulseT = 0 // v6 visuals (7): low-health pulse phase (s), deterministic
    this._player = null // V5P-2: last player seen by update()
    this.flashlight = null // set by Game wiring (V7); battery bar hidden until then
    this.score = null      // set by Game wiring (V9); score box hidden until then
    this.boss = null       // set by Game wiring (boss finale); bar hidden until then
    this._waveSubText = ''   // v6 visuals (8): last wave sub-line (write gate)
    this._threatSubText = '' // v6 visuals (8): last threat sub-line (write gate)
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

    // Wave + remaining (top-center). v6 visuals (8): these same two elements
    // gain a second line each (intermission countdown + composition preview,
    // and cap-pressure danger) instead of a new DOM layer, so nothing new
    // covers the center of the screen.
    const wave = d.createElement('div'); wave.className = 'hud-wave'
    this._waveValue = d.createElement('div'); this._waveValue.className = 'hud-value'; this._waveValue.textContent = 'WAVE 1'
    wave.appendChild(this._waveValue)
    this._waveSub = d.createElement('div'); this._waveSub.className = 'hud-wave-sub'
    wave.appendChild(this._waveSub)
    this._hudRoot.appendChild(wave)
    this._threat = d.createElement('div'); this._threat.className = 'hud-threat'; this._threat.textContent = 'left: 0'
    this._hudRoot.appendChild(this._threat)
    this._threatSub = d.createElement('div'); this._threatSub.className = 'hud-threat-sub'
    this._hudRoot.appendChild(this._threatSub)

    // Boss health bar (wave-5 finale): hidden until a boss zombie is alive.
    const boss = d.createElement('div'); boss.className = 'hud-boss hidden'
    const bossLabel = d.createElement('div'); bossLabel.className = 'hud-label'; bossLabel.textContent = 'BRUTE'
    const bossBar = d.createElement('div'); bossBar.className = 'bar'
    this._bossFill = d.createElement('div'); this._bossFill.className = 'bar-fill'
    bossBar.appendChild(this._bossFill)
    boss.appendChild(bossLabel); boss.appendChild(bossBar)
    this._bossBox = boss
    this._hudRoot.appendChild(boss)

    // Weapons (bottom-right, v2): one slot per bank weapon with name, ammo,
    // and reload indicator; the active slot is highlighted. A legacy
    // single-weapon slot is kept for non-bank weapons. Battery (flashlight)
    // and score are revealed only when Game wires those systems.
    const weapons = d.createElement('div'); weapons.className = 'hud-weapons'
    const slot = (label) => {
      const box = d.createElement('div'); box.className = 'weapon-slot hidden'
      const n = d.createElement('div'); n.className = 'weapon-name'; n.textContent = label
      const a = d.createElement('div'); a.className = 'weapon-ammo'; a.textContent = '0 / 0'
      const reload = d.createElement('div'); reload.className = 'weapon-reload'
      const bar = d.createElement('div'); bar.className = 'bar'
      const rf = d.createElement('div'); rf.className = 'bar-fill'
      bar.appendChild(rf); reload.appendChild(bar)
      box.appendChild(n); box.appendChild(a); box.appendChild(reload)
      return { box, name: n, ammo: a }
    }
    this._slotA = slot('AXE')
    this._slotB = slot('SHOTGUN')
    this._slotC = slot('PISTOL')
    this._slotD = slot('SWORD')
    this._slotE = slot('SNIPER')
    weapons.appendChild(this._slotA.box); weapons.appendChild(this._slotB.box)
    weapons.appendChild(this._slotC.box); weapons.appendChild(this._slotD.box)
    weapons.appendChild(this._slotE.box)
    this._legacyAmmo = d.createElement('div'); this._legacyAmmo.className = 'hud-ammo hidden'
    this._ammoValue = d.createElement('div'); this._ammoValue.className = 'hud-value'; this._ammoValue.textContent = '0 / 0'
    const reload = d.createElement('div'); reload.className = 'hud-reload'
    this._reloadText = d.createElement('span'); this._reloadText.textContent = 'RELOADING…'
    reload.appendChild(this._reloadText)
    this._legacyAmmo.appendChild(this._ammoValue); this._legacyAmmo.appendChild(reload)
    weapons.appendChild(this._legacyAmmo)
    this._ammoBox = this._legacyAmmo
    this._weaponsRoot = weapons
    this._hudRoot.appendChild(weapons)

    // Battery (bottom-left, above health); revealed when a flashlight is wired.
    const battery = d.createElement('div'); battery.className = 'hud-battery hidden'
    const bLabel = d.createElement('div'); bLabel.className = 'hud-label'; bLabel.textContent = 'Battery'
    const bBar = d.createElement('div'); bBar.className = 'bar'
    this._batteryFill = d.createElement('div'); this._batteryFill.className = 'bar-fill'
    bBar.appendChild(this._batteryFill)
    battery.appendChild(bLabel); battery.appendChild(bBar)
    this._batteryBox = battery
    this._hudRoot.appendChild(battery)

    // Score (top-right); revealed when a score tracker is wired.
    const scoreBox = d.createElement('div'); scoreBox.className = 'hud-score hidden'
    const scLabel = d.createElement('div'); scLabel.className = 'hud-label'; scLabel.textContent = 'Score'
    this._scoreValue = d.createElement('div'); this._scoreValue.className = 'hud-value'; this._scoreValue.textContent = '0'
    scoreBox.appendChild(scLabel); scoreBox.appendChild(this._scoreValue)
    this._scoreBox = scoreBox
    this._hudRoot.appendChild(scoreBox)

    // Music-mute button (top-right, under the score): a clickable toggle that
    // mutes ONLY the soundtrack (SFX stay audible). The click handler is wired
    // by Game via onToggleMusic; the label reflects the current state.
    const musicBtn = d.createElement('button')
    musicBtn.className = 'hud-music-btn'
    musicBtn.type = 'button'
    musicBtn.textContent = '♪ Music: On'
    musicBtn.title = 'Toggle soundtrack (Mute/Unmute music)'
    this._musicBtn = musicBtn
    this._musicMuted = false
    this.onToggleMusic = null // set by Game wiring
    musicBtn.addEventListener('click', () => {
      this._musicMuted = !this._musicMuted
      musicBtn.textContent = this._musicMuted ? '♪ Music: Off' : '♪ Music: On'
      musicBtn.classList.toggle('muted', this._musicMuted)
      if (this.onToggleMusic) this.onToggleMusic(this._musicMuted)
    })
    this._hudRoot.appendChild(musicBtn)

    // Crosshair (static; spread FX deferred)
    const ch = d.createElement('div'); ch.className = 'crosshair'
    const dot = d.createElement('div'); dot.className = 'ch-dot'
    for (const b of ['top', 'bottom', 'left', 'right']) {
      const bar = d.createElement('div'); bar.className = 'ch-bar ' + b; ch.appendChild(bar)
    }
    ch.appendChild(dot)
    this._hudRoot.appendChild(ch)

    // Hit marker + kill confirmation (V5P-1): single element, class-driven look.
    const hm = d.createElement('div'); hm.className = 'hit-marker'
    this._marker = hm
    this._hudRoot.appendChild(hm)

    // FX layer: damage vignette + low-health pulse
    this._vignette = d.createElement('div'); this._vignette.className = 'fx-damage'
    this._fxRoot.appendChild(this._vignette)
    // Directional damage edge glow (V5P-2): full-screen layer, glow band at top
    // edge, rotated about screen center to point at the attacker.
    const de = d.createElement('div'); de.className = 'fx-dmg-edge'
    this._dmgEdge = de
    this._fxRoot.appendChild(de)
    this._lowHealth = d.createElement('div'); this._lowHealth.className = 'fx-lowhealth'
    this._fxRoot.appendChild(this._lowHealth)
  }

  update(player, weapon, waveManager) {
    // Each arg is null-checked; a missing arg is a no-op for that section.
    const dt = Math.max(0, (this._now() - this._lastNow) / 1000)
    this._lastNow = this._now()

    if (player) {
      this._player = player
      const maxH = player.maxHealth || 1
      const pct = Math.max(0, Math.min(1, player.health / maxH))
      this._healthFill.style.width = (pct * 100) + '%'
      // HP bar shows the percentage of max health remaining (rounded), e.g. "82%".
      this._healthValue.textContent = Math.round(pct * 100) + '%'
      // Damage vignette (V5P-2 + v6 visuals 7): hook-driven peak with a
      // health-drop fallback; fades over 0.45 s. The fallback now scales with
      // the amount dropped (0.18 + 0.006/pt, cap 0.40) instead of a flat 0.35,
      // so severity reads as severity; the CSS rim is capped at 0.32 alpha and
      // starts at 72% of the gradient extent, so the center stays clear.
      if (this._lastHealth !== null && player.health < this._lastHealth && !this._dmgHitPending) {
        this._vignettePeak = Math.min(0.40, 0.18 + 0.006 * (this._lastHealth - player.health))
        this._vignetteT = 0.45
      }
      this._dmgHitPending = false
      this._lastHealth = player.health
      this._vignetteT = Math.max(0, this._vignetteT - dt)
      this._dmgEdgeT = Math.max(0, this._dmgEdgeT - dt)
      // Low-health frame breathes (v6 visuals 7): deterministic 0.55 Hz pulse
      // in [0.25, 0.75] written through the opacity write that already ran
      // every frame — no extra style write. The damage vignette is suppressed
      // while that frame is on so the two red layers never stack.
      this._pulseT = (this._pulseT + dt) % 1.8
      const low = pct < 0.3
      const pulse = 0.5 + 0.25 * Math.sin(this._pulseT * (Math.PI * 2 / 1.8))
      this._vignette.style.opacity = (this._vignetteT > 0 && !low)
        ? String(this._vignettePeak * (this._vignetteT / 0.45)) : '0'
      this._lowHealth.style.opacity = low ? String(pulse) : '0'
      this._dmgEdge.style.opacity = this._dmgEdgeT > 0
        ? String(0.7 * (this._dmgEdgeT / 0.5)) : '0'
      if (low) { this._lowHealth.classList.add('on'); this._healthBox.classList.add('critical') }
      else { this._lowHealth.classList.remove('on'); this._healthBox.classList.remove('critical') }
      // Stamina.
      const maxS = player.maxStamina || 100
      const sPct = Math.max(0, Math.min(1, (player.stamina !== undefined ? player.stamina : maxS) / maxS))
      this._staminaFill.style.width = (sPct * 100) + '%'
    }

    if (weapon) {
      if (weapon.axe && weapon.shotgun) {
        // WeaponBank: five slots, active one highlighted.
        this._slotA.box.classList.remove('hidden')
        this._slotB.box.classList.remove('hidden')
        this._slotC.box.classList.remove('hidden')
        this._slotD.box.classList.remove('hidden')
        this._slotE.box.classList.remove('hidden')
        this._legacyAmmo.classList.add('hidden')
        // Unrolled (no per-frame array literal): five fixed slots.
        let w = weapon.axe, s = this._slotA
        s.name.textContent = w.name || 'weapon'
        s.ammo.textContent = w.infiniteAmmo ? '∞' : w.ammo + ' / ' + w.reserve
        s.box.classList.toggle('active', w === weapon.current)
        s.box.classList.toggle('reloading', !!w.isReloading)
        s.box.classList.toggle('empty', !w.infiniteAmmo && w.ammo === 0)
        w = weapon.shotgun; s = this._slotB
        s.name.textContent = w.name || 'weapon'
        s.ammo.textContent = w.infiniteAmmo ? '∞' : w.ammo + ' / ' + w.reserve
        s.box.classList.toggle('active', w === weapon.current)
        s.box.classList.toggle('reloading', !!w.isReloading)
        s.box.classList.toggle('empty', !w.infiniteAmmo && w.ammo === 0)
        w = weapon.pistol; s = this._slotC
        s.name.textContent = w.name || 'weapon'
        s.ammo.textContent = w.infiniteAmmo ? '∞' : w.ammo + ' / ' + w.reserve
        s.box.classList.toggle('active', w === weapon.current)
        s.box.classList.toggle('reloading', !!w.isReloading)
        s.box.classList.toggle('empty', !w.infiniteAmmo && w.ammo === 0)
        w = weapon.sword; s = this._slotD
        s.name.textContent = w.name || 'weapon'
        s.ammo.textContent = w.infiniteAmmo ? '∞' : w.ammo + ' / ' + w.reserve
        s.box.classList.toggle('active', w === weapon.current)
        s.box.classList.toggle('reloading', !!w.isReloading)
        s.box.classList.toggle('empty', !w.infiniteAmmo && w.ammo === 0)
        w = weapon.sniper; s = this._slotE
        s.name.textContent = w.name || 'weapon'
        s.ammo.textContent = w.infiniteAmmo ? '∞' : w.ammo + ' / ' + w.reserve
        s.box.classList.toggle('active', w === weapon.current)
        s.box.classList.toggle('reloading', !!w.isReloading)
        s.box.classList.toggle('empty', !w.infiniteAmmo && w.ammo === 0)
      } else {
        // Legacy single weapon (pre-bank compatibility).
        this._slotA.box.classList.add('hidden')
        this._slotB.box.classList.add('hidden')
        this._slotC.box.classList.add('hidden')
        this._slotD.box.classList.add('hidden')
        this._slotE.box.classList.add('hidden')
        this._legacyAmmo.classList.remove('hidden')
        this._ammoValue.textContent = weapon.ammo + ' / ' + weapon.reserve
        this._ammoBox.classList.toggle('reloading', !!weapon.isReloading)
        this._ammoBox.classList.toggle('empty', weapon.ammo === 0)
      }
    }

    if (waveManager) {
      // v6 visuals (8): wave state made legible from data the WaveManager
      // already exposes — `intermission`, `nextWavePreview`, `cap`,
      // `remaining`. No composition logic is duplicated here, and the two
      // existing text writes are reused (one extra write per sub-line, only
      // when the string actually changes).
      const inter = typeof waveManager.intermission === 'number' ? waveManager.intermission : 0
      const preview = waveManager.nextWavePreview || null
      const cap = typeof waveManager.cap === 'number' ? waveManager.cap : 0
      const remaining = waveManager.remaining !== undefined ? waveManager.remaining : 0
      // The boss is counted in `remaining` but never counts against the spawn
      // cap, so the pressure readout must exclude it (wave 5 otherwise reads
      // over-cap while the brute is alive). `this.boss` is the wired boss
      // zombie (Game reassigns it on spawn/death) — no extra getter needed.
      const bossOn = !!(this.boss && !this.boss.isDead)
      const fighting = remaining - (bossOn && preview === null ? 1 : 0)
      this._waveValue.textContent = 'WAVE ' + (waveManager.wave || 1)
      this._threat.textContent = 'left: ' + remaining
      if (inter > 0 && preview) {
        const secs = Math.max(1, Math.ceil(inter))
        const parts = []
        if (preview.shambler) parts.push(preview.shambler + ' shamblers')
        if (preview.screamer) parts.push(preview.screamer + ' screamers')
        if (preview.walker) parts.push(preview.walker + ' walkers')
        if (preview.boss) parts.push('BOSS')
        const sub = 'in ' + secs + 's — ' + parts.join(', ')
        if (sub !== this._waveSubText) {
          this._waveSubText = sub
          this._waveSub.textContent = sub
        }
        this._waveSub.classList.toggle('imminent', secs <= 2)
        this._threat.textContent = 'next: ' + preview.total
        this._threatSub.textContent = 'cap ' + cap
      } else {
        if (this._waveSubText !== '') { this._waveSubText = ''; this._waveSub.textContent = '' }
        this._waveSub.classList.remove('imminent')
        const room = cap > 0 ? cap - fighting : 0
        const danger = cap > 0 && fighting >= cap - 2
        const sub = cap > 0 ? (danger ? 'CAP ' + fighting + '/' + cap : 'room ' + room + '/' + cap) : ''
        if (sub !== this._threatSubText) {
          this._threatSubText = sub
          this._threatSub.textContent = sub
        }
        this._threat.classList.toggle('danger', danger)
      }
    }

    // Boss bar: shown while the wired boss zombie is alive (Game reassigns
    // hud.boss on spawn/death). Hidden when null or dead.
    const boss = this.boss
    const bossOn = !!(boss && !boss.isDead)
    this._bossBox.classList.toggle('hidden', !bossOn)
    if (bossOn) {
      const bPct = Math.max(0, Math.min(1, boss.health / (boss.maxHealth || 1)))
      this._bossFill.style.width = (bPct * 100) + '%'
    }

    // Hit marker / kill confirmation decay (V5P-1).
    this._markerT = Math.max(0, this._markerT - dt)
    if (this._markerT <= 0) this._marker.classList.remove('show')

    // Battery + score: shown only when their systems are wired in.
    this._batteryBox.classList.toggle('hidden', !this.flashlight)
    if (this.flashlight) {
      const pct = Math.max(0, Math.min(1, this.flashlight.battery !== undefined ? this.flashlight.battery : 1))
      this._batteryFill.style.width = (pct * 100) + '%'
      this._batteryBox.classList.toggle('low', pct < 0.25)
    }
    this._scoreBox.classList.toggle('hidden', !this.score)
    if (this.score) {
      this._scoreValue.textContent = String(this.score.value !== undefined ? this.score.value : this.score)
    }
  }

  show() { this._hudRoot.classList.add('visible') }
  hide() { this._hudRoot.classList.remove('visible') }

  /** Reduced motion: soften the damage vignette pulse and disable the hit
   *  marker scale pop (handled in CSS via .reduced-motion). */
  setReducedMotion(on) {
    this._reducedMotion = !!on
    if (this._fxRoot) this._fxRoot.classList.toggle('reduced-motion', this._reducedMotion)
  }

  /** Reflect the music-mute state on the button (called by the N-key path so
   *  the label stays in sync with AudioBank without re-firing the callback). */
  setMusicMuted(muted) {
    this._musicMuted = !!muted
    if (this._musicBtn) {
      this._musicBtn.textContent = this._musicMuted ? '♪ Music: Off' : '♪ Music: On'
      this._musicBtn.classList.toggle('muted', this._musicMuted)
    }
  }

  /** Hit confirmation. kind: 'body' (default) | 'head' — a headshot marker
   *  is brighter, larger, and lingers slightly longer so the player can tell
   *  a clean head hit from a body hit at a glance. */
  hitMarker(kind) {
    const head = kind === 'head'
    this._markerT = head ? 0.35 : 0.25
    this._marker.classList.remove('kill')
    this._marker.classList.toggle('headshot', head)
    this._marker.classList.add('show', 'hit')
  }

  /** Kill confirmation. kind: 'body' (default) | 'head' — a headshot kill
   *  keeps the amber headshot arms alongside the red kill cross. */
  killMarker(kind) {
    const head = kind === 'head'
    this._markerT = 0.6
    this._marker.classList.remove('hit')
    this._marker.classList.toggle('headshot', head)
    this._marker.classList.add('show', 'kill')
  }

  clearMarker() {
    this._markerT = 0
    this._marker.classList.remove('show', 'hit', 'kill', 'headshot')
  }

  dmgFeedback(amount, source) {
    // Vignette: peak scales with damage (0.25 + 0.012/pt, cap 0.55), 0.45 s
    // fade. v6 visuals (7): slope halved and cap lowered from 0.60 — at the
    // old cap the rim alpha 0.55 reached 0.33 effective and pulled a 30 m
    // walker to C 0.54, under the 0.90 gate. With rim 0.32 (styles.css) the
    // worst-case rim is 0.176, and the CSS clear disc starts at 72%.
    this._vignettePeak = Math.min(0.55, 0.25 + 0.012 * amount)
    this._vignetteT = 0.45
    this._dmgHitPending = true
    this._dmgEdgeT = 0.5
    // Directional edge glow: angle from screen-forward to the attacker.
    // 0 = in front, +90 = right, -90 = left, 180 = behind.
    const p = this._player
    const sp = source && source.position
    if (p && p.position && sp && typeof sp.x === 'number' && typeof sp.z === 'number') {
      const dx = sp.x - p.position.x
      const dz = sp.z - p.position.z
      const fwd = dx * Math.sin(p.yaw) - dz * Math.cos(p.yaw)
      const right = dx * Math.cos(p.yaw) + dz * Math.sin(p.yaw)
      const ang = Math.atan2(right, fwd) * (180 / Math.PI)
      this._dmgEdge.style.transform = 'rotate(' + ang.toFixed(1) + 'deg)'
    }
  }

  dispose() {
    // Consistency only (unused at runtime): remove our children from the roots.
    while (this._hudRoot.firstChild) this._hudRoot.removeChild(this._hudRoot.firstChild)
    while (this._fxRoot.firstChild) this._fxRoot.removeChild(this._fxRoot.firstChild)
  }
}
