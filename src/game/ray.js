// ray.js — shared ray math for weapon hit detection. Extracted from the
// former Weapon module, which is no longer part of the game in v2 (the rifle
// was replaced by the shotgun + axe); Shotgun imports from here.

/** Nearest forward ray-sphere hit parameter, or null if no hit. */
export function raySphere(origin, dir, center, radius) {
  const ox = origin.x - center.x
  const oy = origin.y - center.y
  const oz = origin.z - center.z
  const b = ox * dir.x + oy * dir.y + oz * dir.z
  const c = ox * ox + oy * oy + oz * oz - radius * radius
  const disc = b * b - c
  if (disc < 0) return null
  const t = -b - Math.sqrt(disc)
  return t > 1e-6 ? t : null
}
