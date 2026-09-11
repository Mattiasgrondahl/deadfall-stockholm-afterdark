// Screens.js — full-screen overlay screens (title, pause, game-over) plus the
// wave-cleared banner. Browser-only: headless runs never construct it (Game.js
// guards with `if (this.env.document)`). All DOM is created once in the
// constructor via document.createElement (no innerHTML); state changes only
// toggle CSS classes and update text, so there is no per-frame node creation.
// `document` is read from the root element's ownerDocument, so the module
// stays DOM-free at import time. State transitions are driven by a
// pointerlockchange listener plus the Enter key; no extra Game.js edits.

export class Screens {
  constructor(root, game) {
    this._doc = root.ownerDocument
    this._root = root
    this._game = game
    this._bannerTimer = 0
    this._build()
    this._bind()
    this.showTitle()
  }

  _build() {
    const d = this._doc

    // TITLE
    this._title = d.createElement('div'); this._title.className = 'screen'
    const panelT = d.createElement('div'); panelT.className = 'panel'
    const titleEl = d.createElement('div'); titleEl.className = 'game-title'; titleEl.textContent = 'DEADFALL'
    const sub = d.createElement('div'); sub.className = 'game-title sub'; sub.textContent = 'Stockholm Afterdark'
    const tag = d.createElement('div'); tag.className = 'tagline'; tag.textContent = 'The city fell at midnight.'
    const hs = d.createElement('div'); hs.className = 'highscore'; this._highScoreText = hs; hs.textContent = 'HIGH SCORE: 0'
    const grid = d.createElement('div'); grid.className = 'controls-grid'
    for (const [k, a] of [
      ['W A S D', 'Move'], ['Mouse', 'Look'], ['LMB', 'Fire'],
      ['R', 'Reload'], ['Shift', 'Sprint'], ['F', 'Flashlight'],
      ['1 / 2', 'Switch weapon'], ['P / Esc', 'Pause']
    ]) {
      const row = d.createElement('div'); row.className = 'ctrl-row'
      const key = d.createElement('span'); key.className = 'key'; key.textContent = k
      const act = d.createElement('span'); act.className = 'act'; act.textContent = a
      row.appendChild(key); row.appendChild(act)
      grid.appendChild(row)
    }
    const startBtn = d.createElement('button'); startBtn.className = 'btn primary'; startBtn.textContent = 'START'
    startBtn.addEventListener('click', () => this._game.startGame())
    panelT.appendChild(titleEl); panelT.appendChild(sub); panelT.appendChild(tag); panelT.appendChild(hs)
    panelT.appendChild(grid); panelT.appendChild(startBtn)
    this._title.appendChild(panelT)
    this._root.appendChild(this._title)

    // PAUSE — clicking the overlay re-locks the pointer and resumes.
    this._pause = d.createElement('div'); this._pause.className = 'screen'
    const panelP = d.createElement('div'); panelP.className = 'panel'
    const pTitle = d.createElement('div'); pTitle.className = 'game-title'; pTitle.textContent = 'PAUSED'
    const pHint = d.createElement('div'); pHint.className = 'tagline'; pHint.textContent = 'click to resume'
    panelP.appendChild(pTitle); panelP.appendChild(pHint)
    this._pause.appendChild(panelP)
    this._pause.addEventListener('click', () => { if (this._game.input) this._game.input.requestLock() })
    this._root.appendChild(this._pause)

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
    panelO.appendChild(oTitle); panelO.appendChild(stats); panelO.appendChild(recordEl); panelO.appendChild(restartBtn)
    this._over.appendChild(panelO)
    this._root.appendChild(this._over)

    // Wave-cleared banner (top-center; fades via the CSS transition).
    this._banner = d.createElement('div'); this._banner.className = 'banner'
    this._root.appendChild(this._banner)
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

  // Pointer lock lost: show pause (playing was paused by the game), title,
  // or nothing (game-over is already shown by showGameOver).
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

  // Enter starts (title) or restarts (game-over); ignored during play/pause.
  _onKey(e) {
    if (e.key !== 'Enter') return
    if (this._game.state === 'title' || this._game.state === 'gameover') this._game.startGame()
  }

  _hideAll() {
    this._title.classList.remove('visible')
    this._pause.classList.remove('visible')
    this._over.classList.remove('visible')
    this._banner.classList.remove('show')
    if (this._bannerTimer) { clearTimeout(this._bannerTimer); this._bannerTimer = 0 }
    if (this._game.hud) this._game.hud.hide()
  }

  showTitle() {
    this._hideAll()
    if (this._game.score) this._highScoreText.textContent = 'HIGH SCORE: ' + this._game.score.best
    this._title.classList.add('visible')
  }

  showPause() { this._hideAll(); this._pause.classList.add('visible') }

  showGameplay() {
    this._hideAll()
    if (this._game.hud) this._game.hud.show()
  }

  showGameOver({ wave, kills, score = 0, best = 0, record = false }) {
    this._hideAll()
    this._statText.textContent = 'Wave ' + wave + ' — ' + kills + ' kills — ' + score + ' pts'
    this._recordText.textContent = record ? 'NEW HIGH SCORE — ' + best : ''
    this._over.classList.add('visible')
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
    if (this._bannerTimer) clearTimeout(this._bannerTimer)
    while (this._root.firstChild) this._root.removeChild(this._root.firstChild)
  }
}
