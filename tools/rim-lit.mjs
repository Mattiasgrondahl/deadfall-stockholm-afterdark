// rim-lit.mjs — what does the silhouette rim buy, measured at TRUE camera range?
//
// WHY THIS EXISTS. tools/rim-contrast.mjs measured the rim against the backdrop
// it replaces (luma ~28 at night) and concluded width is not a lever. Two gaps
// remained: (a) the combat-relevant lit case was never measured, and (b) the
// frozen-vantage probes place the *player* with debug.setPlayerPos, but the
// camera only syncs inside update(), which is gated on PLAYING — so a paused
// capture renders from the camera's last position, NOT the intended vantage.
// Scene 09's "nearest 6 m" frame is really 11.8 m from the camera, i.e. every
// projected-pixel claim from a paused frame was computed at ~2x the true range.
// This tool sets the camera explicitly and measures the rim at true ranges.
//
// METHOD. Frozen vantage (sim paused => render only, so streetlight flicker
// cannot move between captures; the flashlight is pinned by writing
// spot.intensity directly because flashlight.update is gated on PLAYING).
// Per range: {beam off, on} x {shells on, off}. A rim pixel = dark in the
// shells-on frame and NOT dark in the shells-off frame, bucketed by the luma of
// the backdrop it replaced. Inside the projected silhouette we also compare
// body luma (shells off) against the black rim: the body-vs-rim edge, which is
// what an outline physically is.
//
// MEASURED (v37 R5d, 1280x720, fov 75, camera placed explicitly):
//   true range   rim px   backdrop luma  contrast   body-vs-rim edge
//   2.0 m         6.3 px        27           19          20  (beam off)
//   6.0 m         2.1 px        27           18          20
//   10.0 m        1.3 px        27           18          20
//   20.0 m        0.6 px        27           18          20
//   Lit backdrop behind the rim: ZERO pixels at every range, beam on or off.
//   Beam on at 2 m: body luma 25 -> 96, rim stays 0 -> body-vs-rim edge 20 -> 96.
// CONCLUSION: the "rim pays off against a lit backdrop" hypothesis is not
// reachable in this game's lighting. The flashlight is 55 cd with inverse-square
// decay and a 14 m cutoff, so it lights the GROUND NEAR the player and the BODY
// of a close zombie; it structurally cannot light the backdrop *behind* a
// target. The rim's payoff is the body-vs-rim edge, and because a black shell
// is tone-map invariant (0 -> 0) that edge grows for free whenever the beam
// brightens the body: 20/255 unlit, 96/255 in the beam at melee range. Black is
// therefore the right rim colour, and width stays at OUTLINE_RIM = 0.015 m.
//
// Usage: node tools/rim-lit.mjs        (needs `npm run dev` on :5173)
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import path from 'node:path';

const WS = process.cwd();
const OUT = path.join(WS, '.research', 'look');
const CHROME = path.join(WS, '.browsers', 'chromium_headless_shell-1243', 'chrome-headless-shell-linux64', 'chrome-headless-shell');
const LIT_AT = 90; // luma above which we call the backdrop "lit"
const W = 1280, H = 720;
const RANGES = [2, 6, 10, 20];

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));

await page.goto('http://127.0.0.1:5173', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.renderer, { timeout: 30000 });
await page.click('.screen .btn.primary');
await page.waitForFunction(() => window.__game.debug && window.__game.debug.zombiesAlive() > 0, { timeout: 60000 });
await page.waitForTimeout(1200);

// Deterministic vantage. The camera is placed EXPLICITLY: debug.setPlayerPos
// moves player.position only, and the camera sync happens in update(), which is
// gated on PLAYING — so a paused capture would otherwise render from wherever
// the camera last was.
const setup = (ranges) => page.evaluate(({ ranges, W, H }) => {
  const g = window.__game;
  g.debug.killAllZombies();
  const px = 12, pz = 12;
  g.debug.setPlayerPos(px, pz);
  const c = g.player.camera;
  c.rotation.order = 'YXZ';
  c.rotation.set(0, 0, 0);
  c.position.set(px, 1.7, pz); // yaw 0 looks toward -Z
  c.updateMatrixWorld(true);
  for (const d of ranges) g.debug.spawnZombie('walker', px, pz - d, false);
  g.state = 'paused';
  c.updateMatrixWorld(true);
  const tan = Math.tan((c.fov / 2) * Math.PI / 180);
  const boxes = g.zombies.map((z) => {
    const d = z.position.distanceTo(c.position);
    const p = z.position.clone(); p.y += 0.9; p.project(c);
    const s = z.isBoss ? 2.5 : 1, k = 2 * tan * d;
    const box = {
      x0: Math.max(0, Math.round((p.x * 0.5 + 0.5) * W - (0.45 * s) / k * W)),
      x1: Math.min(W - 1, Math.round((p.x * 0.5 + 0.5) * W + (0.45 * s) / k * W)),
      y0: Math.max(0, Math.round((-p.y * 0.5 + 0.5) * H - (0.9 * s) / k * H)),
      y1: Math.min(H - 1, Math.round((-p.y * 0.5 + 0.5) * H + (0.9 * s) / k * H)),
      d: +d.toFixed(1)
    };
    return box;
  }).filter((b) => Number.isFinite(b.x0) && Number.isFinite(b.x1) && b.x1 > b.x0 && b.y1 > b.y0);
  return {
    alive: g.zombies.length,
    cam: [+c.position.x.toFixed(1), +c.position.y.toFixed(1), +c.position.z.toFixed(1)],
    dists: g.zombies.map((z) => +z.position.distanceTo(c.position).toFixed(1)),
    boxes
  };
}, { ranges: RANGES, W, H });

