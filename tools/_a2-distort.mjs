// _a2-distort.mjs — spawn 2 shamblers (wave-1 first slots) + inspect their mesh
// transform + geometry for distortion (scale, bbox aspect, vertex sanity).
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
await page.waitForTimeout(9000);
const report = await page.evaluate(() => {
  const g = window.__game;
  return g.zombies.filter(z => !z.isDead && z._skinMesh).slice(0, 3).map(z => {
    const body = z._skinMesh.body;
    const geo = body.geometry;
    const pos = geo.attributes.position;
    // measure raw geometry bbox (local, pre-scale)
    geo.computeBoundingBox();
    const gb = geo.boundingBox;
    const gs = { x: +(gb.max.x - gb.min.x).toFixed(2), y: +(gb.max.y - gb.min.y).toFixed(2), z: +(gb.max.z - gb.min.z).toFixed(2) };
    // world bbox after scale
    z.group.updateMatrixWorld(true); z._skinMesh.root.updateMatrixWorld(true);
    const THREE = window.__game.THREE || null;
    const wb = new (window.THREE ? window.THREE.Box3 : Object)();
    return {
      type: z.type,
      rootScale: { x: +z._skinMesh.root.scale.x.toFixed(3), y: +z._skinMesh.root.scale.y.toFixed(3), z: +z._skinMesh.root.scale.z.toFixed(3) },
      groupScale: { x: +z.group.scale.x.toFixed(3), y: +z.group.scale.y.toFixed(3), z: +z.group.scale.z.toFixed(3) },
      geoLocalSize: gs,
      hasSkinning: !!body.geometry.attributes.skinIndex || !!body.geometry.attributes.skinWeight,
      vertexCount: pos.count,
      headScale: z._parts[1] ? { x: +z._parts[1].scale.x.toFixed(2), y: +z._parts[1].scale.y.toFixed(2), z: +z._parts[1].scale.z.toFixed(2) } : null,
    };
  });
});
console.log(JSON.stringify(report, null, 2));
await browser.close();