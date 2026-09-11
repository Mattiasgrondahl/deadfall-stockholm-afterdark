# Deadfall: Stockholm Afterdark — Architecture

First-person zombie survival shooter. Three.js ^0.185 + Vite ^8 + plain ESM
JavaScript (no TypeScript, no JSX, no external assets, no backend). Runs with
`npm run dev` in a real browser.

## Ground rules for every task

- Plain JavaScript only. No imports from packages other than `three`.
- **Headless-safe construction**: every subsystem must be constructible and
  update-able in Node. Never reference `document`, `window`, `navigator`,
  `AudioContext`, or pointer-lock at module top level or unguarded — receive
  them via constructor parameters (`env`/`camera`/`renderer`/`inputState`).
  Headless tests instantiate the *real* objects with stubs.
- No per-frame allocation in hot loops: reuse module-level temp
  vectors/objects. Allocate only on spawn/reset.
- Every side effect must be reversible via the owning object's `dispose()`.
- Bounded counts: ≤ 24 active zombies, ≤ 12 point lights, ~1500 snow particles,
  ≤ ~500 meshes total.
- Keep each file under ~350 lines; split a subsystem into small helpers if it grows.
- All npm commands run with cwd `/home/mgr/Workspace/Zombie` (the `.npmrc`
  redirects the npm cache into the workspace — `~` is read-only here).
  **The sandbox exports `NODE_ENV=production`**, so install with
  `NODE_ENV=development npm install` or `npm install --include=dev`.
- `npm run build` MUST pass after your task (report the result).
- Do not modify files outside your task's file list. In `src/game/Game.js`
  edit only inside `// WIRING:*` comment regions assigned to your task.
- No placeholders, no TODOs, no stub functions left behind.
- **There is no working browser in this sandbox.** Acceptance = `npm run build`
  + the Node headless tests (`node --test`) + headless playthrough stages in
  `test/verify-game.mjs`. Visual quality is reviewed statically, not live.

## Headless design (how tests drive the real game)

`Game` takes `{ canvas, headless }`. In headless mode:
- `game.env` = `{ document: null, window: null, canvasFactory: fakeCanvas }`
  — procedural texture code gets `env.canvasFactory()` (no-op 2d context;
  `CanvasTexture` stores the canvas but never uploads it).
- `game.renderer` is a `StubRenderer` (no-op `render()`, counts calls in
  `info`). `scene`/`camera`/all entities are **real THREE objects**, so
  geometry, transforms, collision, AI, and wave logic all genuinely run.
- Browser UI (HUD/Screens) is only constructed when `env.document` is real;
  `AudioBank` is a no-op until `init()` (never called headless).
- **Input is data**: `game.inputState` = `{ forward, back, left, right, sprint,
  turnX, turnY, fire, reload, pause }`. The browser `Input` adapter writes into
  it; headless tests write it directly via `game.debug.setInput({...})`.
- Frames advance with `game.debug.step(dt)` (clamped to 0.1 s). In a browser
  the renderer animation loop drives the same `step()`.
- `game.debug.sceneStats()` → `{ meshes, points, lights, groups, zombies }`
  from a pure scene traversal — the headless substitute for screenshots.

## File map and ownership

| File | Owner task |
|---|---|
| `src/main.js` | orchestrator (done) |
| `src/game/Game.js` | orchestrator (DI + headless refactor done); later tasks only inside WIRING regions |
| `src/game/Input.js` | A |
| `src/game/Player.js` | A |
| `src/game/CollisionWorld.js` | done (pure math, 12 tests passing) |
| `src/world/City.js` | B |
| `src/world/Lighting.js` | B |
| `src/game/Weapon.js` | C |
| `src/game/Zombie.js` | D |
| `src/game/WaveManager.js` | E |
| `src/ui/HUD.js` | F |
| `src/ui/Screens.js` | F |
| `src/game/Audio.js` (class `AudioBank`) | F |
| `src/styles.css` | orchestrator (done; F may extend) |
| `test/*.test.mjs` | orchestrator + coders (pure-logic node tests) |
| `test/headless-boot.test.mjs` | orchestrator (done) |
| `test/verify-game.mjs` | orchestrator (headless playthrough; the final acceptance harness) |
| `tools/e2e-browser.mjs` | orchestrator (optional real-browser smoke, manual only) |

## Module contracts (public API only)

### Input — `src/game/Input.js`
- `new Input(game, inputState)` — browser-only (headless never constructs it;
  it reads `game.env.document/window` and `game.canvas`).
