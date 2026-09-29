// Headless boot check: real Game + real THREE scene graph in Node, no browser.
import assert from 'node:assert'
import { Game, GameState } from '../src/game/Game.js'

const game = new Game({ headless: true })
game.start()
assert.equal(game.debug.state(), GameState.TITLE, 'boots to TITLE')
game.startGame()
assert.equal(game.debug.state(), GameState.PLAYING, 'startGame -> PLAYING')
for (let i = 0; i < 60; i++) game.step(1 / 60)
const stats = game.debug.sceneStats()
assert.ok(stats.meshes >= 0 && stats.lights >= 0, 'scene traversal works')
const fs = game.debug.frameStats()
assert.ok(fs.calls >= 60, 'render stub counted frames')
assert.ok(Number.isFinite(game.debug.health()), 'health readable')
game.debug.setInput({ forward: true, sprint: true })
assert.equal(game.inputState.forward, true, 'debug.setInput reaches inputState')
assert.ok(Number.isFinite(game.debug.playerPos() ? game.debug.playerPos().x : NaN) || game.debug.playerPos() === null, 'playerPos contract holds (null until wiring)')
game.togglePause()
assert.equal(game.debug.state(), GameState.PAUSED, 'togglePause works headless')
game.startGame()
assert.equal(game.debug.state(), GameState.PLAYING, 'restart works headless')

// v28 R3: headshot hit-stop. While _hitStop is active, step() scales the world
// clock down (freeze-frame feel) but the real clock (timeInGame) keeps running
// at full speed, and _hitStop always expires back to 0.
game._hitStop = 0.2
const t0 = game.timeInGame
game.step(1 / 60)
const realDt = game.timeInGame - t0
assert.ok(Math.abs(realDt - 1 / 60) < 1e-9, 'real clock runs at full speed during hit-stop')
assert.ok(game._hitStop > 0 && game._hitStop < 0.2, 'hit-stop timer ticks down each step')
for (let i = 0; i < 30; i++) game.step(1 / 60) // 0.5 s > 0.2 s window
assert.equal(game._hitStop, 0, 'hit-stop expires to zero')

console.log('headless-boot OK', JSON.stringify(stats), JSON.stringify(fs))
