// Headless co-op damage probe: does a server-side zombie chase + melee-damage a
// player the same way single-player does? Drives a real Match (the same
// WorldCore.updateWorld the client Game uses) with one idle player and one
// walker spawned a few meters away, then samples health + zombie distance/state.
import * as THREE from 'three'
import { Match } from '../src/net/Match.js'

const DT = 1 / 60
const scene = new THREE.Scene()
const m = new Match({ scene, players: [{ id: 'A', x: 0, z: 0 }] })
const a = m.getPlayer('A').player
// Spawn a walker 6 m away on the same street so it must walk to reach the player.
const z = m.spawnZombie('walker', 0, 6)

let firstAttackAt = null
let firstHitAt = null
let hitCount = 0
const samples = []
for (let i = 0; i < 60 * 20; i++) { // 20 s
  m.step(DT)
  const dist = Math.hypot(z.position.x - a.position.x, z.position.z - a.position.z)
  const st = m._zombieState(z)
  if (firstAttackAt === null && st === 'attack') firstAttackAt = (i * DT).toFixed(2)
  // snapshot() drains events, so count hits as they appear each tick.
  const hits = m.snapshot().events.filter((e) => e.k === 'hit' && e.victim === 'A')
  hitCount += hits.length
  if (firstHitAt === null && hits.length) firstHitAt = (i * DT).toFixed(2)
  if (i % 60 === 0) samples.push(`t=${(i * DT).toFixed(1)}s dist=${dist.toFixed(2)} state=${st} hp=${a.health}`)
}
const totalHits = hitCount
console.log(samples.join('\n'))
console.log('---')
console.log('final player hp:', a.health, '(start 100)')
console.log('zombie reached player at (first attack state):', firstAttackAt)
console.log('first melee hit landed at:', firstHitAt)
console.log('total melee hits on A:', totalHits)
console.log('walker alive:', !z.isDead)
console.log(a.health < 100 && totalHits > 0 ? 'PASS: co-op zombie damages the player' : 'FAIL: no damage landed')