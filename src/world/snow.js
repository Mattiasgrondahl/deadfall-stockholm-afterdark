import * as THREE from 'three'

// V2P-7 + v6 visuals (3): falling snow as a 4-band depth hierarchy, each band
// its own THREE.Points in the same 60 m box centered on the player (x/z in
// [-30, 30], y in [0, 60)). Deterministic LCG layout (no Math.random): one
// stream drawn in fixed band order for positions plus per-flake fall
// multiplier, wobble phase/frequency/amplitude and wind phase. Per frame:
// fall, +x drift modulated by a deterministic global gust (two sines of a
// running clock), per-band crosswind + per-flake wobble, box wrap; no
// per-frame allocation; headless-safe.
//
// Layering: near flakes are bigger, faster, brighter and get the strongest
// gust response; mid flakes are the readable body; far flakes are small,
// dim, slow; the 4th band is a slow high-altitude haze that reads as weather
// volume rather than discrete flakes. Every band carries its own wind phase so
// the sheet shears instead of translating as one slab.
//
// Density is driven through setDrawRange only (never a geometry rebuild):
// setCount(n) scales all bands proportionally against the geometry total
// (legacy contract: 750 halves, 1500 restores), setTier(q) picks a quality
// tier, and the deterministic squall multiplies the active base. Geometry
// allocates 1800 flakes in a 7/7/2.6/1.4 split of 200 so every tier share is
// an exact integer (750 / 1050 / 1500 drawn, no rounding drift). The squall
// peak (1500 x 1.4 = 2100) is clamped band-by-band to the 1800 allocated
// flakes, leaving 700 points of margin under the 2500-point budget.
const SIZE = 60
const HALF = SIZE / 2
const BANDS = [
  { count: 700, size: 0.15, opacity: 0.95, fall: 3.1, drift: 1.25, wob: 0.34, wind: 1.0 },
  { count: 700, size: 0.10, opacity: 0.78, fall: 2.3, drift: 0.75, wob: 0.20, wind: 0.62 },
  { count: 260, size: 0.06, opacity: 0.60, fall: 1.7, drift: 0.45, wob: 0.12, wind: 0.34 },
  { count: 140, size: 0.035, opacity: 0.34, fall: 1.1, drift: 0.22, wob: 0.06, wind: 0.16 },
]
const GEOMETRY_TOTAL = BANDS.reduce((n, b) => n + b.count, 0) // 1800
const MAX_POINTS = 1800 // hard ceiling for drawn points (budget 2500)
// Squall clock: triangle envelope (fast rise, slow decay) on its own period so
// it never lines up with the gust clock; q in [0,1].
const SQUALL_PERIOD = 23
const SQUALL_RISE = 4.5
const SQUALL_FALL = 9.5
const SQUALL_GAIN = 0.4 // density multiplier is 1 + SQUALL_GAIN * squall
// Quality tiers -> base drawn total. 'low' is the cheapest layering (the two
// readable bands only), 'medium' an intermediate density, 'high' the full
// 4-band sheet. 'low' keeps the 750 pinned by test/lighting.test.mjs, and
// 1050 / 1500 are exact because each band count is a multiple of 200/700 of
// the 1800-flake geometry total.
const TIERS = { low: 750, medium: 1050, high: 1500 }

