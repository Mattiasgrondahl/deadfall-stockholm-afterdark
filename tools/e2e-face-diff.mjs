// E2E probe: face-texture visibility A/B/C pixel check (headless Chromium).
// One page session, one frozen scene, three rendered states of the SAME face:
//   A = current code (texture + white color)       -> face should read as a portrait
//   C = original bug sim (texture + head color)    -> map * head-color = dark tint
//   B = flat face sim (no texture, head color)     -> what "no face" looks like
// The scene is frozen by no-op'ing game.update (the render loop keeps rendering;
// no pause overlay appears). The face region is projected in-page from the live
// camera, then sampled in each screenshot (pure-JS PNG decode via Node zlib).
// Run after `npm run dev`:  node tools/e2e-face-diff.mjs   (E2E_URL optional)
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import zlib from 'node:zlib'

const URL = process.env.E2E_URL || 'http://127.0.0.1:5173'
const OUT = '.research'
fs.mkdirSync(OUT, { recursive: true })
const W = 1280, H = 720

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: W, height: H } })
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => consoleErrors.push(String(e)))

await page.goto(URL, { waitUntil: 'load', timeout: 30000 })
await page.waitForTimeout(1500)
await page.keyboard.press('Enter')
await page.waitForTimeout(600)
if ((await page.evaluate(() => window.__game.state)) !== 'playing') {
  await page.click('.screen.visible button.btn')
}
await page.waitForTimeout(1500)
for (let i = 0; i < 60 && !(await page.evaluate(() => window.__game.zombies.length > 0)); i++) {
  await page.waitForTimeout(500)
}
for (let i = 0; i < 30 && !(await page.evaluate(() =>
  window.__game.zombies.filter((z) => !z.isDead).every((z) => z._face && z._face.material.map))); i++) {
  await page.waitForTimeout(200) // wait until every live zombie has its texture
}

