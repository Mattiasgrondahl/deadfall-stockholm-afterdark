// Screens.js — full-screen overlay screens (title, pause, game-over) plus the
// wave banner and a settings panel. Browser-only: headless runs never
// construct it (Game.js guards with `if (this.env.document)`). All DOM is
// created once in the constructor via document.createElement (no innerHTML);
// state changes only toggle CSS classes and update text, so there is no
// per-frame node creation. `document` is read from the root element's
// ownerDocument, so the module stays DOM-free at import time.
//
// Phase 1: the pause overlay is driven by the game STATE (a setState hook),
// not only by pointerlockchange — so it appears even when the browser never
// granted the lock. Enter/click resume re-locks when possible and falls back
// to a direct state resume when the lock is unavailable (headless, denied).

import { VERSION } from '../version.js'

// v6: random player-handle generator. AGENTS.md forbids Math.random in src/,
// so this uses the standard seeded-LCG shape (see AmmoDrops._rand) seeded from
// the load time — a fresh name per page load, deterministic within a load so
// tests can stub Date.now for a fixed expected handle. Adjective + noun keeps
// the names readable and unique enough for a shared leaderboard.
const NAME_ADJ = ['Grim', 'Pale', 'Ashen', 'Hollow', 'Feral', 'Silent', 'Crimson', 'Frozen', 'Rotten', 'Midnight', 'Iron', 'Violet', 'Cinder', 'Hollow', 'Wretched', 'Lonely']
const NAME_NOUN = ['Revenant', 'Stray', 'Nomad', 'Wraith', 'Sentinel', 'Crawler', 'Howler', 'Marauder', 'Pilgrim', 'Ghost', 'Ripper', 'Lurker', 'Warden', 'Vagrant', 'Shade', 'Reaper']

/** Pick a random "Adjective Noun" handle, seeded from the wall clock. Pass a
 *  fixed seed (tests) to get a stable name. */
export function randomPlayerName(seed) {
  let s = (seed == null ? Date.now() : seed) >>> 0
  const rand = () => { s = (Math.imul(s, 48271) >>> 0) % 65537; return s / 65537 }
  const a = NAME_ADJ[Math.floor(rand() * NAME_ADJ.length) % NAME_ADJ.length]
  const n = NAME_NOUN[Math.floor(rand() * NAME_NOUN.length) % NAME_NOUN.length]
  return a + ' ' + n
}

export class Screens {
  constructor(root, game) {
    this._doc = root.ownerDocument
    this._root = root
    this._game = game
    this._bannerTimer = 0
    this._build()
    this._bind()
    // State-driven overlay sync: Game.setState calls this on every transition
    // so the visible screen always matches the game state.
    this._stateFn = (next) => this._onStateChange(next)
    if (typeof game.onStateChange === 'function') game.onStateChange(this._stateFn)
    this._syncFromState()
  }