- `attach()` — pointer-lock listeners (`pointerlockchange`), mouse move deltas,
  mouse button 1, keyboard.
- `requestLock()` → `game.canvas.requestPointerLock()`.
- `locked()` → boolean.
- `isDown('w'|'a'|'s'|'d'|'shift')` → boolean (also supports 'r','p','m','escape','space').
- `consumeLook()` → `{ dx, dy }` accumulated mouse delta since last call (reset after).
- `on(event, cb)` / `off(event, cb)` — events: `'lock'`, `'unlock'`, `'mute'`
  (fired once per edge). F wires `'mute'`; A wires `'lock'`/`'unlock'`.
- Writes into `inputState`: movement booleans, `turnX/turnY` (accumulated,
  Player consumes and resets), and edge flags `fire`, `reload`, `pause`
  (set true on press; the consumer clears after acting — `Game.step()`
  consumes `pause`, Weapon consumes `fire`/`reload`).
- Movement keys use `e.code` ('KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft/Right').

### Player — `src/game/Player.js`
- `new Player(camera, inputState, collision, audio)`
- Fields: `position` (Vector3, y = 1.7 eye height), `velocity`, `yaw`, `pitch`,
  `health = 100`, `maxHealth = 100`, `stamina = 100`, `isDead`.
- `update(dt)`:
  - yaw/pitch from `inputState.turnX/turnY` (consume + reset; sensitivity
    ~0.0022, pitch clamped ±1.45 rad).
  - WASD movement relative to yaw from `inputState.forward/back/left/right`:
    walk 3.4 m/s, sprint 5.8 m/s while sprint held and stamina > 5; stamina
    drains 26/s sprinting, recovers 18/s otherwise.
  - smooth accel (lerp velocity, factor ~10/s); camera follows position + bob
    (bob amplitude 0.05 while moving, frequency ∝ speed).
  - collision: `collision.resolve(this.position, 0.35)`.
- `damage(amount, sourceLabel)` → health -= amount (clamp ≥ 0); if 0 →
  `isDead = true`, call `onDeath` callback passed via `setOnDeath(cb)`.
- `heal(amount)`.
- `reset()` → spawn (0, 1.7, 12), full health/stamina, yaw facing city center.
- Public temp vectors reused internally; no per-frame allocation.

### CollisionWorld — `src/game/CollisionWorld.js` (pure math, Node-testable)
- `new CollisionWorld(width, depth)` — world AABB centered at origin (half-size = width/2, depth/2). Ground is y=0.
- `addAABB(minX, minZ, maxX, maxZ, height)` — register an obstacle (buildings, vehicles, barricades). Height unused for walking but kept for future raycasts.
- `resolve(pos, radius)` → mutates `pos` (x,z only): pushes out of every overlapping AABB (2D circle-vs-box), then clamps to world bounds. Returns true if it moved.
- `isWalkable(x, z, radius)` → boolean.
- `castRay(origin, dir, maxDist)` → `{ point, dist }` or null — nearest AABB/world-wall hit along the ray (used by Weapon so bullets stop at walls). **World bounds are occluders.** If the ray origin is inside an obstacle, returns the *exit* point.
- `clear()` — remove all obstacle AABBs (world bounds stay). Task B calls it when the real city replaces task A's placeholder environment.
- No THREE imports needed (use plain {x,y,z} objects) so it runs in Node tests.

### City — `src/world/City.js`
- `new City(scene, collision, env)` — builds everything in constructor
  (`env.canvasFactory()` for procedural textures — headless-safe):
  - 7×7 city blocks (block pitch ~30 m, street width ~9 m). Each block has 1–4
    building boxes (height 5–22 m), dark facade with a procedurally generated
    `CanvasTexture` window grid (most windows dark, a few lit warm). Snow-dusted
    flat roofs. Some blocks are plazas (trees = trunk box + foliage box, no collision).
  - Alleys: narrow walkable gaps between adjacent buildings inside blocks (ensure
    street + alley floor is free of AABBs; buildings get AABBs with ~0.5 m margin).
  - Streetlights: pole (cylinder) + glowing head box, placed along streets, ~40
    total; each exposes `lightAnchor` position in `streetlightAnchors[]`.
  - ~12 abandoned vehicles (box body + cabin + 4 wheel cylinders) parked at
    street edges, each registered as an AABB; ~8 barricades (stacked planks)
    at intersections, AABBs.
  - Snow: 1500 falling flakes as one `THREE.Points` within a 60 m cube centered
    on the player, recycled to the top when below ground; updated in `update(playerPos)`.
  - Stars: distant `THREE.Points` dome. Ground: big plane, pale snow material.
  - World bounds: `collision` sized to the city footprint + margin.
