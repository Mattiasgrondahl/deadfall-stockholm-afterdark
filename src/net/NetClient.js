// src/net/NetClient.js — Phase 1 of MULTIPLAYER_PLAN.md (§6): the browser
// client's network layer.
//
// Responsibilities (plan §5.4, §6):
//  - Open a WebSocket to the server, send a hello, receive a welcome (pid).
//  - Send a ~30 Hz input frame derived from the local player's inputState.
//  - Receive 10 Hz snapshots and expose them for the Game to reconcile:
//      * self: predicted locally, lerped toward the authoritative position.
//      * remote players + zombies: interpolated between the last two snapshots.
//  - Expose the latest snapshot + a small interpolation buffer.
//
// This module is DOM-free (uses the global `WebSocket`, injected or global) so
// it is headless-testable: tests inject a fake socket. It does NOT touch the
// three.js scene — the Game consumes its output.
import { MSG, SERVER_TICK, SNAPSHOT_INTERVAL, INPUT_RATE, buildHello, buildWelcome } from './protocol.js'

// Latency probe cadence: one PING every 2 s (RTT shown in the scoreboard).
const PING_INTERVAL = 2.0

/**
 * Pure interpolation helper: lerp between two snapshot player entries.
 * `alpha` in [0,1] (0 = older snapshot, 1 = newer). Pure function so it is
 * unit-testable without a socket.
 */
export function lerpPlayer(a, b, alpha) {
  const t = Math.max(0, Math.min(1, alpha))
  return {
    id: b.id,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    yaw: a.yaw + (b.yaw - a.yaw) * t,
    pitch: a.pitch + (b.pitch - a.pitch) * t,
    health: b.health, stamina: b.stamina,
    weapon: b.weapon, ammo: b.ammo, reserve: b.reserve,
    dead: b.dead,
  }
}

/** Pure self-reconciliation: lerp predicted -> authoritative over ~100 ms. */
export function reconcileSelf(predicted, authoritative, alpha) {
  const t = Math.max(0, Math.min(1, alpha))
  return {
    x: predicted.x + (authoritative.x - predicted.x) * t,
    y: predicted.y + (authoritative.y - predicted.y) * t,
    z: predicted.z + (authoritative.z - predicted.z) * t,
  }
}

