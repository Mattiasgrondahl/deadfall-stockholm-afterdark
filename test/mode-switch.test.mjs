// v30 mode-switch regression: switching game mode from the title screen must
// fully reset the run type. A stale co-op controller left over from a previous
// co-op game used to keep update() on the server-authoritative branch (so a
// later SURVIVAL pick still ran co-op) and blocked solo CTF from building its
// arena (the CTF build is guarded by `!this.multiplayer`). The fix tears the
// controller down when a NON-co-op run starts from the title.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Game } from '../src/game/Game.js'

// Minimal fake WebSocket so startMultiplayer can build a controller headlessly.
class FakeWS {
  constructor(url) { this.url = url; this.sent = []; this.onopen = null; this.onmessage = null; this.onclose = null }
  send(s) { this.sent.push(JSON.parse(s)) }
  close() { if (this.onclose) this.onclose() }
}

function coOpOpts() { return { room: 'ARENA_1', name: 'Ana', Socket: FakeWS, url: 'ws://x/ws' } }

test('v30: co-op then SURVIVAL from the title clears the stale controller', () => {
  const g = new Game({ headless: true })
  g.start()
  g.startMultiplayer(coOpOpts())
  assert.ok(g.multiplayer, 'co-op run has a controller')
  // Go back to the title, pick SURVIVAL, and start a fresh run.
  g.setState('gameover')
  g.setState('title')
  g.mode = 'survival'
  g.startGame()
  assert.equal(g.multiplayer, null, 'stale co-op controller torn down')
  assert.equal(g._mpOpts, null, 'join options cleared')
  assert.equal(g.mode, 'survival', 'mode is survival')
  assert.ok(g.waveManager, 'survival run has a wave manager')
  g.dispose()
})

test('v30: co-op then CTF from the title builds the solo CTF arena', () => {
  const g = new Game({ headless: true })
  g.start()
  g.startMultiplayer(coOpOpts())
  assert.ok(g.multiplayer, 'co-op run has a controller')
  g.setState('gameover')
  g.setState('title')
  g.mode = 'ctf'
  g.startGame()
  assert.equal(g.multiplayer, null, 'stale co-op controller torn down')
  assert.ok(g.flag, 'solo CTF built its flag state (arena swap ran)')
  assert.equal(g.waveManager, null, 'CTF has no wave manager')
  g.dispose()
})

test('v30: SURVIVAL then CTF then co-op each switch cleanly', () => {
  const g = new Game({ headless: true })
  g.start()
  g.startGame() // solo survival
  assert.equal(g.multiplayer, null, 'solo survival has no controller')
  g.setState('gameover'); g.setState('title')
  g.mode = 'ctf'
  g.startGame() // solo ctf
  assert.ok(g.flag, 'solo CTF arena built')
  g.setState('gameover'); g.setState('title')
  g.startMultiplayer(coOpOpts()) // co-op
  assert.ok(g.multiplayer, 'co-op controller built')
  assert.equal(g._mpStarting, false, 'the co-op-start flag is cleared after start')
  g.dispose()
})

test('v30: a game-over RESTART of a co-op run keeps its controller', () => {
  const g = new Game({ headless: true })
  g.start()
  g.startMultiplayer(coOpOpts())
  assert.ok(g.multiplayer, 'co-op run has a controller')
  g.setState('gameover')
  g.startGame() // RESTART from game-over (not the title) must NOT tear down
  assert.ok(g.multiplayer, 'co-op controller survives a game-over restart')
  g.dispose()
})