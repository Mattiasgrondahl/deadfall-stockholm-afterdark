import { chromium } from "playwright-core"
const EXE = '/home/mgr/Workspace/Zombie/.browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] })
async function joiner(name){const page=await browser.newPage({viewport:{width:800,height:500}});await page.goto("http://127.0.0.1:5173",{waitUntil:"load",timeout:30000});await page.waitForTimeout(1000);await page.evaluate((n)=>{const ins=document.querySelectorAll(".mp-input");ins[0].value="distroom3";ins[1].value=n;Array.from(document.querySelectorAll("button")).find(x=>x.textContent==="JOIN CO-OP").click()},name);await page.waitForTimeout(2000);return page}
const p1 = await joiner("Ada"); await joiner("Bob")
// Drive forward properly via debug.setInput (consumed by player.update, fed each frame).
await p1.evaluate(()=>{const g=window.__game; g.debug.setInput({forward:true})})
let min=99
for(let i=0;i<15;i++){await p1.waitForTimeout(300);const d=await p1.evaluate(()=>{const g=window.__game;const mp=g&&g.multiplayer;const pp=g.debug.playerPos();const zs=[...mp.zombies.values()].filter(z=>!z.isDead);if(!zs.length)return 99;return Math.min(...zs.map(z=>Math.hypot(z._x-pp.x,z._z-pp.z)))});if(d<min)min=d}
console.log("COOP-MOVING-MIN-GAP", min.toFixed(2))
await browser.close().catch(()=>{})
