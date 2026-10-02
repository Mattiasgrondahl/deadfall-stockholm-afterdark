import * as THREE from 'three'

// AmmoDrops — manages ammo drops left by killed zombies. A seeded-LCG roll
// (~55%) spawns a drop at the corpse on each kill; the drop is either shotgun
// SHELLS or handgun BULLETS (40/drop) (a second LCG roll picks the kind). The
// player picks one up within 2.2 m to restock the matching weapon's reserve.
// v27: each drop is a stenciled military ammo CRATE (chunky box + generated
// olive-crate texture) instead of the old flat green square. Drops blink in
// their last 5 s, expire at 30 s, and are capped at 20 concurrent. All RNG is a
// seeded LCG (no Math.random); headless-safe (no DOM, audio optional).
//
// 10-wave ammo economy: a full run is ~217 kills needing ~2030 pistol body
// shots (v27 doubled zombie HP). Expected income is 36 start + ~1957 from drops
// = ~1993 (~98% of need), so the pistol stays scarce but survives to the boss.
// Shotgun: 30 start + ~783 drops vs ~700 needed.

const SEED = 1337
export const DROP_CHANCE = 0.55
// v27: normal-zombie HP doubled (walker 50→100 etc.), so each kill now needs
// ~2× the rounds. Drop yields are doubled to keep the ammo economy from
// collapsing — bullets 18→36, shells 8→16 — so income still tracks ~90% of the
// (also-doubled) demand.
export const SHELLS_PER_DROP = 16
export const BULLETS_PER_DROP = 40
export const BULLET_CHANCE = 0.5 // of drops, share that are handgun bullets (else shells)
// Pickup radius. v20: raised 1.2 -> 2.2 m. The 0.16 m drop box is tiny and hard
// to spot on dark wet asphalt, and a drop lands where the zombie fell — often
// just off the player's path or against a wall. At 1.2 m a player walking past
// brushed within ~1.5 m and the drop was silently missed ("dropped ammo is not
// picked up"). 2.2 m is a forgiving vacuum radius so walking near a drop grabs
// it, while still requiring the player to actually route to the corpse.
export const PICKUP_RADIUS = 2.2
export const LIFETIME = 30
export const BLINK_AFTER = 25
export const MAX_DROPS = 20
/** Share of kills that drop a battery instead of ammo (a third LCG draw,
 *  taken only when an ammo drop actually spawned). Batteries recharge the
 *  flashlight — the run's scarce light resource — so the player must choose
 *  between detouring for light and staying on the ammo path. */
export const BATTERY_CHANCE = 0.18
export const BATTERY_RESTORE = 0.35 // fraction of flashlight battery per pickup
// v37 R2: a small slice of drops are medkits that heal the player instead of
// restocking ammo/light. Rare enough that health stays a scarce resource, but
// present enough that a long run has occasional heal opportunities.
export const MEDKIT_CHANCE = 0.06
export const MEDKIT_HEAL = 35 // hp restored per medkit pickup
const DROP_Y = 0.1
// Distinct visuals so the player can tell shells from bullets at a glance.
const SHELL_COLOR = 0xffaa44, SHELL_EMISSIVE = 0x774400
const BULLET_COLOR = 0x6fc2ff, BULLET_EMISSIVE = 0x1a4a77
const BATTERY_COLOR = 0x9dff6a, BATTERY_EMISSIVE = 0x2a5a1a
const MEDKIT_COLOR = 0xff5a5a, MEDKIT_EMISSIVE = 0x661414

export class AmmoDrops {
  constructor(scene, audio, base = '') {
    this.scene = scene
    this.audio = audio
    this._base = base
    this._seed = SEED
    this._drops = []
    // v27: dropped ammo is a stenciled military ammo CRATE instead of the old
    // flat green square. One shared crate geometry (a chunky box with crate
    // proportions) reused by every drop (flat mesh budget); one material per
    // kind so shells/bullets/battery still read apart by color + emissive glow.
    // A generated olive-crate texture (assets/ammo/ammo_crate.jpg) is layered on
    // in the browser via _loadCrate; headless keeps the flat tinted look.
    this._geo = new THREE.BoxGeometry(0.3, 0.2, 0.22)
    this._shellMat = new THREE.MeshStandardMaterial({
      color: SHELL_COLOR, emissive: SHELL_EMISSIVE, emissiveIntensity: 0.6, roughness: 0.7
    })
    this._bulletMat = new THREE.MeshStandardMaterial({
      color: BULLET_COLOR, emissive: BULLET_EMISSIVE, emissiveIntensity: 0.6, roughness: 0.7
    })
    this._batteryMat = new THREE.MeshStandardMaterial({
      color: BATTERY_COLOR, emissive: BATTERY_EMISSIVE, emissiveIntensity: 0.8, roughness: 0.7
    })
    // v37 R2: medkit crate — a red-tinted box so it reads as health, not ammo.
    this._medkitMat = new THREE.MeshStandardMaterial({
      color: MEDKIT_COLOR, emissive: MEDKIT_EMISSIVE, emissiveIntensity: 0.8, roughness: 0.7
    })
    // v37 R2: difficulty-scaled ammo yield. Under frenzy/nightmare the horde is
    // denser and demand is higher, so drops pay out less (setDifficulty halves
    // it) to keep the economy tense. 1 = normal.
    this._yieldMult = 1
    this._crateTex = null
    this._loadCrate()
  }