- `getSpawnPoints()` → array of `{ x, z }` walkable positions: 8 on the outer ring, 4 interior lots.
- `update(playerPos)` — recycle snow around the player.
- `dispose()` — remove scene children, textures.
- **Headless acceptance**: `game.debug.sceneStats()` shows the expected mesh/
  point counts; every `getSpawnPoints()` entry satisfies
  `collision.isWalkable(x, z, 0.4)`; walking into a building AABB is pushed out.

### Lighting — `src/world/Lighting.js`
- `new Lighting(scene, city, renderer, quality)`
- **three.js r185 physically-based units** (renderer set to
  `THREE.ACESFilmicToneMapping`, `toneMappingExposure` ~1.2):
  - Moon `DirectionalLight`: color 0x9db4ff, **0.8 lx**, casts the *only*
    shadow (shadow map 2048, ortho box ~44 m; light + target follow the player
    each frame — light offset NW-above, target at player).
  - `HemisphereLight` sky 0x1a2440 / ground 0x0a0a10, ~0.3; small
    `AmbientLight` 0x141a2e, ~0.15 as backstop.
  - Streetlight pool: 12 `PointLight`s, color 0xffb878, **35 cd, decay 2,
    distance 20**; each frame assign to the 12 nearest `streetlightAnchors` to
    the player; all others intensity 0. (PointLight shadows are 6-face cubemaps —
    never enable them.)
  - Muzzle flash (from Weapon): ~400 cd for 2–4 frames, short-lived PointLight.
- `update(playerPos)` — light assignment + shadow follow.
- `setQuality('high'|'low')` — low: `renderer.shadowMap.enabled = false`,
  snow halved (tell City via `city.setSnowCount(n)` if provided), 6 lights.
  Game calls it on toggle.
- `dispose()`.

### Weapon — `src/game/Weapon.js`
- `new Weapon(scene, camera, collision, audio)`
- View model: procedural rifle attached to camera at ~(0.26, -0.26, -0.55):
  barrel, body, magazine, stock from boxes/cylinders, dark grey/steel materials;
  muzzle-flash sprite + short-lived `PointLight` (40 ms, ~400 cd) at barrel tip; recoil kick
  (0.05 m, decays) and view-model sway/bob synced to player movement.
- Stats: `magSize = 12`, start `ammo = 12`, `reserve = 60`, `damage = 34`,
  head multiplier 2, `range = 60`, `spread = 0.015` rad base (+0.02 moving, +0.03 sprinting),
  `reloadTime = 2.2 s`, fire interval 0.12 s (semi-auto: one shot per `inputState.fire` edge).
- `shoot()` → false if reloading, out of ammo, or within fire interval; else:
  ray from camera along view direction with spread jitter; nearest zombie hitbox
  within range AND before `collision.castRay` wall hit → `zombie.damage(dmg * headMult, dir)`,
  muzzle flash, `audio.shoot()`, ammo--, auto-reload at 0. Returns true.
- `reload()` → if reserve > 0 && ammo < mag && !isReloading: start; refill on completion.
- `update(dt)` — reload progress, recoil/sway recovery; consumes `inputState.fire/reload` edges.
- `reset()` → full mag, full reserve, no reload.
- `disposables` handled by `dispose()`.

### Zombie — `src/game/Zombie.js`
- Types:
  | type | health | speed | damage | notes |
  |---|---|---|---|---|
  | walker | 50 | 2.6 | 8 | fast-ish, common |
  | shambler | 100 | 1.5 | 14 | large, slow, tough |
  | screamer | 70 | 3.2 | 10 | appears wave ≥ 3, shrieks |
  Wave scaling (WaveManager): `stat *= 1 + 0.12*(wave-1)`.
- Body: `Group` of boxes (torso, head, 2 arms, 2 legs) + procedural materials:
  per-type base palette (rot-flesh grey-green, tattered coat colors: faded blue,
  rust, olive, dark red) randomized per zombie via `Color.offsetHSL`. Eyes glow
  faintly red (small emissive box). Walk cycle: procedural limb swing from phase;
  head yaws toward player while pursuing; hit flash: white emissive pulse 0.2 s.
