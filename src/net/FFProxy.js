// src/net/FFProxy.js — a friendly-fire hitbox proxy for a remote (teammate)
// player, so the local weapon's existing zombie-hit loop can also register hits
// on teammates in co-op.
//
// The weapons raycast `getZombies()` and call the target's getHitboxes /
// hitLimbAt / _chainShot / knockback / damage. A teammate is not a zombie, so
// this proxy presents the SAME read-only surface the weapons expect but with
// harmless no-op behaviour for the zombie-only bits (limb sever, dismemberment
// chain, knockback, shotgun armor) and a `damage()` that sends an authoritative
// friendly-fire (MSG.FF) message to the server instead of mutating local state.
// The server applies the reduced friendly-fire damage to the victim's player and
// the snapshot round-trips the new health back to every client.
//
// The proxy is a plain data object (no THREE, no DOM) rebuilt each snapshot from
// the roster entry, so it is headless-testable and allocation-cheap (one small
// object per teammate per snapshot, ≤8 total).
//
// The hitbox layout mirrors RemotePlayer's primitive body: torso box + head box,
// expressed as two spheres (body + head) for the weapons' raySphere test. The
// snapshot carries the player's EYE height (y = STAND_EYE 1.7 when standing);
// the torso center sits below the eye, the head center above it.

const STAND_EYE = 1.7

/**
 * Build a fresh friendly-fire proxy for one teammate from a snapshot entry.
 * @param {{id:string,x:number,y:number,z:number,dead?:boolean}} p snapshot player
 * @param {(victim:string, dmg:number)=>void} sendFF sends MSG.FF to the server
 * @returns {object} a weapon-target-shaped proxy
 */
export function makeFFProxy(p, sendFF) {
  const eye = Number.isFinite(p.y) ? p.y : STAND_EYE
  const x = p.x, z = p.z
  // Two spheres: a torso sphere at chest height, a head sphere above it. Radii
  // approximate the primitive avatar's silhouette (torso 0.5 wide, head 0.28).
  const boxes = [
    { center: { x, y: eye - 0.45, z }, radius: 0.42, isHead: false },
    { center: { x, y: eye + 0.15, z }, radius: 0.22, isHead: true },
  ]
  const self = {
    id: p.id,
    isDead: !!p.dead,
    isBoss: false,
    shotgunArmor: 1,
    position: { x, y: eye, z },
    getHitboxes() { return boxes },
    hitLimbAt() { return null },   // teammates have no severable limbs
    _chainShot() {},               // no dismemberment chain for players
    knockback() {},                // no knockback on players
    damage(dmg) {
      // The weapon calls damage() with the full listed damage; the server applies
      // the friendly-fire fraction, so forward the raw damage and let the server
      // scale it. Guard against self/dead/zero.
      if (dmg > 0 && !self.isDead) sendFF(p.id, dmg)
    },
  }
  return self
}