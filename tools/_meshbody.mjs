// A2 headless probe: spawn one zombie per mesh-backed type, step the real Game,
// and confirm nothing crashes and the mesh budget holds. Headless never loads a
// GLB (document is undefined), so _skinMesh stays null by design — this probe
// proves the new constructor hook / _applyLOD branch are crash-free headless.
import { Game } from '../src/game/Game.js'

const g = new Game({ headless: true })
g.start()
g.debug.spawnZombie('shambler', 2, 2)
g.debug.spawnZombie('screamer', 3, 2)
g.debug.spawnZombie('brute', 4, 2)
for (let i = 0; i < 60; i++) g.step(1 / 60)
const s = g.debug.sceneStats()
console.log(s)
const zs = g.debug.zombiesAlive()
console.log('zombiesAlive', zs)
for (const z of g.zombies || []) {
  console.log(z.type, 'skinMesh', z._skinMesh === null ? 'null(headless ok)' : 'attached',
    'lodMesh', z._lodMesh === true, 'headVisible', z._parts[1].visible)
}
if (s.meshes > 800) { console.error('MESH BUDGET EXCEEDED'); process.exit(1) }
console.log('probe ok')