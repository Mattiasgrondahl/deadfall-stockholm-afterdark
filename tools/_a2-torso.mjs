// _a2-torso.mjs — after meshes attach + frames run, check primitive torso visibility
// (double-body risk) and whether _applyLOD re-hid it.
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
// Force several LOD passes by stepping frames.
await page.evaluate(() => { const g = window.__game; for (let i = 0; i < 120; i++) g.step(1 / 60); });
const report = await page.evaluate(() => {
  const g = window.__game;
  return g.zombies.filter(z => !z.isDead).map(z => ({
    type: z.type, hasMesh: !!z._skinMesh,
    torsoVis: z._parts && z._parts[0] ? z._parts[0].visible : null,
    armLVis: z._parts && z._parts[2] ? z._parts[2].visible : null,
    headVis: z._parts && z._parts[1] ? z._parts[1].visible : null,
    meshVis: z._skinMesh ? z._skinMesh.root.visible : null,
    lodSkinned: z._lodSkinned, lodMesh: z._lodMesh,
  }));
});
console.log(JSON.stringify(report, null, 2));
await browser.close();