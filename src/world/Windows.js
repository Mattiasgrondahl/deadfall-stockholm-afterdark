// Shootable building windows (v26). The facade texture bakes windows as a flat
// emissive grid on each building face, so a bullet that hits a wall could never
// break a specific window — the glass was painted on. This module overlays a
// small, LOGICAL cluster of real glass panes on each building: ONE front-facing
// row with 1–2 ADJACENT panes side by side (not a scattered full grid), as ONE
// InstancedMesh (one draw call, +1 mesh regardless of count). Each pane carries
// a shootable AABB offset outward so a ray hits the pane before the building box
// behind it (same trick as Storefront.js). When a shot lands on a pane,
// Windows.hitAt dims that instance's emissive color to a dead dark, plays the
// glass-break voice, and pops a shard burst — mirroring the Lamps break system.
// Headless-safe: scene may be null; no Math.random.
import * as THREE from 'three'

// The facade grid is 8 rows x 4 columns per face (drawFacadeTexture); we reuse
// its row height + column pitch so our 1–2 panes line up with the painted
// window courses instead of floating arbitrarily on the wall.
const ROWS = 8
const COLS = 4
// One cluster (<=2 panes) per building; a handful of buildings, so a small cap
// is plenty and keeps the instance buffer tiny.
const MAX_PANES = 64

// A lit window reads as warm amber glass; a broken one goes dark and smoky.
const LIT = new THREE.Color(0xffb066)
const BROKEN = new THREE.Color(0x0a0c10)

/**
 * Build the window overlay for every building and register shootable panes.
 * @param {THREE.Group} group      the city group to add the InstancedMesh to
 * @param {Object} collision       CollisionWorld (or a stub with addAABB)
 * @param {Array} buildings        City building list: {mesh,w,d,h} (+ optional
 *                                 .variant from City's facade-variant LCG)
 * @param {Object} [exclude]       optional {x, z, halfW, y0, y1} rectangle to
 *                                 leave bare — the wanted-poster footprint, so a
 *                                 bright glass pane never overlaps the placard.
 * @returns {{mesh:THREE.InstancedMesh, windows:Array, aabbs:Array}}
 */
export function addWindows(group, collision, buildings, exclude) {
  const windows = []
  const aabbs = []
  if (!buildings || !buildings.length) return { windows, aabbs, mesh: null }
  // A pane is dropped when its centre lands inside the exclusion rectangle.
  const inExclude = (px, pz, up) => {
    if (!exclude) return false
    return Math.abs(px - exclude.x) <= exclude.halfW &&
      Math.abs(pz - exclude.z) <= exclude.halfD &&
      up >= exclude.y0 && up <= exclude.y1
  }

  // A unit box reused for every pane, scaled + oriented per instance.
  const paneGeo = new THREE.BoxGeometry(1, 1, 1)
  // Emissive glass that self-lights (view-independent) so lit panes glow like
  // the baked facade lights; instanceColor drives the per-pane lit/broken state.
  const paneMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.35, metalness: 0.0,
    emissive: 0xffffff, emissiveIntensity: 1.1, transparent: true, opacity: 0.9
  })
  const mesh = new THREE.InstancedMesh(paneGeo, paneMat, MAX_PANES)
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  // instanceColor multiplies the material color; drive it per pane so a broken
  // window can be dimmed in place without a new material or mesh.
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PANES * 3), 3)
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)

  const m = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const e = new THREE.Euler()
  const col = new THREE.Color()

  let pi = 0
  for (const b of buildings) {
    const bx = b.mesh.position.x
    const bz = b.mesh.position.z
    const w = b.w
    const d = b.d
    const h = b.h
    if (h < 4) continue // too short to carry a window worth shooting
    const variant = b.variant !== undefined ? b.variant : 0

    // v26b: ONE shootable window cluster per building, not a full grid. Pick the
    // front face (+z, facing the player/street so it is the most visible and the
    // most "logical" target), choose a single mid-height row deterministically
    // from the variant, and place 1–2 ADJACENT panes side by side in that row.
    // This reads as a real pair of windows on a wall instead of a scattered
    // skyline of glowing cells, and keeps the pane count tiny.
    const rowH = Math.min(2.6, (h - 2) / ROWS)
    // A row that sits comfortably on the wall and within reach (never the top
    // course, never the ground floor): pick from the lower-middle rows.
    const usable = Math.max(1, Math.min(ROWS, Math.floor((h - 2) / rowH)))
    const row = 1 + (variant % Math.max(1, usable - 1)) // 2nd row onward, varies per building
    const up = 2 + row * rowH + rowH * 0.5
    if (up > h - 0.5) continue // keep the cluster inside the wall height

    // Front face only: panes spread across the building width.
    const span = w
    const pz = bz + d / 2 + 0.04
    const ry = 0
    // Two adjacent columns centred on the face (or one if the wall is narrow).
    const cols = span >= 4 ? 2 : 1
    const paneW = Math.max(0.5, span / 4 * 0.6)
    const gap = span / COLS // column pitch matches the facade grid
    const startAcross = cols === 2 ? -gap * 0.5 : 0
    for (let k = 0; k < cols; k++) {
      if (pi >= MAX_PANES) break
      const across = startAcross + k * gap
      const px = bx + across
      const up2 = up
      if (inExclude(px, pz, up2)) continue // leave the wanted-poster wall bare
      e.set(0, ry, 0)
      quat.setFromEuler(e)
      pos.set(px, up2, pz)
      scl.set(paneW, rowH * 0.7, 0.06)
      m.compose(pos, quat, scl)
      mesh.setMatrixAt(pi, m)
      mesh.setColorAt(pi, col.copy(LIT))
      // Shootable AABB: a thin footprint hugging the pane, offset outward so
      // the ray meets the pane before the building box behind it.
      const hw = 0.35
      collision.addAABB(px - hw, pz - hw, px + hw, pz + hw, up2 + rowH * 0.35)
      const aabb = collision.aabbs[collision.aabbs.length - 1]
      if (aabb) {
        aabb.shootable = true // blocks bullets but not player movement
        aabbs.push(aabb)
      }
      windows.push({ idx: pi, x: px, z: pz, y: up2, broken: false })
      pi++
    }
  }

  mesh.count = pi
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.frustumCulled = false
  group.add(mesh)
  return { mesh, windows, aabbs }
}

