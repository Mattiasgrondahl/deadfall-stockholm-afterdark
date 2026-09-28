// Does a server-side zombie track a MOVING player, or a stale point?
// Drives a real Match: player runs +X continuously; a walker spawned behind
// must keep chasing the live position (distance stays bounded), not converge on
// the spot the player passed through.
import * as THREE from 'three'
import { Match } from '../src/net/Match.js'

const DT = 1 / 60
const scene = new THREE.Scene()
const m = new Match({ scene, players: [{ id: 'A', x: 0, z: 0 }] })
const a = m.getPlayer('A').player
const slot = m.getPlayer('A')
// Player runs forward (+X) the whole time.
slot.inputState.forward = true
const z = m.spawnZombie('walker', 0, 6)

const samples = []
let maxDist = 0
for (let i = 0; i < 60 * 20; i++) { // 20 s
  m.step(DT)
  const dist = Math.hypot(z.position.x - a.position.x, z.position.z - a.position.z)
  maxDist = Math.max(maxDist, dist)
  if (i % 60 === 0) samples.push(`t=${(i * DT).toFixed(1)}s player.z=${a.position.z.toFixed(1)} z.z=${z.position.z.toFixed(1)} dist=${dist.toFixed(2)} state=${m._zombieState(z)}`)
}
console.log(samples.join('\n'))
console.log('---')
console.log('player final z:', a.position.z.toFixed(1), 'zombie final z:', z.position.z.toFixed(1))
console.log('max distance during chase:', maxDist.toFixed(2))
// If the zombie keeps pace, dist stays small after the initial catch-up.
const finalDist = Math.hypot(z.position.x - a.position.x, z.position.z - a.position.z)
console.log(finalDist < 2.5 ? 'PASS: zombie tracks the moving player' : 'FAIL: zombie fell behind (targets a stale point)')