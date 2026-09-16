#!/usr/bin/env node
// tools/generate-zombie-faces.mjs
// Generates nine zombie-face images (3 types x 3 variants, z_image +
// mattias_1024_z_2 LoRA) through the WanGP Gradio UI at http://127.0.0.1:7860
// using headless Playwright, and saves results under public/assets/faces/.
// Variant 0 of each type is the original portrait ({type}-face.jpg); variants
// 1 and 2 are extra distinct faces ({type}2-face.jpg, {type}3-face.jpg).
//
// Usage:
//   node tools/generate-zombie-faces.mjs            run all not-yet-complete variants
//   node tools/generate-zombie-faces.mjs --probe    load page, dump DOM probe + screenshots, exit
//   node tools/generate-zombie-faces.mjs --only NAME  run a single variant
//     (walker|walker2|walker3|shambler|shambler2|shambler3|screamer|screamer2|screamer3)

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const WS = path.resolve(new URL('..', import.meta.url).pathname);
const RESEARCH = path.join(WS, '.research');
const FACES = path.join(WS, 'public', 'assets', 'faces');
const APP_URL = 'http://127.0.0.1:7860';
const CHROME = path.join(WS, '.browsers', 'chromium_headless_shell-1243', 'chrome-headless-shell-linux64', 'chrome-headless-shell');
const LORA_NAME = 'mattias_1024_z_2';
const GEN_TIMEOUT_MS = 600 * 1000;

const BASE = JSON.parse(fs.readFileSync(path.join(RESEARCH, 'zimage_mattias.json'), 'utf8'));
const VARIANTS = [
  { name: 'walker', seed: 42, prompt: 'front-facing close-up portrait of Mattias as a fresh zombie, pale grey-green skin, dark sunken eyes, slightly open mouth, torn collar, plain solid dark olive background color, realistic photograph, no text' },
  { name: 'walker2', seed: 45, prompt: 'front-facing close-up portrait of Mattias as a fresh zombie, pale grey-green skin, blood-stained chin, black bruise around one eye, clenched jaw, matted hair, plain solid dark olive background color, realistic photograph, no text' },
  { name: 'walker3', seed: 46, prompt: 'front-facing close-up portrait of Mattias as a fresh zombie, pale grey-green skin, milky cloudy eyes, split lip, half-open mouth, thinning grey hair, plain solid dark olive background color, realistic photograph, no text' },
  { name: 'shambler', seed: 43, prompt: 'front-facing close-up portrait of Mattias as a rotting zombie, gaunt face, matted hair, drooling, decayed skin, plain solid dark brown background color, realistic photograph, no text' },
  { name: 'shambler2', seed: 47, prompt: 'front-facing close-up portrait of Mattias as a rotting zombie, gaunt face, exposed rotting teeth, blackened decayed skin, dripping blood, balding matted hair, plain solid dark brown background color, realistic photograph, no text' },
  { name: 'shambler3', seed: 48, prompt: 'front-facing close-up portrait of Mattias as a rotting zombie, gaunt face, weeping sores, cracked grey decayed skin, drool streaks, long greasy matted hair, plain solid dark brown background color, realistic photograph, no text' },
  { name: 'screamer', seed: 44, prompt: 'front-facing close-up portrait of Mattias as a screaming zombie, wide open mouth, blood on chin, wild disheveled hair, plain solid dark maroon background color, realistic photograph, no text' },
  { name: 'screamer2', seed: 49, prompt: 'front-facing close-up portrait of Mattias as a screaming zombie, gaping open mouth, blood spatter on cheek, hollow sunken eyes, wild disheveled hair, plain solid dark maroon background color, realistic photograph, no text' },
  { name: 'screamer3', seed: 50, prompt: 'front-facing close-up portrait of Mattias as a screaming zombie, twisted open mouth, bared teeth, blood on chin, bruised dark skin, wild disheveled hair, plain solid dark maroon background color, realistic photograph, no text' }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function settingsFileFor(v) {
  const p = path.join(RESEARCH, `zf_${v.name}_settings.json`);
  const cfg = { ...BASE, resolution: '768x768', seed: v.seed, prompt: v.prompt, output_filename: `zf_${v.name}` };
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return p;
}

function rawPath(name, ext) { return path.join(RESEARCH, `zf-${name}-raw.${ext}`); }

function isValidRaw(p) {
  try {
    const b = fs.readFileSync(p);
    if (b.length < 10 * 1024) return false;
    return (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0xff && b[1] === 0xd8);
  } catch { return false; }
}

function dims(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const m = buf[i + 1];
      if (m === 0xff) { i += 1; continue; }
      if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

async function shot(page, name) {
  const p = path.join(RESEARCH, name);
  await page.screenshot({ path: p });
  console.log(`[shot] ${p}`);
}

async function waitFor(page, fn, ms, label, step = 1000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await fn()) return true; } catch { /* retry */ }
    await sleep(step);
  }
  throw new Error(`timeout after ${ms}ms waiting for: ${label}`);
}