  _build() {
    const d = this._doc

    // TITLE
    this._title = d.createElement('div'); this._title.className = 'screen'
    const panelT = d.createElement('div'); panelT.className = 'panel'
    const titleEl = d.createElement('div'); titleEl.className = 'game-title'; titleEl.textContent = 'DEADFALL'
    const sub = d.createElement('div'); sub.className = 'game-title sub'; sub.textContent = 'Stockholm Afterdark'
    const tag = d.createElement('div'); tag.className = 'tagline'; tag.textContent = 'The city fell at midnight.'
    // v3: a version stamp so players and the deployed host can tell which build
    // is live. Rendered via textContent (XSS-safe, like every other label here).
    const ver = d.createElement('div'); ver.className = 'version'; ver.textContent = 'v' + VERSION
    const hs = d.createElement('div'); hs.className = 'highscore'; this._highScoreText = hs; hs.textContent = 'HIGH SCORE: 0'
    // v6: a top-10 leaderboard under the title high-score line. Built once,
    // repopulated from score.top (server-sourced) whenever it changes. Every
    // cell is textContent-only, so a hostile name renders as inert text.
    const board = d.createElement('div'); board.className = 'highscore-board'; this._boardEl = board
    const boardTitle = d.createElement('div'); boardTitle.className = 'board-title'; boardTitle.textContent = 'TOP 10'
    board.appendChild(boardTitle)
    this._boardRows = []
    for (let i = 0; i < 10; i++) {
      const row = d.createElement('div'); row.className = 'board-row'
      const rank = d.createElement('span'); rank.className = 'board-rank'; rank.textContent = (i + 1) + '.'
      const nm = d.createElement('span'); nm.className = 'board-name'; nm.textContent = ''
      const sc = d.createElement('span'); sc.className = 'board-score'; sc.textContent = ''
      row.appendChild(rank); row.appendChild(nm); row.appendChild(sc)
      board.appendChild(row)
      this._boardRows.push({ nm, sc })
    }
    const grid = d.createElement('div'); grid.className = 'controls-grid'
    // The full live control contract (matches Input.js key bindings exactly).
    for (const [k, a] of [
      ['W A S D', 'Move'], ['Mouse', 'Look'], ['LMB', 'Fire'],
      ['R', 'Reload'], ['Shift', 'Sprint'], ['C', 'Crouch'],
      ['Space', 'Jump'], ['F', 'Flashlight'], ['N', 'Music On/Off'],
      ['M', 'Mute All'], ['1–5', 'Axe / Shotgun / Pistol / Sword / Sniper'],
      ['Q (hold)', 'Sniper scope'], ['P / Esc', 'Pause']
    ]) {
      const row = d.createElement('div'); row.className = 'ctrl-row'
      const key = d.createElement('span'); key.className = 'key'; key.textContent = k
      const act = d.createElement('span'); act.className = 'act'; act.textContent = a
      row.appendChild(key); row.appendChild(act)
      grid.appendChild(row)
    }
    const settingsBtn = d.createElement('button'); settingsBtn.className = 'btn'; settingsBtn.textContent = 'SETTINGS'
    settingsBtn.addEventListener('click', () => this.showSettings())
    panelT.appendChild(titleEl); panelT.appendChild(sub); panelT.appendChild(tag); panelT.appendChild(hs); panelT.appendChild(ver)
    // v3 difficulty (1): FRENZY is the DEFAULT mode (2× speed + flat 50 HP);
    // NIGHT is the old baseline; NIGHTMARE stacks on frenzy (3× speed, same
    // flat HP, run starts at wave 3) — enabling it turns frenzy on, and
    // turning frenzy off drops nightmare back to normal. The choice is
    // stored on the game and applied to every spawned zombie.
    const diffRow = d.createElement('div'); diffRow.className = 'difficulty-row'
    const diffLabel = d.createElement('div'); diffLabel.className = 'difficulty-label'; diffLabel.textContent = 'DIFFICULTY'
    this._nightBtn = d.createElement('button'); this._nightBtn.className = 'toggle'; this._nightBtn.textContent = 'NIGHT'
    this._frenzyBtn = d.createElement('button'); this._frenzyBtn.className = 'toggle on'; this._frenzyBtn.textContent = 'FRENZY'
    this._nightmareBtn = d.createElement('button'); this._nightmareBtn.className = 'toggle'; this._nightmareBtn.textContent = 'NIGHTMARE'
    const frenzyHint = d.createElement('div'); frenzyHint.className = 'tagline dim'; frenzyHint.textContent = 'FRENZY (default): 2× faster — 2 shots to kill unless you headshot. NIGHTMARE: 3× faster + starts at wave 3'
    this._nightBtn.addEventListener('click', () => this._setDifficulty('normal'))
    this._frenzyBtn.addEventListener('click', () => this._setDifficulty('frenzy'))
    this._nightmareBtn.addEventListener('click', () => this._setDifficulty('nightmare'))
    diffRow.appendChild(diffLabel); diffRow.appendChild(this._nightBtn); diffRow.appendChild(this._frenzyBtn); diffRow.appendChild(this._nightmareBtn)
    diffRow.appendChild(frenzyHint)
    panelT.appendChild(grid); panelT.appendChild(board); panelT.appendChild(diffRow); panelT.appendChild(settingsBtn)
    // v3 T6: a display name for the SOLO run. It is sanitized (control chars
    // stripped, whitespace collapsed, clamped to 24) and attributed to a new
    // high score, then hosted so every visitor sees the record holder's name.
    const nameRow = d.createElement('div'); nameRow.className = 'mp-row'
    const nameLabel = d.createElement('div'); nameLabel.className = 'difficulty-label'; nameLabel.textContent = 'PLAYER'
    this._soloNameInput = d.createElement('input'); this._soloNameInput.className = 'mp-input'
    this._soloNameInput.type = 'text'; this._soloNameInput.placeholder = 'your name'; this._soloNameInput.value = 'player'
    const soloHint = d.createElement('div'); soloHint.className = 'tagline dim'
    soloHint.textContent = 'Shown on the high score if you set a record.'
    nameRow.appendChild(nameLabel); nameRow.appendChild(this._soloNameInput); nameRow.appendChild(soloHint)
    panelT.appendChild(nameRow)
    const startBtn = d.createElement('button'); startBtn.className = 'btn primary'; startBtn.textContent = 'START'
    startBtn.addEventListener('click', () => this._startSolo())
    panelT.appendChild(startBtn)
    // CO-OP: a room code + display name join the server-authoritative room.
    // JOIN calls Game.startMultiplayer, which builds the client controller and
    // renders other players' avatars + a scoreboard from server snapshots.
    const mpRow = d.createElement('div'); mpRow.className = 'mp-row'
    const mpLabel = d.createElement('div'); mpLabel.className = 'difficulty-label'; mpLabel.textContent = 'CO-OP'
    this._roomInput = d.createElement('input'); this._roomInput.className = 'mp-input'
    this._roomInput.type = 'text'; this._roomInput.placeholder = 'room code'; this._roomInput.value = 'default'
    this._nameInput = d.createElement('input'); this._nameInput.className = 'mp-input'
    this._nameInput.type = 'text'; this._nameInput.placeholder = 'your name'; this._nameInput.value = 'player'
    // v3 T6b: short helper lines under each co-op field, rendered via
    // textContent (same XSS rules as the high-score name).
    const roomHint = d.createElement('div'); roomHint.className = 'tagline dim'
    roomHint.textContent = 'Room code: the shared game name — everyone who types it lands in the same session.'
    const nameHint = d.createElement('div'); nameHint.className = 'tagline dim'
    nameHint.textContent = 'Your name: shown to other players and on the scoreboard.'
    const joinBtn = d.createElement('button'); joinBtn.className = 'btn'; joinBtn.textContent = 'JOIN CO-OP'
    joinBtn.addEventListener('click', () => this._joinCoop())
    mpRow.appendChild(mpLabel); mpRow.appendChild(this._roomInput); mpRow.appendChild(roomHint)
    mpRow.appendChild(this._nameInput); mpRow.appendChild(nameHint); mpRow.appendChild(joinBtn)
    panelT.appendChild(mpRow)
    // Title-screen backdrop: the Wan2GP-generated alley plate sits behind the
    // panel inside the title overlay (dimmed by the overlay's own rgba wash).
    // Missing image is harmless — the browser just renders no background.
    const bgUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL)
      ? import.meta.env.BASE_URL.replace(/\/$/, '') + '/' : ''
    const bg = d.createElement('div')
    bg.className = 'title-bg'
    bg.style.backgroundImage = `url('${bgUrl}assets/posters/menu_bg.jpg')`
    this._title.appendChild(bg)
    this._title.appendChild(panelT)
    this._root.appendChild(this._title)

