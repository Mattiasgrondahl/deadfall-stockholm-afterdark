// _a2-upright.mjs — confirm the attached body mesh renders UPRIGHT in-world
// (world bbox Y-span ~1.8, feet near the zombie's ground plane).
import { chromium } from 'playwright-core';
import path from 'node:path';
const WS = process.cwd();
const CHROME = path.join(WS, '.browsers', 'chromium_headless_shell-1243', 'chrome-headless-shell-linux64', 'chrome-headless-shell');
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
await page.goto('http://127.0.0.1:5173', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.renderer, { timeout: 30000 });
await page.click('.screen .btn.primary');
await page.waitForFunction(() => window.__game.debug && window.__game.debug.zombiesAlive() > 0, { timeout: 60000 });
await page.evaluate(() => {
  const g = window.__game;
  g.debug.spawnZombie('shambler', -2, -6);
  g.debug.spawnZombie('screamer', 0, -6);
  g.debug.spawnZombie('brute', 2, -6);
});
await page.waitForTimeout(9000);
const report = await page.evaluate(async () => {
  const g = window.__game;
  const THREE = await import('/node_modules/three/build/three.module.js');
  return g.zombies.filter(z => !z.isDead && z._skinMesh).map(z => {
    z.group.updateMatrixWorld(true);
    const wb = new THREE.Box3().setFromObject(z._skinMesh.body);
    return {
      type: z.type,
      worldSize: { x: +(wb.max.x - wb.min.x).toFixed(2), y: +(wb.max.y - wb.min.y).toFixed(2), z: +(wb.max.z - wb.min.z).toFixed(2) },
      feetY: +wb.min.y.toFixed(2),
      topY: +wb.max.y.toFixed(2),
      headY: z._parts[1] ? +z._parts[1].getWorldPosition(new THREE.Vector3()).y.toFixed(2) : null,
    };
  });
});
console.log(JSON.stringify(report, null, 2));
await browser.close();