- Hitboxes for weapon: `getHitboxes()` → `[{ center: Vector3, radius, isHead }]`
  (torso center radius 0.45, head radius 0.3).
- State machine (`state`): IDLE → PURSUE → ATTACK → (HIT overlay) → DEAD.
  - IDLE: wander heading, 1.5–4 s, speed 0.4×; then PURSUE.
  - PURSUE: steer toward player (arrive-style), separation from others (radius 0.9,
    push 0.5), `collision.resolve(pos, 0.4)`; within `attackRange = 1.35` → ATTACK.
  - ATTACK: face player, lunge (short burst 1.6 m/s); if within 1.5 m and cooldown
    elapsed (1.0 s) → `player.damage(damage, 'zombie')`, `audio.zombieAttack()`; back to PURSUE.
  - HIT: 0.25 s stagger (no movement), then return to previous state.
  - DEAD: topple (rotate to ground over 0.4 s, sink slowly), `deathTimer`; after 5 s
    `deadAndGone = true` (Game splices + disposes).
- `damage(amount, dir)` → health -= amount; state → HIT; hit flash; if ≤ 0 →
  `isDead = true`, state DEAD, `audio.zombieDeath()`; register kill via `onKill(cb)`.
- `update(dt, player, others, collision, audio)` — runs the machine; skips movement while DEAD/HIT.
- Object pooling: module-level pool per type reuses body Groups (reset transforms/materials);
  `reset(type, pos, scaleStats)` reactivates. `dispose()` returns to pool.
- Bounded: Game caps active zombies at 24.

### WaveManager — `src/game/WaveManager.js`
- `new WaveManager(scene, spawnPoints, collision, audio, gameHooks)`
  `gameHooks = { onWaveStart(wave), onWaveCleared(wave), spawnZombie(type,x,z) }`.
- `wave = 0`, `remaining`, `state` ∈ idle|intermission|active.
- `reset()` → wave 0, state idle.
- `startNextWave()`:
  - wave++; total = `5 + 3*wave` (cap 40); maxConcurrent = `min(8 + wave, 18)`.
  - type mix: walker 55%, shambler 25%, screamer 20% (no screamers before wave 3 → shift to walkers).
  - `audio.waveStart()`; `onWaveStart(wave)` (HUD banner).
  - spawn cadence: 1 zombie per 0.7 s until total spawned, respecting maxConcurrent.
- `update(dt, game)`:
  - spawn schedule; track alive count.
  - all spawned && none alive → `onWaveCleared(wave)`, state intermission; after 4 s
    auto `startNextWave()`; `audio.waveClear()`.
  - `remaining` = spawned-not-dead + not-yet-spawned (for HUD).
- `forceClear()` — test hook: kill all live + skip intermission.
- `dispose()`.

### Audio — `src/game/Audio.js` (class name `AudioBank`)
- `new AudioBank()` — **headless-safe**: no AudioContext until `init()`; every
  sound method is a no-op before `init()` or while muted. `init()` is called
  only from a user gesture in a browser (never headless).
- All sounds synthesized (no files):
  - `shoot()` — 20 ms band-passed noise burst + 120→60 Hz sine thump.
  - `hitZombie()` — low-pass noise thud 80 ms.
  - `zombieDeath()` — descending saw 150→40 Hz, 300 ms.
  - `zombieAttack()` — saw grunt 200→80 Hz, 150 ms.
  - `reload()` — two short square-wave clicks (at 0 and +0.3 s).
  - `waveStart()` / `waveClear()` — low horn tones.
  - `startAmbient()` — wind: looped filtered brown noise + slow LFO; drone sine 55 Hz
    (very quiet); occasional distant shriek via a bounded timer (max 1 per 20 s).
  - `stopAmbient()`.
- `setMuted(m)`, `muted`. Master gain 0.8.
- All one-shot nodes scheduled to stop → GC'd; ambient graph torn down on stop.

### HUD — `src/ui/HUD.js`
- `new HUD(hudRoot, fxRoot)` — browser-only; Game constructs it only when
  `env.document` is real. Builds DOM:
  - crosshair (center dot + 4 bars; spreads via CSS class when moving/sprinting),
  - health bar bottom-left (numeric + bar; red pulse below 30),
  - ammo bottom-right (`mag / reserve`), reload progress line while reloading,
  - wave top-center (`WAVE n`), threat indicator (`THREAT: k` remaining),
  - center message area for transient status ("WAVE CLEARED", "RELOADING"),
  - damage flash overlay in fxRoot (red vignette, `flashDamage()`),
  - low-health vignette class when health < 30.
