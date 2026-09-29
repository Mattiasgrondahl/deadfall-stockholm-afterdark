#!/usr/bin/env node
// generate-outfit-textures.mjs — generates 6 flat 2D clothing textures for
// the zombie outfit pass via the local WanGP (Z-Image) Gradio UI at
// http://127.0.0.1:7860 using headless Playwright, and saves them under
// public/assets/outfits/ (JPEG). Adapted from generate-zombie-faces.mjs:
// same settings-file flow, but NO face LoRA (mattias_1024_z_2 would pull the
// renders toward a face), per-variant resolutions matching the box UV
// aspect ratios, and PNG->JPEG re-encode via sharp so the game loader can
// hardcode .jpg.
//
// Aspect ratios (box front faces, width x height):
//   torso 0.5 x 1.0  -> 512x1024   (1 : 2)
//   leg   0.14 x 0.9 -> 256x1600   (~1 : 6.25)
// Each leg box gets the full single-leg pants texture, so two legs read as
// a pair of trousers.
//
// Usage: node tools/generate-outfit-textures.mjs [--only <name>]
// Skips variants whose final .jpg already exists. ~40 s/image expected.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright-core';

const WS = path.resolve(new URL('..', import.meta.url).pathname);
const RESEARCH = path.join(WS, '.research');
const OUTFITS = path.join(WS, 'public', 'assets', 'outfits');
const APP_URL = 'http://127.0.0.1:7860';
const CHROME = path.join(WS, '.browsers', 'chromium_headless_shell-1243', 'chrome-headless-shell-linux64', 'chrome-headless-shell');
const GEN_TIMEOUT_MS = 600 * 1000;

const BASE = JSON.parse(fs.readFileSync(path.join(RESEARCH, 'zimage_mattias.json'), 'utf8'));
BASE.activated_loras = [];       // face LoRA is wrong for clothing renders
BASE.loras_multipliers = '';

const BG = 'plain solid very dark grey background color';
const STYLE = 'flat 2D video game character texture, front view, garment fills the frame, flat clean shading, no text, no watermark';
// Nine archetypes (order matches OUTFITMATS/OUTFIT_FILES in Zombie.js): a top
// (512x1024) and a bottom (256x1600) each. The three original suit/hoodie/tee
// outfits are replaced by the richer profession look-alikes.
const VARIANTS = [
  { name: 'lawyer-top', seed: 71, resolution: '512x1024',
    prompt: `${STYLE}, headless torso only of a man wearing a charcoal business suit jacket over a white dress shirt with a dark tie, straight shoulders, no arms, no hands, no head, no legs, ${BG}` },
  { name: 'lawyer-pants', seed: 72, resolution: '256x1600',
    prompt: `${STYLE}, front view of a single charcoal suit trouser leg, straight leg from waistband to ankle, single leg only, no second leg, no torso, no head, no feet, ${BG}` },
  { name: 'mailman-top', seed: 73, resolution: '512x1024',
    prompt: `${STYLE}, headless torso only of a mail carrier wearing a navy blue short-sleeve uniform shirt with a chest pocket, no arms, no hands, no head, no legs, ${BG}` },
  { name: 'mailman-pants', seed: 74, resolution: '256x1600',
    prompt: `${STYLE}, front view of a single grey uniform trouser leg, straight leg from waistband to ankle, single leg only, no second leg, no torso, no head, no feet, ${BG}` },
  { name: 'police-top', seed: 75, resolution: '512x1024',
    prompt: `${STYLE}, headless torso only of a police officer wearing a dark navy uniform jacket with shoulder epaulettes and a metal badge, no arms, no hands, no head, no legs, ${BG}` },
  { name: 'police-pants', seed: 76, resolution: '256x1600',
    prompt: `${STYLE}, front view of a single black police uniform trouser leg, straight leg from waistband to ankle, single leg only, no second leg, no torso, no head, no feet, ${BG}` },
  { name: 'fireman-top', seed: 77, resolution: '512x1024',
    prompt: `${STYLE}, headless torso only of a firefighter wearing a tan turnout coat with reflective yellow stripes, no arms, no hands, no head, no legs, ${BG}` },
  { name: 'fireman-pants', seed: 78, resolution: '256x1600',
    prompt: `${STYLE}, front view of a single dark firefighter turnout trouser leg with a reflective stripe, straight leg from waistband to ankle, single leg only, no second leg, no torso, no head, no feet, ${BG}` },
  { name: 'dress-top', seed: 79, resolution: '512x1024',
    prompt: `${STYLE}, headless torso only of a woman wearing a crimson red dress bodice, fitted, no arms, no hands, no head, no legs, ${BG}` },
  { name: 'dress-skirt', seed: 80, resolution: '256x1600',
    prompt: `${STYLE}, front view of a single crimson red dress skirt panel, flowing fabric, single panel only, no second leg, no torso, no head, no feet, ${BG}` },
  { name: 'stripper-top', seed: 81, resolution: '512x1024',
    prompt: `${STYLE}, headless torso only of a woman wearing a black sparkly sequin top, fitted, no arms, no hands, no head, no legs, ${BG}` },
  { name: 'stripper-skirt', seed: 82, resolution: '256x1600',
    prompt: `${STYLE}, front view of a single bright pink short skirt panel, single panel only, no second leg, no torso, no head, no feet, ${BG}` },
  { name: 'schoolgirl-top', seed: 83, resolution: '512x1024',
    prompt: `${STYLE}, headless torso only of a schoolgirl wearing a white collared blouse with a small red bow tie, no arms, no hands, no head, no legs, ${BG}` },
  { name: 'schoolgirl-skirt', seed: 84, resolution: '256x1600',
    prompt: `${STYLE}, front view of a single brown plaid pleated schoolgirl skirt panel, single panel only, no second leg, no torso, no head, no feet, ${BG}` },
  { name: 'jogger-top', seed: 85, resolution: '512x1024',
    prompt: `${STYLE}, headless torso only of a jogger wearing a bright teal athletic running shirt, no arms, no hands, no head, no legs, ${BG}` },
  { name: 'jogger-shorts', seed: 86, resolution: '256x1600',
    prompt: `${STYLE}, front view of a single black athletic running short leg, short length ending at mid-thigh, single leg only, no second leg, no torso, no head, no feet, ${BG}` },
  { name: 'gym-top', seed: 87, resolution: '512x1024',
    prompt: `${STYLE}, headless torso only of a muscular man wearing a grey sleeveless gym tank top, no arms, no hands, no head, no legs, ${BG}` },
  { name: 'gym-shorts', seed: 88, resolution: '256x1600',
    prompt: `${STYLE}, front view of a single black gym short leg, short length ending at mid-thigh, single leg only, no second leg, no torso, no head, no feet, ${BG}` }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function settingsFileFor(v) {
  const p = path.join(RESEARCH, `outfit_${v.name}_settings.json`);
  const cfg = { ...BASE, resolution: v.resolution, seed: v.seed, prompt: v.prompt, output_filename: `outfit_${v.name}` };
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return p;
}

function rawPath(name, ext) { return path.join(RESEARCH, `outfit-${name}-raw.${ext}`); }
function outPath(name) { return path.join(OUTFITS, `${name}.jpg`); }

async function toJpeg(buf) {
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
  if (!isPng && !isJpg) throw new Error('output is not PNG/JPEG');
  if (isJpg) return buf;
  const out = await sharp(Buffer.from(buf)).jpeg({ quality: 92 }).toBuffer();
  return out;
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

function generateButtonVisible(page) {
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

async function waitFor(page, fn, ms, label, step = 1000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await fn()) return true; } catch { /* retry */ }
    await sleep(step);
  }
  throw new Error(`timeout after ${ms}ms waiting for: ${label}`);
}