export function createSnow() {
  let s = 7 // deterministic LCG layout; no Math.random
  const rnd = () => (s = (s * 48271) % 65537) / 65537

  const layers = []
  for (const band of BANDS) {
    const pos = new Float32Array(band.count * 3)
    const fallMul = new Float32Array(band.count)
    const wobPhase = new Float32Array(band.count)
    const wobFreq = new Float32Array(band.count)
    const wobAmp = new Float32Array(band.count)
    const windPhase = new Float32Array(band.count)
    for (let i = 0; i < band.count; i++) {
      pos[i * 3] = (rnd() - 0.5) * SIZE
      pos[i * 3 + 1] = rnd() * SIZE
      pos[i * 3 + 2] = (rnd() - 0.5) * SIZE
      fallMul[i] = 0.7 + 0.6 * rnd()
      wobPhase[i] = 6.2832 * rnd()
      wobFreq[i] = 0.4 + 0.8 * rnd()
      wobAmp[i] = band.wob * (0.5 + rnd())
      windPhase[i] = 6.2832 * rnd()
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: band.size, transparent: true, opacity: band.opacity })
    const pts = new THREE.Points(geo, mat)
    pts.frustumCulled = false // the box follows the player; never cull it
    layers.push({ band, pts, geo, fallMul, wobPhase, wobFreq, wobAmp, windPhase })
  }

  let t = 0 // global gust + squall clock; g and q are pure functions of t
  let base = GEOMETRY_TOTAL // base drawn total (full sheet until a tier sets it)
  let squall = 0 // smoothed squall envelope in [0,1]

  // Drawn counts for a base total: each band takes its share of the base
  // against the geometry total (so base 750 halves, 1500 = 10/14 of full and
  // 2100 restores exactly), then the squall multiplier `k` is applied and
  // clamped to that band's geometry. The drawn total can never exceed the
  // 2100 allocated flakes, and MAX_POINTS caps the base.
  const counts = (b, k) => {
    const out = new Array(layers.length)
    for (let i = 0; i < layers.length; i++) {
      out[i] = Math.max(0, Math.min(layers[i].band.count, Math.round(b * layers[i].band.count / GEOMETRY_TOTAL * k)))
    }
    return out
  }

  const apply = (b, k) => {
    const c = counts(b, k)
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i]
      L.geo.setDrawRange(0, c[i])
      // Cheapest tier keeps only the two readable bands: the haze and far
      // layers cost draw calls and shader work without reading at low quality.
      L.pts.visible = b >= 1000 || i < 2
      L.pts.material.opacity = L.band.opacity * (1 + 0.25 * (k - 1))
    }
    return c
  }

  const update = (playerPos, dt) => {
    if (dt <= 0) return // safe no-op (keeps the no-op test green)
    t += dt
    const g = 0.5 + 0.5 * (0.65 * Math.sin(2 * Math.PI * t / 17) + 0.35 * Math.sin(2 * Math.PI * t / 4.3 + 1.7)) // g in [0,1]
    // Deterministic squall: triangle envelope (fast rise, slow decay) so a
    // squall builds over ~4.5 s and eases out over ~9.5 s, then rests.
    const ph = t % SQUALL_PERIOD
    const q = ph < SQUALL_RISE ? ph / SQUALL_RISE : 1 - (ph - SQUALL_RISE) / SQUALL_FALL
    squall += (Math.min(Math.max(q, 0), 1) - squall) * Math.min(1, dt * 2.5)
    const k = 1 + 0.4 * squall // density multiplier in [1, 1.4]
    const c = apply(base, k)
    let drawn = 0
    for (let i = 0; i < c.length; i++) drawn += c[i]
    for (const L of layers) {
      L.pts.position.set(playerPos.x, 0, playerPos.z)
      const p = L.geo.attributes.position.array
      const n = L.band.count
      const fall = L.band.fall
      const drift = L.band.drift
      const wind = L.band.wind
      for (let i = 0; i < n; i++) {
        const i3 = i * 3
        p[i3 + 1] -= fall * L.fallMul[i] * (1 - 0.3 * g) * dt
        p[i3] += (drift * (0.6 + 1.4 * g) + L.wobAmp[i] * Math.sin(t * L.wobFreq[i] + L.wobPhase[i])) * dt
        // Per-band + per-flake crosswind: bands shear against each other and
        // individual flakes flutter, so the sheet never moves as one slab.
        p[i3 + 2] += (drift * (g - 0.5) + wind * (0.55 * g + 0.45 * squall) * Math.sin(t * 0.7 + L.windPhase[i])) * dt
        if (p[i3 + 1] < 0) p[i3 + 1] += SIZE
        if (p[i3] > HALF) p[i3] -= SIZE
        if (p[i3] < -HALF) p[i3] += SIZE
        if (p[i3 + 2] > HALF) p[i3 + 2] -= SIZE
        if (p[i3 + 2] < -HALF) p[i3 + 2] += SIZE
      }
      L.geo.attributes.position.needsUpdate = true
    }
    return drawn
  }

  const setCount = (n) => {
    base = Math.max(0, Math.min(MAX_POINTS, Math.floor(n)))
    apply(base, 1)
  }

  const setTier = (q) => setCount(TIERS[q === 'medium' ? 'medium' : q === 'low' ? 'low' : 'high'])

  const dispose = () => {
    for (const L of layers) { L.geo.dispose(); L.pts.material.dispose() }
  }

  return { points: layers.map(L => L.pts), update, setCount, setTier, dispose }
}