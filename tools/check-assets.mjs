#!/usr/bin/env node
// tools/check-assets.mjs — asset inventory + reference integrity (headless).
//
// Catches the "playlist points at a missing file" class of bug without a
// browser: extracts every asset path the shipped code references (mp3/wav
// playlists, poster/facade/ground textures, face/outfit/weapon images, zombie
// GLBs) and checks each one exists under public/assets/ AND in dist/assets/
// when a build is present. Also reports size + ffprobe duration for audio and
// compares against the *_SECONDS constants in Game.js so a stale playlist
// length is visible instead of silently cutting a song short.
//
// Usage:
//   node tools/check-assets.mjs            # check public/ (+ dist/ if built)
//   node tools/check-assets.mjs --json     # machine-readable
//
// Exit codes: 0 all good, 1 missing/mismatched assets, 2 bad usage.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const json = process.argv.includes('--json')

function read(rel) {
  const p = path.join(ROOT, rel)
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
}

// ---- Collect references from source ---------------------------------------
const refs = new Map() // assetRel -> Set of source files that reference it
function addRef(assetRel, src) {
  if (!assetRel) return
  if (!refs.has(assetRel)) refs.set(assetRel, new Set())
  refs.get(assetRel).add(src)
}

const SRC_FILES = ['src/game/Game.js', 'src/game/Screens.js', 'src/game/Sniper.js', 'src/game/Axe.js', 'src/game/Zombie.js', 'src/world/cityDressing.js']
const ASSET_RE = /['"`](assets\/[\w./-]+\.(?:mp3|wav|jpg|jpeg|png|glb|gltf))['"`]/g
for (const rel of SRC_FILES) {
  const text = read(rel)
  if (text === null) continue
  let m
  while ((m = ASSET_RE.exec(text))) addRef(m[1], rel)
  ASSET_RE.lastIndex = 0
}
// Dynamic ones the regex cannot see (concatenated names): pinned explicitly
// from the known loaders so a renamed/removed file still trips the check.
// Zombie faces: {type}{,2,3}-face.jpg for walker/shambler/screamer.
for (const type of ['walker', 'shambler', 'screamer']) {
  addRef(`assets/faces/${type}-face.jpg`, 'src/game/Zombie.js (dynamic)')
  addRef(`assets/faces/${type}2-face.jpg`, 'src/game/Zombie.js (dynamic)')
  addRef(`assets/faces/${type}3-face.jpg`, 'src/game/Zombie.js (dynamic)')
}
// Zombie skins: every value of SKIN_ASSET in Zombie.js.
const zombieSrc = read('src/game/Zombie.js') || ''
const skinBlock = zombieSrc.match(/const SKIN_ASSET = \{[^}]*\}/)
if (skinBlock) for (const m of skinBlock[0].matchAll(/'([^']+)'/g)) addRef(`assets/zombies/${m[1]}`, 'src/game/Zombie.js (SKIN_ASSET)')
// Outfit textures: OUTFIT* maps in Zombie.js list file stems.
for (const m of zombieSrc.matchAll(/'([a-z0-9-]+)-(top|pants|skirt)'/g)) addRef(`assets/outfits/${m[1]}-${m[2]}.jpg`, 'src/game/Zombie.js (outfits)')

// ---- Known audio lengths from Game.js -------------------------------------
const gameSrc = read('src/game/Game.js') || ''
function constArray(name) {
  const m = gameSrc.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`))
  return m ? m[1].split(',').map(s => Number(s.trim())).filter(Number.isFinite) : []
}
// Map asset filename -> declared length, read from the source order itself
// (SONG_PLAYLIST then SONG_PLAYLIST_SECONDS), so renaming/reordering cannot
// silently misalign the comparison the way a sorted list would.
const declaredByAsset = new Map()
{
  const pl = gameSrc.match(/export const SONG_PLAYLIST = \[([\s\S]*?)\]/)
  const urls = pl ? [...pl[1].matchAll(/assets\/audio\/([\w.-]+\.mp3)/g)].map(m => m[1]) : []
  const lens = constArray('SONG_PLAYLIST_SECONDS')
  urls.forEach((u, i) => { if (lens[i] != null) declaredByAsset.set(`assets/audio/${u}`, lens[i]) })
  // LEVEL_TRACKS is a scalar-length pair (LEVEL_TRACK_SECONDS applies to both).
  const lt = gameSrc.match(/export const LEVEL_TRACKS = \[([\s\S]*?)\]/)
  const ltUrls = lt ? [...lt[1].matchAll(/assets\/audio\/([\w.-]+\.mp3)/g)].map(m => m[1]) : []
  const ltLen = constArray('LEVEL_TRACK_SECONDS')[0]
  if (ltLen != null) for (const u of ltUrls) declaredByAsset.set(`assets/audio/${u}`, ltLen)
}

function ffprobeDuration(abs) {
  const r = spawnSync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', abs], { encoding: 'utf8' })
  if (r.status !== 0) return null
  const n = Number((r.stdout || '').trim())
  return Number.isFinite(n) ? n : null
}

// ---- Check -----------------------------------------------------------------
const problems = []
const report = []
const haveDist = fs.existsSync(path.join(ROOT, 'dist', 'index.html'))
for (const [assetRel, srcs] of [...refs.entries()].sort()) {
  const pub = path.join(ROOT, 'public', assetRel)
  const dist = path.join(ROOT, 'dist', assetRel)
  const pubOk = fs.existsSync(pub)
  const distOk = haveDist ? fs.existsSync(dist) : null
  const entry = { asset: assetRel, referencedBy: [...srcs], public: pubOk, dist: distOk }
  if (pubOk) {
    entry.bytes = fs.statSync(pub).size
    if (/\.(mp3|wav)$/i.test(assetRel)) {
      const dur = ffprobeDuration(pub)
      entry.durationS = dur
      // Compare against the declared length read from Game.js source order.
      // Wav one-shots have no declared constant; mp3 loops do — a mismatch
      // means the loop watchdog would cut the song short or restart early.
      const declared = declaredByAsset.get(assetRel)
      if (declared != null && dur !== null) {
        entry.declaredS = declared
        if (Math.abs(dur - declared) > 1.5) {
          problems.push(`${assetRel}: actual ${dur.toFixed(1)}s vs declared ${declared}s (SONG_PLAYLIST_SECONDS / LEVEL_TRACK_SECONDS stale?)`)
        }
      }
    }
  } else {
    problems.push(`${assetRel}: referenced by ${[...srcs].join(', ')} but missing in public/`)
  }
  if (haveDist && pubOk && !distOk) problems.push(`${assetRel}: in public/ but missing from dist/ (stale build?)`)
  report.push(entry)
}

if (json) {
  console.log(JSON.stringify({ ok: problems.length === 0, problems, assets: report, distChecked: haveDist }, null, 1))
} else {
  for (const e of report) {
    const mark = e.public ? 'ok  ' : 'MISS'
    const dur = e.durationS ? ` ${e.durationS.toFixed(1)}s${e.declaredS ? ` (declared ${e.declaredS}s)` : ''}` : ''
    const distMark = e.dist === null ? '' : e.dist ? ' +dist' : ' NO-DIST'
    console.log(`${mark} ${e.asset}${dur}${distMark}  <- ${e.referencedBy.join(', ')}`)
  }
  console.log(`\ncheck-assets: ${report.length} referenced assets, ${problems.length} problem(s)${haveDist ? '' : ' (dist/ not built — skipped dist checks)'}`)
  for (const p of problems) console.log(`  PROBLEM: ${p}`)
}
process.exit(problems.length === 0 ? 0 : 1)