// Aim at the nearest live zombie from 3.4 m, freeze all per-frame motion,
// project the face center through the live camera.
const target = await page.evaluate(({ W, H }) => {
  const g = window.__game
  const p = g.player
  const zs = g.zombies.filter((z) => !z.isDead)
  if (!zs.length) return null
  // Prefer the nearest live zombie whose face texture has actually loaded
  // (variant 0 materials get textures; if some variants' files are missing,
  // their faces stay flat head-color and would make the A/D diff meaningless).
  // When every face has a texture this reduces to the original "nearest
  // zombie" choice. Fall back to the nearest live zombie if none are textured.
  let best = null, bd = Infinity
  for (const z of zs) {
    if (z._face && z._face.material && z._face.material.map) {
      const d = Math.hypot(z.position.x - p.position.x, z.position.z - p.position.z)
      if (d < bd) { bd = d; best = z }
    }
  }
  if (!best) {
    bd = Infinity
    for (const z of zs) {
      const d = Math.hypot(z.position.x - p.position.x, z.position.z - p.position.z)
      if (d < bd) { bd = d; best = z }
    }
  }
  const dx = p.position.x - best.position.x, dz = p.position.z - best.position.z
  const d = Math.max(bd, 1e-6)
  g.debug.setPlayerPos(best.position.x + (dx / d) * 3.4, best.position.z + (dz / d) * 3.4)
  p.yaw = Math.atan2(p.position.x - best.position.x, p.position.z - best.position.z)
  p.pitch = 0
  g.debug.setPlayerHealth(100)
  // Sync the camera to the teleported player NOW: player.update() is what
  // normally moves the camera, and we are about to freeze it.
  g.camera.position.set(p.position.x, p.position.y, p.position.z)
  g.camera.rotation.set(0, p.yaw, 0)
  // Re-aim the zombie at the teleported player: update() is frozen, so its
  // facing (and bob tilt) is stale from the pre-teleport position, which would
  // point the face away from the camera. rotation.set(0, yaw, 0) mirrors what
  // update() writes (bob on x, facing on y). Tag this zombie so the state
  // captures target its face specifically (the nearest is not array-first).
  best._probeTarget = true
  best.group.rotation.set(0, Math.atan2(p.position.x - best.position.x, p.position.z - best.position.z), 0)
  // Isolate the target: hide every other zombie so the face region is not
  // polluted by other zombies' faces/eyes/blood in the pixel diff.
  for (const z of zs) if (z !== best) z.group.visible = false
  // Freeze: animation loop keeps rendering, but update() no-ops (no bob,
  // no walking, no snow drift, no flicker) while state stays PLAYING.
  g._origUpdate = g.update
  g.update = () => {}
  for (const z of zs) z._faceTex = z._face.material.map
  g.step(0)
  best.group.updateMatrixWorld(true)
  g.camera.updateMatrixWorld(true)
  // Face center: head-local (0,0,0.155) -> world, then -> camera space.
  // Use THREE's own vector methods (grab a Vector3 by cloning head.position)
  // to avoid hand-indexing column-major matrix elements.
  const head = best.group.children[1]
  const faceWorld = head.localToWorld(head.position.clone().set(0, 0, 0.155))
  const camSpace = faceWorld.clone().applyMatrix4(g.camera.matrixWorldInverse)
  const fov = 75 * Math.PI / 180 // camera fov (vertical), from Game.js
  const aspect = g.camera.aspect
  const tanHalf = Math.tan(fov / 2)
  // Camera looks down -Z: x_ndc = -x/(z*tan*aspect), y_ndc = -y/(z*tan)
  const xNdc = -camSpace.x / (camSpace.z * tanHalf * aspect)
  const yNdc = -camSpace.y / (camSpace.z * tanHalf)
  const mat = best._face.material
  // Inspect the loaded face texture: downscale to 64x64, measure mean RGB +
  // std-dev. A real portrait is bright with high local detail; a blank/dark
  // image would read low and flat.
  let texStats = null
  const texImg = mat.map && mat.map.image
  if (texImg && texImg.width) {
    const c = document.createElement('canvas')
    c.width = 64; c.height = 64
    const ctx = c.getContext('2d')
    ctx.drawImage(texImg, 0, 0, 64, 64)
    const d = ctx.getImageData(0, 0, 64, 64).data
    let sr = 0, sg = 0, sb = 0, sr2 = 0, sg2 = 0, sb2 = 0, n = 0
    for (let i = 0; i < d.length; i += 4) {
      sr += d[i]; sg += d[i + 1]; sb += d[i + 2]
      sr2 += d[i] * d[i]; sg2 += d[i + 1] * d[i + 1]; sb2 += d[i + 2] * d[i + 2]; n++
    }
    const mr = sr / n, mg = sg / n, mb = sb / n
    texStats = {
      size: [texImg.width, texImg.height],
      mean: [mr.toFixed(1), mg.toFixed(1), mb.toFixed(1)],
      std: (((sr2 / n - mr * mr) + (sg2 / n - mg * mg) + (sb2 / n - mb * mb)) / 3) ** 0.5
    }
  }
  return {
    type: best.type,
    texStats,
    faceWorld: [faceWorld.x, faceWorld.y, faceWorld.z],
    headWorld: (() => { const v = head.getWorldPosition(head.position.clone()); return [v.x, v.y, v.z] })(),
    camSpace: [camSpace.x, camSpace.y, camSpace.z],
    camPos: [g.camera.position.x, g.camera.position.z],
    faceVisible: best._face.visible,
    faceHasMap: !!mat.map,
    faceColorHex: mat.color.getHex(),
    faceNeedsUpdate: mat.needsUpdate,
    mapColorSpace: mat.map ? mat.map.colorSpace : null,
    mapNeedsUpdate: mat.map ? mat.map.needsUpdate : null,
    mapImageType: mat.map && mat.map.image ? mat.map.image.constructor.name : null,
    faceMatIsShared: g.zombies.some((z) => z !== best && z._face && z._face.material === mat),
    mapImage: mat.map ? [mat.map.image.width, mat.map.image.height] : null,
    sx: Math.round(W / 2 + xNdc * (W / 2)),
    sy: Math.round(H / 2 - yNdc * (H / 2))
  }
}, { W, H })
if (!target) { console.log('PROBE-FACE-DIFF: FAIL (no live zombie)'); await browser.close(); process.exit(1) }