    // PAUSE — clicking the overlay re-locks the pointer (or resumes directly
    // when the lock cannot be acquired) and resumes.
    this._pause = d.createElement('div'); this._pause.className = 'screen'
    const panelP = d.createElement('div'); panelP.className = 'panel'
    const pTitle = d.createElement('div'); pTitle.className = 'game-title'; pTitle.textContent = 'PAUSED'
    const pHint = d.createElement('div'); pHint.className = 'tagline'; pHint.textContent = 'click to resume'
    panelP.appendChild(pTitle); panelP.appendChild(pHint)
    const pHint2 = d.createElement('div'); pHint2.className = 'tagline dim'; pHint2.textContent = 'or press Enter'
    panelP.appendChild(pHint2)
    const resumeBtn = d.createElement('button'); resumeBtn.className = 'btn primary'; resumeBtn.textContent = 'RESUME'
    resumeBtn.addEventListener('click', () => this._resume())
    const pSettingsBtn = d.createElement('button'); pSettingsBtn.className = 'btn'; pSettingsBtn.textContent = 'SETTINGS'
    pSettingsBtn.addEventListener('click', () => this.showSettings())
    const quitBtn = d.createElement('button'); quitBtn.className = 'btn'; quitBtn.textContent = 'QUIT TO TITLE'
    quitBtn.addEventListener('click', () => this._quitToTitle())
    panelP.appendChild(resumeBtn); panelP.appendChild(pSettingsBtn); panelP.appendChild(quitBtn)
    this._pause.appendChild(panelP)
    this._pause.addEventListener('click', (e) => { const t = e && e.target; if (!t || !t.closest || !t.closest('button')) this._resume() })
    this._root.appendChild(this._pause)

