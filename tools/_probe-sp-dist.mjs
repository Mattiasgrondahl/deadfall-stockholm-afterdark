import { chromium } from "playwright-core"
const EXE = '/home/mgr/Workspace/Zombie/.browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] })
const sp = await browser.newPage({viewport:{width:800,height:500}})
sp.on("pageerror",e=>console.error("PAGE ERROR:",e.message))
await sp.goto("http://127.0.0.1:5173",{waitUntil:"load",timeout:30000}); await sp.waitForTimeout(1000)
await sp.evaluate(()=>{Array.from(document.querySelectorAll(".screen .btn.primary"))[0].click()})
await sp.waitForFunction(()=>window.__game&&window.__game.debug&&window.__game.debug.zombiesAlive()>0,{timeout:60000})
// Force-spawn a zombie 6m away and let it chase to the player, measuring min gap.
await sp.evaluate(()=>{const g=window.__game;g.debug.killAllZombies();const p=g.debug.playerPos();g.debug.spawnZombie("walker",p.x,p.z-6)})
let min=99
for(let i=0;i<20;i++){await sp.waitForTimeout(300);const d=await sp.evaluate(()=>{const g=window.__game;const pp=g.debug.playerPos();const zs=g.zombies.filter(z=>!z.isDead);if(!zs.length)return 99;return Math.min(...zs.map(z=>Math.hypot(z.position.x-pp.x,z.position.z-pp.z)))});if(d<min)min=d}
console.log("SP-MIN-GAP", min.toFixed(2))
await browser.close().catch(()=>{})