/**
 * Runtime manager: routes a wall hit to the matching pane and dims it. Mirrors
 * Lamps — weapons call hitAt(wall.point) and, on a true return, skip the
 * bullet-hole. No per-frame allocation; dispose() frees the InstancedMesh.
 */
export class Windows {
  constructor(data) {
    this.mesh = data ? data.mesh : null
    this.windows = data ? data.windows : []
    this.audio = null
    this.shards = null
    this.onBreak = null
    this._col = new THREE.Color()
    this._broken = 0
  }

  /**
   * Break the window whose centre is nearest the hit point (within a small
   * radius), dimming its glass + firing the glass voice + shard burst.
   * @returns {Object|null} the broken window, or null if the hit missed them all
   */
  hitAt(x, y, z) {
    if (!this.windows.length) return null
    let best = null
    let bestD = 0.9 // generous so a hit anywhere on the pane face counts
    for (const win of this.windows) {
      if (win.broken) continue
      // A hit must be at window height (a shot over the roof or into the base
      // is a wall, not glass).
      if (y < win.y - 1.4 || y > win.y + 1.4) continue
      const d = Math.hypot(x - win.x, z - win.z)
      if (d < bestD) { bestD = d; best = win }
    }
    if (!best) return null
    this._break(best)
    return best
  }

  _break(win) {
    win.broken = true
    this._broken++
    if (this.mesh && this.mesh.instanceColor) {
      this.mesh.setColorAt(win.idx, this._col.copy(BROKEN))
      this.mesh.instanceColor.needsUpdate = true
    }
    if (this.audio) this.audio.glassBreak()
    if (this.shards) this.shards.burst(win.x, win.y, win.z)
    if (this.onBreak) this.onBreak()
  }

  brokenCount() {
    return this._broken
  }

  reset() {
    for (const win of this.windows) {
      if (!win.broken) continue
      win.broken = false
      if (this.mesh && this.mesh.instanceColor) {
        this.mesh.setColorAt(win.idx, this._col.copy(LIT))
      }
    }
    if (this.mesh && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    this._broken = 0
  }

  dispose() {
    if (this.mesh) {
      if (this.mesh.geometry) this.mesh.geometry.dispose()
      if (this.mesh.material) this.mesh.material.dispose()
      if (this.mesh.dispose) this.mesh.dispose()
    }
    this.windows = []
  }
}