// Worst-case mesh budget: fill the scene with the max zombies, all distinct types.
import { Game } from '../src/game/Game.js'
const g = new Game({ headless: true })
g.start()
const types = ['shambler', 'screamer', 'brute', 'walker']
for (let i = 0; i < 24; i++) g.debug.spawnZombie(types[i % 4], (i % 6) - 3, -6 - Math.floor(i / 6) * 2)
for (let i = 0; i < 120; i++) g.step(1 / 60)
const s = g.debug.sceneStats()
console.log(JSON.stringify(s))
console.log('peak check meshes<=800:', s.meshes <= 800, 'lights<=40:', s.lights <= 40, 'points<=2500:', s.points <= 2500, 'zombies<=24:', s.zombies <= 24)
