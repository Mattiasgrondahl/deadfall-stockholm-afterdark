/**
 * Input — browser-only input adapter for Deadfall.
 *
 * Writes into the plain `inputState` object shared with Game/Player/Weapon:
 * movement booleans, accumulated look deltas (turnX/turnY), and press-edge
 * flags (fire/reload/pause) that consumers clear after acting. Headless
 * (Node) runs never construct this class; nothing browser-specific runs at
 * module top level, so the file imports cleanly in Node.
 */

const KEY_CODES = {
  w: ['KeyW'], a: ['KeyA'], s: ['KeyS'], d: ['KeyD'],
  shift: ['ShiftLeft', 'ShiftRight'], crouch: ['KeyC'],
  r: ['KeyR'], p: ['KeyP'], m: ['KeyM'], escape: ['Escape'], space: ['Space'],
  f: ['KeyF'], one: ['Digit1'], two: ['Digit2'], three: ['Digit3'], four: ['Digit4']
}

export class Input {
  constructor(game, inputState) {
    this.game = game
    this.inputState = inputState
    // v2 edges; ensure the shared state object carries them even if it was
    // built before this version (Game.js keeps its own literal untouched).
    this.inputState.switch1 = false
    this.inputState.switch2 = false
    this.inputState.switch3 = false
    this.inputState.switch4 = false
    this.inputState.flashlight = false
    this.inputState.jump = false
    this.inputState.crouch = false
    this.down = {}                          // e.code -> true while physically held
    this._edgeHeld = { fire: false, reload: false, pause: false, switch1: false, switch2: false, switch3: false, switch4: false, flashlight: false, jump: false }
    this._listeners = null                  // [target, event, handler] triples
    this._events = { lock: [], unlock: [], mute: [], musicMute: [] }
    this._wasLocked = false
    this._lastX = 0
    this._lastY = 0
  }

  /** Register all listeners; no-op without a real DOM; safe to call twice. */
  attach() {
    const doc = this.game.env.document
    const win = this.game.env.window
    if (!doc || !win) return
    this.dispose() // drop any previous bindings
    this._listeners = [
      [doc, 'pointerlockchange', () => this._onLockChange()],
      [doc, 'mousemove', (e) => this._onMouseMove(e)],
      [doc, 'mousedown', (e) => this._onMouse(e, true)],
      [doc, 'mouseup', (e) => this._onMouse(e, false)],
      [win, 'keydown', (e) => this._onKey(e, true)],
      [win, 'keyup', (e) => this._onKey(e, false)]
    ]
    for (const [t, ev, fn] of this._listeners) t.addEventListener(ev, fn)
  }

  /** Remove all listeners; every side effect is reversible. */
  dispose() {
    for (const [t, ev, fn] of this._listeners || []) t.removeEventListener(ev, fn)
    this._listeners = null
    for (const k in this.down) this.down[k] = false
    this._edgeHeld.fire = this._edgeHeld.reload = this._edgeHeld.pause = false
    this._edgeHeld.switch1 = this._edgeHeld.switch2 = this._edgeHeld.switch3 = this._edgeHeld.switch4 = this._edgeHeld.flashlight = this._edgeHeld.jump = false
    this._wasLocked = false
    this._syncMovement()
    // Clear stale edges/look deltas left in the shared state object
    // (e.g. keys still held at teardown), so a later re-attach is clean.
    const st = this.inputState
    st.fire = false
    st.reload = false
    st.pause = false
    st.switch1 = false
    st.switch2 = false
    st.switch3 = false
    st.switch4 = false
    st.flashlight = false
    st.jump = false
    st.crouch = false
    st.turnX = 0
    st.turnY = 0
  }

  locked() {
    const doc = this.game.env.document
    return !!doc && doc.pointerLockElement === this.game.canvas
  }

  requestLock() {
    if (!this.locked() && this.game.canvas) {
      // requestPointerLock returns a Promise in modern browsers; a rejected
      // request (no gesture, or too soon after release) must not become an
      // unhandled rejection / console error.
      const p = this.game.canvas.requestPointerLock()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    }
  }

  isDown(key) {
    const codes = KEY_CODES[key]
    return !!codes && codes.some((c) => this.down[c])
  }

