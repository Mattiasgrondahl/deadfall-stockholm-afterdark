// Measure zombie-player gap while the player is MOVING (the case the user sees).
import { chromium } from "playwright-core"
import path from "node:path"
const WS = process.cwd()
const CHROME = path.join(WS, ".browsers", "chromium_headless_shell-1243", "chrome-headless-shell-linux64", "chrome-headless-shell")
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] })
async function joiner(name){const page=await browser.newPage({viewport:{width:800,height:500}});await page.goto("http://127.0.0.1:5173",{waitUntil:"load",timeout:30000});await page.waitForTimeout(1000);await page.evaluate((n)=>{const ins=document.querySelectorAll(".mp-input");ins[0].value="distroom2";ins[1].value=n;Array.from(document.querySelectorAll("button")).find(x=>x.textContent==="JOIN CO-OP").click()},name);await page.waitForTimeout(2500);return page}
const p1 = await joiner("Ada"); await joiner("Bob")
// Drive the player forward (W held) so client prediction leads the server.
await p1.evaluate(()=>{ window.__drive=setInterval(()=>{const g=window.__game; if(g&&g.inputState){g.inputState.forward=true}},16) })
await p1.waitForTimeout(5000)
const r = await p1.evaluate(() => {
  const g = window.__game; const mp = g && g.multiplayer
  const pp = g.debug.playerPos()
  const zs = [...mp.zombies.values()].filter(z => !z.isDead)
  const gaps = zs.map(z => +Math.hypot(z._x - pp.x, z._z - pp.z).toFixed(2)).sort((a,b)=>a-b)
  // also report client selfPos (server's view of this player) vs client pos
  const sp = mp.selfPos ? {x:+mp.selfPos.x.toFixed(2),z:+mp.selfPos.z.toFixed(2)} : null
  const off = sp ? +Math.hypot(sp.x-pp.x, sp.z-pp.z).toFixed(2) : null
  return { n: zs.length, minGap: gaps[0] ?? null, gaps: gaps.slice(0,4), clientOff: off, selfPos: sp, px:+pp.x.toFixed(2), pz:+pp.z.toFixed(2) }
})
console.log("COOP-DIST-MOVING", JSON.stringify(r))
await p1.evaluate(()=>clearInterval(window.__drive))
await browser.close().catch(()=>{})