export class NetClient {
  /**
   * @param {object} opts
   * @param {string} [opts.url] ws url (default same-origin /ws)
   * @param {typeof WebSocket} [opts.Socket] injectable WebSocket ctor (tests)
   * @param {string} [opts.name] display name for hello
   * @param {string} [opts.room] room name
   */
  constructor(opts = {}) {
    const Ctor = opts.Socket || (typeof WebSocket !== 'undefined' ? WebSocket : null)
    if (!Ctor) throw new Error('NetClient requires a WebSocket implementation')
    this.url = opts.url || (typeof location !== 'undefined' ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws` : 'ws://localhost:8080/ws')
    this.name = opts.name || 'player'
    this.room = opts.room || 'default'
    this.socket = new Ctor(this.url)
    this.pid = null
    this.connected = false
    this.lastSnap = null
    this.prevSnap = null
    this.snapAge = 0 // seconds since last snapshot (for interpolation alpha)
    this._inputAccum = 0
    this._handlers = { welcome: [], snap: [], close: [] }
    // Latency probe: the client stamps a monotonic time on each PING and the
    // server echoes it back in PONG; RTT = now - sent. `now` is injectable so
    // the probe is testable headlessly (defaults to Date.now).
    this._now = opts.now || (typeof performance !== 'undefined' && performance && performance.now
      ? () => performance.now() : () => Date.now())
    this.pingMs = 0
    this._pingSentAt = 0
    this._pingAccum = 0
    this.socket.onopen = () => { this.connected = true; this.socket.send(JSON.stringify(buildHello(this.name, this.room))) }
    this.socket.onmessage = (ev) => this._onMessage(JSON.parse(ev.data))
    this.socket.onclose = () => { this.connected = false; this._emit('close', {}) }
    this.socket.onerror = () => { this.connected = false }
  }

  on(event, fn) { if (this._handlers[event]) this._handlers[event].push(fn) }
  _emit(event, data) { for (const fn of this._handlers[event] || []) fn(data) }

  _onMessage(msg) {
    if (!msg || typeof msg !== 'object') return
    if (msg.t === MSG.WELCOME) { this.pid = msg.pid; this._emit('welcome', msg) }
    else if (msg.t === MSG.SNAP) {
      this.prevSnap = this.lastSnap
      this.lastSnap = msg
      this.snapAge = 0
      this._emit('snap', msg)
    } else if (msg.t === MSG.PONG) {
      // RTT from the echoed client timestamp.
      if (this._pingSentAt) this.pingMs = Math.max(0, Math.round(this._now() - this._pingSentAt))
    }
  }

  /** Send one input frame (§5.1) derived from the local inputState. */
  sendInput(inputState, yaw) {
    if (!this.connected || this.pid === null) return
    const fwd = (inputState.forward ? 1 : 0) - (inputState.back ? 1 : 0)
    const side = (inputState.left ? 1 : 0) - (inputState.right ? 1 : 0)
    let sw = null
    if (inputState.switch1) sw = 0; else if (inputState.switch2) sw = 1
    else if (inputState.switch3) sw = 2; else if (inputState.switch4) sw = 3
    this.socket.send(JSON.stringify({
      t: MSG.INPUT, pid: this.pid, tick: this._inputAccum,
      move: { fwd, side }, sprint: !!inputState.sprint,
      look: { dx: inputState.turnX || 0, dy: inputState.turnY || 0 },
      fire: !!inputState.fire, reload: !!inputState.reload, jump: !!inputState.jump,
      switch: sw,
    }))
    inputState.turnX = 0; inputState.turnY = 0
  }

  /** Send an authoritative hit the client confirmed on a remote zombie so the
   *  server applies the damage (the client has the authoritative crosshair). */
  sendHit(victim, dmg, head) {
    if (!this.connected || this.pid === null || victim == null || !(dmg > 0)) return
    try { this.socket.send(JSON.stringify({ t: MSG.HIT, victim, dmg: Math.round(dmg), head: !!head })) } catch { /* socket closed */ }
  }

  /** Advance timers by dt (called from the Game loop). Accumulates input rate. */
  update(dt) {
    this.snapAge += dt
    this._inputAccum += dt
    this._pingAccum += dt
  }

  /** Throttled latency probe: call each frame; sends a PING at ~PING_RATE. */
  maybePing() {
    if (!this.connected || this.pid === null) return
    if (this._pingAccum >= PING_INTERVAL) {
      this._pingAccum = 0
      this._pingSentAt = this._now()
      this.socket.send(JSON.stringify({ t: MSG.PING, now: this._pingSentAt }))
    }
  }

  /** Throttled input send: call each frame; it sends at ~INPUT_RATE. */
  maybeSendInput(inputState, yaw) {
    if (this._inputAccum >= 1 / INPUT_RATE) {
      this._inputAccum = 0
      this.sendInput(inputState, yaw)
    }
  }

  /** Latest snapshot's players/zombies (for the Game to render). */
  getSnapshot() { return this.lastSnap }

  /** Interpolated view of remote entities between prevSnap and lastSnap. */
  interpolated() {
    if (!this.lastSnap) return { players: [], zombies: [] }
    const alpha = Math.min(1, this.snapAge / SNAPSHOT_INTERVAL)
    const prev = this.prevSnap
    const players = this.lastSnap.players.map((p) => {
      if (!prev) return p
      const a = prev.players.find((q) => q.id === p.id)
      return a ? lerpPlayer(a, p, alpha) : p
    })
    return { players, zombies: this.lastSnap.zombies }
  }

  close() { if (this.socket) this.socket.close() }
}