async function runVariant(page, v, report) {
  const t0 = Date.now();
  const cfgPath = settingsFileFor(v);
  const fileInput = await settingsFileInput(page);
  await fileInput.setInputFiles(cfgPath);
  // Wait until the form has settled: prompt filled, image form active,
  // Generate button visible.
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
  if (!(await clickGenerate(page))) throw new Error('Generate button not visible');
  console.log(`[${v.name}] generation started (${v.resolution}); status: ${(await statusText(page)).slice(0, 120)}`);
  const before = await gallerySrcs(page);
  const end = Date.now() + GEN_TIMEOUT_MS;
  let done = false, lastStatus = '';
  while (Date.now() < end) {
    const srcs = await gallerySrcs(page);
    const fresh = srcs.filter((s) => !before.includes(s));
    if (fresh.length > 0) {
      const buf = await fetchSrc(page, fresh[fresh.length - 1]);
      if (buf.length > 10 * 1024) {
        const jpg = await toJpeg(buf);
        const raw = rawPath(v.name, jpg[0] === 0xff ? 'jpg' : 'png');
        fs.writeFileSync(raw, buf);
        fs.mkdirSync(OUTFITS, { recursive: true });
        fs.writeFileSync(outPath(v.name), jpg);
        console.log(`RESULT ${v.name}: ${outPath(v.name)} | ${jpg.length} bytes | ${v.resolution}`);
        done = true;
        break;
      }
    }
    lastStatus = (await statusText(page)).slice(0, 120);
    await sleep(2000);
  }
  if (!done) {
    const abort = page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        if (b.textContent.trim() === 'Abort' && b.offsetParent !== null) { b.click(); return true; }
      }
      return false;
    }).catch(() => false);
    await sleep(2000);
    report.push({ name: v.name, ok: false, secs: (Date.now() - t0) / 1000, error: `timed out after 600s (last status: ${lastStatus}; abort clicked: ${abort})` });
    return;
  }
  report.push({ name: v.name, ok: true, secs: (Date.now() - t0) / 1000 });
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  fs.mkdirSync(RESEARCH, { recursive: true });
  fs.mkdirSync(OUTFITS, { recursive: true });
  for (const v of VARIANTS) settingsFileFor(v);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await page.goto(APP_URL, { timeout: 30000 });
  await waitFor(page, async () => (await page.locator('gradio-app, #gradio').count()) > 0, 60000, 'gradio app shell');
  await waitFor(page, async () => (await promptValue(page)) !== null, 60000, 'prompt textbox visible');

  const report = [];
  for (const v of VARIANTS) {
    if (only && v.name !== only) continue;
    const existing = outPath(v.name);
    if (fs.existsSync(existing) && fs.readFileSync(existing).length > 10 * 1024) {
      console.log(`[${v.name}] already complete: ${existing} — skipping`);
      report.push({ name: v.name, ok: true, secs: 0, error: 'skipped (already present)' });
      continue;
    }
    try { await runVariant(page, v, report); }
    catch (e) {
      console.log(`[${v.name}] FAILED: ${e.message}`);
      report.push({ name: v.name, ok: false, secs: 0, error: e.message });
    }
  }
  console.log('\nSUMMARY');
  for (const r of report) console.log(`- ${r.name}: ${r.ok ? 'OK' : 'FAIL'} in ${r.secs.toFixed(1)}s ${r.error || ''}`);
  await browser.close();
  process.exit(report.length > 0 && report.every((r) => r.ok) ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(2); });