const HALF = 70 // face box half-size (face is ~37 px wide at 3.3 m)
const CORE = 20 // tight core box around the face center
const shots = {}
// State A = live (white color + texture, visible). State D = same but the face
// mesh hidden. A vs D isolates "is the face mesh contributing pixels at all".
// D = face hidden (visible=false). E = face given an UNLIT bright material
// (cloned from the eye's MeshBasicMaterial, forced bright red) — independent of
// scene lighting. If the face mesh renders at all, E must show a bright patch
// at the face position where D shows the flat head behind it.
// A = LIVE state: the material exactly as the game has it (after the fix this
// includes the self-lit emissive). D = face hidden (flat head). F = an emissive
// tuning reference (fresh material, portrait as map+emissiveMap, higher
// intensity) to compare against the shipped value.
for (const tag of ['A', 'D', 'F']) {
  await page.evaluate(({ tag, intensity }) => {
    const g = window.__game
    const z = g.zombies.find((z) => z._probeTarget)
    if (!z || !z._face) return
    if (!z._faceMatOrig) z._faceMatOrig = z._face.material
    z._face.visible = true
    if (tag === 'A') {
      // Live state: leave the material as the game set it (map + fix emissive).
      z._face.material.needsUpdate = true
    } else if (tag === 'D') {
      z._face.visible = false
    } else { // F: self-lit tuning reference
      const m = z._faceMatOrig.clone()
      m.map = z._faceTex
      m.emissiveMap = z._faceTex
      m.emissive.set(0xffffff)
      m.emissiveIntensity = intensity
      m.color.set(0xffffff)
      m.needsUpdate = true
      z._face.material = m
    }
    g.step(0) // re-render frozen scene
  }, { tag, intensity: tag === 'F' ? 0.8 : 0 })
  await page.waitForTimeout(300)
  shots[tag] = `${OUT}/face-diff-${tag}.png`
  await page.screenshot({ path: shots[tag] })
}
// Restore live state (face visible, original material, other zombies shown)
// and unfreeze.
await page.evaluate(() => {
  const g = window.__game
  for (const z of g.zombies) {
    if (!z._face || z.isDead) continue
    z.group.visible = true
    z._face.visible = true
    // Only the probe target had its material captured/replaced (_faceMatOrig);
    // every other zombie's face material was never touched, so restoring it
    // here would set material = undefined and crash the renderer.
    if (z._faceMatOrig) z._face.material = z._faceMatOrig
    z._faceMatOrig = null
  }
  g.update = g._origUpdate
  g.step(0)
})

// Variant coverage: group live zombies by the texture URL their face material
// carries. Each of the 9 shared variant materials owns a distinct texture, so
// two or more distinct URLs within one type prove different variants are
// actually applied to same-type zombies in the live scene.
const variantReport = await page.evaluate(() => {
  const g = window.__game
  const byType = {}
  for (const z of g.zombies.filter((z) => !z.isDead && z._face)) {
    const mat = z._face.material
    const url = mat && mat.map && mat.map.image && mat.map.image.src ? mat.map.image.src : '(flat/no texture)'
    if (!byType[z.type]) byType[z.type] = {}
    byType[z.type][url] = (byType[z.type][url] || 0) + 1
  }
  return byType
})

// --- PNG decode (8-bit RGB/RGBA, non-interlaced) + box statistics
function decodePng(file) {
  const buf = fs.readFileSync(file)
  let pos = 8, idat = []
  let width = 0, height = 0, channels = 0
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      if (data.readUInt8(8) !== 8) throw new Error('unsupported bit depth ' + data.readUInt8(8))
      channels = data.readUInt8(9) === 6 ? 4 : 3
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const row = width * channels
  const px = Buffer.allocUnsafe(width * height * channels)
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c)
  }
  for (let y = 0; y < height; y++) {
    const f = raw[y * (row + 1)]
    const src = raw.subarray(y * (row + 1) + 1, (y + 1) * (row + 1))
    const dst = px.subarray(y * row, (y + 1) * row)
    for (let x = 0; x < row; x++) {
      const a = x >= channels ? dst[x - channels] : 0
      const b = y > 0 ? px[(y - 1) * row + x] : 0
      const c = (x >= channels && y > 0) ? px[(y - 1) * row + x - channels] : 0
      let v = src[x]
      if (f === 1) v = (v + a) & 255
      else if (f === 2) v = (v + b) & 255
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255
      else if (f === 4) v = (v + paeth(a, b, c)) & 255
      dst[x] = v
    }
  }
  return { width, height, channels, px }
}