const setFlash = (on) => page.evaluate((on) => {
  const f = window.__game.flashlight;
  f.battery = 1;
  f.on = on;
  f.spot.intensity = on ? 55 : 0; // BASE_INTENSITY; update() is gated on PLAYING
}, on);
const setShells = (on) => page.evaluate((on) => {
  for (const z of window.__game.zombies) if (z._outline) for (const m of z._outline) m.visible = on;
});

const load = async (f) => sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const luma = (d, k) => (d[k] + d[k + 1] + d[k + 2]) / 3;

const view = await setup(RANGES);
console.log(`camera (${view.cam}), yaw 0, ${view.alive} walkers at ${view.dists.join(', ')} m (true camera distances)`);

const frames = {};
for (const flash of ['off', 'on']) {
  await setFlash(flash === 'on');
  await setShells(true);
  await page.waitForTimeout(600);
  frames[`${flash}On`] = path.join(OUT, `_lit-${flash}-on.png`);
  await page.screenshot({ path: frames[`${flash}On`] });
  await setShells(false);
  await page.waitForTimeout(500);
  frames[`${flash}Off`] = path.join(OUT, `_lit-${flash}-off.png`);
  await page.screenshot({ path: frames[`${flash}Off`] });
}
await browser.close();

const boxes = view.boxes;
const inBox = (x, y) => boxes.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
const tan = Math.tan((75 / 2) * Math.PI / 180);

for (const flash of ['off', 'on']) {
  const on = await load(frames[`${flash}On`]);
  const off = await load(frames[`${flash}Off`]);
  const n = on.data.length / on.info.channels;
  let rimPx = 0, sumBack = 0, sumRim = 0, lit = 0;
  let bodyPx = 0, bodySum = 0, rimIn = 0, rimInSum = 0, litOff = 0, litOn = 0;
  for (let i = 0; i < n; i++) {
    const k = i * on.info.channels;
    const a = luma(off.data, k), b = luma(on.data, k);
    if (b < 25 && a >= b + 12) { rimPx++; sumBack += a; sumRim += b; if (a > LIT_AT) lit++; }
    const x = i % W, y = (i / W) | 0;
    if (inBox(x, y)) {
      bodyPx++; bodySum += a;
      if (b < 25) { rimIn++; rimInSum += a; }
      if (a > LIT_AT) litOff++;
      if (b > LIT_AT) litOn++;
    }
  }
  const back = rimPx ? sumBack / rimPx : 0;
  const bodyMean = bodyPx ? bodySum / bodyPx : 0;
  const rimInMean = rimIn ? rimInSum / rimIn : 0;
  console.log(`beam ${flash}: rim ${rimPx} px, backdrop luma ${back.toFixed(0)}, contrast ${(back - (rimPx ? sumRim / rimPx : 0)).toFixed(0)}, lit backdrop ${lit} px`);
  console.log(`  inside silhouettes (${bodyPx} px): body luma ${bodyMean.toFixed(0)}, rim ${rimInMean.toFixed(0)} -> body-vs-rim edge ${(bodyMean - rimInMean).toFixed(0)}, px>90 ${litOff} -> ${litOn}`);
}
console.log(`rim width in px by true range: ${RANGES.map((d) => `${d}m ${((0.015 / (2 * tan * d)) * W).toFixed(1)}px`).join(', ')}`);
console.log('NOTE: the beam lights the BODY, never the backdrop behind a target (55 cd, inverse-square, 14 m cutoff). The rim\'s payoff is the body-vs-rim edge, and a tonemap-invariant black rim tracks the beam for free.');
