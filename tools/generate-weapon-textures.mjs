#!/usr/bin/env node
// tools/generate-weapon-textures.mjs
// Generates two weapon-surface textures (sword blade, axe head) through the
// WanGP Gradio UI at http://127.0.0.1:7860 using headless Playwright, and
// saves results under public/assets/weapons/.
//
// IMPORTANT: unlike the face generator, these run WITHOUT the Mattias LoRA
// (activated_loras: []) — the character LoRA would warp object art. After
// loading each settings file the script verifies no LoRA chip is active and
// aborts that variant if one is.
//
// The prompts describe full-frame extreme close-ups of the metal surface so
// the texture covers the entire box face it will be applied to (no black
// background around a small object).
//
// Usage:
//   node tools/generate-weapon-textures.mjs            run all not-yet-complete variants
//   node tools/generate-weapon-textures.mjs --only sword
//   node tools/generate-weapon-textures.mjs --dryrun   load settings, verify, no generation

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const WS = path.resolve(new URL('..', import.meta.url).pathname);
const RESEARCH = path.join(WS, '.research');
const WEAPONS = path.join(WS, 'public', 'assets', 'weapons');
const APP_URL = 'http://127.0.0.1:7860';
const CHROME = path.join(WS, '.browsers', 'chromium_headless_shell-1243', 'chrome-headless-shell-linux64', 'chrome-headless-shell');
const GEN_TIMEOUT_MS = 600 * 1000;

const BASE = JSON.parse(fs.readFileSync(path.join(RESEARCH, 'zimage_mattias.json'), 'utf8'));
// Prompts are written for seamless texture generation: the surface must fill
// the whole frame edge to edge (no object-in-background, no border slivers),
// because these become box-face materials.
const VARIANTS = [
  { name: 'sword', seed: 13, prompt: 'seamless full-frame extreme macro close-up texture of a weathered forged dark steel sword blade surface, the metal fills the entire frame edge to edge, no background, no border, no margin, no object, dense fine scratches and wear marks, faint etched rune symbols along one edge, light dried blood spatter near the top edge, moderate dramatic side lighting, photorealistic, no text, no hands, no logo' },
  { name: 'axe', seed: 14, prompt: 'seamless full-frame extreme macro close-up texture of a weathered forged dark steel battle axe head surface, the metal fills the entire frame edge to edge, no background, no border, no margin, no object, a beveled cutting edge crossing the frame, chips and pitting, fine scratches, dried blood streaks along the edge, moderate dramatic side lighting, photorealistic, no text, no hands, no logo' }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function settingsFileFor(v) {
  const p = path.join(RESEARCH, `zimage_${v.name}.json`);
  const cfg = {
    ...BASE,
    prompt: v.prompt,
    resolution: '768x768',
    seed: v.seed,
    output_filename: `zf_${v.name}`,
    activated_loras: [],
    loras_multipliers: '1'
  };
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return p;
}

function rawPath(name, ext) { return path.join(RESEARCH, `zw-${name}-raw.${ext}`); }

function isValidRaw(p) {
  try {
    const b = fs.readFileSync(p);
    if (b.length < 10 * 1024) return false;
    return (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0xff && b[1] === 0xd8);
  } catch { return false }
}

async function waitFor(page, fn, ms, label, step = 1000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await fn()) return true; } catch { /* retry */ }
    await sleep(step);
  }
  throw new Error(`timeout after ${ms}ms waiting for: ${label}`);
}

async function promptValue(page) {
  return page.evaluate((ids) => {
    for (const id of ids) {
      const b = document.getElementById(id);
      if (!b || b.offsetParent === null) continue;
      const ta = b.querySelector('textarea, input');
      if (ta) return { id, value: ta.value };
    }
    return null;
  }, ['wangp-prompt-advanced', 'wangp-prompt-wizard']);
}

async function statusText(page) {
  return page.evaluate(() => {
    for (const l of document.querySelectorAll('label, .label, .block-title')) {
      if (l.textContent.trim() !== 'Status') continue;
      const b = l.closest('.block');
      const el = b && (b.querySelector('textarea, input, pre, .gradio-text') || null);
      return el ? (el.value ?? el.textContent) : l.textContent;
    }
    return '';
  });
}