// Mean RGB + std-dev + bright-pixel fraction over a box centered at (cx, cy).
// Std-dev and brightFrac are the key metrics: a real (self-lit) face portrait
// has high local contrast and many bright pixels; a flat dark head does not.
function boxStats(img, cx, cy, half) {
  const x0 = Math.max(0, cx - half), x1 = Math.min(img.width - 1, cx + half)
  const y0 = Math.max(0, cy - half), y1 = Math.min(img.height - 1, cy + half)
  let sr = 0, sg = 0, sb = 0, sr2 = 0, sg2 = 0, sb2 = 0, n = 0, bright = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const o = (y * img.width + x) * img.channels
      const r = img.px[o], g = img.px[o + 1], b = img.px[o + 2]
      sr += r; sg += g; sb += b; sr2 += r * r; sg2 += g * g; sb2 += b * b; n++
      if (r + g + b > 150) bright++
    }
  }
  const mr = sr / n, mg = sg / n, mb = sb / n
  return {
    r: mr.toFixed(1), g: mg.toFixed(1), b: mb.toFixed(1),
    std: (((sr2 / n - mr * mr) + (sg2 / n - mg * mg) + (sb2 / n - mb * mb)) / 3) ** 0.5,
    brightFrac: (bright / n * 100).toFixed(1)
  }
}

function boxDiff(a, b, cx, cy, half) {
  let sum = 0, n = 0
  for (let y = Math.max(0, cy - half); y < Math.min(a.height, cy + half); y++) {
    for (let x = Math.max(0, cx - half); x < Math.min(a.width, cx + half); x++) {
      const o = (y * a.width + x) * a.channels, q = (y * b.width + x) * b.channels
      sum += Math.abs(a.px[o] - b.px[q]) + Math.abs(a.px[o + 1] - b.px[q + 1]) + Math.abs(a.px[o + 2] - b.px[q + 2])
      n++
    }
  }
  return (sum / (n * 3)).toFixed(2) // mean abs diff per channel, 0..255
}

const imgs = { A: decodePng(shots.A), D: decodePng(shots.D), F: decodePng(shots.F) }
const { sx, sy } = target
const out = {
  target,
  faceCenter: { sx, sy },
  coreHalf: CORE,
  texStats: target.texStats,
  faceCoreStats: {
    A: boxStats(imgs.A, sx, sy, CORE),
    D: boxStats(imgs.D, sx, sy, CORE),
    F: boxStats(imgs.F, sx, sy, CORE)
  },
  faceCoreMeanAbsDiff: {
    'A_vs_D (textured vs hidden)': boxDiff(imgs.A, imgs.D, sx, sy, CORE),
    'F_vs_D (emissive vs hidden)': boxDiff(imgs.F, imgs.D, sx, sy, CORE),
    'F_vs_A (emissive vs textured)': boxDiff(imgs.F, imgs.A, sx, sy, CORE)
  },
  screenshots: shots,
  variantsByType: variantReport,
  consoleErrors
}
fs.writeFileSync(`${OUT}/face-diff.json`, JSON.stringify(out, null, 2))
console.log('FACE-DIFF PROBE:', JSON.stringify(out, null, 1))
// PASS = the LIVE state (A, which now carries the emissive fix) makes the face
// clearly visible: it must differ strongly from the hidden face (D), have real
// local detail, and more bright pixels than the flat head. F is a tuning
// reference reported for comparison.
const liveFaceVisible = parseFloat(out.faceCoreMeanAbsDiff['A_vs_D (textured vs hidden)']) > 15 &&
  parseFloat(out.faceCoreStats.A.std) > 30 &&
  parseFloat(out.faceCoreStats.A.brightFrac) > parseFloat(out.faceCoreStats.D.brightFrac)
// Variants applied in-page: at least one type must show 2+ distinct face
// materials among its live zombies (different texture URLs = different
// shared variant materials).
const variantsApplied = Object.values(variantReport).some((m) => Object.keys(m).length >= 2)
const pass = liveFaceVisible && variantsApplied &&
  !consoleErrors.some((e) => /404|faces\/.*jpg|Failed to load/i.test(e))
console.log('PROBE-FACE-DIFF:', pass ? 'PASS' : 'FAIL',
  liveFaceVisible ? '' : '(live face not clearly visible) ',
  variantsApplied ? '' : '(no type shows more than one face variant)')
await browser.close()
process.exitCode = pass ? 0 : 1
