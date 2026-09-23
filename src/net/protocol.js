// src/net/protocol.js — Phase 1 of MULTIPLAYER_PLAN.md (§5): message schemas +
// constants shared by the server and the browser client.
//
// Transport is WebSocket carrying JSON. This module is pure data + pure
// functions (no DOM, no sockets, no timers) so it is importable from both the
// Node server and the browser, and headless-testable. It defines the wire
// shape (§5.1 input, §5.2 snapshot) and validates inbound input so a bad or
// cheating client cannot poison a room with out-of-range values.
import { TICK } from './Match.js'

export const PROTOCOL_VERSION = 1

// Tick + snapshot cadence (plan §4.2 / §5.2).
export const SERVER_TICK = TICK // 0.05 s = 20 Hz authoritative tick
export const SNAPSHOT_INTERVAL = 0.1 // 10 Hz snapshot broadcast
export const INPUT_RATE = 30 // client sends input ~30 Hz (plan §5.3)
export const MAX_PLAYERS = 8
export const MAX_ZOMBIES = 24

// Message types (the `t` discriminator on every frame).
export const MSG = {
  HELLO: 'hello', // client -> server: join a room with a name
  WELCOME: 'welcome', // server -> client: your assigned pid + starting roster
  INPUT: 'input', // client -> server: per-tick input (§5.1)
  SNAP: 'snap', // server -> client: world snapshot (§5.2)
  PING: 'ping', // client -> server: latency probe
  PONG: 'pong', // server -> client: latency reply
  LEAVE: 'leave', // client -> server: voluntary disconnect
  HIT: 'hit', // client -> server: a confirmed client-side hit on a zombie (authoritative damage)
}

export const WEAPONS = ['axe', 'shotgun', 'pistol', 'sword']
export const ZOMBIE_STATES = ['idle', 'chase', 'attack', 'stagger', 'dead']

// Clamp to [lo,hi]; a non-finite value falls back to 0 (neutral), not to the
// lower bound, so garbage input means "no movement" rather than "full back".
const clamp = (v, lo, hi) => (Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : 0)

/**
 * Validate + normalize an inbound input message (§5.1). Returns a clean input
 * object safe to feed the authoritative sim, or null if the message is not a
 * well-formed input frame. Never trusts raw client numbers: every field is
 * clamped to its legal range and coerced to a finite number / boolean.
 */
export function parseInput(msg) {
  if (!msg || typeof msg !== 'object' || msg.t !== MSG.INPUT) return null
  if (typeof msg.pid !== 'string' || !msg.pid) return null
  const move = msg.move && typeof msg.move === 'object' ? msg.move : {}
  const look = msg.look && typeof msg.look === 'object' ? msg.look : {}
  const sw = msg.switch
  return {
    t: MSG.INPUT,
    pid: msg.pid,
    tick: Number.isFinite(msg.tick) ? Math.floor(msg.tick) : 0,
    move: { fwd: clamp(move.fwd, -1, 1), side: clamp(move.side, -1, 1) },
    sprint: !!msg.sprint,
    look: { dx: clamp(look.dx, -1, 1), dy: clamp(look.dy, -1, 1) },
    fire: !!msg.fire,
    reload: !!msg.reload,
    jump: !!msg.jump,
    switch: Number.isInteger(sw) && sw >= 0 && sw <= 3 ? sw : null,
  }
}

/** Build a snapshot frame (§5.2) from a Match's snapshot() output. */
export function buildSnap(matchSnapshot) {
  return { t: MSG.SNAP, ...matchSnapshot }
}

/** Build a server->client welcome frame with the assigned pid + roster. */
export function buildWelcome(pid, roster) {
  return { t: MSG.WELCOME, pid, roster: Array.isArray(roster) ? roster.slice(0, MAX_PLAYERS) : [] }
}

/** Build a client->server hello (join) frame. */
export function buildHello(name, room) {
  return { t: MSG.HELLO, name: String(name || 'player').slice(0, 24), room: String(room || 'default').slice(0, 32) }
}

/** True if `value` is a plain JSON-serializable object (no live THREE refs). */
export function isPlainData(value) {
  try { JSON.stringify(value); return true } catch { return false }
}