    // SETTINGS — volume / sensitivity / FOV / quality / effects sliders and
    // toggles, bound to the game's Settings store (persisted in localStorage).
    this._settings = d.createElement('div'); this._settings.className = 'screen'
    const panelS = d.createElement('div'); panelS.className = 'panel'
    const sTitle = d.createElement('div'); sTitle.className = 'game-title'; sTitle.textContent = 'SETTINGS'
    panelS.appendChild(sTitle)
    this._settingRows = {}
    const mkSlider = (label, key, min, max, step, fmt) => {
      const row = d.createElement('div'); row.className = 'setting-row'
      const lab = d.createElement('span'); lab.className = 'setting-label'; lab.textContent = label
      const input = d.createElement('input'); input.type = 'range'
      input.min = String(min); input.max = String(max); input.step = String(step)
      const val = d.createElement('span'); val.className = 'setting-value'
      const sync = () => {
        const v = this._getSetting(key)
        input.value = String(v === undefined ? Number(input.min) : v)
        val.textContent = fmt(v === undefined ? Number(input.min) : v)
      }
      input.addEventListener('input', () => {
        const v = this._setSetting(key, Number(input.value))
        val.textContent = fmt(v)
      })
      row.appendChild(lab); row.appendChild(input); row.appendChild(val)
      panelS.appendChild(row)
      this._settingRows[key] = { sync }
      return sync
    }
    const pct = (v) => Math.round(v * 100) + '%'
    mkSlider('Master volume', 'masterVolume', 0, 1, 0.05, pct)
    mkSlider('Music volume', 'musicVolume', 0, 1, 0.05, pct)
    mkSlider('Effects volume', 'effectsVolume', 0, 1, 0.05, pct)
    mkSlider('Mouse sensitivity', 'sensitivity', 0.2, 3, 0.1, (v) => v.toFixed(1) + '×')
    mkSlider('Field of view', 'fov', 65, 100, 1, (v) => Math.round(v) + '°')
    // Graphics quality: three radio-style toggles.
    const qRow = d.createElement('div'); qRow.className = 'setting-row'
    const qLab = d.createElement('span'); qLab.className = 'setting-label'; qLab.textContent = 'Graphics'
    this._qualityBtns = {}
    for (const q of ['low', 'medium', 'high']) {
      const b = d.createElement('button'); b.className = 'toggle'; b.textContent = q.toUpperCase()
      b.addEventListener('click', () => {
        this._setSetting('quality', q)
        for (const k of Object.keys(this._qualityBtns)) this._qualityBtns[k].classList.toggle('on', k === q)
      })
      this._qualityBtns[q] = b
      qRow.appendChild(b)
    }
    qRow.appendChild(qLab)
    panelS.appendChild(qRow)
    // Toggles: flashlight flicker, reduced motion, mute, music mute.
    const mkToggle = (label, key, onApply) => {
      const row = d.createElement('div'); row.className = 'setting-row'
      const lab = d.createElement('span'); lab.className = 'setting-label'; lab.textContent = label
      const b = d.createElement('button'); b.className = 'toggle'
      const sync = () => {
        const v = !!this._getSetting(key)
        b.classList.toggle('on', v)
        b.textContent = v ? 'ON' : 'OFF'
      }
      b.addEventListener('click', () => {
        const v = this._setSetting(key, !this._getSetting(key))
        b.classList.toggle('on', !!v)
        b.textContent = v ? 'ON' : 'OFF'
        if (onApply) onApply(!!v)
      })
      row.appendChild(lab); row.appendChild(b)
      panelS.appendChild(row)
      this._settingRows[key] = { sync }
      return sync
    }
    mkToggle('Flashlight flicker', 'flashlightEffects')
    mkToggle('Reduced motion', 'reducedMotion')
    mkToggle('Mute all (M)', 'muted', (v) => { if (this._game.audio) this._game.audio.setMuted(v) })
    mkToggle('Mute music (N)', 'musicMuted', (v) => {
      if (this._game.audio) this._game.audio.setMusicMuted(v)
      if (this._game.hud) this._game.hud.setMusicMuted(v)
    })
    const backBtn = d.createElement('button'); backBtn.className = 'btn primary'; backBtn.textContent = 'BACK'
    backBtn.addEventListener('click', () => this._backFromSettings())
    panelS.appendChild(backBtn)
    this._settings.appendChild(panelS)
    this._root.appendChild(this._settings)
    this._settingsFrom = 'title'

