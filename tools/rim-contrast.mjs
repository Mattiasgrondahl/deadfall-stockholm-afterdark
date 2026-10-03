// rim-contrast.mjs — perceptual audit of the zombie silhouette rim (browser).
//
// WHY THIS EXISTS. tools/verify-outline.mjs proves the rim is *geometrically*
// correct: constant 0.015 m, contains its part every frame, projects >= 1 px.
// Geometry is necessary but NOT sufficient — the VLM readability verdict stayed
// "not discernible" at 6 m even after the geometry passed, so the remaining
// question is photometric: does the rim actually contrast with what it replaced?
//
// METHOD. One frozen frame (sim paused -> render only, so the streetlight
// flicker cannot move between captures), 4 zombies in the view cone, camera at
// yaw 0. For each candidate rim width we recolor the shells and diff against
// the shells-hidden frame. A rim pixel = darker in ON, not dark in OFF. We then
// report the luma of the backdrop the rim *replaced*: a black rim only separates
// a body where that backdrop was BRIGHT.
//
// MEASURED (v37 R5d, 1280x720, fov 75, camera placed explicitly at (12,1.7,12),
// 5 zombies, nearest 6.2 m — see the camera note below; the R5c run below was
// taken from the camera's stale position, i.e. ~2x the range it claimed):
//   rim 0.015 m (2.0 px @6.2 m): 24279 rim px, backdrop luma 29, contrast 22,
//                                lit-backdrop cuts 515, dark-backdrop cuts 23764
//   rim 0.030 m (4.0 px @6.2 m): 59539 rim px, backdrop luma 28, contrast 20,
//                                lit-backdrop cuts 1227, dark-backdrop cuts 58312
//   rim 0.045 m (6.0 px @6.2 m): 57126 rim px, backdrop luma 30, contrast 21,
//                                lit-backdrop cuts 1818, dark-backdrop cuts 55308
// CONCLUSION: rim WIDTH is not the lever. Tripling it leaves contrast flat
// (22 -> 20 -> 21) because in a night scene the backdrop is already ~luma 29 and
// a black shell has nothing to stand out against. Widening does buy more
// lit-backdrop cuts (515 -> 1818) — the shell spills past the body into lit
// ground — at the cost of 2.4x the rim pixels and a fatter silhouette. The rim
// pays off against LIT backdrop (streetlight pools, flashlight cone), which is
// the combat-relevant case, so 0.015 m is kept. If readability at range is ever
// raised again, the lever is rim CONTRAST, not scale — and see tools/rim-lit.mjs
// for what lit actually means here.
//
// RIM COLOUR IS ALSO NOT A LEVER (measured, same vantage, mask = the
// tonemap-invariant black-rim frame so flicker cannot pollute the metric):
//   black 0x000000  rim luma  7  contrast 17  100 % of masked px differ >= 12
//   grey  0.35 lin  rim luma 16  contrast  8   51 %
//   grey  0.55 lin  rim luma 17  contrast  7   52 %
//   grey  0.75 lin  rim luma 15  contrast 10   72 %
//   white 1.2  +toneMapped=false  rim luma 20  contrast  4   31 %
// Lightening the rim makes it WORSE, and `toneMapped = false` does not rescue
// it: the masked pixels are the anti-aliased edge sliver, so their value is a
// coverage-weighted blend of rim and body, and a light rim blends toward the
// dark body it is hugging. Black is the only value that is tonemap-invariant
// (0 -> 0) and it is the strongest of the set.
//
// WHAT THE RIM DOES ACHIEVE: 100 % of masked rim pixels shift by >= 12 luma and
// the mean separation is 17/255 against a luma-24 backdrop. In a night scene
// that is a real edge — the geometry fix (sub-pixel 0.4 px -> 2.5 px at 5 m) is
// what made it measurable. The local VLM is NOT a reliable gate for it: it
// answered "yes, clearly separated" at 4 m (3.1 px rim) and "not discernible" at
// 6 m (2.1 px), and it answered "not discernible" on a frame that provably
// contained ZERO zombies. Use this tool's numbers, not the VLM's prose, to
// decide rim changes; use the VLM only for whole-frame gestalt.
//
// Usage: node tools/rim-contrast.mjs [rimWidths...]   (needs `npm run dev` on :5173)
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import path from 'node:path';

const WS = process.cwd();
const OUT = path.join(WS, '.research', 'look');
const WIDTHS = process.argv.slice(2).map(Number).filter((n) => n > 0);
const RIMS = WIDTHS.length ? WIDTHS : [0.015, 0.03, 0.045];
const CHROME = path.join(WS, '.browsers', 'chromium_headless_shell-1243', 'chrome-headless-shell-linux64', 'chrome-headless-shell');

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));

