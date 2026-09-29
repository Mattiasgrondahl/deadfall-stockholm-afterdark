/**
 * CollisionWorld — 2D top-down collision for the play area.
 * Pure math (no THREE imports) so it runs in Node unit tests.
 * Positions are {x, z} objects; y is always ground level.
 *
 * Model: player/zombies are circles of `radius`; obstacles are axis-aligned
 * boxes (buildings, vehicles, barricades) plus world bounds. `resolve()`
 * pushes a circle out of every overlapping box, then clamps to the world.
 */

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v)
}

export class CollisionWorld {
  /** @param {number} width  full width of the play area (m), centered at origin
   * @param {number} depth  full depth of the play area (m), centered at origin */
  constructor(width, depth) {
    this.halfW = width / 2
    this.halfD = depth / 2
    /** @type {{minX:number,minZ:number,maxX:number,maxZ:number,height:number}[]} */
    this.aabbs = []
  }

  /** Register an obstacle box. Height is stored for raycast/height logic. */
  addAABB(minX, minZ, maxX, maxZ, height = 0) {
    this.aabbs.push({ minX, minZ, maxX, maxZ, height })
  }

  /** Remove all obstacle AABBs (world bounds stay). Used when a new city
   *  replaces a placeholder environment. */
  clear() {
    this.aabbs.length = 0
  }

  /**
   * Push `pos` (mutated) out of every overlapping AABB, then clamp to the
   * world bounds. Runs two passes so stacked overlaps settle.
   * @returns {boolean} true if the position moved.
   */
  resolve(pos, radius) {
    const beforeX = pos.x
    const beforeZ = pos.z
    for (let pass = 0; pass < 2; pass++) {
      for (const b of this.aabbs) {
        if (b.shootable) continue // thin shootable props (lamp poles) do not block movement
        const cx = clamp(pos.x, b.minX, b.maxX)
        const cz = clamp(pos.z, b.minZ, b.maxZ)
        const dx = pos.x - cx
        const dz = pos.z - cz
        const d2 = dx * dx + dz * dz
        if (d2 >= radius * radius) continue
        if (d2 > 1e-9) {
          // Circle overlaps box edge/corner: push along the closest-point normal.
          const d = Math.sqrt(d2)
          const push = (radius - d) / d
          pos.x += dx * push
          pos.z += dz * push
        } else {
          // Center is inside the box: exit along the nearest face.
          const dLeft = pos.x - b.minX
          const dRight = b.maxX - pos.x
          const dTop = pos.z - b.minZ
          const dBottom = b.maxZ - pos.z
          const m = Math.min(dLeft, dRight, dTop, dBottom)
          if (m === dLeft) pos.x = b.minX - radius
          else if (m === dRight) pos.x = b.maxX + radius
          else if (m === dTop) pos.z = b.minZ - radius
          else pos.z = b.maxZ + radius
        }
      }
    }
    const clx = clamp(pos.x, -this.halfW + radius, this.halfW - radius)
    const clz = clamp(pos.z, -this.halfD + radius, this.halfD - radius)
    if (clx !== pos.x || clz !== pos.z) {
      pos.x = clx
      pos.z = clz
    }
    return pos.x !== beforeX || pos.z !== beforeZ
  }

  /** True if a circle of `radius` centered at (x, z) does not intersect anything. */
  isWalkable(x, z, radius) {
    if (x < -this.halfW + radius || x > this.halfW - radius ||
        z < -this.halfD + radius || z > this.halfD - radius) return false
    for (const b of this.aabbs) {
      if (b.shootable) continue // thin shootable props (lamp poles) do not block walking
      const cx = clamp(x, b.minX, b.maxX)
      const cz = clamp(z, b.minZ, b.maxZ)
      const dx = x - cx
      const dz = z - cz
      if (dx * dx + dz * dz < radius * radius) return false
    }
    return true
  }

  /**
   * Nearest obstacle hit along the ray (used to stop bullets at walls).
   * 3D-aware: an obstacle only blocks the ray when the bullet's height at the
   * crossing point is BELOW the box's stored `height`. This lets a shot aimed
   * over a low car/barricade pass through to a target behind it, while tall
   * buildings still stop it. `origin.y` defaults to eye height (1.7) and
   * `dir.y` to 0 when not supplied, so callers that only pass {x,z} keep the
   * old horizontal behaviour for their own height.
   * @param {{x:number,z:number,y?:number}} origin
   * @param {{x:number,z:number,y?:number}} dir  need not be normalized
   * @param {number} maxDist
   * @returns {{point:{x:number,z:number,y:number},dist:number,normal:{x:number,z:number},box:Object}|null}
   */
  castRay(origin, dir, maxDist) {
    let best = null
    const oy = typeof origin.y === 'number' ? origin.y : 1.7
    const dy = typeof dir.y === 'number' ? dir.y : 0
    const consider = (t, box, normal) => {
      if (t > 1e-6 && t <= maxDist && (!best || t < best.dist)) {
        const y = oy + dy * t
        // A box only occludes the bullet if the bullet is at or below its top.
        if (y >= box.height) return
        best = {
          point: { x: origin.x + dir.x * t, z: origin.z + dir.z * t, y },
          dist: t,
          normal,
          box
        }
      }
    }
    // Slab test against each AABB and the world bounds.
    for (const box of this.aabbs) {
      const hit = raySlab(origin, dir, box.minX, box.minZ, box.maxX, box.maxZ)
      if (hit !== null) consider(hit.t, box, hit.normal)
    }
    // World bounds are treated as infinitely tall walls (height Infinity).
    const bounds = { minX: -this.halfW, minZ: -this.halfD, maxX: this.halfW, maxZ: this.halfD, height: Infinity }
    const hit = raySlab(origin, dir, bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ)
    if (hit !== null) consider(hit.t, bounds, hit.normal)
    return best
  }
}

/**
 * 3D slab intersection. Returns the nearest forward hit parameter `t` plus the
 * face `normal` the ray entered through, or null if the ray never enters the
 * box. If the origin is inside the box, returns the exit parameter and the
 * exit-face normal (the ray must leave it).
 */
function raySlab(origin, dir, minX, minZ, maxX, maxZ) {
  let tmin = -Infinity
  let tmax = Infinity
  let nAxis = -1 // which axis produced the entry plane (0=x, 1=z)
  let nSign = 0 // entry-face normal sign along that axis
  const axes = [[origin.x, dir.x, minX, maxX], [origin.z, dir.z, minZ, maxZ]]
  for (let a = 0; a < 2; a++) {
    const [o, d, mn, mx] = axes[a]
    if (Math.abs(d) < 1e-8) {
      if (o < mn || o > mx) return null // parallel and outside
      continue
    }
    let t1 = (mn - o) / d
    let t2 = (mx - o) / d
    let s1 = -1, s2 = 1 // -d into min face, +d out of max face
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; const s = s1; s1 = s2; s2 = s }
    if (t1 > tmin) { tmin = t1; nAxis = a; nSign = s1 }
    if (t2 < tmax) tmax = t2
    if (tmin > tmax) return null
  }
  const normal = nAxis === 0 ? { x: nSign, z: 0 } : (nAxis === 1 ? { x: 0, z: nSign } : { x: 0, z: 0 })
  return tmin >= 0 ? { t: tmin, normal } : { t: tmax, normal: { x: -normal.x, z: -normal.z } } // entering hit, or exit if starting inside
}