    // GAME OVER
    this._over = d.createElement('div'); this._over.className = 'screen'
    const panelO = d.createElement('div'); panelO.className = 'panel'
    const oTitle = d.createElement('div'); oTitle.className = 'gameover-title'; oTitle.textContent = 'YOU DIED'
    const stats = d.createElement('div'); stats.className = 'stats'
    const stat = d.createElement('div'); stat.className = 'stat'
    this._statText = d.createElement('span'); this._statText.textContent = 'Wave 1 — 0 kills'
    stat.appendChild(this._statText)
    stats.appendChild(stat)
    const restartBtn = d.createElement('button'); restartBtn.className = 'btn primary'; restartBtn.textContent = 'RESTART'
    restartBtn.addEventListener('click', () => this._game.startGame())
    const recordEl = d.createElement('div'); recordEl.className = 'record'; this._recordText = recordEl; recordEl.textContent = ''
    const oHint = d.createElement('div'); oHint.className = 'tagline dim'; oHint.textContent = 'or press Enter to restart'
    panelO.appendChild(oTitle); panelO.appendChild(stats); panelO.appendChild(recordEl); panelO.appendChild(oHint); panelO.appendChild(restartBtn)
    this._over.appendChild(panelO)
    this._root.appendChild(this._over)

    // Wave banner (top-center; fades via the CSS transition).
    this._banner = d.createElement('div'); this._banner.className = 'banner'
    this._root.appendChild(this._banner)

    // Intermission threat-preview line (below the banner; visible while the
    // next wave is loading).
    this._threatLine = d.createElement('div'); this._threatLine.className = 'threat-preview'
    this._root.appendChild(this._threatLine)