// ---------- UI helpers ----------

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

async function clickTab(page, text) {
  return page.evaluate((t) => {
    const nav = [...document.querySelectorAll('.tab-container[role="tablist"]')].find((n) => !n.classList.contains('visually-hidden'));
    const btns = nav ? [...nav.querySelectorAll('button[role="tab"]')] : [...document.querySelectorAll('button[role="tab"]')];
    const btn = btns.find((b) => b.textContent.trim() === t && b.offsetParent !== null);
    if (!btn) return false;
    btn.click();
    return true;
  }, text);
}

async function clickVisibleButton(page, text) {
  const loc = page.locator('button', { hasText: new RegExp(`^${text}$`) });
  const n = await loc.count();
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (await el.isVisible()) { await el.click(); return true; }
  }
  return false;
}

async function generateButtonVisible(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Generate' && b.offsetParent !== null));
}

async function clickGenerate(page) {
  return page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent.trim() === 'Generate' && b.offsetParent !== null) { b.click(); return true; }
    }
    return false;
  });
}

async function ensureLora(page, v) {
  if ((await loraChips(page)).some((c) => c.includes(LORA_NAME))) return true;
  // Fallback: the LoRAs section lives in the settings tabs, which are hidden in
  // wizard mode — enable Advanced Mode, open the LoRAs tab, search and pick it.
  const adv = await page.evaluate(() => {
    for (const b of document.querySelectorAll('.block')) {
      if (!b.offsetParent) continue;
      const inp = b.querySelector('input[type=checkbox]');
      if (inp && b.textContent.replace(/\s+/g, ' ').includes('Advanced Mode')) {
        if (!inp.checked) inp.click();
        return true;
      }
    }
    return false;
  });
  if (adv) await sleep(2500);
  if ((await loraChips(page)).some((c) => c.includes(LORA_NAME))) return true;
  await clickTab(page, 'LoRAs');
  await sleep(1200);
  if ((await loraChips(page)).some((c) => c.includes(LORA_NAME))) return true;
  const search = page.locator('.hierarchy-selector-search-input').first();
  await search.click();
  await search.fill(LORA_NAME);
  await waitFor(page, async () => (await page.locator('.hierarchy-search-row').count()) > 0, 15000, 'lora search results');
  const clicked = await page.evaluate((name) => {
    const row = [...document.querySelectorAll('.hierarchy-search-row')]
      .find((r) => r.textContent.includes(name) && r.offsetParent !== null);
    if (!row) return false;
    row.click();
    return true;
  }, LORA_NAME);
  await sleep(2500);
  return clicked && (await loraChips(page)).some((c) => c.includes(LORA_NAME));
}
// ---------- per-variant run ----------

async function downloadImage(v, buf) {
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
  if (!isPng && !isJpg) throw new Error('output is not PNG/JPEG');
  const ext = isPng ? 'png' : 'jpg';
  const raw = rawPath(v.name, ext);
  fs.writeFileSync(raw, buf);
  fs.mkdirSync(FACES, { recursive: true });
  const out = path.join(FACES, `${v.name}-face.${ext}`);
  fs.copyFileSync(raw, out);
  const d = dims(buf);
  console.log(`RESULT ${v.name}: ${out} (raw: ${raw}) | ${buf.length} bytes | ${d ? d.w + 'x' + d.h : '?'}px | ${ext.toUpperCase()}`);
}