- `update(player, weapon, waveManager)` — writes DOM only when a value changed
  (cache last values); `flashDamage()` on player damage; `showMessage(text, ms)`.
- `hide()` / `show()` — hidden outside PLAYING.
- `dispose()`.

### Screens — `src/ui/Screens.js`
- `new Screens(root, game)` — browser-only. Builds title / pause / gameover / wave-banner screens:
  - **Title**: name, tagline, controls list, "CLICK TO BEGIN" button (+ clicking the
    canvas also starts). → `game.startGame()`.
  - **Pause**: shown when pointer lock lost / P pressed: controls summary, buttons
    Resume (re-lock), Restart, Quit to title, quality toggle (high/low), mute toggle.
  - **Game over**: "YOU DIED", wave reached, kills, buttons Restart / Title.
  - **Wave banner**: big center text with CSS fade, `showBanner(text)` (used by
    onWaveStart / onWaveCleared).
- `showGameplay()` — hide all screens (used by startGame).
- `showTitle()` / `showPause()` / `showGameOver(stats)` / `showBanner(text)`.
- `dispose()`.

### Game — `src/game/Game.js` (DI + headless refactor done)
- `new Game({ canvas, headless })` — headless env: stub renderer, no DOM,
  `canvasFactory` for procedural textures (see "Headless design" above).
- `start()` — build renderer (browser only), scene (bg 0x060912, FogExp2
  0x0b1020 @ 0.032, camera 75° @ (0,1.7,12)), init subsystems, start loop
  (browser: `renderer.setAnimationLoop(() => tick())`; headless: one render to
  build the graph; frames then come from `debug.step(dt)`).
- `step(dt)` — one clamped frame: `update(dt)` while PLAYING, `render()`, HUD
  update. `tick()` = rAF wrapper over `step`.
- State machine `GameState`: TITLE / PLAYING / PAUSED / GAMEOVER.
  `startGame()`, `togglePause()`, `handleUnlock()`, `onPlayerDeath()`,
  `setState(next)`.
- Later tasks fill the WIRING regions exactly as marked in the file:
  - A: INPUT, PLAYER (incl. `new CollisionWorld(180, 180)` + placeholder ground),
    STATE_TRANSITIONS (log), RESET, player death wiring.
  - B: CITY, LIGHTING.
  - C: WEAPON (in UPDATE region).
  - D: SPAWN (create zombie via pool, push to `this.zombies`, cap 24),
    ZOMBIES (update loop + corpse cleanup already in scaffold).
  - E: WAVES.
  - F: AUDIO, UI, HUD (already scaffolded in `step()`), state transitions
    (screens/pointer-lock), quality toggle (→ `lighting.setQuality`).
- `spawnZombie(type, x, z)` — stub until D.
- **`window.__game` debug API (keep stable; headless uses it to drive play)**:
  `state()`, `playerPos()`, `health()`, `stamina()`, `ammo()`, `reserve()`,
  `wave()`, `zombiesAlive()`, `zombiesRemaining()`, `kills()`,
  `setPlayerPos(x,z)`, `damagePlayer(n)`, `shootOnce()`, `reloadWeapon()`,
  `setInput(partial)`, `spawnZombie(type,x,z)`, `killAllZombies()`,
  `forceWaveClear()`, `step(dt)`, `frameStats()`, `sceneStats()`.

## HUD / Screens DOM contract (CSS is already written to match this)

`HUD` builds into `#hud-root`; FX overlays go into `#fx-root`:

```
#hud-root (position:fixed, pointer-events:none)
  .crosshair            .ch-dot  .ch-bar.top .ch-bar.bottom .ch-bar.left .ch-bar.right
                        (+ .crosshair.spread while moving/sprinting)
  .hud-health   .hud-label .bar > .bar-fill .hud-value     (bottom-left)
  .hud-stamina  same structure                               (under health)
  .hud-ammo     .hud-label .hud-value .hud-reload > .bar .bar-fill  (bottom-right)
  .hud-wave     .hud-label .hud-value                        (top-center)
  .hud-threat   .hud-label .hud-value                        (top-center, under wave)
  .hud-message  .hud-message-text                            (center, transient)

#fx-root
  .fx-scanlines     (always, subtle)
  .fx-damage        (red flash, .fx-damage.on for ~300 ms)
  .fx-lowhealth     (persistent vignette when health < 30)
```

