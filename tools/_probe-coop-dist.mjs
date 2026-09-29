// Measure how close a co-op (remote) zombie gets to the local player vs how close
// a single-player zombie gets. Drives the player to stand still and lets zombies
// swarm, then reports the minimum zombie-player distance on client + server.
import { chromium } from "playwright-core"
import path from "node:path"
const WS = process.cwd()
const CHROME = path.join(WS, ".browsers", "chromium_headless_shell-1243", "chrome-headless-shell-linux64", "chrome-headless-shell")
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] })
async function joiner(name){const page=await browser.newPage({viewport:{width:800,height:500}});await page.goto("http://127.0.0.1:5173",{waitUntil:"load",timeout:30000});await page.waitForTimeout(1000);await page.evaluate((n)=>{const ins=document.querySelectorAll(".mp-input");ins[0].value="distroom";ins[1].value=n;Array.from(document.querySelectorAll("button")).find(x=>x.textContent==="JOIN CO-OP").click()},name);await page.waitForTimeout(2500);return page}
const p1 = await joiner("Ada"); await joiner("Bob")
// Stand still, let zombies approach for a few seconds.
await p1.waitForTimeout(4000)
const r = await p1.evaluate(() => {
  const g = window.__game; const mp = g && g.multiplayer
  const pp = g.debug.playerPos()
  const zs = [...mp.zombies.values()].filter(z => !z.isDead)
  const gaps = zs.map(z => +Math.hypot(z._x - pp.x, z._z - pp.z).toFixed(2)).sort((a,b)=>a-b)
  return { n: zs.length, minGap: gaps[0] ?? null, gaps: gaps.slice(0,6), px:+pp.x.toFixed(2), pz:+pp.z.toFixed(2) }
})
console.log("COOP-DIST", JSON.stringify(r))
// Single-player comparison: fresh page, start solo, stand still, measure min gap.
const sp = await browser.newPage({viewport:{width:800,height:500}})
await sp.goto("http://127.0.0.1:5173",{waitUntil:"load",timeout:30000}); await sp.waitForTimeout(1000)
await sp.evaluate(()=>{Array.from(document.querySelectorAll(".screen .btn.primary"))[0].click()})
await sp.waitForFunction(()=>window.__game&&window.__game.debug&&window.__game.debug.zombiesAlive()>0,{timeout:60000})
await sp.waitForTimeout(4000)
const sp2 = await sp.evaluate(()=>{const g=window.__game;const pp=g.debug.playerPos();const zs=g.zombies.filter(z=>!z.isDead);const gaps=zs.map(z=>+Math.hypot(z.position.x-pp.x,z.position.z-pp.z).toFixed(2)).sort((a,b)=>a-b);return {n:zs.length,minGap:gaps[0]??null,gaps:gaps.slice(0,6)}})
console.log("SP-DIST", JSON.stringify(sp2))
await browser.close().catch(()=>{})
