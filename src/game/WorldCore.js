// WorldCore — the shared authoritative per-frame simulation core for Deadfall.
//
// Phase 0 of MULTIPLAYER_PLAN.md (§9, §13): the per-frame world update that
// used to live inline in Game.update() is extracted here so that BOTH the
// single-player Game and the server-side Match (src/net/Match.js) drive the
// exact same code path. The core is pure object orchestration — no DOM, no
// Math.random (all RNG lives in the deterministic LCGs inside the entities) —
// so it is headless-Node safe.
//
// The world state `ws` is a plain object owned by the caller:
//   ws.players   : [{ id, player, weapon, inputState }, ...]
//                   (1 entry for the single-player Game, up to 8 for a Match)
//   ws.zombies   : Zombie[] — the LIVE entity list. The caller owns the array;
//                  the core mutates it (corpse removal splices it), and the
//                  wave manager reads it. Game passes this.zombies (same array).
//   ws.collision : CollisionWorld
//   ws.wave      : WaveManager or null (update(dt, ws) reads ws.zombies)
//   ws.drops     : AmmoDrops or null
//   ws.audio     : AudioBank or null (positional zombie-attack sound, drop thud)
//   ws.onKill(zombie, by)   : fired once per kill; `by` is the killer's player
//                   id (zombie.lastDamager, set by weapons that know their
//                   owner) or null when unknown (e.g. debug kills, solo)
//   ws.onDropSpawn(x, z)     : fired when a kill roll spawns an ammo drop
//   ws.onDropPickup(drop, player) : fired when a player picks a drop
//
// Order of the shared systems (mirrors the pre-refactor Game.update sequence
// for those systems, so single-player behavior is unchanged):
//   1. each player: player.update(dt)  (skip dead) + weapon.update(dt, player)
//   2. each zombie: zombie.update(dt, target, zombies, collision, audio)
//      target = nearest ALIVE player; in solo that is the single player, so
//      the zombie sees exactly what it always saw.
//   3. kill bookkeeping + corpse cleanup (kill event, drop roll, removal)
//   4. drops: age / blink / expire / pickup by any alive player
//   5. wave manager: spawn cadence, concurrent cap, clear detection
//
// Client-only systems are NOT part of the core: blood, decapitated-head pool,
// flashlight, groans, lighting, sky, city visuals, HUD. The Game keeps calling
// them around the core; the server Match has no such concerns (it never
// renders or plays audio — ws.audio is null there).

/**
 * Nearest alive player to world point (x, z); null if none is alive.
 * Exact ties resolve to the first player in the array (deterministic).
 */
export function nearestAlivePlayer(x, z, players) {
  let best = null
  let bestD2 = Infinity
  for (const p of players) {
    const pl = p.player
    if (!pl || pl.isDead) continue
    const dx = pl.position.x - x
    const dz = pl.position.z - z
    const d2 = dx * dx + dz * dz
    if (d2 < bestD2) { bestD2 = d2; best = pl }
  }
  return best
}

/**
 * One authoritative frame of world simulation. dt should already be clamped
 * by the caller (Game.step and Match.step clamp to [0, 0.1]).
 */
export function updateWorld(dt, ws) {
  // 1. Players: movement / look / stamina / jump, then weapon cooldowns,
  //    fire/reload/switch input edges, view model.
  for (const p of ws.players) {
    if (p.player && !p.player.isDead) p.player.update(dt)
    if (p.weapon) p.weapon.update(dt, p.player)
  }
  // 2. Zombies: AI (chase / attack / stagger / slide), melee damage,
  //    knockback. Each zombie targets the nearest alive player.
  for (const z of ws.zombies) {
    const target = nearestAlivePlayer(z.position.x, z.position.z, ws.players)
    z.update(dt, target, ws.zombies, ws.collision, ws.audio)
  }
  // 3. Kill bookkeeping + corpse cleanup (mirrors the pre-refactor
  //    Game.update loop: kill event first, then drop roll, then removal).
  for (let i = ws.zombies.length - 1; i >= 0; i--) {
    const z = ws.zombies[i]
    if (z.isDead && !z._killCounted) {
      z._killCounted = true
      if (ws.onKill) ws.onKill(z, z.lastDamager ?? null)
      const kind = ws.drops ? ws.drops.maybeSpawn(z.position.x, z.position.z) : null
      if (kind) {
        if (ws.audio && ws.audio.drop) ws.audio.drop()
        if (ws.onDropSpawn) ws.onDropSpawn(z.position.x, z.position.z, kind)
      }
    }
    if (z.deadAndGone) {
      ws.zombies.splice(i, 1)
      z.dispose()
    } else if (z.isDead && z.deathTimer >= 5) {
      z.deadAndGone = true
    }
  }
  // 4. Drops: aging, blink, expiry, pickup by the first alive player in range
  //    (drops take Player objects, so map the slots down).
  if (ws.drops) ws.drops.update(dt, ws.players.map(s => s.player), ws.onDropPickup)
  // 5. Waves: spawn cadence, cap, clear detection. ws.wave reads ws.zombies.
  if (ws.wave) ws.wave.update(dt, ws)
}
