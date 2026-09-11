import * as THREE from 'three'

// Task 8b-4: falling snow. One THREE.Points, 1500 flakes in a 60 m box
// centered on the player (x/z in [-30, 30], y in [0, 60)). Deterministic LCG
// layout (no Math.random). Per-frame: fall + wind drift + wrap; no allocation.
const COUNT = 1500
const SIZE = 60
const FALL = 2.0   // m/s
const WIND = 0.5   // m/s drift toward +x

export function createSnow() {
  let s = 7 // deterministic LCG layout; no Math.random
  const rnd = () => (s = (s * 48271) % 65537) / 65537
  const pos = new Float32Array(COUNT * 3)
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = (rnd() - 0.5) * SIZE
    pos[i * 3 + 1] = rnd() * SIZE
    pos[i * 3 + 2] = (rnd() - 0.5) * SIZE
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.75 })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false // the box follows the player; never cull it

  const update = (playerPos, dt) => {
    if (dt <= 0) return // safe no-op (keeps the old no-op test green)
    points.position.set(playerPos.x, 0, playerPos.z)
    const p = geo.attributes.position.array
    for (let i = 0; i < COUNT; i++) {
      p[i * 3 + 1] -= FALL * dt
      p[i * 3] += WIND * dt
      if (p[i * 3 + 1] < 0) p[i * 3 + 1] += SIZE
      if (p[i * 3] > SIZE / 2) p[i * 3] -= SIZE
      if (p[i * 3] < -SIZE / 2) p[i * 3] += SIZE
    }
    geo.attributes.position.needsUpdate = true
  }

  const setCount = (n) => geo.setDrawRange(0, Math.max(0, Math.min(Math.floor(n), COUNT)))
  const dispose = () => { geo.dispose(); mat.dispose() }

  return { points, update, setCount, dispose }
}
