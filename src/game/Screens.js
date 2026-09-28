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
import { sanitizeName } from './Score.js'

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

// v7: zombie-themed room-code words. A room code is a short, uppercase,
// memorable handle that also names the room's own leaderboard, so the words are
// spooky/undead-flavoured. Two words + a 2-digit suffix keeps codes unique.
const ROOM_WORDS = ['GRAVE', 'ROT', 'HORDE', 'BITE', 'CRYPT', 'ASH', 'BONE', 'MIST', 'HOWL', 'GORE', 'DUSK', 'DECAY', 'PLAGUE', 'SHAMBLE', 'EMBER', 'NIGHT']

/** Pick a random zombie-themed room code, seeded from the wall clock. Pass a
 *  fixed seed (tests) for a stable code. Format: WORD-WORD-NN (≤ 32 chars). */
export function randomRoomCode(seed) {
  let s = (seed == null ? Date.now() : seed) >>> 0
  const rand = () => { s = (Math.imul(s, 48271) >>> 0) % 65537; return s / 65537 }
  const w1 = ROOM_WORDS[Math.floor(rand() * ROOM_WORDS.length) % ROOM_WORDS.length]
  const w2 = ROOM_WORDS[Math.floor(rand() * ROOM_WORDS.length) % ROOM_WORDS.length]
  const n = 10 + Math.floor(rand() * 90) // 10..99
  // v4 UI: join with underscores (not dashes) so a generated code stays inside
  // the allowed input charset (a-z 0-9 space _ ! ?).
  return w1 + '_' + w2 + '_' + n
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
    panelT.appendChild(grid); panelT.appendChild(diffRow); panelT.appendChild(settingsBtn)
    // v11: ONE display name drives both modes. It is sanitized (control chars
    // stripped, whitespace collapsed, clamped to 24), attributed to a solo high
    // score AND sent to the co-op room, so the same generated handle appears on
    // the leaderboard and to other players. (Previously two separate inputs —
    // "PLAYER" for solo and a second "your name" for co-op — duplicated the same
    // value.)
    const nameRow = d.createElement('div'); nameRow.className = 'mp-row'
    const nameLabel = d.createElement('div'); nameLabel.className = 'difficulty-label'; nameLabel.textContent = 'PLAYER'
    this._nameInput = d.createElement('input'); this._nameInput.className = 'mp-input'
    this._nameInput.type = 'text'; this._nameInput.placeholder = 'your name'; this._nameInput.value = 'player'
    // v4 UI: cap the field at 24 chars and keep only the allowed charset live as
    // the player types (a-z 0-9 space _ ! ?), so a payload like `img src=x
    // onerror=alert(` can't even be entered.
    this._nameInput.maxLength = 24
    this._nameInput.addEventListener('input', () => Screens._filterInput(this._nameInput))
    const soloHint = d.createElement('div'); soloHint.className = 'tagline dim'
    soloHint.textContent = 'Your name — shown on the high score and to other players in co-op.'
    nameRow.appendChild(nameLabel); nameRow.appendChild(this._nameInput); nameRow.appendChild(soloHint)
    panelT.appendChild(nameRow)
    const startBtn = d.createElement('button'); startBtn.className = 'btn primary'; startBtn.textContent = 'START'
    startBtn.addEventListener('click', () => this._startSolo())
    panelT.appendChild(startBtn)
    // CO-OP: a room code joins the server-authoritative room; the name above is
    // reused. JOIN calls Game.startMultiplayer, which builds the client
    // controller and renders other players' avatars + a scoreboard from server
    // snapshots.
    const mpRow = d.createElement('div'); mpRow.className = 'mp-row'
    const mpLabel = d.createElement('div'); mpLabel.className = 'difficulty-label'; mpLabel.textContent = 'CO-OP'
    this._roomInput = d.createElement('input'); this._roomInput.className = 'mp-input'
    this._roomInput.type = 'text'; this._roomInput.placeholder = 'room code'; this._roomInput.value = 'default'
    // v4 UI: same 24-char cap + live charset filter as the name field.
    this._roomInput.maxLength = 24
    this._roomInput.addEventListener('input', () => Screens._filterInput(this._roomInput))
    // v3 T6b: short helper line under the co-op field, rendered via textContent
    // (same XSS rules as the high-score name).
    const roomHint = d.createElement('div'); roomHint.className = 'tagline dim'
    roomHint.textContent = 'Room code: the shared game name — everyone who types it lands in the same session.'
    const joinBtn = d.createElement('button'); joinBtn.className = 'btn'; joinBtn.textContent = 'JOIN CO-OP'
    joinBtn.addEventListener('click', () => this._joinCoop())
    mpRow.appendChild(mpLabel); mpRow.appendChild(this._roomInput); mpRow.appendChild(roomHint)
    mpRow.appendChild(joinBtn)
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
    // v4 VISUALS (D1): looping muted attract clip over the static plate. The
    // <video> is browser-only (this whole file is), plays muted+looped+autoplay
    // so it needs no user gesture, and sits above the plate but below the panel
    // (z-index). If the mp4 is missing the video is transparent and the plate
    // shows through — no broken-image box. dispose() pauses + unloads it.
    const vid = d.createElement('video')
    vid.className = 'title-video'
    vid.muted = true
    vid.autoplay = true
    vid.loop = true
    vid.playsInline = true
    vid.preload = 'metadata'
    vid.src = `${bgUrl}assets/posters/attract.mp4`
    this._titleVideo = vid
    this._title.appendChild(vid)
    this._title.appendChild(panelT)
    // v4 UI: the TOP-10 board is a sibling of the panel, pinned to the top-right
    // corner of the title overlay (see .highscore-board CSS) instead of sitting
    // inside the centered panel.
    this._title.appendChild(board)
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
    // v8: exactly one difficulty is highlighted as the active selection — the
    // picker is a single-choice control, so NIGHTMARE does not also light up
    // FRENZY (that made two buttons look selected at once). The stacking of
    // nightmare-on-frenzy is a gameplay concern handled by the preset, not the
    // UI state.
    this._nightBtn.classList.toggle('on', name === 'normal')
    this._frenzyBtn.classList.toggle('on', name === 'frenzy')
    this._nightmareBtn.classList.toggle('on', name === 'nightmare')
  }

  /** JOIN CO-OP: read the room code + name from the title inputs and start a
   *  server-authoritative co-op run. */
  _joinCoop() {
    // v4 UI: sanitize both fields through the same allow-list the score uses, so
    // a co-op join can't carry a hostile name/room to the server either.
    const room = sanitizeName(this._roomInput && this._roomInput.value) || 'default'
    const name = sanitizeName(this._nameInput && this._nameInput.value) || 'player'
    this._game.startMultiplayer({ room, name })
  }

  /** v3 T6 / v11: START a solo run, carrying the chosen display name into the
   *  score so a new record is attributed to it (and hosted). The same name input
   *  feeds co-op, so one handle covers both modes. */
  _startSolo() {
    const name = (this._nameInput && this._nameInput.value || '').trim()
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
    // v4 UI: pre-populate empty slots with random handles at score 0 so the
    // board always reads as a full top-10 rather than blank rows. Each empty
    // rank gets a distinct generated name (seeded off its rank so it is stable
    // across a page load) and a 0 score. Real hosted entries (top[i]) win.
    for (let i = 0; i < this._boardRows.length; i++) {
      const e = top[i]
      if (e) {
        this._boardRows[i].nm.textContent = e.name
        this._boardRows[i].sc.textContent = String(e.score)
      } else {
        this._boardRows[i].nm.textContent = randomPlayerName(1000 + i)
        this._boardRows[i].sc.textContent = '0'
      }
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
    // v11: one name input feeds both solo and co-op, so only it is prefilled.
    if (this._nameInput && this._nameInput.value === 'player') this._nameInput.value = name
    // v7: a random zombie-themed room code so a fresh co-op session lands in a
    // uniquely-named room with its own leaderboard, instead of the shared
    // "default". Only overwrites the untouched default so a typed code stands.
    if (this._roomInput && this._roomInput.value === 'default') this._roomInput.value = randomRoomCode()
  }

  /** v4 UI: strip disallowed characters from an input's value in place, keeping
   *  only a-z 0-9 space _ ! ? (case preserved). Used as a live `input` handler
   *  on the name + room fields so a hostile payload can't be typed. */
  static _filterInput(el) {
    if (!el) return
    const cleaned = String(el.value == null ? '' : el.value).replace(/[^A-Za-z0-9 _!?]/g, '')
    if (cleaned !== el.value) el.value = cleaned
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
    // v4 VISUALS (D1): stop the attract clip + release its media resource so
    // the decoded buffer / network stream are freed, not just the DOM node.
    if (this._titleVideo) {
      try { this._titleVideo.pause() } catch (e) { /* headless-safe */ }
      if (this._titleVideo.removeAttribute) this._titleVideo.removeAttribute('src')
      else this._titleVideo.src = ''
      try { this._titleVideo.load() } catch (e) { /* headless-safe */ }
      this._titleVideo = null
    }
    while (this._root.firstChild) this._root.removeChild(this._root.firstChild)
  }
}
