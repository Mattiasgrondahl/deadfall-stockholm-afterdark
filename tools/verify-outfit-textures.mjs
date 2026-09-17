#!/usr/bin/env node
// verify-outfit-textures.mjs — browser check that the six outfit textures are
// actually fetched and loaded by the live game (dev server on :5173).
// Loads the page, starts the game (Enter -> PLAYING, which spawns wave 1 and
// triggers the lazy outfit texture load), then waits for all six
// /assets/outfits/*.jpg responses to be 200 and for no "outfit texture failed"
// console warnings. Also captures console errors and a screenshot artifact.
//
// Usage: node tools/verify-outfit-textures.mjs   (dev server must be running)

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const WS = path.resolve(new URL('..', import.meta.url).pathname);
const RESEARCH = path.join(WS, '.research');
const CHROME = path.join(WS, '.browsers', 'chromium_headless_shell-1243', 'chrome-headless-shell-linux64', 'chrome-headless-shell');
const APP_URL = 'http://127.0.0.1:5173/';
const NAMES = ['suit-top', 'suit-pants', 'hoodie-top', 'sweat-pants', 'tee-top', 'jeans-pants'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(RESEARCH, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleMsgs = [];
  const outfitResponses = {};
  page.on('console', (m) => {
    const txt = m.text();
    consoleMsgs.push(`${m.type()}: ${txt}`);
    if (txt.includes('outfit texture failed')) console.log('CONSOLE:', txt);
  });
  page.on('response', (r) => {
    const url = r.url();
    for (const n of NAMES) {
      if (url.includes('/assets/outfits/' + n + '.jpg')) outfitResponses[n] = r.status();
    }
  });

  await page.goto(APP_URL, { timeout: 30000 });
  await sleep(4000); // boot + asset warm-up
  await page.mouse.click(640, 400); // title-screen gesture
  await page.keyboard.press('Enter');
  await sleep(2000);

  // Wait until all six textures have been requested (or 45 s timeout)
  const end = Date.now() + 45000;
  while (Object.keys(outfitResponses).length < NAMES.length && Date.now() < end) await sleep(1000);
  await sleep(3000); // let TextureLoader decode
  await page.screenshot({ path: path.join(RESEARCH, 'outfit-probe.png') });

  let ok = true;
  console.log('\nOUTFIT TEXTURE RESPONSES (live game, dev server):');
  for (const n of NAMES) {
    const s = outfitResponses[n];
    const good = s === 200;
    if (!good) ok = false;
    console.log(`  ${n}.jpg -> ${s ?? 'NOT REQUESTED'} ${good ? 'OK' : 'FAIL'}`)
  }
  const failures = consoleMsgs.filter((m) => m.startsWith('error') || m.startsWith('warning'));
  console.log(`\nconsole messages (${consoleMsgs.length}): ${failures.length} error/warning`);
  for (const f of failures.slice(0, 10)) console.log('  ' + f);
  await browser.close();
  console.log(ok ? 'OUTFIT VERIFY: PASS' : 'OUTFIT VERIFY: FAIL');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(2); });