    this._syncSettings()
  }

  /** Read one setting from the game's Settings store, tolerating test doubles
   *  that expose a plain object instead of a Settings instance. */
  _getSetting(key) {
    const s = this._game.settings
    if (!s) return undefined
    if (typeof s.get === 'function') return s.get(key)
    return s[key]
  }

  /** Write one setting through the Settings store when available. */
  _setSetting(key, value) {
    const s = this._game.settings
    if (!s) return value
    if (typeof s.set === 'function') return s.set(key, value)
    s[key] = value
    return value
  }

  _syncSettings() {
    for (const key of Object.keys(this._settingRows)) this._settingRows[key].sync()
    const q = this._getSetting('quality') || 'high'
    for (const k of Object.keys(this._qualityBtns)) this._qualityBtns[k].classList.toggle('on', k === q)
  }

  _bind() {
    const d = this._doc
    this._lockFn = () => this._onLockChange()
    this._keyFn = (e) => this._onKey(e)
    if (d.addEventListener) {
      d.addEventListener('pointerlockchange', this._lockFn)
      d.addEventListener('keydown', this._keyFn)
    }
  }

  // Game.setState hook: the overlay always follows the game state, whether
  // the transition came from Escape, pointer-lock loss, death, or restart.
  _onStateChange(next) {
    if (next === 'paused') this.showPause()
    else if (next === 'playing') this.showGameplay()
    else if (next === 'title') this.showTitle()
    // 'gameover' is shown by showGameOver() itself (it needs the run stats).
  }

  // Initial sync from whatever state the game is already in.
  _syncFromState() {
    const s = this._game.state
    if (s === 'paused') this.showPause()
    else if (s === 'playing') this.showGameplay()
    else if (s === 'gameover') { /* shown with stats by Game */ }
    else this.showTitle()
  }

  // Pointer lock regained while playing: hide overlays, show the HUD.
  // Losing the lock while paused re-shows the pause overlay (the lock event
  // is the authoritative "the pointer is gone" signal; the state hook covers
  // transitions that happen without a lock change).
  _onLockChange() {
    const locked = !!this._doc.pointerLockElement
    const state = this._game.state
    if (!locked) {
      if (state === 'paused') this.showPause()
      else if (state === 'title') this.showTitle()
    } else if (state === 'playing') {
      this.showGameplay()
    }
  }

  // Enter starts (title) / restarts (gameover) / resumes (pause). During
  // pause it re-locks when possible and falls back to a direct resume when
  // the browser cannot grant the lock (headless, denied, or unsupported).
  _onKey(e) {
    if (e.key !== 'Enter') return
    const s = this._game.state
    if (s === 'title' || s === 'gameover') this._game.startGame()
    else if (s === 'paused') this._resume()
  }

  /** Resume from pause: re-lock the pointer when a lock is available (the
   *  Game 'lock' handler flips PAUSED -> PLAYING); otherwise resume directly
   *  so the game is never stuck behind a lock the browser won't grant. */
  _resume() {
    const g = this._game
    if (g.state !== 'paused') return
    if (g.input && g.input.requestLock) {
      g.input.requestLock()
      // No lock event followed (headless / rejected): resume directly so the
      // player is never stranded on the pause overlay.
      if (!this._doc.pointerLockElement && typeof g.togglePause === 'function') g.togglePause()
    } else if (typeof g.togglePause === 'function') {
      g.togglePause()
    }
  }

  _quitToTitle() {
    const g = this._game
    if (g.input && g.input.releaseLock) g.input.releaseLock()
    else if (g.input && g.input.unlock && g.input.unlock()) { /* released */ }
    g.setState('title')
    this.showTitle()
  }

  // Title-screen difficulty selection: sets the game preset and the active
  // toggles. START/Enter then begin with the selected difficulty, and a
  // game-over restart keeps it (startGame re-rolls the same difficulty).
  // v3 difficulty (1): NIGHTMARE stacks on FRENZY — the DIFFICULTY preset
  // itself carries the 3× speed + wave-3 start, so "nightmare on" is just
  // difficulty === 'nightmare'; the frenzy toggle lights up alongside it.
  // Clicking FRENZY downgrades nightmare to plain frenzy; NIGHT resets.
  _setDifficulty(name) {
    this._game.difficulty = name
    this._nightBtn.classList.toggle('on', name === 'normal')
    this._frenzyBtn.classList.toggle('on', name === 'frenzy' || name === 'nightmare')
    this._nightmareBtn.classList.toggle('on', name === 'nightmare')
  }

  /** JOIN CO-OP: read the room code + name from the title inputs and start a
   *  server-authoritative co-op run. */
  _joinCoop() {
    const room = (this._roomInput && this._roomInput.value || 'default').trim() || 'default'
    const name = (this._nameInput && this._nameInput.value || 'player').trim() || 'player'
    this._game.startMultiplayer({ room, name })
  }

  /** v3 T6: START a solo run, carrying the chosen display name into the score
   *  so a new record is attributed to it (and hosted). */
  _startSolo() {
    const name = (this._soloNameInput && this._soloNameInput.value || '').trim()
    if (this._game.score && name) this._game.score.setName(name)
    this._game.startGame()
  }

  _hideAll() {
    this._title.classList.remove('visible')
    this._pause.classList.remove('visible')
    this._over.classList.remove('visible')
    this._settings.classList.remove('visible')
    this._banner.classList.remove('show')
    if (this._bannerTimer) { clearTimeout(this._bannerTimer); this._bannerTimer = 0 }
    if (this._game.hud) this._game.hud.hide()
  }

  showTitle() {
    this._hideAll()
    if (this._game.score) this._highScoreText.textContent = this._hsLabel(this._game.score)
    this._renderBoard()
    this._prefillRandomName()
    this._title.classList.add('visible')
    // The hosted best may land after boot (GET /api/highscore is async) —
    // refresh the label when it does, without ever lowering what is shown.
    if (this._game.score && !this._hsRefresh) {
      this._hsRefresh = () => {
        if (this._game.score && this._highScoreText.textContent !== this._hsLabel(this._game.score)) {
          this._highScoreText.textContent = this._hsLabel(this._game.score)
        }
        this._renderBoard()
      }
      this._game.score._onBestChange = this._hsRefresh
    }
  }

  /** v6: populate the title-screen TOP 10 board from the hosted leaderboard
   *  (score.top). Empty slots stay blank. textContent-only, so a hostile name
   *  can never become markup. */
  _renderBoard() {
    if (!this._boardRows) return
    const top = (this._game.score && this._game.score.top) || []
    for (let i = 0; i < this._boardRows.length; i++) {
      const e = top[i]
      this._boardRows[i].nm.textContent = e ? e.name : ''
      this._boardRows[i].sc.textContent = e ? String(e.score) : ''
    }
  }

  /** v6: on the first title screen, replace the default "player" name with a
   *  random generated one so a fresh visitor starts with a distinct handle.
   *  Only fills inputs still holding the default, so a returning player's
   *  saved name is never clobbered. */
  _prefillRandomName() {
    if (this._nameRolled) return
    this._nameRolled = true
    const name = randomPlayerName()
    if (this._soloNameInput && this._soloNameInput.value === 'player') this._soloNameInput.value = name
    if (this._nameInput && this._nameInput.value === 'player') this._nameInput.value = name
  }

  /** v3 T6: the title HIGH SCORE label. When the hosted record has a holder
   *  name it reads `HIGH SCORE: NAME — SCORE`; otherwise just the score. The
   *  name is assigned via textContent only (never innerHTML), so a hostile
   *  payload renders as inert text with zero markup nodes. */
  _hsLabel(score) {
    const name = score && score.bestName
    return name ? 'HIGH SCORE: ' + name + ' — ' + score.best : 'HIGH SCORE: ' + score.best
  }

  showPause() { this._hideAll(); this._pause.classList.add('visible') }

  showGameplay() {
    this._hideAll()
    if (this._game.hud) this._game.hud.show()
  }

  /** Called on wave start: the preview line is stale once spawns begin. */
  onWaveStarted() {
    this.clearThreatPreview()
  }

  /** Open the settings panel over whatever screen is up (title or pause);
   *  BACK returns there. */
  showSettings() {
    const s = this._game.state
    this._settingsFrom = s === 'paused' ? 'paused' : 'title'
    this._hideAll()
    this._syncSettings()
    this._settings.classList.add('visible')
  }

  _backFromSettings() {
    if (this._settingsFrom === 'paused' && this._game.state === 'paused') this.showPause()
    else this.showTitle()
  }

  showGameOver({ wave, kills, score = 0, best = 0, record = false, name = '' }) {
    this._hideAll()
    this._statText.textContent = 'Wave ' + wave + ' — ' + kills + ' kills — ' + score + ' pts'
    // v3 T6: a new record is attributed to the player's name (textContent only).
    this._recordText.textContent = record ? (name ? 'NEW HIGH SCORE — ' + name + ' — ' + best : 'NEW HIGH SCORE — ' + best) : ''
    this._over.classList.add('visible')
  }

  /** Intermission threat preview: a second, lower banner line that stays up
   *  for the whole intermission (cleared when the next wave starts). */
  showThreatPreview(text) {
    if (!this._threatLine) return
    this._threatLine.textContent = text
    this._threatLine.classList.add('show')
  }

  clearThreatPreview() {
    if (this._threatLine) this._threatLine.classList.remove('show')
  }

  showBanner(text) {
    this._banner.textContent = text
    this._banner.classList.add('show')
    if (this._bannerTimer) clearTimeout(this._bannerTimer)
    this._bannerTimer = setTimeout(() => {
      this._banner.classList.remove('show')
      this._bannerTimer = 0
    }, 2500)
  }

  dispose() {
    if (this._doc.removeEventListener) {
      this._doc.removeEventListener('pointerlockchange', this._lockFn)
      this._doc.removeEventListener('keydown', this._keyFn)
    }
    if (typeof this._game.offStateChange === 'function') this._game.offStateChange(this._stateFn)
    // Reverse the hosted-high-score hook: the callback lives on Score, so
    // dispose must remove it too (the listener is owned by Screens).
    if (this._game.score && this._game.score._onBestChange === this._hsRefresh) {
      this._game.score._onBestChange = null
    }
    this._hsRefresh = null
    if (this._bannerTimer) clearTimeout(this._bannerTimer)
    while (this._root.firstChild) this._root.removeChild(this._root.firstChild)
  }
}
