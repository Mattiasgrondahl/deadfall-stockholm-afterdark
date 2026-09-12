import * as THREE from 'three'

// V2P-7: falling snow as 3 depth layers (near/mid/far), each its own
// THREE.Points in the same 60 m box centered on the player (x/z in
// [-30, 30], y in [0, 60)). Deterministic LCG layout (no Math.random): one
// stream drawn in fixed band order for positions plus per-flake fall
// multiplier and wobble phase/frequency/amplitude. Per frame: fall, +x drift
// modulated by a deterministic global gust (two sines of a running clock),
// per-flake wobble, zero-mean crosswind, box wrap; no per-frame allocation;
// headless-safe. Total flakes = 1500 (budget <= 2500).
const SIZE = 60
const HALF = SIZE / 2
const TOTAL = 1500
const BANDS = [
  { count: 600, size: 0.13, opacity: 0.85, fall: 2.6, drift: 1.0, wob: 0.3 },
  { count: 550, size: 0.08, opacity: 0.70, fall: 2.0, drift: 0.6, wob: 0.18 },
  { count: 350, size: 0.045, opacity: 0.50, fall: 1.4, drift: 0.35, wob: 0.08 },
]

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
    for (let i = 0; i < band.count; i++) {
      pos[i * 3] = (rnd() - 0.5) * SIZE
      pos[i * 3 + 1] = rnd() * SIZE
      pos[i * 3 + 2] = (rnd() - 0.5) * SIZE
      fallMul[i] = 0.7 + 0.6 * rnd()
      wobPhase[i] = 6.2832 * rnd()
      wobFreq[i] = 0.4 + 0.8 * rnd()
      wobAmp[i] = band.wob * (0.5 + rnd())
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: band.size, transparent: true, opacity: band.opacity })
    const pts = new THREE.Points(geo, mat)
    pts.frustumCulled = false // the box follows the player; never cull it
    layers.push({ band, pts, geo, fallMul, wobPhase, wobFreq, wobAmp })
  }

  let t = 0 // global gust clock; g is a pure function of t

  const update = (playerPos, dt) => {
    if (dt <= 0) return // safe no-op (keeps the no-op test green)
    t += dt
    const g = 0.5 + 0.5 * (0.65 * Math.sin(2 * Math.PI * t / 17) + 0.35 * Math.sin(2 * Math.PI * t / 4.3 + 1.7)) // g in [0,1]
    for (const L of layers) {
      L.pts.position.set(playerPos.x, 0, playerPos.z)
      const p = L.geo.attributes.position.array
      const n = L.band.count
      const fall = L.band.fall
      const drift = L.band.drift
      for (let i = 0; i < n; i++) {
        const i3 = i * 3
        p[i3 + 1] -= fall * L.fallMul[i] * (1 - 0.3 * g) * dt
        p[i3] += (drift * (0.6 + 1.4 * g) + L.wobAmp[i] * Math.sin(t * L.wobFreq[i] + L.wobPhase[i])) * dt
        p[i3 + 2] += drift * (g - 0.5) * dt
        if (p[i3 + 1] < 0) p[i3 + 1] += SIZE
        if (p[i3] > HALF) p[i3] -= SIZE
        if (p[i3] < -HALF) p[i3] += SIZE
        if (p[i3 + 2] > HALF) p[i3 + 2] -= SIZE
        if (p[i3 + 2] < -HALF) p[i3 + 2] += SIZE
      }
      L.geo.attributes.position.needsUpdate = true
    }
  }

  const setCount = (n) => {
    for (const L of layers) {
      L.geo.setDrawRange(0, Math.max(0, Math.min(Math.floor(n * L.band.count / TOTAL), L.band.count)))
    }
  }

  const dispose = () => {
    for (const L of layers) { L.geo.dispose(); L.pts.material.dispose() }
  }

  return { points: layers.map(L => L.pts), update, setCount, dispose }
}