  /** v27: layer the generated ammo-crate texture onto the crate materials.
   *  Browser-only (guarded for headless); on load the crate reads as a stenciled
   *  wooden box rather than a tinted cube. Missing/undecodable keeps the flat
   *  tinted crate. Mirrors the weapon-skin loader (Sniper.js:_loadSkin). */
  _loadCrate() {
    if (typeof document === 'undefined') return
    const loader = new THREE.TextureLoader()
    loader.load(this._base + 'assets/ammo/ammo_crate.jpg', (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 4
      this._crateTex = tex
      for (const m of [this._shellMat, this._bulletMat, this._batteryMat, this._medkitMat]) {
        m.map = tex
        m.needsUpdate = true
      }
    }, undefined, () => { /* keep the flat tinted crate */ })
  }

  /** Seeded LCG in [0, 1). Deterministic for a fixed call order. The >>> 0
   * keeps Math.imul's signed 32-bit result non-negative before the mod, so
   * the roll is always in [0, 1). */
  _rand() {
    this._seed = (Math.imul(this._seed, 48271) >>> 0) % 65537
    return this._seed / 65537
  }

  get count() { return this._drops.length }

  /** Roll on a kill; spawn a drop at (x, z) if the roll hits and under cap.
   *  A second LCG roll picks the kind: 'bullets' (handgun) or 'shells'
   *  (shotgun). Returns the spawned drop's kind, or null when no drop spawned. */
  maybeSpawn(x, z) {
    if (this._drops.length >= MAX_DROPS) return null
    if (this._rand() >= DROP_CHANCE) return null
    let kind = this._rand() < BULLET_CHANCE ? 'bullets' : 'shells'
    // Third draw: a slice of drops are batteries (a brighter, larger box)
    // instead of ammo. The choice is the player's: grab light or grab ammo.
    if (this._rand() < BATTERY_CHANCE) kind = 'battery'
    // v37 R2: a rare fourth draw turns the drop into a medkit (heals instead of
    // restocking). Checked last so it doesn't disturb the existing battery/ammo
    // distribution that the ammo-economy tests pin.
    else if (this._rand() < MEDKIT_CHANCE) kind = 'medkit'
    const mat = kind === 'bullets' ? this._bulletMat
      : kind === 'shells' ? this._shellMat
        : kind === 'battery' ? this._batteryMat : this._medkitMat
    // v37 R2: ammo drops carry a difficulty-scaled amount so the pickup handler
    // pays out the right count (battery/medkit carry their fixed restore).
    let amount = 0
    if (kind === 'bullets') amount = Math.max(1, Math.round(BULLETS_PER_DROP * this._yieldMult))
    else if (kind === 'shells') amount = Math.max(1, Math.round(SHELLS_PER_DROP * this._yieldMult))
    else if (kind === 'battery') amount = BATTERY_RESTORE
    else if (kind === 'medkit') amount = MEDKIT_HEAL
    const mesh = new THREE.Mesh(this._geo, mat)
    mesh.position.set(x, DROP_Y, z)
    this.scene.add(mesh)
    this._drops.push({ x, z, t: 0, mesh, kind, amount })
    return kind
  }

  /** v37 R2: set the ammo-yield multiplier for the run's difficulty (1 = normal;
   *  frenzy/nightmare pass 0.5 so drops pay out half as much against the denser,
   *  faster horde). Only affects future spawns; existing drops keep their amount. */
  setDifficulty(mult) {
    this._yieldMult = Number.isFinite(mult) && mult > 0 ? mult : 1
  }

  /** Per frame: age, blink, expire, and pick up. onPickup(drop, player) per
   *  pickup. `player` may be a single player (solo Game) or an array of
   *  players (multiplayer Match): the first alive player in range takes the
   *  drop, in array order (deterministic). */
  update(dt, player, onPickup) {
    const players = Array.isArray(player) ? player : [player]
    for (let i = this._drops.length - 1; i >= 0; i--) {
      const d = this._drops[i]
      d.t += dt
      if (d.t >= LIFETIME) { this._remove(i); continue }
      d.mesh.visible = d.t >= BLINK_AFTER ? (Math.floor(d.t * 3) % 2 === 0) : true
      for (const p of players) {
        if (!p || p.isDead) continue
        const dx = p.position.x - d.x
        const dz = p.position.z - d.z
        if (dx * dx + dz * dz <= PICKUP_RADIUS * PICKUP_RADIUS) {
          if (onPickup) onPickup(d, p)
          this._remove(i)
          break
        }
      }
    }
  }

  _remove(i) {
    const d = this._drops[i]
    this.scene.remove(d.mesh)
    this._drops.splice(i, 1)
  }

  /** Remove all drops (reset / new run). */
  clear() {
    while (this._drops.length) this._remove(this._drops.length - 1)
  }

  dispose() {
    this.clear()
    this._geo.dispose()
    this._shellMat.dispose()
    this._bulletMat.dispose()
    this._batteryMat.dispose()
    if (this._crateTex) this._crateTex.dispose()
    this._crateTex = null
  }
}
