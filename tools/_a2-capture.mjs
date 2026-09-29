// _a2-capture.mjs — browser proof that A2 distinct per-type body meshes attach.
// Spawns shambler/screamer/brute near the player, waits for their GLBs to load
// (async), then reads each zombie's _skinMesh state + captures a screenshot.
// Usage: node tools/_a2-capture.mjs  (requires the game running at :5173)
import { chromium } from 'playwright-core';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const WS = process.cwd();
const CHROME = path.join(WS, '.browsers', 'chromium_headless_shell-1243', 'chrome-headless-shell-linux64', 'chrome-headless-shell');
const OUT = path.join(WS, '.research', 'look');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
page.on('console', m => { if (m.type() === 'error') console.error('CONSOLE:', m.text()); });

await page.goto('http://127.0.0.1:5173', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.renderer, { timeout: 30000 });
await page.click('.screen .btn.primary');
await page.waitForFunction(() => window.__game.debug && window.__game.debug.zombiesAlive() > 0, { timeout: 60000 });

// Spawn the three distinct types in a row in front of the player (player faces -z).
await page.evaluate(() => {
  const g = window.__game;
  g.debug.spawnZombie('shambler', -2, -6);
  g.debug.spawnZombie('screamer', 0, -6);
  g.debug.spawnZombie('brute', 2, -6);
  g.debug.setPlayerPos(0, 0);
  g.inputState.turnX = 0; g.inputState.turnY = 0;
});
// Give the async GLTFLoader time to fetch + attach all three.
await page.waitForTimeout(9000);

const report = await page.evaluate(() => {
  const g = window.__game;
  const out = [];
  for (const z of g.zombies) {
    if (z.isDead) continue;
    out.push({
      type: z.type,
      hasMesh: !!z._skinMesh,
      meshVisible: z._skinMesh ? z._skinMesh.root.visible : null,
      torsoHidden: z._parts && z._parts[0] ? z._parts[0].visible === false : null,
      headVisible: z._parts && z._parts[1] ? z._parts[1].visible === true : null,
      tint: z._meshRestMat ? z._meshRestMat.color.getHexString() : null,
    });
  }
  return { alive: g.debug.zombiesAlive(), sceneStats: g.debug.sceneStats(), zombies: out };
});
console.log(JSON.stringify(report, null, 2));

await page.screenshot({ path: path.join(OUT, 'a2-distinct-meshes.png') });
console.log('a2-distinct-meshes captured');
await browser.close();