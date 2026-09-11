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
console.log('headless-boot OK', JSON.stringify(stats), JSON.stringify(fs))
