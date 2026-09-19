// look-capture.mjs — headless Playwright screenshots of the live game for visual
// assessment (no gameplay assertions; pure look diagnosis).
// Usage: node tools/look-capture.mjs  (requires the game running at :5173)
// Outputs: .research/look/*.png
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

await page.goto('http://127.0.0.1:5173', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.renderer, { timeout: 30000 });
await page.waitForTimeout(2500); // let sky/lights settle
await page.screenshot({ path: path.join(OUT, '01-title.png') });
console.log('01-title captured');

// Start the game (title START button is the first .btn.primary)
await page.click('.screen .btn.primary');
await page.waitForFunction(() => window.__game.debug && window.__game.debug.zombiesAlive() > 0, { timeout: 60000 });
await page.waitForTimeout(3000); // frames render, wave active
await page.screenshot({ path: path.join(OUT, '02-play-default.png') });
console.log('02-play-default captured');

const look = (tx, ty) => page.evaluate(([tx, ty]) => {
  const g = window.__game;
  g.inputState.turnX = tx;
  g.inputState.turnY = ty;
}, [tx, ty]);
const move = (x, z) => page.evaluate(([x, z]) => window.__game.debug.setPlayerPos(x, z), [x, z]);
const toggleFlashlight = () => page.evaluate(() => {
  const g = window.__game;
  if (g.flashlight) g.flashlight.toggle(); // edge-driven public method
});
const shoot = () => page.evaluate(() => { window.__game.debug.shootOnce(); });

await look(-1.1, 0);
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, '03-look-left.png') });
console.log('03-look-left captured');

await look(1.1, 0);
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, '04-look-right.png') });
console.log('04-look-right captured');

// Street intersection vantage (blocks pitch 24, size 15 -> street centers at multiples of 12 offset)
await move(12, 12);
await look(0, 0);
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(OUT, '05-intersection.png') });
console.log('05-intersection captured');

// Turn to face a different street direction
await look(1.57, 0);
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, '06-intersection-turned.png') });
console.log('06-intersection-turned captured');

// Another block out, flashlit alley
await move(36, 36);
await toggleFlashlight();
await look(-0.6, 0);
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(OUT, '07-flashlight.png') });
console.log('07-flashlight captured');

// Muzzle flash + blood
await shoot();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, '08-muzzle.png') });
console.log('08-muzzle captured');

await browser.close();
console.log('done:', OUT);