async function gallerySrcs(page) {
  return page.evaluate(() => {
    const g = document.getElementById('gallery');
    return g ? [...g.querySelectorAll('img')].map((i) => i.src) : [];
  });
}

async function fetchSrc(page, src) {
  if (src.startsWith('data:')) return Buffer.from((src.split(',')[1] || '').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  const r = await page.request.fetch(src, { timeout: 120000 });
  if (!r.ok()) throw new Error(`download failed: ${src} -> HTTP ${r.status()}`);
  return await r.body();
}

async function settingsFileInput(page) {
  const idx = await page.evaluate(() => {
    const inps = [...document.querySelectorAll('input[type=file]')];
    for (let k = 0; k < inps.length; k++) {
      const b = inps[k].closest('.block');
      if (b && b.offsetParent !== null && b.textContent.includes('Load Settings From Media File')) return k;
    }
    return -1;
  });
  if (idx === -1) throw new Error('settings file input not found in DOM');
  return page.locator('input[type=file]').nth(idx);
}

async function loraChips(page) {
  return page.evaluate(() => [...document.querySelectorAll('.hierarchy-selector-chip-text')].map((e) => e.textContent.trim()));
}

async function clickGenerate(page) {
  return page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent.trim() === 'Generate' && b.offsetParent !== null) { b.click(); return true; }
    }
    return false;
  });
}

async function downloadImage(v, buf) {
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
  if (!isPng && !isJpg) throw new Error('output is not PNG/JPEG');
  const ext = isPng ? 'png' : 'jpg';
  const raw = rawPath(v.name, ext);
  fs.writeFileSync(raw, buf);
  fs.mkdirSync(WEAPONS, { recursive: true });
  const out = path.join(WEAPONS, `${v.name}.${ext}`);
  fs.copyFileSync(raw, out);
  console.log(`RESULT ${v.name}: ${out} (raw: ${raw}) | ${buf.length} bytes`);
}

async function runVariant(page, v, report, dryrun = false) {
  const t0 = Date.now();
  const cfgPath = settingsFileFor(v);
  const fileInput = await settingsFileInput(page);
  await fileInput.setInputFiles(cfgPath);
  try {
    await waitFor(page, async () => {
      const p = await promptValue(page);
      if (!p || p.value.trim() !== v.prompt.trim()) return false;
      const formSwitched = await page.evaluate(() => {
        const labels = [...document.querySelectorAll('.block')]
          .filter((b) => b.offsetParent).map((b) => (b.querySelector('label, .label') || {}).textContent || '');
        return !labels.some((t) => t.includes('Number of frames'));
      });
      const genBtn = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Generate' && b.offsetParent !== null));
      return formSwitched && genBtn;
    }, 90000, `form ready for ${v.name}`);
  } catch (e) {
    const p = await promptValue(page);
    const chips = await loraChips(page);
    const genBtn = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Generate' && b.offsetParent !== null));
    const formInfo = await page.evaluate(() => {
      const blocks = [...document.querySelectorAll('.block')].filter((b) => b.offsetParent);
      const labels = blocks.map((b) => (b.querySelector('label, .label') || {}).textContent || '').map((t) => t.trim()).filter(Boolean);
      return {
        formSwitched: !labels.some((t) => t.includes('Number of frames')),
        frameLabelHits: labels.filter((t) => t.includes('Number of frames')),
        allLabels: labels.slice(0, 40)
      };
    });
    console.log(`[${v.name}] form-ready diagnostics:`, JSON.stringify({
      promptId: p ? p.id : null,
      promptMatches: p ? p.value.trim() === v.prompt.trim() : false,
      promptHead: p ? p.value.slice(0, 80) : '',
      loraChips: chips,
      generateVisible: genBtn,
      formSwitched: formInfo.formSwitched,
      frameLabelHits: formInfo.frameLabelHits,
      allLabels: formInfo.allLabels,
      status: (await statusText(page)).slice(0, 160)
    }, null, 1));
    throw e;
  }
  // Weapon art must NOT run with the character LoRA; abort if any chip is active.
  const chips = await loraChips(page);
  if (chips.length > 0) throw new Error(`LoRA chip still active after settings load: ${chips.join(', ')}`);
  if (dryrun) {
    console.log(`[${v.name}] dryrun: settings loaded, no LoRA active; not generating`);
    report.push({ name: v.name, ok: true, secs: (Date.now() - t0) / 1000, error: 'dryrun (no generation)' });
    return;
  }
  const before = await gallerySrcs(page);
  if (!(await clickGenerate(page))) throw new Error('Generate button not visible');
  console.log(`[${v.name}] generation started; status: ${(await statusText(page)).slice(0, 120)}`);
  const end = Date.now() + GEN_TIMEOUT_MS;
  let done = false, lastStatus = '';
  while (Date.now() < end) {
    const srcs = await gallerySrcs(page);
    const fresh = srcs.filter((s) => !before.includes(s));
    if (fresh.length > 0) {
      const buf = await fetchSrc(page, fresh[fresh.length - 1]);
      if (buf.length > 10 * 1024) { done = true; await downloadImage(v, buf); break; }
    }
    lastStatus = (await statusText(page)).slice(0, 120);
    await sleep(2000);
  }
  if (!done) {
    report.push({ name: v.name, ok: false, secs: (Date.now() - t0) / 1000, error: `timed out after 600s (last status: ${lastStatus})` });
    return;
  }
  report.push({ name: v.name, ok: true, secs: (Date.now() - t0) / 1000 });
}

