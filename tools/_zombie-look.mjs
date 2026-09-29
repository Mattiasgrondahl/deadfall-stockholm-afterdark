// _zombie-look.mjs — capture the first-spawned zombies up close for VLM review.
// Spawns a shambler + screamer directly in front of the player and screenshots.
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
// Clear the wave, then spawn a shambler + screamer a few meters in front of the player.
await page.evaluate(() => {
  const g = window.__game;
  g.debug.killAllZombies();
  const p = g.debug.playerPos();
  g.debug.spawnZombie('shambler', p.x - 1.2, p.z - 3.0);
  g.debug.spawnZombie('screamer', p.x + 1.2, p.z - 3.0);
});
await page.waitForTimeout(8000);
await page.screenshot({ path: path.join(WS, '.research', 'zombie-look.png') });
console.log('captured .research/zombie-look.png');
await browser.close();