  /** Accumulated look delta since last call; resets the accumulator. */
  consumeLook() {
    const dx = this.inputState.turnX
    const dy = this.inputState.turnY
    this.inputState.turnX = 0
    this.inputState.turnY = 0
    return { dx, dy }
  }

  on(event, cb) { if (this._events[event]) this._events[event].push(cb) }
  off(event, cb) {
    const list = this._events[event]
    if (!list) return
    const i = list.indexOf(cb)
    if (i >= 0) list.splice(i, 1)
  }

  _emit(event) {
    for (const cb of this._events[event] || []) cb()
  }

  _onLockChange() {
    const locked = this.locked()
    if (locked === this._wasLocked) return
    this._wasLocked = locked
    this._emit(locked ? 'lock' : 'unlock')
  }

  _onKey(e, pressed) {
    const code = e.code
    if (pressed) {
      const first = !this.down[code] && !e.repeat
      this.down[code] = true
      if (first) {
        this._syncMovement()
        if (code === 'KeyR') { this.inputState.reload = true; this._edgeHeld.reload = true }
        else if (code === 'KeyP' || code === 'Escape') { this.inputState.pause = true; this._edgeHeld.pause = true }
        else if (code === 'KeyM') this._emit('mute')
        else if (code === 'KeyN') this._emit('musicMute')
        else if (code === 'KeyF') { this.inputState.flashlight = true; this._edgeHeld.flashlight = true }
        else if (code === 'Space') { this.inputState.jump = true; this._edgeHeld.jump = true }
        else if (code === 'Digit1') { this.inputState.switch1 = true; this._edgeHeld.switch1 = true }
        else if (code === 'Digit2') { this.inputState.switch2 = true; this._edgeHeld.switch2 = true }
        else if (code === 'Digit3') { this.inputState.switch3 = true; this._edgeHeld.switch3 = true }
        else if (code === 'Digit4') { this.inputState.switch4 = true; this._edgeHeld.switch4 = true }
      }
    } else {
      if (!this.down[code]) return
      this.down[code] = false
      this._syncMovement()
      // Clearing on release avoids stale edges when the consumer is not
      // running (e.g. fire pressed, pointer unlocked, released while paused).
      if (code === 'KeyR') { this.inputState.reload = false; this._edgeHeld.reload = false }
      else if (code === 'KeyP' || code === 'Escape') { this.inputState.pause = false; this._edgeHeld.pause = false }
      else if (code === 'KeyF') { this.inputState.flashlight = false; this._edgeHeld.flashlight = false }
      else if (code === 'Space') { this.inputState.jump = false; this._edgeHeld.jump = false }
      else if (code === 'Digit1') { this.inputState.switch1 = false; this._edgeHeld.switch1 = false }
      else if (code === 'Digit2') { this.inputState.switch2 = false; this._edgeHeld.switch2 = false }
      else if (code === 'Digit3') { this.inputState.switch3 = false; this._edgeHeld.switch3 = false }
      else if (code === 'Digit4') { this.inputState.switch4 = false; this._edgeHeld.switch4 = false }
    }
  }

  _onMouse(e, pressed) {
    if (e.button !== 0) return
    if (pressed) {
      if (this.locked() && !this._edgeHeld.fire) {
        this._edgeHeld.fire = true
        this.inputState.fire = true
      }
    } else {
      this._edgeHeld.fire = false
      this.inputState.fire = false
    }
  }

  _onMouseMove(e) {
    const dx = e.movementX !== undefined ? e.movementX : (e.clientX ?? this._lastX) - this._lastX
    const dy = e.movementY !== undefined ? e.movementY : (e.clientY ?? this._lastY) - this._lastY
    this._lastX = e.clientX ?? this._lastX
    this._lastY = e.clientY ?? this._lastY
    if (this.locked()) {
      this.inputState.turnX += dx
      this.inputState.turnY += dy
    }
  }

  _syncMovement() {
    const st = this.inputState
    st.forward = !!this.down['KeyW']
    st.back = !!this.down['KeyS']
    st.left = !!this.down['KeyA']
    st.right = !!this.down['KeyD']
    st.sprint = !!(this.down['ShiftLeft'] || this.down['ShiftRight'])
    st.crouch = !!this.down['KeyC']
  }
}