await page.goto('http://127.0.0.1:5173', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.renderer, { timeout: 30000 });
await page.click('.screen .btn.primary');
await page.waitForFunction(() => window.__game.debug && window.__game.debug.zombiesAlive() > 0, { timeout: 60000 });
await page.waitForTimeout(1200);

// Deterministic vantage: fixed camera, fixed yaw, fixed spawns, frozen sim.
// The camera is placed EXPLICITLY: debug.setPlayerPos moves player.position
// only, and the camera syncs inside update(), which is gated on PLAYING — so a
// paused capture renders from the camera's last position, not the intended
// vantage. Distances and projected-pixel claims must come from the camera.
const view = await page.evaluate(() => {
  const g = window.__game;
  g.debug.setPlayerPos(12, 12);
  g.player.camera.rotation.order = 'YXZ';
  g.player.camera.rotation.set(0, 0, 0);
  g.player.camera.position.set(12, 1.7, 12);
  g.player.camera.updateMatrixWorld(true);
  for (const [t, x, z] of [['walker', 12, 6], ['shambler', 8.5, 4], ['screamer', 15.5, 5], ['walker', 12, 1.5]]) {
    g.debug.spawnZombie(t, x, z, false);
  }
  g.state = 'paused'; // update() is gated on PLAYING; render() is not
  g.player.camera.updateMatrixWorld(true);
  const cam = g.player.camera.position;
  const tan = Math.tan((g.player.camera.fov / 2) * Math.PI / 180);
  const near = Math.min(...g.zombies.map((z) => z.position.distanceTo(cam)));
  return { alive: g.zombies.length, near, tan };
});
await page.waitForTimeout(900);

// Recolor every shell to a target rim width in metres (same math as
// ZombieOutline.attachOutline: constant world-metre rim, per-axis scale).
const setRim = (rim) => page.evaluate((rim) => {
  const sz = new window.__game.zombies[0]._outline[0].scale.constructor();
  for (const z of window.__game.zombies) {
    if (!z._outline) continue;
    for (let i = 0; i < z._outline.length; i++) {
      const geo = z._parts[i].geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      geo.boundingBox.getSize(sz);
      z._outline[i].scale.set(1 + rim / (sz.x * 0.5), 1 + rim / (sz.y * 0.5), 1 + rim / (sz.z * 0.5));
      z._outline[i].visible = true;
    }
  }
}, rim);

const shots = [];
for (const rim of RIMS) {
  await setRim(rim);
  await page.waitForTimeout(600);
  const f = path.join(OUT, `_rim-${String(rim).replace('.', '')}.png`);
  await page.screenshot({ path: f });
  shots.push([rim, f]);
}
await page.evaluate(() => {
  for (const z of window.__game.zombies) if (z._outline) for (const m of z._outline) m.visible = false;
});
await page.waitForTimeout(500);
const offPath = path.join(OUT, '_rim-off.png');
await page.screenshot({ path: offPath });
await browser.close();

const load = async (f) => sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const off = await load(offPath);
const luma = (d, k) => (d[k] + d[k + 1] + d[k + 2]) / 3;

console.log(`vantage: ${view.alive} zombies, nearest ${view.near.toFixed(1)} m, fov 75 @1280px`);
for (const [rim, f] of shots) {
  const on = await load(f);
  const n = on.data.length / on.info.channels;
  let rimPx = 0, sumBack = 0, sumRim = 0, lit = 0, dark = 0;
  for (let i = 0; i < n; i++) {
    const k = i * on.info.channels;
    const a = luma(off.data, k), b = luma(on.data, k);
    if (b < 25 && a >= b + 12) {
      rimPx++; sumBack += a; sumRim += b;
      if (a > 90) lit++; else dark++;
    }
  }
  const back = rimPx ? sumBack / rimPx : 0;
  const px = (rim / (2 * view.near * view.tan)) * 1280;
  console.log(
    `rim ${rim} m (${px.toFixed(1)} px @${view.near.toFixed(1)} m): rim px ${rimPx}, ` +
    `backdrop replaced luma ${back.toFixed(0)}, contrast ${(back - (rimPx ? sumRim / rimPx : 0)).toFixed(0)}, ` +
    `lit-backdrop cuts ${lit}, dark-backdrop cuts ${dark}`
  );
}
console.log('NOTE: contrast is bounded by the backdrop. A black rim cannot separate a body from a near-black night backdrop — widen is not the lever.');