async function runVariant(page, v, report, dryrun = false) {
  const t0 = Date.now();
  const cfgPath = settingsFileFor(v);
  // 1) upload settings JSON via the "Load Settings From Media File / Json / Zip" input
  const fileInput = await settingsFileInput(page);
  await fileInput.setInputFiles(cfgPath);
  // Wait until the form has fully settled: prompt filled, image form active,
  // Generate button visible. The model-switch cascade re-renders the form in
  // stages; clicking Generate before that is unsafe (stale form values would
  // overwrite the loaded settings).
  await waitFor(page, async () => {
    const p = await promptValue(page);
    if (!p || p.value.trim() !== v.prompt.trim()) return false;
    const formSwitched = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('.block')]
        .filter((b) => b.offsetParent).map((b) => (b.querySelector('label, .label') || {}).textContent || '');
      return !labels.some((t) => t.includes('Number of frames'));
    });
    return formSwitched && (await generateButtonVisible(page));
  }, 90000, `form ready for ${v.name}`);
  await shot(page, `ui-loaded-${v.name}.png`);
  // 2) verify LoRA present (settings load should have filled it even when hidden)
  const loraOk = await ensureLora(page, v);
  await shot(page, `ui-lora-${v.name}.png`);
  if (!loraOk) throw new Error(`LoRA ${LORA_NAME} not active in LoRAs area`);
  if (dryrun) {
    console.log(`[${v.name}] dryrun: settings loaded, form switched, LoRA ${loraOk ? 'present' : 'MISSING'}; not generating`);
    report.push({ name: v.name, ok: true, secs: (Date.now() - t0) / 1000, error: 'dryrun (no generation)' });
    return;
  }
  // 3) click the Generate button (only one is visible on the image form)
  const before = await gallerySrcs(page);
  if (!(await clickGenerate(page))) throw new Error('Generate button not visible');
  console.log(`[${v.name}] generation started; status: ${(await statusText(page)).slice(0, 120)}`);
  // 4) wait for a new gallery image (>10 KB) or 600 s stall
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
  await shot(page, `ui-gen-${v.name}.png`);
  if (!done) {
    await clickVisibleButton(page, 'Abort').catch(() => {});
    await sleep(2000);
    report.push({ name: v.name, ok: false, secs: (Date.now() - t0) / 1000, error: `timed out after 600s (last status: ${lastStatus})` });
    return;
  }
  report.push({ name: v.name, ok: true, secs: (Date.now() - t0) / 1000 });
}

// ---------- probe ----------

async function dumpProbe(page) {
  const info = await page.evaluate(() => {
    const txt = (el, n = 200) => (el ? el.textContent.trim().slice(0, n) : null);
    const navs = [...document.querySelectorAll('.tab-container[role="tablist"]:not(.visually-hidden)')]
      .map((n) => [...n.querySelectorAll('button[role="tab"]')].map((b) => `${b.textContent.trim()}(${b.classList.contains('selected') ? 'SEL' : ''})`).join(' | '));
    const fileInputs = [...document.querySelectorAll('input[type=file]')].map((i) => {
      const b = i.closest('.block');
      return { id: i.id, blockLabel: b ? txt(b, 80) : null };
    });
    const buttons = [...document.querySelectorAll('button')]
      .filter((b) => b.offsetParent).map((b) => b.textContent.trim()).filter(Boolean).slice(0, 80);
    const galleryImgs = document.getElementById('gallery') ? [...document.querySelectorAll('#gallery img')].length : -1;
    const chips = [...document.querySelectorAll('.hierarchy-selector-chip-text')].map((e) => e.textContent.trim());
    const blockLabels = [...document.querySelectorAll('.block')]
      .filter((b) => b.offsetParent)
      .map((b) => { const l = b.querySelector('label, .label'); return l ? l.textContent.trim().slice(0, 70) : null; })
      .filter(Boolean);
    return { navs, fileInputs, buttons, galleryImgs, chips, blockLabels };
  });
  const p = path.join(RESEARCH, 'ui-probe.txt');
  fs.writeFileSync(p, JSON.stringify(info, null, 2));
  console.log('[probe] ' + p);
  await shot(page, 'ui-tabs.png');
}

// ---------- main ----------

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const probe = args.includes('--probe');
  const dryrun = args.includes('--dryrun');
  fs.mkdirSync(RESEARCH, { recursive: true });
  for (const v of VARIANTS) settingsFileFor(v);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await page.goto(APP_URL, { timeout: 30000 });
  await waitFor(page, async () => (await page.locator('gradio-app, #gradio').count()) > 0, 60000, 'gradio app shell');
  await waitFor(page, async () => (await promptValue(page)) !== null, 60000, 'prompt textbox visible');
  await shot(page, 'ui-load.png');
  if (probe) { await dumpProbe(page); await browser.close(); return; }

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
      await shot(page, `ui-fail-${v.name}.png`);
      report.push({ name: v.name, ok: false, secs: (Date.now() - t0) / 1000, error: e.message });
    }
  }
  console.log('\nSUMMARY');
  for (const r of report) console.log(`- ${r.name}: ${r.ok ? 'OK' : 'FAIL'} in ${r.secs.toFixed(1)}s ${r.error || ''}`);
  await browser.close();
  process.exit(report.length > 0 && report.every((r) => r.ok) ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(2); });
