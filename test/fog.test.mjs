// Fog retune V2P-3: FogExp2 density 0.032 -> 0.022 keeps near-range targets
// readable (30 m >= 0.60 visibility) while preserving the city depth cue
// (80 m < 0.15 visibility). Headless-safe: no window/document access.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { Game } from '../src/game/Game.js'

function newHeadlessGame() {
  const game = new Game({ headless: true })
  game.start() // start() -> setupScene() creates scene.fog
  return game
}

test('fog: scene fog is FogExp2 with retuned density and original color', () => {
  const game = newHeadlessGame()
  assert.ok(game.scene.fog instanceof THREE.FogExp2, 'scene fog must be FogExp2')
  assert.equal(game.scene.fog.density, 0.022, 'retuned density')
  assert.equal(game.scene.fog.color.getHex(), 0x0b1020, 'fog color unchanged')
})

test('fog gates: near-range readability >= 0.60 and far-range depth < 0.15', () => {
  const vis = d => Math.exp(-((d * 0.022) ** 2)) // exp(-(d*density)^2)
  assert.ok(vis(30) >= 0.60, `30 m visibility ${vis(30).toFixed(4)} >= 0.60 (targets readable)`)
  assert.ok(vis(80) < 0.15, `80 m visibility ${vis(80).toFixed(4)} < 0.15 (city depth cue preserved)`)
})