async function probe(page, v) {
  const cfgPath = settingsFileFor(v);
  const fileInput = await settingsFileInput(page);
  await fileInput.setInputFiles(cfgPath);
  await sleep(15000); // give the settings load time to settle
  const p = await promptValue(page);
  const status = (await statusText(page)).slice(0, 200);
  const chips = await loraChips(page);
  const genBtn = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Generate' && b.offsetParent !== null));
  const framesLabel = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.block')].filter((b) => b.offsetParent).map((b) => (b.querySelector('label, .label') || {}).textContent || '');
    return labels.some((t) => t.includes('Number of frames'));
  });
  console.log('PROBE', JSON.stringify({
    promptId: p ? p.id : null,
    promptLen: p ? p.value.length : 0,
    promptMatches: p ? p.value.trim() === v.prompt.trim() : false,
    promptHead: p ? p.value.slice(0, 80) : '',
    status,
    loraChips: chips,
    generateVisible: genBtn,
    framesLabelVisible: framesLabel
  }, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const dryrun = args.includes('--dryrun');
  fs.mkdirSync(RESEARCH, { recursive: true });
  for (const v of VARIANTS) settingsFileFor(v);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await page.goto(APP_URL, { timeout: 30000 });
  await waitFor(page, async () => (await page.locator('gradio-app, #gradio').count()) > 0, 60000, 'gradio app shell');
  await waitFor(page, async () => (await promptValue(page)) !== null, 60000, 'prompt textbox visible');

  if (args.includes('--probe')) {
    await probe(page, VARIANTS[0]);
    await browser.close();
    process.exit(0);
  }

  const report = [];
  for (const v of VARIANTS) {
    if (only && v.name !== only) continue;
    const existing = ['png', 'jpg'].map((e) => rawPath(v.name, e)).find(isValidRaw);
    if (existing) {
      console.log(`[${v.name}] already complete: ${existing} — skipping`);
      report.push({ name: v.name, ok: true, secs: 0, error: 'skipped (already present)' });
      continue;
    }
    const t0 = Date.now();
    try { await runVariant(page, v, report, dryrun); }
    catch (e) {
      console.log(`[${v.name}] FAILED: ${e.message}`);
      report.push({ name: v.name, ok: false, secs: (Date.now() - t0) / 1000, error: e.message });
    }
  }
  console.log('\nSUMMARY');
  for (const r of report) console.log(`- ${r.name}: ${r.ok ? 'OK' : 'FAIL'} in ${r.secs.toFixed(1)}s ${r.error || ''}`);
  await browser.close();
  process.exit(report.length > 0 && report.every((r) => r.ok) ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(2); });