`Screens` builds into `#screens-root`:

```
.screen            (overlay, hidden by default; .screen.visible shows it)
  .screen-title    .game-title .tagline .controls-grid .btn.primary#btn-start
  .screen-pause    .screen-heading .controls-grid
                   .btn#btn-resume .btn#btn-restart .btn#btn-quit
                   .toggle-row > .toggle#tgl-quality .toggle#tgl-mute
  .screen-gameover .gameover-title .stats > .stat (x2) .btn#btn-restart2 .btn#btn-title
.banner            (center, .banner.show triggers fade/scale animation)
```

Buttons: class `.btn`, primary actions get `.btn.primary`. Control grid rows:
`.ctrl-row > .key + .act`.

## Verification strategy (sandbox has no working browser)

Established by exhaustive probing: Firefox 154 headless fails at SWGL
framebuffer mapping; Playwright Firefox dies on read-only $HOME/$run dirs;
Chromium download is blocked at the Microsoft CDN. Therefore:

1. **Unit tests** (`node --test`, auto-discovers `test/*.test.mjs`): pure
   logic — collision (12 tests, done), zombie state machine, wave scheduling,
   weapon math, player movement/stamina.
2. **Headless playthrough** (`test/verify-game.mjs`): the real `Game` in Node
   with `headless: true`; drives a full session — title → start → move/sprint/
   look → shoot (hits registered) → reload → zombies pursue/attack/kill →
   waves 1→2→3 with spawns, scaling, clear, intermission → player death →
   game over → restart. Asserts invariants per stage + `sceneStats()` sanity.
3. **Build**: `npm run build` after every task.
4. **Dev server**: module-transform checks on the running Vite server
   (HTTP 200 + transformed modules parse).
5. **Static review**: reviewer subagents inspect City/Lighting/HUD visual code
   (lighting units, budgets, DOM contract) — they cannot see pixels.

Real-browser play (visuals, audio, pointer feel) is left to the user:
`npm run dev` → http://localhost:5173, plus the debug API on
`window.__game.debug` and the optional `node tools/e2e-browser.mjs`.

## Task boundaries (one GPU-1 child at a time)

- **A**: Input.js, Player.js + Game.js wiring (INPUT, PLAYER, STATE_TRANSITIONS,
  RESET, death wiring, placeholder ground) — CollisionWorld already done.
  Acceptance: headless-boot + headless movement stages (forward movement,
  sprint + stamina drain, look turns yaw/pitch, pause/resume, restart resets);
  `npm run build` passes.
- **B**: City.js, Lighting.js + Game.js wiring (CITY, LIGHTING). Acceptance:
  `npm run build` passes; headless `sceneStats()` shows buildings/vehicles/
  streetlights/snow/stars; all spawn points walkable; AABB push-out verified;
  lighting uses r185 units (moon-only shadows, candela streetlights).
- **C**: Weapon.js + Game.js wiring (WEAPON) + `test/weapon.test.mjs`.
  Acceptance: build + node test pass; headless: shoot decrements ammo,
  auto-reload at 0, reload refills, no fire while reloading, bullets stop at
  walls (castRay occlusion).
- **D**: Zombie.js + Game.js wiring (ZOMBIES, SPAWN) + `test/zombie-state.test.mjs`.
  Acceptance: build + node test pass; headless: spawned zombie pursues player,
  attacks (player health drops), staggers on hit, dies and corpse cleans up,
  kills counter increments.
- **E**: WaveManager.js + Game.js wiring (WAVES) + `test/waves.test.mjs`.
  Acceptance: build + node test pass; headless: startGame → wave 1 active,
  spawn cadence, difficulty scaling, kill-all → cleared → intermission → wave 2;
  screamer only wave ≥ 3.
- **F**: HUD.js, Screens.js, Audio.js + Game.js wiring (AUDIO, UI, state
  transitions, quality toggle). Acceptance: build passes; headless playthrough
  runs clean with HUD/Screens null (guards hold); AudioBank no-op headless;
  DOM contract matches styles.css (static review).
- **Final**: `test/verify-game.mjs` full headless playthrough green +
  `npm run build` green + dev-server module checks + reviewer final pass +
  README.

## Style notes

- UI: cold blue-grey palette, condensed uppercase labels, subtle scanline/vignette.
  CSS is owned by the orchestrator; tasks F may add classes but not restyle wholesale.
- No external fonts, no external images, no network calls at runtime.
