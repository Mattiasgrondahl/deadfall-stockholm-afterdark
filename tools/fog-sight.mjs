// fog-sight.mjs — V3P-3 headless fog-vs-target legibility probe.
// Boots the real Game headlessly (same pattern as tools/verify-game.mjs),
// confirms the live scene fog, then computes FogExp2 visibility
// V(d) = exp(-(d*rho)^2) per target class at its gameplay-relevant
// distances. No Math.random, no browser APIs.
import * as THREE from 'three'
import { Game } from '../src/game/Game.js'

const game = new Game({ headless: true })
game.start()

const fog = game.scene.fog
if (!(fog instanceof THREE.FogExp2)) {
  console.error('FAIL: scene.fog is not a THREE.FogExp2')
  process.exit(1)
}
const rho = fog.density
const colorHex = fog.color.getHex()
if (Math.abs(rho - 0.022) > 1e-12 || colorHex !== 0x0b1020) {
  console.error(`FAIL: fog density=${rho} color=0x${colorHex.toString(16)} (expected 0.022, 0x0b1020)`)
  process.exit(1)
}
console.log(`fog confirmed: FogExp2 density=${rho} color=0x${colorHex.toString(16).padStart(6, '0')}`)

const V = d => Math.exp(-((d * rho) ** 2))
const grade = v => (v >= 0.5 ? 'clear' : v >= 0.2 ? 'marginal' : 'faint')

// [target class, distance (m)] — relevance per target class in docs/fog-sight.md
const rows = [
  ['Zombie eye glow (all types)', 3],   // combat range; attack reach <=1.3 m
  ['Zombie eye glow (all types)', 10],
  ['Zombie eye glow (all types)', 20],
  ['Zombie eye glow (all types)', 30],  // far edge of combat range
  ['Streetlight halos (reach 14 m)', 5],
  ['Streetlight halos (reach 14 m)', 10],
  ['Streetlight halos (reach 14 m)', 14], // light reach edge
  ['Plaza halo + signage panels', 10], // typical player distance 10-40 m
  ['Plaza halo + signage panels', 20],
  ['Plaza halo + signage panels', 30],
  ['Plaza halo + signage panels', 40],
  ['Central spire + halo', 10],        // city-center landmark, 10-40 m
  ['Central spire + halo', 20],
  ['Central spire + halo', 30],
  ['Central spire + halo', 40],
  ['Blue street direction strips', 10], // center lines 0 .. +-60
  ['Blue street direction strips', 20],
  ['Blue street direction strips', 30],
  ['Blue street direction strips', 40],
  ['Blue street direction strips', 60], // outer center line
  ['Corner beacons (+-84, +-84)', 35], // approaching a beacon
  ['Corner beacons (+-84, +-84)', 45],
  ['Corner beacons (+-84, +-84)', 60],
  ['Corner beacons (+-84, +-84)', 118.7], // city center -> corner beacon
]

console.log(`\nlegibility table  V(d)=exp(-(d*${rho})^2)   clear>=0.5  marginal 0.2-0.5  faint<0.2`)
console.log('target'.padEnd(31) + ' d(m)'.padStart(6) + ' V(d)'.padStart(7) + ' grade')
for (const [target, d] of rows) {
  const v = V(d)
  console.log(target.padEnd(31) + ' ' + String(d).padStart(5) + ' ' + v.toFixed(4).padStart(6) + ' ' + grade(v))
}

// Gate range from test/fog.test.mjs: V(30) >= 0.60 and V(80) < 0.15.
const rhoMax = Math.sqrt(-Math.log(0.6)) / 30
const rhoMin = Math.sqrt(-Math.log(0.15)) / 80
const gLoose = Math.exp(-((118.7 * 0.0172) ** 2))
const gMin = Math.exp(-((118.7 * rhoMin) ** 2))
const gMax = Math.exp(-((118.7 * rhoMax) ** 2))

console.log(`\ngate range (both tests pass): rho in [${rhoMin.toFixed(5)}, ${rhoMax.toFixed(5)}]`)
console.log(`  beacon V(118.7 m) at rho=0.0172     : ${gLoose.toFixed(4)} (${grade(gLoose)})`)
console.log(`  beacon V(118.7 m) at rho=${rhoMin.toFixed(5)} (loosest) : ${gMin.toFixed(4)} (${grade(gMin)})`)
console.log(`  beacon V(118.7 m) at rho=${rhoMax.toFixed(5)} (densest) : ${gMax.toFixed(4)} (${grade(gMax)})`)

console.log(`\nkey values: V(30)=${V(30).toFixed(4)} V(40)=${V(40).toFixed(4)} V(60)=${V(60).toFixed(4)} V(80)=${V(80).toFixed(4)} V(118.7)=${V(118.7).toFixed(5)}`)
