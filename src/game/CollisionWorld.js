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
   * @param {{x:number,z:number}} origin
   * @param {{x:number,z:number}} dir  need not be normalized
   * @param {number} maxDist
   * @returns {{point:{x:number,z:number},dist:number}|null}
   */
  castRay(origin, dir, maxDist) {
    let best = null
    const consider = (t) => {
      if (t > 1e-6 && t <= maxDist && (!best || t < best.dist)) {
        best = { point: { x: origin.x + dir.x * t, z: origin.z + dir.z * t }, dist: t }
      }
    }
    // Slab test against each AABB and the world bounds.
    for (const box of this.aabbs) {
      const t = raySlab(origin, dir, box.minX, box.minZ, box.maxX, box.maxZ)
      if (t !== null) consider(t)
    }
    const t = raySlab(origin, dir, -this.halfW, -this.halfD, this.halfW, this.halfD)
    if (t !== null) consider(t)
    return best
  }
}

/**
 * 2D slab intersection. Returns the nearest forward hit parameter t, or null
 * if the ray never enters the box. If the origin is inside the box, returns
 * the exit parameter (the ray must leave it).
 */
function raySlab(origin, dir, minX, minZ, maxX, maxZ) {
  let tmin = -Infinity
  let tmax = Infinity
  const axes = [[origin.x, dir.x, minX, maxX], [origin.z, dir.z, minZ, maxZ]]
  for (const [o, d, mn, mx] of axes) {
    if (Math.abs(d) < 1e-8) {
      if (o < mn || o > mx) return null // parallel and outside
      continue
    }
    let t1 = (mn - o) / d
    let t2 = (mx - o) / d
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t }
    if (t1 > tmin) tmin = t1
    if (t2 < tmax) tmax = t2
    if (tmin > tmax) return null
  }
  return tmin >= 0 ? tmin : tmax // entering hit, or exit if starting inside
}
