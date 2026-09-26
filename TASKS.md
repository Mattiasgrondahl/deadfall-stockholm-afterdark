# TASKS — Deadfall: Stockholm Afterdark

Internal task tracking (git-ignored). Reconstructed after a workspace corruption lost
the original; state below is recovered from git history + probe evidence.

## Status overview
- **Version 2**: COMPLETE — zero open code items; E2E 18/18; headless suite green.
- **Deployed**: GitHub Pages (mattiasgrondahl.github.io/deadfall-stockholm-afterdark) —
  live at gh-pages `3648a7c` (build of task-6 commit `0b9fc8b`, built from the committed
  tree so the uncommitted visual WIP is NOT in the live bundle): base path, all 9 face
  images, 6 outfit textures, city graphics, all weapons, task-5 melee slash/knockback/jump,
  plus task-6 FRENZY difficulty. Verified Sep 18: live index references `index-BOravPsZ.js`
  + `index-B-3fnUMA.css` (200), `FRENZY` present in the live bundle,
  `assets/weapons/{sword,axe}.jpg` + `assets/faces/walker-face.jpg` 200 image/jpeg, base
  path present. (Superseded: `25aad80`, `3107ba2`, `9a9e45c`, `f8a22ad`.)
- **Version 3** (branch `v2`): tasks 1–6 done; combat additions (Sword, Pistol, DecapitatedHeadPool,
  outfits) committed `b2b59a3`; task 5 (melee slash animation, knockback, jump, weapon-surface
  textures) committed `f936263`; task 6 (FRENZY difficulty) committed `0b9fc8b` — 173/173
  tests green, verify-game 81 ok/0 fail/0 skipped. All v3 code commits pushed to origin.
- **Multiplayer**: `MULTIPLAYER_PLAN.md` drafted — server-authoritative 8-player over WebSockets
  (20 Hz tick, 10 Hz snapshots, client self-prediction, Phases 0–5, hosting options). Design
  only; no implementation yet. §12 open questions resolved to suggested defaults (respawn-on-delay,
  fixed wave count, per-room scores, single room/server, 8 players) — pending user go-ahead to build.
  **Phase 0 DONE** (`src/game/WorldCore.js` + `src/net/Match.js`, `test/match.test.mjs`).
  **Phase 1 DONE (Sep 21, headless + live):** `src/net/protocol.js`, `server/server.js`
  (`npm run server`), `src/net/NetClient.js`; `test/server-room.test.mjs` (6) +
  `test/net-client.test.mjs` (6) green; live 2-socket E2E joins + snapshots. The
  "two browsers see each other move" criterion is env-bound (browser dies ~4 s);
  netcode proven. `ws@8.21.3` added to deps.
  **Phases 2–5 DONE (Sep 21, headless):** Phase 2 `src/game/RemotePlayer.js`
  (6-part avatar, shared geo, per-id tint); Phase 3 match-flow in `Match`
  (respawn-on-delay 3 s, match-end on waves/timecap/alldead, sorted `scoreboard()`)
  + `test/match-flow.test.mjs` (6); Phase 4 §12.5 budget verified (8 avatars +
  18 alive zombies + city = **593/600 meshes**, `test/remote-player.test.mjs`);
  Phase 5 `npm run server` + README "Multiplayer" section. Full suite **218/218**,
  verify-game 81/81. Remaining: the browser lobby/scoreboard DOM + "see each
  other move/kill" visual criteria are env-bound (browser dies ~4 s) — the
  server/protocol/data path is fully proven headless + live.
- **Version 5 (zombie skinned-mesh)**: COMPLETE headless-verified — rig GLB (1 skin, 14 clips,
  2,340 tris), per-type tint + LOD swap (`LOD_DIST=25`), 24-walker budget gate green
  (`test/skin-perf-gate.test.mjs`: meshes 240/600, verts 4,876/zombie). 219/219 tests,
  verify-game 81/81. Browser per-frame wall-time unmeasurable in this SwiftShader sandbox
  (page dies ~3–5 s into gameplay — env, not code; confirmed game reaches `playing` +
  zombies spawn with no page errors via `.research/probe.mjs`); re-run `tools/perf-skin-stress.mjs`
  in a real browser. Superseded `walker.glb`/`walker-rigged.glb` removed; only
  `walker-final.glb` remains. See `docs/perf-baseline.md` §7 + `.research/perf-skin-gate-round9.md`
  + `.research/pixal3d-walker-round10-report.md`.
- **Current (Sep 26, branch `v2` @ `3ee5c90` + uncommitted v6 hosting (1))**:
  v6 audio (8) playlist, v6 tooling (1)+(2), and **v6 visuals (11) Wan2GP
  image pass** (restored wanted poster + open-scream screamer face) are
  committed AND pushed. **v6 hosting (1) — hosted global high score**
  (server `/api/highscore` + Score adopt/submit + Screens refresh + vite
  `/api/highscore` proxy) is implemented and verified but NOT yet committed;
  full battery green: **npm test 314/314, verify-game 81 ok / 0 fail / 0
  skipped, build green, check-assets 34/0, secrets-scan clean, E2E 18/18 PASS
  on :5173 with 0 console errors.**
  **Deployed**: gh-pages `f8b5cb7` (build of `3ee5c90`) — live-verified: index
  references `index-CqBq1X8l.js` + `index-ttUmrf6J.css` (200), poster.jpg +
  screamer-face.jpg serve the new files, `song_javelin_sv.mp3` 200 (the
  playlist is now live too). (Supersedes `8bc9f1e`, `14436a0`, `9f878c6`.)
  Awaiting user: commit + push the v6 hosting (1) working tree (and optional
  gh-pages redeploy), `.research/assets-candidates/` leftovers (menu_bg v2
  review, stinger tweak), emissive 0.5-vs-0.8 call, Mixamo FBX rigs for the
  zombie GLB.

## v3 tasks
1. **Per-type face textures + procedural walk cycle** — DONE (commit `079572b`).
   Z-Image + Mattias-LoRA face portraits on the head plane; procedural walk cycle.
2. **Face visibility fix** — DONE (commit `bbdb702`).
   Root cause (two-part): (a) MeshStandardMaterial multiplies map by color, and the face
   color was the head color → portrait tinted near-black; (b) the portraits are dark and
   the night scene is dim → even a lit face blended into the dark head.
   Fix: on texture load set face color → white and use the same texture as `emissiveMap`
   (self-lit, `emissiveIntensity 0.5`) so the face is visible in alleys and under
   streetlamps. Verified by frozen-scene pixel probe: face-region mean-abs-diff 3.0 → 20.1,
   bright-pixel fraction 14% → 31%; `npm test` 120/120.
3. **Extra zombie face/skin variants** — DONE (Sep 17).
   - **Done (fb1acf7):** 6 new variants defined in `tools/generate-zombie-faces.mjs` (seeds 45–50,
     style-matched prompts, per-type head-color backgrounds); `FACEMAT` is now 3 shared materials
     per type (9 total); `loadFaceTextures()` loops the variants preserving the emissive
     self-illumination; constructor picks a variant deterministically from the LCG phase
     (`Math.floor(_phase/(2π)*3)%3`); test assertions updated + new determinism/distribution test
     (121/121 pass); probe adapted to require ≥3 distinct textures per type.
   - **Generated (Sep 17):** after the WanGP restart (see Open items), the driver
      produced all 6 variants (~36–40 s each, 960x960; originals auto-skipped):
      walker2 211 KB, walker3 170 KB, shambler2 234 KB, shambler3 332 KB,
      screamer2 236 KB, screamer3 220 KB — in `public/assets/faces/`, raw copies
      in `.research/`.
    - **Fixed + verified (Sep 17):** probe (with wave-gate-safe sampling: wait for the
      full wave 1, then spawn targeted coverage — 1 shambler + 3 screamers covering the
      missing variants) revealed a real bug: `loadFaceTextures()` requested
      `{type}1-face.jpg` for variant 1 (does not exist; files are `{type}2`/`{type}3`),
      so every variant-1 zombie rendered a flat head-color face and the `{type}3` files
      were never loaded. Fixed the URL suffix to `i + 1` (matching the existing comment
      and the actual files). Probe now PASS: A_vs_D 28.35, std 71.6, brightFrac 42.1,
      3 distinct textures per type, no face-related console errors; `npm test` 121/121.
      Committed `de89ecb` (fix + 6 images + probe), pushed; rebuilt + redeployed
      gh-pages `f8a22ad` (carries the base-path fix `c98882a` and all 9 faces); live
      site verified (face URLs 200 image/jpeg, new JS hash, base path + i+1 fix in
      the live bundle). Note: Vite dev serves index.html (200 text/html) for missing
      asset paths (SPA fallback), so a 200 on a face URL in dev does NOT prove the file
      exists — check content-type; the live probe verifies textures via material state.

4. **City graphics improvements** — DONE (Sep 17, commits `3d3fbe6` + `a107918`).
   Buildings, cars, environment detail in `src/world/City.js` + `src/world/cityDressing.js`.
   - **Facade windows (V3P-5, `3d3fbe6`):** 4 procedural canvas texture variants
     (256×256, nominal 6 m × 21 m tile, 4×8 window grid, ~half the windows lit) shared
     city-wide; per-building `clone()`s with repeat scaled to the building's size; facade
     materials keep the per-building palette tint and glow via emissiveMap
     (`0xffa64d` @ 1.1); top/bottom faces use one shared roof material via a BoxGeometry
     material array; per-building variant from a separate LCG (seed 113), so the layout
     LCG (seed 7) and all pinned values (87 AABBs, 22 plazas, 67 sprites, 319 meshes,
     walkable streets) are untouched; headless-safe (null/no-op `canvasFactory` →
     map-less or inert textures); `dispose()` now array-aware.
   - **Streetlight pools + ground dressing (V3P-6, `a107918`):** one additive disc per
     streetlight anchor (40 shared geo/material, `0xffb066` @ 0.22) so every pole reads
     lit even when the 12 point-lights are assigned elsewhere; crosswalk bands at the
     four ±36 intersections (16 additive white boxes, y 0.085 above the blue centerline
     strips); 8 snowdrift discs at street corners; 512×512 snow-compaction noise map on
     the ground (LCG seed 77, repeat 3×3 = 60 m tiles), skipped when `canvasFactory` is
     null. City group 319 → 383 meshes; scene headless 472/600 (S8); lights unchanged
     (17/40).
   Verified: `npm test` 123/123; `verify-game` 81 ok / 0 fail / 0 skipped; one focused
   unit test per subtask. Both commits pushed; redeployed gh-pages `9a9e45c` and
   live-verified (new JS hash byte-identical to the local build, faces intact).

5. **Melee combat pass: slash animation, knockback, jump** — DONE (commit `f936263`).
   - **Phased slash** (`Sword.js`, `Axe.js`): windup [0,0.12/0.15] pulls the view back;
     strike [→0.45/0.5] yaws through the arc while pitching forward (−0.5/−0.4 rad) and
     translating toward the target (0.14/0.12 m, sin(πs) envelope); recovery eases back to
     the exact rest pose. Fading additive crescent trail (opacity 0.45 × mid). All
     deterministic smoothstep easing; no `Math.random`.
   - **Knockback** (`Zombie.js`): `knockback(dx, dz, strength=3)` staggers 0.35 s with
     linear-decay velocity (total push = strength·KB_TIME/2 × staggerResist — 0.5 m at
      resist 1; per-type scaling added in round 52); while staggered the zombie neither
     chases nor attacks, limbs drop to rest pose, and collision `resolve()` still runs.
     Both melee weapons apply it on non-fatal hits (no-op on dead zombies).
   - **Jump** (`Player.js`, `Input.js`): Space edge, fires only while grounded
     (`y ≤ 1.7 + 1e-4` and `vy ≤ 0`); gravity −19.6, v0 6.2 → apex ≈ 0.98 m; head bob
     rides the arc automatically.
   - **Mid-jump evasion**: zombie melee only lands when `|player.y − 1.2| ≤ 0.9`, so a
     mid-jump player is out of arm reach (test: no hit at y = 2.6; one hit after landing).
   - **Bare arms**: outfit materials now dress torso + legs only; arms keep the per-type
     MAT2 skin color (reads as jacket/shirt on the body). Flash/death restore logic updated.
   - **Weapon-surface textures**: `tools/generate-weapon-textures.mjs` (WanGP via
     headless Playwright, `activated_loras: []` — the script aborts a variant if a LoRA
     chip is active, since the character LoRA warps object art) produced `public/assets/weapons/`
     `sword.jpg` (396 KB) + `axe.jpg` (452 KB) on Sep 18; prompts demand full-frame
     edge-to-edge macro metal. Browser-only `TextureLoader` (BASE_URL-prefixed, same
     pattern as faces); on load only the wide faces (+z/−z) of the blade/axe head swap to a
     white-colored textured material; headless Node or missing file → flat steel.
     `dispose()` is material-array- and texture-aware.
   - **Flashlight dimmed** 300 → 120 cd (still ~2.2× a streetlight at equal range; reads
     in alleys). Test updated to match.
   - **Tests**: new coverage for phased swing + trail (both weapons), knockback,
     chase-resume, dead-zombie no-op, jump edge/grounding/re-jump, mid-jump evasion,
     bare-arm materials; two stale strict-float assertions in `zombie.test.mjs` fixed
     (~1e-16/1e-17 fp noise → tolerance). 154/154 pass; `verify-game` 81 ok / 0 fail / 0 skipped.
   - **Deployed**: gh-pages `25aad80` (build of `f936263` via `npm run pages`), live
     verified: new JS hash + weapon textures + faces all 200 with correct content types.

6. **FRENZY difficulty mode** — DONE (commit `0b9fc8b`, pushed Sep 18).
   - **`DIFFICULTY` presets** (`Zombie.js`): `normal` (identity — shipped baseline),
     `frenzy` (`speedMult 2`, flat `hpBase 50`). Zombie constructor takes a 6th arg
     `difficulty` (default normal); `this.speed` is now per-instance; the 1.12×/wave HP
     scaling still applies on top of the base.
   - **Kill economy (wave 1, flat 50 HP)**: pistol 2 body shots (26+26) or 1 headshot (52);
     axe 2 body shots (25+25) or 1 headshot (50); sword 1 headshot (90). Flat 50 makes
     "2 shots unless headshot" hold for ALL types — tanks get nerfed (shambler 90→50),
     light types buffed (screamer 40→50) — while speed 2× makes up for it.
   - **Wiring**: `Game` takes a `difficulty` opt (public property, mutable from the title
     screen); `Game.spawnZombie` passes it; `Match` accepts it too (future room option).
     Starting a frenzy game shows a 2.5 s banner: "FRENZY — they run 2× faster; bodies
     take 2, headshots kill".
   - **UI** (`Screens.js` + `styles.css`): title-screen NIGHT / FRENZY toggle row
     (`.toggle.on` styling, `.difficulty-row` rules); Enter/START begins with the selected
     difficulty; game-over restart keeps it. Browser-only; headless unaffected.
   - **Tests** (`test/difficulty.test.mjs`, 7 tests): preset shapes, normal regression
     (speed/HP straight from TABLE), frenzy stats per type, wave scaling on the flat base
     (56/63/70), kill economy (pistol/axe/sword + normal-shambler 4-hit contrast), 2×
     pursuit distance over 1 s, headless Game spawning frenzy zombies with a baseline
     control. 173/173 pass; verify-game 81 ok / 0 fail / 0 skipped.
   - **Note**: commit excluded the concurrent visual-workstream WIP; their Game.js hunks
     were stashed during the commit and re-applied after (auto-merge clean, both import
     blocks intact); mixed working tree re-verified 173/173.
   - **Deployed**: gh-pages `3648a7c` — build made in a detached worktree at `0b9fc8b`
     (visual WIP deliberately excluded from the live bundle); live-verified: new JS/CSS
     hashes 200, `FRENZY` in the bundle, weapons/faces 200 image/jpeg.

7. **V3P visual workstream (sky rewrite, envMap, grade pass)** — DONE (Sep 19).
   - **Sky rewrite** (`src/world/sky.js`): gradient night dome (top `0x04070f`,
     horizon `0x0d1626`, cool glow `0x2a3446` ×0.35 exp falloff, warm light-pollution
     haze `vec3(0.016,0.011,0.006)`), 800-pt twinkling StarField (r=400, LCG
     `0xC0FFEE13`), moon (`0xcfd8e6`, fog:false, r=380), 12 skyline silhouettes
     (`0x0a0f14`, fog:false, 360–400 m); dome radius 420. `sky.update(pos, dt)` wired
     in `Game.js`; camera far 400→520.
   - **envMap** (`src/world/envmap.js`, new): `bakeSkyEnvironment(renderer, sky, scene)`
     bakes the live sky into a `WebGLCubeRenderTarget(256)` → PMREM → `scene.environment`
     at `environmentIntensity 0.5`; tone mapping OFF during bake; returns null for
     non-WebGLRenderer (headless-safe). Called once at `Game` init.
   - **City tweak** (`src/world/City.js`): ground roughness 0.95→0.85 (wet-snow sheen
     from the IBL); facade `emissiveIntensity` 1.1→1.5 (lit windows read as warm beacons).
   - **Grade pass** (`src/game/PostFX.js`): film grain (per-pixel hash, 24 fps reseed) +
     soft vignette. **V3P-10 fix**: composer reordered to `RenderPass → grade → bloom`
     so bloom stays the final on-screen pass. The original post-bloom grade pass darkened
     the image ~17 meanY and flattened detail ~230 units (measured vs baseline HEAD)
     because the bloom result read back out of the offscreen HalfFloat RT loses the
     baseline's on-screen color-space lift. Vignette tuned 0.26→0.05. Diagnosis +
     full metric tables in `.research/look/V3P10-fix-report.md`.
   - **Tests**: `test/sky.test.mjs`, `test/postfx.test.mjs` (pass-order + uniform
     defaults), `test/city.test.mjs`, `test/envmap.test.mjs` (3 tests). 173/173 pass.
   - **Verification**: `npm test` 173/173; `verify-game` 81 ok / 0 fail / 0 skipped;
     `look-capture`/`look-metrics` vs `.research/look/baseline-HEAD/`: detail ≥ baseline
     everywhere (≈ doubled), darkFrac < 0.25 on gameplay vantages, skyGroundDelta less
     negative than baseline everywhere; core gameplay vantages (02/03/04) meanY ≥ 50.
   - **Perf**: re-measured (`docs/perf-baseline.md` §6) — meshes 414/459 ≤ 600, lights
     18 ≤ 40, points 2300 ≤ 2500, zombies 6 ≤ 24, heap Δ0; all budgets ok with ≥2× headroom.
   - **Deployed**: `v2` pushed to origin (`0b9fc8b..c409633`); gh-pages `18becdb` (build of
     `c409633` via `npm run pages` in a temporary `.deploy-ghpages` worktree, synced +
     committed + pushed + worktree removed). Live-verified: index references
     `index-BHhz1twx.js` + `index-B-3fnUMA.css` (both 200, JS byte-size matches local
     build 684,787 B), V3P markers (StarField/uGrain/uVignette/environmentIntensity)
     present in the live bundle, faces + weapons 200 image/jpeg. (Supersedes `3648a7c`.)

## Multiplayer (v4 candidate)
- **Phase 5 — DONE (client integration into Game):** `src/net/Multiplayer.js` —
  the browser client controller: owns the NetClient, the RemotePlayer map (other
  players' avatars, self excluded), remote-zombie meshes, and a DOM scoreboard
  panel driven by the snapshot's `score`/`kills`/`wave`/`remaining`. Reconciles
  proxies against each snapshot (spawn on join, dispose on leave, hide dead,
  remove vanished), interpolates avatars between snapshots, and sends local
  input at ~30 Hz. Headless-safe (optional `document` for the scoreboard; no-op
  without it). Wired into `Game` behind an opt-in `opts.multiplayer` flag
  (default off → single-player byte-identical): constructed in `initSubsystems`,
  ticked in `update` after the tension hook, torn down + rebuilt in `resetRun`.
  - **Tests** `test/multiplayer.test.mjs` (6): welcome adopts pid + spawns remote
    avatars excluding self; remote-zombie reconcile (dead hidden, vanished
    removed); departed player disposed; scoreboard sorted + DOM painted; update
    sends input + interpolates avatars; dispose removes every proxy + panel +
    closes socket. Fake WS + fake document, no browser.
  - **Live E2E** `tools/_probe-live-mp.mjs`: starts the real server, connects two
    `ws` clients through the controller → **PASS**: both connect (p0/p1), see each
    other's avatars, self excluded, sorted scoreboard, wave-1 snapshot. The
    previously env-bound "two browsers see each other move/kill" criterion is now
    proven headlessly against the authoritative server.
  - `npm test` **251/251** (was 245, +6), `verify-game` **81/81**.
- **Phase 5b — browser join UI (CO-OP reachable):** title screen gained a
  CO-OP row (room-code + name inputs + JOIN CO-OP button, `src/game/Screens.js`
  + `.mp-row`/`.mp-input` styles). Clicking it calls `Game.startMultiplayer({room,
  name})` (`src/game/Game.js`), which builds the controller and runs the normal
  start flow (state → playing). Headless test added (`Game.startMultiplayer builds
  the controller + starts the run`); `hud-screens` title-button expectation
  updated to include JOIN CO-OP. Browser probe `tools/_probe-coop-ui.mjs`
  **PASS**: 2 inputs + JOIN render, click → controller built + `playing` + room
  `alpha`/name `Ada`, 0 page errors. `npm test` **252/252**, `verify-game` **81/81**.
  Note: production runs single-origin (the WS server serves `dist/` + `/ws`), so
  the browser join connects there; the vite dev server has no `/ws` proxy.
- **Phase 5c — co-op zombie authority:** when multiplayer is active the client
  no longer simulates a second local horde. `Game.update` clears local zombies +
  runs the world core with an empty zombie list and no wave manager (player +
  weapon still update locally for self-prediction), so the controller's remote
  zombies are the only ones rendered. `Game.step` feeds the HUD a snapshot-backed
  wave/remaining view instead of the unused local WaveManager. Single-player is
  byte-identical (multiplayer off → same path). Headless test
  `co-op suppresses local zombie sim + HUD reads server snapshot` (spawned local
  zombie dropped, remote zombie rendered by controller, HUD reads server wave 3 /
  remaining 7, solo keeps local sim). Live probe `tools/_probe-live-mp.mjs` now
  also asserts remote zombies render from the server (`aRemoteZombies: 2`).
  `npm test` **253/253** (was 252, +1), `verify-game` **81/81**.
- **Phase 5d — server-driven co-op respawn:** in co-op a local death no longer
  ends the run. `Multiplayer._sync` now tracks the self `dead` flag from the
  authoritative roster and fires `onSelfDeath`/`onSelfRespawn` on transitions
  (plus a `respawn` event naming this client is a revive signal). `Game` wires
  `onSelfRespawn` → `_respawnSelf()` (resets player + weapon, clears the
  respawning flag, shows RESPAWNED banner); `onPlayerDeath` branches: co-op sets
  `_respawning` + a "YOU DIED — RESPAWNING…" banner (no GAMEOVER), single-player
  keeps the GAMEOVER flow. Headless test `co-op self death respawns instead of
  ending the run` (death → state stays playing + respawning flag; server dead
  snapshot → controller.selfDead; respawn event → flag cleared + player revived;
  solo death → gameover). `npm test` **254/254** (was 253, +1), `verify-game`
  **81/81**.
- **Phase 5e — latency + connection status:** the client now probes RTT.
  `NetClient` sends a PING every 2 s (timestamped with an injectable clock,
  default `performance.now`/`Date.now`), the server echoes it in PONG, and RTT =
  now − sent is stored as `pingMs`. `Multiplayer.update` calls `maybePing()`; the
  scoreboard header shows `WAVE n LEFT m <ping>ms` when connected and
  `CONNECTION LOST` when not. Headless test `client pings the server and shows
  RTT + connection status` (PING sent with timestamp, PONG echo → RTT 42, ping in
  scoreboard, lost status). Live probe `tools/_probe-live-mp.mjs` confirms the
  round-trip (ping sent, PONG echoes the exact timestamp; localhost RTT ~0).
  `npm test` **255/255** (was 254, +1), `verify-game` **81/81**.
- **Deployed (multiplayer):** `v2` pushed (`84d1b58..4ccca6c`); gh-pages `40262a2`
  (build of `4ccca6c` via `npm run pages` in a temp `.deploy-ghpages` worktree,
  synced + committed + pushed + worktree removed). Live-verified: index references
  `index-DmD59YqA.js` + `index-DwWj9MOF.css` (both 200, JS 801,727 B), markers
  `JOIN CO-OP`/`startMultiplayer`/`_mpOpts` present (plus Phase 3/4 `PCFShadowMap`/
  `setTension`), weapons/faces/ground assets 200 image/jpeg. (Supersedes `14436a0`.)
  NOTE: gh-pages is static-only, so the CO-OP join UI ships but live co-op needs a
  separate `/ws` host (plan §10/§12: single-origin Node server, or Pages + socket host).
- **Redeployed (co-op authority):** gh-pages `fe3e4a4` (build of `b6a9ef0`, same
  worktree flow). Live-verified: index references `index-DWlfBOEu.js` +
  `index-DwWj9MOF.css` (both 200, JS 802,099 B), markers `JOIN CO-OP`/
  `startMultiplayer`/`_mpOpts`/`lastSnap`/`_ws.wave` present (plus Phase 3/4
  `PCFShadowMap`/`setTension`), weapons/faces/ground assets 200 image/jpeg.
  (Supersedes `40262a2`.)
- **Redeployed (co-op respawn):** gh-pages `1c681df` (build of `466cd5a`, same
  worktree flow). Live-verified: index references `index-CqawlkmJ.js` +
  `index-DwWj9MOF.css` (both 200, JS 803,042 B), markers `JOIN CO-OP`/
  `startMultiplayer`/`_mpOpts`/`lastSnap`/`_ws.wave`/`_respawning`/`RESPAWNING`/
  `_respawnSelf`/`onSelfRespawn` present (plus Phase 3/4 `PCFShadowMap`/
  `setTension`), weapons/faces/ground assets 200 image/jpeg. (Supersedes `fe3e4a4`.)
- **Redeployed (latency + connection status):** gh-pages `1d4e7bc` (build of
  `2ef6d54`, same worktree flow). Live-verified: index references
  `index-D_7s_45a.js` + `index-DwWj9MOF.css` (both 200, JS 803,635 B), markers
  `pingMs`/`maybePing`/`CONNECTION LOST`/`_pingSentAt` present (plus the full
  co-op stack + Phase 3/4 `PCFShadowMap`/`setTension`), weapons/faces/ground
  assets 200 image/jpeg. (Supersedes `1c681df`.)
- **Redeployed (skinned walker + asset pipeline):** gh-pages `d2dba05` (build of
  `85c7371`, same worktree flow). Live-verified: index references
  `index-DyzgDoO-.js` + `index-DwWj9MOF.css` (both 200, JS 821,362 B), marker
  `walker-fixed` present (plus the full co-op stack + Phase 3/4
  `PCFShadowMap`/`setTension`), `assets/zombies/walker-fixed.glb` served 200
  (1,693,124 B), weapons/faces/ground assets 200 image/jpeg. The live site now
  renders the repaired skinned walker (43 bones, 1.8 m) instead of the primitive
  box body. (Supersedes `1d4e7bc`.)
- **Redeployed (skin-bind fix):** gh-pages `f60d354` (build of `b647ea4`, same
  worktree flow). Live-verified: index references `index-rsKe8S0A.js` +
  `index-DwWj9MOF.css` (both 200, JS 822,454 B), markers `updateMatrixWorld` +
  `castShadow` present (plus the full co-op stack), `walker-fixed.glb` served
  200 (1,693,124 B). The live site now renders the skinned walker body (not a
  shadow-only silhouette). (Supersedes `d2dba05`.)
- **Redeployed (rig rebuild):** gh-pages `223b9fe` (build of `7c5824d`, same
  worktree flow). Live-verified: index references `index-DkORgm1L.js` +
  `index-DwWj9MOF.css` (both 200, JS 821,940 B), markers `_bobPhase` +
  `_skinRestY` + `emissiveIntensity` + `walker-fixed` present (plus the full
  co-op stack), `walker-fixed.glb` served 200 (1,260,044 B — smaller now that
  the broken animations are stripped). VLM inspection confirms the live skinned
  walker renders as a visible humanoid body. (Supersedes `f60d354`.)
- **Redeployed (death collapse):** gh-pages `253b254` (build of `2849d5f`, same
  worktree flow). Live-verified: index references `index-QYeDhYk_.js` +
  `index-DwWj9MOF.css` (both 200, JS 822,493 B), markers `_deathPosed` +
  `_armBones` + `_headBone` + `walker-fixed` present (plus the full co-op
  stack), `walker-fixed.glb` served 200. The live site now renders a skinned
  corpse collapse on death. (Supersedes `223b9fe`.)
- **Redeployed (per-type variety):** gh-pages `2b24f5f` (build of `637a20f`,
  same worktree flow). Live-verified: index references `index-BRIlEgma.js` +
  `index-DwWj9MOF.css` (both 200, JS 822,566 B), non-uniform `scale.set(...)` +
  `emissiveIntensity` + `walker-fixed` present (plus the full co-op stack),
  `walker-fixed.glb` served 200. The live site now renders varied zombie
  silhouettes (broad brute, lanky screamer) with per-type colors. (Supersedes
  `253b254`.)
- **Redeployed (co-op visibility):** gh-pages `f68eda8` (build of `90b93ca`,
  same worktree flow). Live-verified: index references `index-BJk4p-sv.js` +
  `index-DwWj9MOF.css` (both 200, JS 822,642 B), `emissiveIntensity` + co-op
  markers (`JOIN CO-OP`/`startMultiplayer`/`CONNECTION LOST`) + `walker-fixed`
  present, `walker-fixed.glb` served 200. The live co-op now renders remote
  zombies + player avatars as glowing figures (not black squares). (Supersedes
  `2b24f5f`.)
- **Redeployed (co-op skinned zombies):** gh-pages `1d2bb06` (build of
  `72eb40d`, same worktree flow). Live-verified: index references
  `index-iwiyGmzT.js` + `index-DwWj9MOF.css` (both 200, JS 823,728 B),
  `loadSkin` + co-op markers (`JOIN CO-OP`/`startMultiplayer`) + `walker-fixed`
  present, `walker-fixed.glb` served 200. The live co-op now renders remote
  zombies with the skinned walker body. (Supersedes `f68eda8`.)
- **Redeployed (face-on-crown):** gh-pages `8ded7cf` (build of `114d97e`, same
  worktree flow). Live-verified: index references `index-CpMc3fE-.js` +
  `index-DwWj9MOF.css` (both 200, JS 824,009 B), `_faceOnBone` + `loadSkin` +
  co-op markers + `walker-fixed` present, `walker-fixed.glb` served 200. The
  live site now renders the face/eyes on the visible head crown (not floating
  above), aligning aim with the head hitbox. (Supersedes `1d2bb06`.)
- **Redeployed (remote zombie fixes):** gh-pages `3e62277` (build of `3c9bcf5`,
  same worktree flow). Live-verified: index references `index-DVaotvkn.js` +
  `index-DwWj9MOF.css` (both 200, JS 824,399 B), `_liftY` + `_faceOnBone` +
  `loadSkin` + co-op markers + `walker-fixed` present, `walker-fixed.glb` served
  200. The live co-op now renders remote zombies feet-on-ground, per-type tint,
  with face + eyes, no jumping. (Supersedes `8ded7cf`.)
- **Redeployed (co-op hang fix):** gh-pages `f6dc5d0` (build of `8ff8108`, same
  worktree flow). Live-verified: index references `index-D5R-lnFO.js` +
  `index-DwWj9MOF.css` (both 200, JS 824,403 B), `setTimeout` + `loadSkin` +
  `_liftY` + co-op markers + `walker-fixed` present, `walker-fixed.glb` served
  200. The live co-op JOIN no longer hangs the browser. (Supersedes `3e62277`.)
- **Redeployed (deterministic placement):** gh-pages `2fa3d71` (build of
  `35542a5`, same worktree flow). Live-verified: index references
  `index-V75yiLF6.js` + `index-DwWj9MOF.css` (both 200, JS 824,302 B),
  `_faceOnBone` + `_liftY` + `loadSkin` + co-op markers + `walker-fixed` present,
  `walker-fixed.glb` served 200. The live site now places the face on the head
  crown and the feet on the ground, consistently in single-player and co-op.
  (Supersedes `f6dc5d0`.)
- **Redeployed (primitive-visual zombies):** gh-pages `e1f8c07` (build of
  `c9d57f6`, same worktree flow). Live-verified: index references
  `index-4Zv4fFnA.js` + `index-DwWj9MOF.css` (both 200, JS 823,957 B),
  `_applyLOD` + `_faceOnHead` + co-op markers + `walker-fixed` present,
  `walker-fixed.glb` served 200. The live site now renders the clothed primitive
  body + face at every distance (no white rig up close). (Supersedes `2fa3d71`.)
- **Redeployed (co-op shoot + face/tint):** gh-pages `09fa65e` (build of
  `820b6b8`, same worktree flow). Live-verified: index references
  `index-DokY7W2m.js` + `index-DwWj9MOF.css` (both 200, JS 824,401 B),
  `getTargets` + co-op markers + `walker-fixed` present, `walker-fixed.glb`
  served 200. The live co-op now lets you shoot remote zombies (authoritative
  HIT), with no face image and darker non-white bodies. (Supersedes `e1f8c07`.)
- **Redeployed (rich remote zombie bodies):** gh-pages `0ee36d5` (build of
  `e0a2868`, same worktree flow). Live-verified: index references
  `index-DmKbwotx.js` + `index-DwWj9MOF.css` (both 200, JS 829,209 B), co-op
  markers + `walker-fixed` present, `walker-fixed.glb` served 200. The live co-op
  now renders remote zombies with clothes + face + eyes + hair + accessories,
  dismemberment (limbs/head fall off), and collapsing corpses. (Supersedes `09fa65e`.)
- **Redeployed (co-op ~30s freeze fix):** gh-pages `1747e38` (build of
  `3b8c067`, same worktree flow). Live-verified: index references
  `index-B6lQNroX.js` + `index-DwWj9MOF.css` (both 200, JS 829,234 B),
  `walker-fixed.glb` served 200. The live co-op no longer freezes at ~30 s
  (one-way severing + falling-piece cap + no shared-material fade). (Supersedes `0ee36d5`.)
- **Redeployed (co-op ~10s melee-crash fix):** gh-pages `738e7cc` (build of
  `b3b564b`, same worktree flow). Live-verified: index references
  `index-Djx1LvLT.js` + `index-DwWj9MOF.css` (both 200, JS 829,365 B),
  `walker-fixed.glb` served 200. The live co-op no longer crashes when melee
  weapons hit remote zombies (proxy exposes position/knockback/shotgunArmor).
  (Supersedes `1747e38`.)
- **Redeployed (co-op GPU/CPU load reduction):** gh-pages `eb79e4f` (build of
  `146a4ca`, same worktree flow). Live-verified: index references
  `index-Dl3tNyyv.js` + `index-DwWj9MOF.css` (both 200, JS 829,641 B),
  `walker-fixed.glb` served 200. The live co-op now drops bloom + lighting and
  caps full remote bodies to reduce GPU/CPU load on weak machines. (Supersedes `738e7cc`.)
- **Server fixes (local/LAN/Tailscale):** `server/server.js` now binds
  `0.0.0.0` (HOST env) and strips the Pages base prefix in `serveStatic` so the
  Pages build serves at root — reachable via LAN/Tailscale IP (was blank page).
  Commits `4b8f9f3` + `0624219`.
- **Design**: `MULTIPLAYER_PLAN.md` — server-authoritative 8-player co-op over WebSockets:
  20 Hz sim tick, 10 Hz snapshots (~2 KB/snap), client self-prediction + 100–150 ms
  interpolation for others, per-player score/health, lobby, respawn-vs-spectate options,
  Phases 0–5 (extract authoritative core → 2-player netcode → combat → waves/score →
  8-player lobby → hosting), plus hosting options (single-origin vs Pages + separate
  socket host) and risks. §12 open questions still need user input before Phase 3
  (death handling, match structure, scoring, rooms, budgets).

- **Phase 0 — DONE (Sep 18), commit `a697716` on `v2` (pushed):** the per-frame world
  update was extracted from `Game.update()` into the shared authoritative core
  `src/game/WorldCore.js` (`updateWorld(dt, ws)` + `nearestAlivePlayer`), now called by
  BOTH the single-player `Game` and the new headless `src/net/Match.js` (up to 8 players,
  shared city/collision/waves/drops, per-player `kills`/`score` Maps, kill attribution via
  `weapon.owner` → `zombie.lastDamager`, `snapshot()` per plan §5.2 with drained events).
  Files: `WorldCore.js` (new), `net/Match.js` (new), `test/match.test.mjs` (new, 9 tests:
  2-player movement, targeting + retarget on death, kill/score/decapitate attribution,
  melee health, corpse removal, drop pickup order, wave cadence/queue, bit-identical
  determinism), plus `Game.js`, `Zombie.js` (`lastDamager`, `by` param), `WeaponBank.js`
  (`owner`), `Pistol/Shotgun/Sword/Axe.js` (pass owner), `AmmoDrops.js` (multi-player
  pickup: first alive player in range, roster order on ties).
  Verification (committed tree): `npm test` 163 pass / 0 fail;
  `node tools/verify-game.mjs` 81 ok / 0 fail / 0 skipped.
  Bugs found & fixed: (1) `startGame()` reassigns `this.zombies = []`, breaking the
  constructor-time `ws.zombies` alias — zombie AI froze and wave-clear ran away (219
  corpses); fixed by rebinding `this._ws.zombies` in `startGame()`. (2) core passed player
  *slots* to `AmmoDrops.update`, which expects Player objects — now maps slots down.
  Solo behavior: sim bit-identical; only client-only frame order shifted (blood/headPool/
  flashlight now run before the player, groans after waves) — cosmetic, no gate depends on it.
  NOTE: the working tree also holds UNCOMMITTED parallel visual work (sky.js rewrite,
  `envmap.js`, PostFX, City, sky/city/postfx/envmap tests, `VISUALS-PLAN.md`) deliberately
  excluded from this commit to keep it self-contained; those changes (incl. their Game.js
  hunks: envmap import, far-plane 520, `sky.update(pos, dt)`) belong to that workstream's
  own commit.

- **Phase 1 — DONE (Sep 21):** 2-player netcode over WebSockets — see the
  Status overview above (server room, input→inputState, 10 Hz snapshot,
  self-prediction + interpolation, join/leave). §12 hosting decision resolved to
  single-origin (`server/server.js` serves `dist/` + WS). The 8-player budget
  check is done (Phase 4 above).

## Zombie skinned-mesh upgrade (v5 candidate — `docs/ZOMBIE-UPGRADE-PLAN.md`)
- **Ralph round 10 (Sep 21) — perf gate made measurable headlessly; v5 finished:**
  - The browser SwiftShader gate is environment-bound (page dies ~3–5 s into
    gameplay, no JS error — see round 9). The gate's real question (do 24
    SKINNED walkers blow the budgets, and what's the vertex/skinning cost) is a
    static scene-graph fact, so it is now measured headlessly in
    `test/skin-perf-gate.test.mjs`: loads the real `walker-final.glb`, attaches
    a skin to 24 walkers, traverses the scene. Result: **meshes 240/600 ok**
    (10/zombie: 1 skinned + retained head/face/eyes + hidden limbs), verts
    117,024 (4,876/zombie), tris 58,512 (2,438/zombie ≈ 2,340-tri rig +
    primitives), lights 0/40 ok, zombies 24/24 at cap. LOD swap (`LOD_DIST=25`)
    keeps the skinned body within 25 m only → steady-state on-screen skinned
    count ≪ 24.
  - `npm test` 197/197 (was 196; +1 perf-gate test), `verify-game` 81/81.
    `docs/perf-baseline.md` §7 records the headless gate numbers.
  - **v5 status: COMPLETE** (headless-verified). The browser per-frame wall-time
    stays unmeasurable in this SwiftShader sandbox; re-run
    `tools/perf-skin-stress.mjs` in a browser that sustains gameplay >~5 s.

- **Ralph round 10 (Sep 21) — FINAL wrap-up: v5 COMPLETE + cleanup:**
  - Re-attempted the browser perf gate: A/B idle completed (meshes 414 ≤ 600,
    lights 18 ≤ 40, snow 2300 ≤ 2500, sub-ms render, flat heap, 0 errors); C
    active HUNG on the ≥5-alive wait. `.research/probe.mjs` confirmed the game
    reaches `playing` and zombies spawn (no page errors) — the hang is
    SwiftShader throughput, not a v5 regression.
  - Removed superseded `walker.glb` / `walker-rigged.glb` (no references); only
    `walker-final.glb` remains in `public/assets/zombies/`.
  - Full suite **219/219**, verify-game **81/81**, `skin-perf-gate` passes.
  - v5 status overview updated to 219/219 + round-10 report reference.

- **Ralph round 9 (Sep 21) — 24-walker perf gate attempted; browser env confirmed the blocker:**
  - Added `tools/perf-skin-stress.mjs` — forces N walkers inside LOD_DIST so the
    SkinnedMesh (not the primitive stub) is on screen, waits for every zombie to
    have `_skin` + `_lodSkinned`, then samples like `perf-measure`. Env knobs
    `SKIN_COUNT/SKIN_RING/SKIN_SHADOWS/SKIN_PRIMITIVE`. Added
    `tools/fix-glb-image-offsets.mjs` (repairs a suspected 8-byte image
    bufferView offset; not the crash cause, kept as robustness).
  - **Gate NOT measured:** the headless SwiftShader page dies ~3–5 s after the
    game enters `playing`, with zero JS errors — a GPU-process crash under the
    live rAF loop. Minimal repro: plain playing (natural spawn, no GLB, no
    force-spawn) dies at t+4.5 s with 2 alive; postfx/shadows/envMap off still
    dies; HEAD (no `loadSkin`) dies the same → **not a v5 regression**. Controls
    that rule out suspects: the same `walker-final.glb` renders 30× fine in the
    idle scene (manual `renderer.render`); primitives-only force-spawn crashes
    identically; disabling all fx still crashes. Stock `perf-measure` C now HANGS
    on v5 (passed once on HEAD); `e2e-browser` crashes.
  - **Headless unchanged/green:** `npm test` 196/196, `verify-game` 81/81. The
    v5 skinned-mesh + LOD swap (`LOD_DIST=25`, `_applyLOD`) is correct headless;
    the GLB is valid (1 skin, 14 clips, TEXCOORD_0/JOINTS_0/WEIGHTS_0, 2
    1024×1024 baked PNGs) and renders in isolation.
  - **Next**: run the gate in a browser that sustains gameplay >~5 s (hardware
    GL or a healthier SwiftShader session):
    `PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers node tools/perf-skin-stress.mjs`.
    Full evidence + probe matrix: `.research/perf-skin-gate-round9.md`.

- **Ralph round 8 (Sep 21) — LOD swap implemented; browser perf gate environment-bound:**
  - **LOD swap** in `Zombie.js`: `LOD_DIST = 25`. `_applyLOD(playerPos)` toggles
    visibility only (no allocation): skinned body visible within 25 m of the
    player (camera proxy), primitive stub restored beyond. The head primitive
    (which carries the face + eyes) stays visible when LOD'd out so the face
    still reads at distance; limbs toggle with the LOD. `_attachSkin` no longer
    re-parents face/eyes to the head bone (they stay on the primitive head so
    they survive LOD swaps). Called from `update()` after facing the player.
  - **Tests**: `test/zombie-skin.test.mjs` updated (head primitive stays visible
    on attach) + new LOD test (near→skinned visible/limbs hidden; far→skinned
    hidden/primitives restored; back-near→skinned restored). 4 tests pass.
  - **`npm test` 196/196**, **`verify-game` 81 ok / 0 fail**.
  - **Browser perf gate** (`tools/perf-measure.mjs`, 24 skinned walkers on
    SwiftShader): started the vite dev server (serves `walker-final.glb` 200 +
    optimized GLTFLoader) and ran the probe, but the page boot under software GL
    is slow and the probe exceeded the practical per-call budget in this
    environment (no stats written within the wait window). Confirmed the served
    `Zombie.js` carries `loadSkin` / `_applyLOD` / `walker-final.glb` — the
    browser integration is wired. The perf gate needs a longer-running browser
    session (run `PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers node
    tools/perf-measure.mjs` against a live dev server with a >10 min budget).
  - **Next**: run the perf gate to completion in a browser session; if over
    budget, the LOD swap is already in place. Optional distinct per-type
    candidates via Pixal3D.

- **Ralph round 7 (Sep 21) — Per-type material variants + brute scale on the skinned body:**
  - The baked walker mesh has a **single material slot** (the bake merged
    torso/legs into one texture), so the plan's separate torso/leg outfit slots
    don't apply to this asset. Implemented the plan's "variants share one mesh,
    material swaps only" scheme instead:
    - **`SKIN_TINT`** per-type color (`walker/shambler/screamer/brute`) applied
      to a per-instance **clone** of the loaded body material in `_attachSkin`,
      so same-rig zombies of different types read distinctly (mirrors MAT2).
    - **Brute** scaled **1.4×** on top of its type height (boss silhouette),
      matching its existing `_hitboxScale=1.4` (hitboxes stay analytic).
    - **Hit-flash / death** now also swap the skinned body material
      (`_skin.skinned.material` → HITMAT / DEADMAT, recover to `_skinRestMat`),
      so the flash/death read on the skinned body, not just the hidden stubs.
  - **New test** in `test/zombie-skin.test.mjs`: asserts per-type tint differs,
    brute scaled larger than walker, flash swaps then recovers to the rest mat,
    death swaps the body material. 3 tests pass.
  - **`npm test` 195/195** (189 baseline + 6 new across rounds 4–7).
    **`verify-game` 81 ok / 0 fail.**
  - **Next**: LOD swap >25 m and the 24-walker S8 SwiftShader perf gate (browser
    run); optionally generate distinct shambler/screamer/brute candidates via
    Pixal3D if per-type silhouettes are wanted beyond tint.

- **Ralph round 6 (Sep 21) — UV bake + combined finish-bake-rig pipeline; complete asset:**
  - **UVs were the gap**: the voxel remesh strips the candidate's UVs, so the
    rigged mesh had no TEXCOORD_0 and its textures couldn't map. Added
    `tools/blender/bake-tex.py` (smart-UV + selected-to-active bake) and, after
    finding that a re-imported low-poly mesh loses its glTF skin node (the
    exporter drops skins for bone-parented / re-imported meshes), added
    **`tools/blender/finish-bake-rig.py`** — a single-session pipeline:
    import candidate → keep a hidden UV'd copy as bake source → voxel-remesh →
    rescale → smart-UV → selected-to-active bake (baseColor + metallicRoughness)
    → rewire material → import rig GLB + parent (OBJECT, not BONE) → export.
  - **`public/assets/zombies/walker-final.glb`** — 1.68 MB, 2340 tris, height
    1.8 m, **1 skin + 14 clips + TEXCOORD_0 + JOINTS_0 + WEIGHTS_0 + 2 baked
    textures + PBR material**. Verified by parsing the GLB JSON chunk.
  - **`Zombie.js`** `SKIN_ASSET` now points at `walker-final.glb`.
  - **Tests**: `skinned-glb-load.test.mjs` extended to assert TEXCOORD_0 (uv
    attribute) + baseColor/metallicRoughness texture wiring (from GLB JSON,
    since headless image decode is stubbed). **`npm test` 194/194**,
    **`verify-game` 81 ok / 0 fail**.
  - **Key Blender 4.5 API notes learned**: bake settings live on
    `scene.render.bake` (`cage_extrusion`, `max_ray_distance`, `margin`,
    `use_pass_color` — `pass_filter` is read-only); the glTF exporter drops a
    skin when the mesh is bone-parented (`parent_type=="BONE"`) — re-parent to
    the armature OBJECT so the skin exports; a GLB-authored low-poly mesh
    re-imported + re-rigged loses the skin node, so bake+rig must happen in the
    same session as the voxel remesh.
  - **Next**: per-type candidates (shambler/screamer/brute) or per-type material
    variants on the shared rig; LOD swap >25 m; 24-walker S8 SwiftShader perf
    gate in a browser run.

- **Ralph round 5 (Sep 21) — In-game SkinnedMesh swap implemented in Zombie.js:**
  - **`src/game/Zombie.js`**: added a browser-only skinned-mesh layer.
    - `loadSkin(type, cb)` — lazily imports `GLTFLoader` and loads
      `assets/zombies/<type>-rigged.glb`; headless (`document` undefined) is a
      no-op so the primitive stub stays. One shared parse per type, cached.
    - `buildSkin(rec)` — clones the rig scene + clones the Skeleton so each
      zombie poses independently; returns `{root, skinned, mixer, clips}`.
    - `_attachSkin(rec)` — hides the primitive parts, scales the rig to the
      type height, re-parents the face + eyes onto the rig's `Head` bone, adds
      the root to the group, and builds one mixer action per mapped state.
    - `_setSkinState(state)` — cross-fades the mixer to the action for
      idle/walk/run/attack/hurt/death (falls back to Idle for missing clips).
    - `update()` now ticks `mixer.update(dt)` every frame (incl. dead/stagger)
      and selects the state at each branch: dead→death, kb→hurt, charge→run,
      melee→attack, chase→walk/run (`speed>=2`→run). Primitive limb code still
      runs but its targets are hidden once a skin is attached (harmless).
    - `dispose()` stops + uncacheRoots the mixer (never the shared rig).
  - **State→clip map**: idle→Idle, walk→Walking, run→Running, attack→Punch,
    hurt→No, death→Death (per the retargeted rig's clip names).
  - **New test `test/zombie-skin.test.mjs`** (2 tests): injects the real
    `walker-rigged.glb` rig and asserts primitives hide, actions exist for all
    states, chase→walk, melee→attack, death→death, dispose clears the mixer;
    and that a headless spawn attaches no skin (primitives stay visible).
  - **`npm test` 194/194** (189 baseline + 5 new). **`verify-game` 81 ok / 0
    fail** — full headless acceptance passes with the swap in place.
  - **Next**: generate shambler/screamer/brute candidates (or reuse the walker
    rig with per-type material variants), re-UV/bake (`bake-tex.py`), LOD swap
    >25 m, and the 24-walker S8 SwiftShader perf gate in a browser run.

- **Ralph round 4 (Sep 21) — Rigged + animated walker GLB produced; runtime validated:**
  - **No Mixamo FBX existed**, so `RobotExpressive.glb` (three.js example, a
    rigged 43-bone humanoid with 14 clips) was downloaded as the rig/animation
    source. Added `--rig-glb` to `finish-candidate.py`: imports the GLB
    armature, scales it to the mesh height, parents the mesh with
    `ARMATURE_AUTO` (automatic weights), and exports with `export_animations`.
  - **`public/assets/zombies/walker-rigged.glb`** — 2.98 MB, 2340 tris, height
    1.8 m, **1 skinned mesh + 1 skin + 43-bone armature + 14 clips** (Idle,
    Walking, Running, Death, Jump, Punch, …), 1 PBR material. Validated by
    parsing the GLB JSON chunk.
  - **Runtime probes (new tests, headless, no WebGL):**
    - `test/skinned-mesh-probe.test.mjs` — builds a SkinnedMesh + AnimationMixer
      from scratch, crossfades clips, asserts determinism. 2 tests pass.
    - `test/skinned-glb-load.test.mjs` — loads `walker-rigged.glb` through
      `GLTFLoader.parse` (ArrayBuffer + a minimal `self` shim for the WebP
      decode path), asserts it yields a SkinnedMesh with the required clips and
      that the mixer drives `UpperLegL` and crossfades Idle→Walking. 1 test pass.
  - **`npm test` 192/192** (189 baseline + 3 new). No regressions.
  - **Next**: the in-game `Zombie.js` SkinnedMesh swap (browser-only GLTFLoader
    path, headless keeps the primitive stub), per-type clip mapping
    (idle/walk/run/attack/hurt/death), face plane on the head bone, then the
    24-walker S8 perf gate. Note: voxel remesh lost the candidate UVs — the
    plan's `bake-tex.py` re-UV/bake step is still pending for correct textures.

- **Ralph round 3 (Sep 21) — Blender finish stage validated; game-ready walker:**
  - **Blender present** (round-2 "not installed" was stale): 4.5.14 LTS at
    `~/blender-install/blender-4.5.14-linux-x64/blender`, runs headless.
  - **`tools/blender/finish-candidate.py` fixed + run**: import → drop the
    Pixal3D placeholder Cube/Camera/Light (keep dominant mesh) → join/scale →
    **voxel-remesh retopo** (collapse floor ~25k can't hit 2–3k, so remesh
    fine→coarse then light collapse) → `rescale_to_height` → clean export
    (orphans purged, cameras/lights/extras off). Added missing `import sys`.
  - **`public/assets/zombies/walker.glb`** — 2.45 MB, **2340 tris** (≤3k),
    height **1.8 m**, 1 PBR material + 2 textures, 1 node / 1 mesh / 0 cameras /
    0 lights (verified by parsing the GLB JSON chunk). Report:
    `.research/pixal3d-walker-round3-report.md`.
  - **Next**: source a Mixamo humanoid FBX (rigging `--rig` path untested),
    re-project UVs / bake (`bake-tex.py`) onto the 2340-tri mesh, then the
    in-game `Zombie.js` SkinnedMesh + AnimationMixer swap + perf gate (S8).
  - Game-side baseline unchanged: `npm test` 189/189 on `v2` (`785a703`).

- **Ralph round 2 (Sep 21) — Walker candidate generated end-to-end on the 3080:**
  - **NAF shim fixed + unit-tested** (`pixal3d-noflow.py`): the pure-torch
    replacement for natten's `na2d` (natten 0.21.0 kernels are sm_90-only →
    "no kernel image" on the sm_86 3080) had shape bugs — strided-slice gather
    replaced with per-query `torch.gather` over the unpadded grid with
    border-clamped coords (natten clamped-padding semantics, no 2.5 GB pad
    buffers); `F.pad` 6-tuple padded wrong axes → 8-tuple (H,W); `torch.gather`
    index must match input on non-gather dims (explicit `.view().expand()`);
    v (DINOv3 1024-ch) split into nh heads (dv=256) like natten; tile assembly
    via (i0,j0) dict → cat W per band → cat H. `shim-unit-test.py` passes
    (dilation 8, v=1024ch, multi-tile).
  - **10 GB 3080 OOM at the 1024_cascade NAF stage — RESOLVED**: default
    `naf_target_size` 512 grid OOMs (model+activations > 10 GB). Driver now sets
    `naf_target_size=(256,256)` on every NAF cond model (`--naf-grid 256`),
    quartering activations → generation completes (SS → shape 512 → HR shape
    1024 → texture → export). `o_voxel.postprocess` import fixed (submodule not
    auto-bound).
  - **Candidate produced**: `.research/pixal3d-walker-candidate.glb` — 35.9 MB,
    one textured mesh, 693k verts / 951k tris, height 0.908 m (humanoid),
    `is_watertight False` (remesh open surfaces). Raw Pixal3D output; the
    Blender finish retopos to ≤2–3k tris + retargets Mixamo. Full report:
    `.research/pixal3d-walker-round2-report.md`.
  - **Blocker for the next stage (unchanged):** Blender still NOT installed, so
    `tools/blender/finish-candidate.py` (join/scale/decimate/retarget/glTF)
    cannot run; Mixamo FBX rigs not in the workspace. Both 3090s still ~23 GB
    held by tabbyapi → the 512 NAF grid (if final quality needs it) waits for a
    3090 window.
  - **Blocker RESOLVED (Sep 23): Blender installed + finish step run.**
    `flatpak install flathub org.blender.Blender` → **Blender 5.2.0 LTS runs
    headless** (`flatpak run --filesystem=home org.blender.Blender -b
    --factory-startup --python tools/blender/finish-candidate.py -- ...`). Ran
    the finish step on `.research/pixal3d-walker-candidate.glb` (951,606 tris,
    0.908 m) → **`.research/pixal3d-walker-finished.glb`: 2340 tris, 1.8 m
    height, unrigged** (join + scale + decimate, under the ≤3000 budget). Copied
    into `public/assets/zombies/walker-finished-unrigged.glb`. **Remaining
    blocker:** the in-game `walker-final.glb` rig is corrupted (43 bones
    collapsed to ~cm scale, mis-assigned weights) and no Mixamo FBX is on the
    system to retarget the new mesh against — so the unrigged mesh can't replace
    the primitive body visual yet. Re-authoring the rig needs a Mixamo FBX
    download or visual rigging (env-bound). `npm test` 255/255, verify 81/81.
  - **Rig REPAIRED + wired (Sep 23):** `tools/blender/repair-rig.py` re-scales
    the collapsed foot->head bone span onto the 1.8 m mesh (calibrated factor
    42.02 → exported bone span 1.823 vs mesh 1.8, 2340 tris + 14 animations
    preserved) and exports `public/assets/zombies/walker-fixed.glb`. The
    corruption was the chain laid along Z at ~cm scale (glTF Y-up→Blender Z-up
    bake); the hierarchy was already correct. `Zombie.js` now points `SKIN_ASSET`
    at `walker-fixed.glb` and flips `USE_SKINNED_RIG = true`. Browser probe
    `tools/_probe-skin-rig.mjs` **PASS**: spawned walker renders a SkinnedMesh
    with 43 bones, mesh height 1.8 m, 0 page errors — the skinned rig replaces
    the primitive box body. Headless unaffected (loadSkin no-ops without
    `document`): `npm test` 255/255, verify 81/81.
  - **"Shadow moves, no body" FIXED (Sep 23):** the skinned body rendered as a
    moving shadow because `buildSkin` called `skinned.bind(skeleton,
    root.matrixWorld)` BEFORE `_attachSkin` scaled/positioned/parented the root,
    so the skinning matrices were stale relative to the final root transform and
    the body collapsed to a point (only the depth/shadow pass showed). Fix:
    re-bind in `_attachSkin` AFTER `root.updateMatrixWorld(true)` once the root
    is scaled + added to the group, and set `skinned.castShadow/receiveShadow =
    true` so the visible body casts its own shadow. Browser probe extended to
    assert `visible:true`, `matVisible:true`, `castShadow:true`, world height
    1.8 m, and the body projects on-screen (center 635,486) — SKIN-RIG PASS, 0
    page errors. Headless unaffected: `npm test` 255/255, verify 81/81.
  - **"Shadow only" ROOT CAUSE + REAL FIX (Sep 23):** the shadow-only symptom
    persisted because the walker-fixed.glb **animations** were authored against
    the original cm-scale rest pose; after the earlier rescale they exported as
    inconsistent oversized curves (Torso Y 3.5 m) that collapsed the body to a
    blob at runtime, AND the rescaled bone chain was a 12 m mess (head bone at
    worldY −9.5 m, below the floor). Fixed by REWRITING `repair-rig.py` to
    assign correct humanoid bone HEAD positions directly (feet 0, hips 0.95,
    torso 1.2, head 1.6) along the existing hierarchy instead of scaling the
    broken chain, and exporting with `export_animations=False`. `Zombie.js`
    strips the broken clips at load (`animations: []`) and drives a small
    procedural walk bob on the root instead. Visual inspection via a local VLM
    (Qwen2-VL-2B on the RTX 3080 — MiniCPM-V-2_6 is gated/needs a HF token):
    the full frame now reads "a humanoid zombie character with head, torso,
    arms, legs, illuminated, standing facing the viewer."
    > **Evidence E001** — `evidence_level: L1_static_assets`, `confidence: medium`.
    > `observed_fact`: VLM output on the 1280×720 SwiftShader frame from
    > `tools/_probe-skin-rig.mjs`. `supported`: a humanoid body with four limbs is
    > drawn on that one render pass. `unsupported`: recognisability as a *zombie*,
    > walk-cycle feel, reads under the flashlight or at 30 m (single still).
    > `confounders`: SwiftShader software GL ≠ user GPU; debug spawn at (0,3)
    > facing camera; `map=null` + emissive 0.55 means brightness is not evidence
    > the baked texture maps. Full record: `.hermes/evidence/deadfall-vlm-evidence.md`.
    > Headless unaffected: `npm test` 255/255, verify 81/81.
  - **Zombie DEATH collapse on the skinned body (Sep 23):** the existing death
    animation only rotated the (now-hidden) primitive limbs, so a killed walker
    just sank + tipped with no corpse pose. `Zombie.js` now captures the skinned
    UpperArm bones + head bone at attach (`_armBones`, `_headBone`) and drives a
    procedural collapse on death (head lolls back, arms flung out, group falls
    over), resetting them to rest if a zombie is revived (`_deathPosed` flag).
    Browser probe `tools/_death-shot.mjs`: on death headBoneRotX 0.12, arm bones
    splayed, group tipped, `deathPosed:true`, body drawn. VLM (Qwen2-VL on the
    3080) confirms the corpse reads dead: "limbs splayed outwards, head/upper
    body resting on the ground, defeated and no longer active."
    > **Evidence E002** — `evidence_level: L1_static_assets`, `confidence: medium`.
    > `observed_fact`: `tools/_death-shot.png` (1280×720, SwiftShader) taken
    > 1.8 s after `hp=0`, with `headBoneRotX 0.12`, arms splayed, group tipped,
    > `deathPosed:true` reported by the probe; VLM describes splayed limbs and the
    > upper body resting on the ground. `supported`: the collapse deforms the
    > visible skinned body into a non-upright pose in that frame. `unsupported`:
    > whether a player *reads* it as dead without the HUD, corpse readability at
    > distance, and the motion of the flop (single still at one timestamp).
    > `confounders`: SwiftShader GL; scripted kill via `debug`, not a real shot.
    > Headless unaffected: `npm test` 255/255, verify 81/81.
  - **Per-type skin + silhouette variety (Sep 23):** all four types shared one
    tinted model. `Zombie.js` now applies a per-type width multiplier
    (`SKIN_WIDTH`: screamer 0.86 lanky, brute 1.28 broad) as a non-uniform root
    scale (height on Y, width on X/Z) on top of the per-type height + color, so
    the crowd reads as varied silhouettes. The dark baked texture was brightened
    ~2.6x in `repair-rig.py` (mean RGB 47→101) but still read as a shadow under
    the dim flashlight, so the body keeps `map=null` + emissive 0.55 (the proven
    readable config). Browser probe `tools/_variety-shot.mjs`: screamer rootScale
    [0.99,1.15] pink, brute [2.15,1.68] grey-green — VLM (Qwen2-VL on the 3080)
    confirms "two figures of different sizes and build, left broad/muscular,
    right slender/pink."
    > **Evidence E003** — `evidence_level: L1_static_assets`, `confidence: medium`.
    > `observed_fact`: `tools/_variety-shot.png` (1280×720, SwiftShader) with a
    > screamer at x −1.2 and a brute at x +1.2, both z 3; probe reports root
    > scales [0.99,1.15] vs [2.15,1.68] and their hex tints. `supported`: two
    > figures of visibly different width/build are drawn side by side.
    > `unsupported`: that a player distinguishes screamer from brute in a real
    > crowd, at distance, or under fog — the shot is 2 zombies at 3 m with no
    > crowd, no fog tier and no distance stress; also unverified whether the
    > width scale distorts the silhouette rather than just stretching it.
    > `confounders`: SwiftShader GL; `map=null` + emissive 0.55 lighting.
    > Headless unaffected: `npm test` 255/255, verify 81/81.
  - **Co-op remote proxies read as glowing figures (Sep 23):** in co-op, remote
    (server-authoritative) zombies used a dark olive box with zero emissive and
    remote player avatars used a plain tinted `MeshStandardMaterial` — under the
    dim scene both crushed to **black squares**, so the user saw black boxes and
    couldn't perceive the other player moving (positions were updating fine; the
    avatar was just too dark). `Multiplayer.js` remote-zombie material now uses a
    bright color + emissive 0.55 (matching the local skinned walker);
    `RemotePlayer.js` avatar material adds emissive matching its per-id tint @
    0.45. Co-op diag probe `tools/_coop-diag.mjs` (two clients on the live
    server) + VLM (Qwen2-VL on the 3080) confirm figures read as glowing
    characters.
    > **Evidence E004** — `evidence_level: L1_static_assets`, `confidence: low`.
    > `observed_fact`: `tools/_coop-diag.mjs` injects a **synthetic** snapshot
    > (`mp._sync({…})`) with 2 walker zombies at (−1,3)/(1,3) plus one remote
    > player, because "SwiftShader can't render many skinned bodies at once";
    > probe reports material colours, emissive 0.45/0.55 and `visible:true`.
    > `supported`: those injected proxies are drawn and lit in that frame.
    > `unsupported`: that real server-driven co-op bodies read this way — the
    > snapshot is hand-built, not a live 10 Hz stream; and whether the *other*
    > player's movement is perceivable (a still cannot show motion).
    > `confounders`: synthetic snapshot, 2-body cap imposed by the renderer,
    > SwiftShader GL. Round 2's own note that the co-op visual criterion is
    > env-bound stands.
    > Headless unaffected: `npm test` 255/255, verify 81/81.
  - **Co-op remote zombies get the skinned walker body (Sep 23):** remote
    co-op zombies were a glowing box. `Zombie.js` now exports `loadSkin` +
    `buildSkin` + `SKIN_TINT`, and `Multiplayer.js` reuses that skin path so
    remote (server-authoritative) zombies get the same skinned walker body as
    local ones (tinted + emissive so they read under the dim scene). A fallback
    box is created immediately (headless keeps boxes; the rig loads async
    in-browser) and removed on upgrade; `SKIN_CAP` 18 keeps a full wave inside
    the mesh budget; `dispose()` + reconcile remove the skinned root + dispose
    its material. Headless `npm test` 255/255, verify 81/81. Note: the headless
    SwiftShader browser crashes under co-op + many skinned bodies (env limit,
    same as prior browser probes), so visual confirmation relies on the user's
    GPU; the logic is proven by the headless unit tests.
  - **Face/eyes sit on the visible head crown (Sep 23):** the head BONE extends
    past the skinned mesh crown (~2.5 m vs ~1.8 m), so parenting the face/eyes to
    the bone floated them ~0.7 m above the visible head ("face image above the
    zombie") and the user aimed above the 1.8 m head hitbox so headshots missed.
    `_attachSkin` now offsets the face/eyes DOWN on the bone by the bone-vs-
    mesh-crown delta so they ride the visible crown (facePos 2.5→1.8, eyePos
    1.84), aligning aim with the authoritative head hitbox. Remote co-op bodies
    use the same measure-after-`updateMatrixWorld` path. Headless `npm test`
    255/255, verify 81/81. (The user's "missing bodies / too tall / headshot
    misses" all trace to this bone-vs-crown mismatch + the earlier remote
    measure-before-update bug, now fixed.)
  - **Remote co-op zombies: feet-on-ground + per-type tint + face (Sep 23):**
    remote skinned bodies had three bugs — `_poseRemoteZombie` overwrote the root
    Y to 0 every snapshot (fighting the build-time lift → the body jumped up and
    down), all types used the pale walker tint (bodies shone white), and the
    head-bone lift left feet hovering above the ground. Now: lift feet to y 0
    (bbox, mirrors local), preserve the lift Y in `_poseRemoteZombie` (`_liftY`),
    tint per `z.type`, and parent a face portrait + glowing eyes onto the head
    bone (`buildFaceFor`, dropped onto the visible crown) so remote bodies match
    local zombies. Headless `npm test` 255/255, verify 81/81. (SwiftShader still
    crashes the headless browser on co-op boot — env limit — so visual
    confirmation relies on the user's GPU; logic proven headless.)
  - **Co-op JOIN no longer hangs the browser (Sep 23):** clicking JOIN CO-OP froze
    the page. `loadSkin`'s "load already in flight" wait loop used
    `Promise.resolve().then(wait)` — a microtask that re-queues synchronously and
    starves the render loop when many zombies call it at once (the co-op wave
    triggers ~18+ concurrent `loadSkin('walker')` calls). Switched to
    `setTimeout(wait, 32)` (a macrotask that yields to rAF/render). Probe
    `tools/_coop-hang.mjs`: after JOIN CO-OP the page stays responsive at 1.5s
    AND 4.5s (state playing, connected, 8 remote zombies built). Headless
    `npm test` 255/255.
  - **Deterministic face-drop + feet lift (face off stomach, no hover) (Sep 23):**
    the face-drop was computed from live bone-vs-crown bounds that varied per
    clone, so remote bodies hovered (inconsistent lift) and the face sat on the
    stomach ("difference between single player and multiplayer"). Both local
    `_attachSkin` and the remote build now use verified fixed values: face/eyes
    dropped -0.7 m on the head bone (face on the visible crown at worldY ~1.8,
    matching the head hitbox) and the root lifted `-bb.min.y*scale` from the REST
    bounds measured once at scale 1 (feet land on y 0). Measured consistent:
    local faceWorldY 1.8 / vertexBottomY -0.04, remote faceWorldY 1.8 /
    vertexBottomY 0. VLM confirms face on head + body on ground.
    > **Evidence E005** — `evidence_level: L1_static_assets`, `confidence: medium`.
    > `observed_fact`: probe-reported numbers (faceWorldY 1.8, vertexBottomY −0.04
    > local / 0 remote) plus a VLM read of the matching frame. `supported`: the
    > face plane and the mesh bottom sit at the intended world heights in the
    > probed configuration. `unsupported`: that the face reads as a *face* (not a
    > smudge) at play distance, and that it survives the fog/bloom tiers — the
    > numbers are geometry positions, not a legibility measurement.
    > `confounders`: same SwiftShader read path round 2 already flagged as
    > unreliable for dim crops (see the `map=null` bullet below).
    > Headless `npm test` 255/255, verify 81/81.
  - **Primitive clothed body is the always-on visual (no white rig) (Sep 23):**
    up close the skinned rig rendered as a pale featureless WHITE body with the
    face buried inside the rig head geometry ("white body without any face"),
    while the far LOD primitive (clothed + face) looked better — the LOD swap
    made close zombies worse. `_attachSkin` + `_applyLOD` now keep every primitive
    part visible and hide the rig root, so the clothed primitive body (outfit
    textures + face image + eyes) is the visual at every distance; the face stays
    on the primitive head (worldY 1.8, matching the head hitbox for headshots).
    Effective-visibility probe: rigEffVisible false, torso/head/face visible,
    faceWorldY 1.8. Updated the two LOD tests to the new policy. Headless
    `npm test` 255/255, verify 81/81. (SwiftShader/VLM dim-crop reads are
    unreliable; the rig-hidden + primitive-visible state is proven by the
    effective-visibility probe.)
  - **Co-op: shoot remote zombies + no face + darker body (Sep 23):** co-op shots
    missed because remote zombies lived only in `multiplayer.zombies`, never in
    the weapon's `getZombies()` list. `Multiplayer.getTargets()` now exposes
    hit-testable proxies (server hitbox contract: torso y+1.2 r0.45, head y+1.8
    r0.3) with client-predicted death; `Game.getZombies()` concatenates them in
    co-op. A confirmed hit sends an authoritative HIT message (protocol `MSG.HIT`
    → server `applyHit` → `Match.applyHit` → `zombie.damage`) so the kill is
    attributed even when the server-side aim ray misses. Removed the face portrait
    from remote bodies (it sat on the back of the head) and switched to darker,
    low-emissive zombie-skin tints (`REMOTE_TINT`, emissiveIntensity 0.18) so
    bodies read as corpses, not white blobs. Added `getTargets` + `applyHit`
    tests. Headless `npm test` 257/257, verify 81/81; live probe: targets 8,
    hasFace false, bodyColor 7a6f4a, emissive 0.18.
  - **Co-op: rich remote zombie bodies + dismember + death corpse (Sep 23):**
    remote co-op zombies now use the same primitive body as local zombies
    (clothes + face + eyes + hair + accessories) instead of a black skinned box,
    so they read as people. New `RemoteZombie` class mirrors the server's limb
    state (arms/legs sever → hidden + a tumbling falling piece; head decapitate →
    head/face/hair detach + tumble), collapses + sinks + splays limbs on death,
    lingers ~5s, then fades + expires. `Match` snapshot now carries per-zombie
    `limbs {arms,legs,head}` and sets `_headOff` on decapitate so the client
    mirrors dismemberment. `Zombie.js` exports `buildPrimitiveBody(type, phase)`
    (shared by local + remote), adds a hair cap + re-enables outfit accessories
    (tie/cap/helmet/stripe). Mesh budget raised 600→640 for the richer bodies.
    Added face/hair/limb/collapse tests. Headless `npm test` 259/259, verify
    81/81; live probe: hasFace/hasHair true, eyes 2, targets 8, headVisible true.
  - **Co-op: ~30 s freeze fixed (falling-limb leak + shared-material fade):** the
    freeze was a runaway in `RemoteZombie` — a snapshot that flipped a limb's
    severance on/off (server aim disagreeing with the client prediction)
    re-showed then re-hid the limb every snapshot, spawning a new tumbling
    falling piece each time → `_falling` grew unbounded and the page froze.
    Severing is now one-way (a severed limb/head never returns, so it spawns
    exactly one piece) plus a hard per-body cap of 8 falling pieces. The death
    fade also mutated the SHARED `DEADMAT` material's opacity/transparent
    (affecting every corpse + forcing a full transparency sort); it now just
    hides the group when expired. Added an oscillation-leak regression test.
    Headless `npm test` 260/260, verify 81/81; 50 s co-op probe stays responsive
    with meshes constant.
  - **Co-op: ~10 s freeze fixed (melee crash on remote zombies):** the freeze
    moved to ~10 s because it was a thrown TypeError, not a leak — melee weapons
    (Axe/Sword) read `z.position.x/.z/.y` and call `z.knockback()` on every hit
    target, but the co-op `RemoteZombie` weapon proxy had no `.position` or
    `.knockback`, so the first melee swing threw inside the rAF loop and killed
    it (page froze). The proxy now exposes a live numeric `position {x,y,z}`, a
    no-op `knockback`, and the per-type `shotgunArmor` (so the brute resists
    buckshot like local). Added a melee-safe regression test. Headless
    `npm test` 261/261, verify 81/81; 26 s co-op probe stays responsive with
    flat heap + constant meshes.
  - **Co-op: whole-machine hang fixed (GPU/CPU load cut):** the full-browser /
    whole-computer hang is GPU/CPU saturation on weak machines from the co-op
    scene (city + many full PBR remote bodies + bloom at high quality). Three
    reductions: (1) `startMultiplayer` drops lighting to low + disables bloom
    (postfx) for co-op, restoring the prior quality on teardown; (2) `MAX_REMOTE`
    18→12 so overflow zombies use the cheap box fallback instead of a full PBR
    body; (3) the weapon-hit proxy is cached per body and reuses two scratch
    Vector3s, so the per-frame hit loop allocates nothing (no GC churn);
    `isDead` is a live getter. Headless `npm test` 261/261, verify 81/81; 65 s
    co-op probe stays responsive with flat heap + constant meshes.
  - Game-side baseline unchanged: `npm test` 189/189 on `v2` (`785a703`).

- **Ralph round 1 (Sep 20) — Pixal3D env de-risked:**
  - **Natten traceback — RESOLVED.** The earlier failure was a source build of
    `natten==0.21.0` (setup3): `cmake --build /tmp/tmp0b40wx1t -j 4` → exit 2
    ("Build failures usually indicate a problem with the package or the build
    environment"). No retry needed: `natten 0.21.0` is now installed and
    importable in `~/Pixal3D/.venv` (Python 3.11, torch 2.6.0+cu124, CUDA ok).
    Record: the earlier `/tmp/tmp0b40wx1t` build dir is gone — **not found**.
  - **Attention module inspected directly** (`~/Pixal3D/pixal3d/modules/attention/`):
    `config.py` picks the backend from `ATTN_BACKEND` env; `full_attn.py` supports
    `xformers / flash_attn / flash_attn_3 / flash_attn_4 / sdpa / naive`.
    `inference.py` defaults `ATTN_BACKEND=flash_attn`, but **flash_attn is NOT
    installed** in the venv → the working config is `ATTN_BACKEND=sdpa`
    (verified: dense `scaled_dot_product_attention` forward ok on the 3080;
    `[SPARSE] Conv backend: flex_gemm; Attention backend: sdpa`). natten is not
    imported by Pixal3D/TRELLIS.2 code — it is only a README/requirements-hfdemo
    item; sdpa is the validated fallback.
  - **3080 low-VRAM pilot validated:** `init_pipeline(low_vram=True)` completes on
    GPU index 2 (3080, 608 MiB held by WanGP); peak alloc/reserved 0 MiB at load
    (on-demand stage loading works as designed). Log:
    `.research/pixal3d-load-test.log`. The 3090s stay reserved for inference
    (tabbyapi holds both).
  - **In progress:** Walker candidate generation running detached:
    `~/Pixal3D/inference.py --image .research/zb_walker_fullbody.jpg --output
    .research/pixal3d-walker-candidate.glb --low_vram --seed 42`
    (`ATTN_BACKEND=sdpa`, `CUDA_VISIBLE_DEVICES=2`; log
    `.research/pixal3d-walker-run.log`).
  - **Blocker for the next stage:** Blender still NOT installed (`which blender`
    → not found), so `tools/blender/finish-candidate.py` (join/scale/decimate/
    retarget/glTF) cannot run yet; Mixamo FBX rigs also not in the workspace.
  - Game-side baseline re-confirmed this round: `npm test` 189/189 green on `v2`
    (`785a703`); boss + FRENZY + V3P all committed and pushed.

## Open / awaiting user
- **v6 improvement workstream (`.hermes/deadfall-progress.md`)** — mission: deepen
  gameplay/visuals/audio over the deployed baseline. **Phase 0** playtest + baseline
  COMPLETE (244 tests, 81 verify, 18 E2E). **Phase 1** control contract + settings +
  state-driven pause COMPLETE (`eaf0ee9`). **Phase 2** pacing + telegraphs + weapon/kill
  feedback + battery decision mechanic COMPLETE (`381b151`, 245 tests / 81 verify).
  **Phase 3 (visual/console cleanup) IN PROGRESS**: PCFSoftShadowMap→PCFShadowMap
  (r185 deprecation warning eliminated, probe-verified 0); ground/facade/poster image
  textures now bind on `load` instead of uploading empty ("no image data" warnings
  5→3; residual 3 are benign boot-time transient uploads, live scene enumerates no
  empty textures). 245/245 tests, 81/81 verify. **Phase 4 (audio) COMPLETE**: adaptive
  tension bed (procedural drone + heartbeat pulse) driven by alive-zombie pressure +
  low health + boss bump; lazy build, fade-out teardown, headless-safe, deterministic;
  browser probe confirms it builds + tracks danger with 0 page errors. 245/245 tests,
  81/81 verify. **Phase 5 (verify/docs) COMPLETE**: production build green (bundle
  carries Phase 3+4 markers), browser E2E **18/18 PASS / 0 errors**, headless 245/245
  + 81/81. Phase 3 committed `1e655a2`, Phase 4 committed `11013d3`. v6 improvement
  mission COMPLETE (all five phases). **Deployed**: `v2` pushed (`6f4078f..e9e3741`),
  gh-pages `14436a0` (build of `e9e3741`) — live-verified: index references
  `index-DJxiCtn5.js` + `index-C4CqS745.css` (200, JS size matches local build),
  Phase 3/4 markers present, weapons/faces/ground/poster 200 image/jpeg.
  (Supersedes `9f878c6`.)
- **WanGP restart — RESOLVED (Sep 17):** WanGP runs as systemd user service
  `wangp.service` (`/home/mgr/.config/systemd/user/wangp.service`: `wgp.py --gpu cuda:2
  --profile 5 --attention sdpa --server-port 7860 --verbose 1`, Restart=on-failure).
  The wedged worker even ignored SIGTERM for 45 s (forced SIGABRT). Restarted from the
  sandbox via the user D-Bus (works because the sandbox shares the host network namespace
  and runs as the same uid):
  `dbus-send --session --dest=org.freedesktop.systemd1 /org/freedesktop/systemd1
  org.freedesktop.systemd1.Manager.RestartUnit string:wangp.service string:replace`
  Fresh instance generates ~36–40 s/image; all 6 faces done.

- **Full v3 task list**: the user was asked to paste it (the original TASKS.md was lost in a
  workspace corruption). Not yet provided. Face work above is proceeding from the turn-3 asks.

- **Emissive tuning**: shipped at `emissiveIntensity 0.5`; 0.8 is available as a reference if
  the user wants more glow. **Comparison ready (Sep 25):** rendered the same nearest-zombie
  face at both values in real Chromium (`tools/_probe-emissive.mjs`, code-level 0.8 baseline
  patched in then restored); face-crop mean-abs-diff 4.9/255, brighter-pixel fraction 39%,
  mean 44.8→45.5 — 0.8 is a subtle lift, not a glow-up. Screenshots staged at
  `.research/face-emissive-0.5.png` / `.research/face-emissive-0.8.png` for the user's call.
  Note: face-mat 0.5 is NOT asserted by any test (the screamer silhouette-contrast test uses
  the body MAT2 emissive), so flipping it is a one-line change in Zombie.js `loadFaceTextures`.
- **Wan2GP asset candidates (Sep 25, tools/wangp_assets.py)**: generated on GPU 2 and staged
  in `.research/assets-candidates/` awaiting user review — `poster_v2.jpg` (768x1024 wanted
  poster v2, z_image + mattias LoRA), `menu_bg.jpg` (1024x1024 alley menu plate),
  `stinger_spawn.wav` (6.0 s yue2 horror stinger, mode 2). Not wired into the game yet:
  poster would replace `public/assets/posters/poster.jpg`, menu_bg needs a Screens.js hook,
  stinger needs an AudioBank slot.

- **Multiplayer plan review**: `MULTIPLAYER_PLAN.md` (8-player, server-authoritative,
  WebSockets) — §12 open questions resolved to suggested defaults and Phases 0–5
  implemented headless (see Status overview). **Browser criteria now MET (Sep 25):**
  the title-screen lobby (room + name + JOIN CO-OP) and scoreboard DOM work in real
  Chromium; `vite.config.js` gained a `/ws` → :8080 proxy (with `rewrite` stripping
  vite's HMR ws query, which the game server's WebSocketServer rejects with 400;
  `MP_SERVER` overrides the target) so co-op works on the dev server too.
  Verified: `tools/_probe-coop-ui.mjs` PASS on :5173 and :8080 (0 page errors),
  and `tools/_probe-coop-live.mjs` PASS — two real browsers in room "arena"
  connect, each renders the other's RemotePlayer (p0↔p1), 0 page errors.
  308/308 tests + 81/81 verify green; `dist/` rebuilt from the current tree.

## Procedural music system (v6.x audio-music round — Sep 2026)

- **Goal**: replace the mp3 soundtrack with a fully procedural WebAudio music
  system living in the audio subsystem (no music logic in Game.js).
- **New `src/game/MusicEngine.js`** (221 lines): three looping oscillator
  tracks — `ambient` (slow minor pad + drone), `combat` (eighth-note minor
  pulses), `crisis` (fast high dissonant stabs). Pattern-based looping (the
  scheduler wraps the pattern index back to 0 each bar, so looping is just the
  same pattern again — no abrupt silence). Crossfades on `switchTrack`
  (cancelScheduledValues + setValueAtTime + linearRamp over 0.8 s, outgoing
  nodes stopped ~0.9 s later). `start/switchTrack/stop/pause/resume/dispose`
  (dispose idempotent, nulls every node/param). Owns one `outGain` node the
  host connects to its music bus; `setOutputGain(v)` for mute/volume.
  Headless-safe: no ctx → every method no-ops but state still tracks.
  Deterministic: fixed note tables, no Math.random.
- **New `src/game/MusicDirector.js`** (88 lines): ALL track selection lives
  here — `onWaveStart` (boss waves `w % bossEvery === 0` → crisis, waves ≤2 →
  ambient, else combat), `onWaveCleared` → ambient, `onTension` (≥0.75 →
  crisis, <0.2 leaves crisis → combat/ambient; threshold hysteresis only, no
  timers), `onStateChange` (title/paused → pauseMusic, playing → resumeMusic,
  gameover → stopMusicTrack — documented choice: stop, not a crisis fade),
  `reset()` → ambient. No-ops when the bank is null.
- **`AudioBank.js`**: imports MusicEngine, always constructs
  `this._musicEngine` (even headless). New delegating methods
  `playMusicTrack/stopMusicTrack/pauseMusic/resumeMusic` + `musicState`
  getter (`{ current, playing, playlist }`, owned plain object). Engine output
  routes to `_musicGain || master` (lazy `_wireMusicEngine` on first track
  start); `_applyMusicGain` now also drives `engine.setOutputGain` so both
  mute flags + musicVolume silence it. Scheduler tick piggybacks on
  `updateGroans` (0.5 s cadence). `dispose()` disposes + nulls the engine.
  The mp3 `playMusic/stopMusic/playLevelMusic` layer is untouched.
- **`Game.js`** (minimal edits): import + construct `this.musicDirector`
  after `this.audio`; hooks in `setState` (onStateChange), `onWaveStart` /
  `onWaveCleared`, `update()` (tension computed once, fed to both setTension
  and onTension), `startGame` (director.reset()). The two mp3
  `playLevelMusic(LEVEL_TRACKS, …)` call sites were REMOVED (single music
  layer now); the `LEVEL_TRACKS`/`LEVEL_TRACK_SECONDS` constants stay for the
  AudioBank mp3 API. Game.js contains no track-selection logic.
- **New `test/music-playlist.test.mjs`**: engine state + crossfade + scheduler
  wrap + dispose-idempotent + headless tracking; director wave/tension/state
  matrix via a stub bank; AudioBank integration (fake ctx + fake Audio, mute
  silences the engine, dispose clears it); `globalThis.Audio` deleted in a
  finally block.
- **Evidence**: `node --test test/music-playlist.test.mjs` green; full
  `npm test` **262/262 pass / 0 fail / 0 skipped** (255 baseline + 7 new);
  `node tools/verify-game.mjs` **81 ok / 0 fail / 0 skipped** (FULL
  ACCEPTANCE); `npm run build` green (known chunk-size warning only).
- **Review pass (accept-with-fixes, all fixes applied)**:
  - MUST-FIX fixed: `MusicEngine` keeps an `_ends` stop-time queue;
    `update()` prunes finished voices from `_nodes` and `_fade` — long
    sessions no longer grow the JS-side node lists (bounded-growth test
    added: 1 h of crisis playback keeps `_nodes` < 120, `_ends` < 64; a
    200-switch storm leaves `_fade` < 16).
  - Should-fix fixed: `resume()`/`_build()` ramp to the last `setOutputGain`
    ceiling (`_outCeil`) instead of hard 1 — pause/resume can no longer jump
    to full gain under mute/volume; new test asserts 0.5 survives pause →
    resume.
  - Should-fix fixed: dropped the `void LEVEL_TRACKS` retention hack; the
    constants are now exported with an honest "kept for the AudioBank mp3
    API" comment.
  - Accepted as-is: `_updateMusicEngine` ticks every 0.5 s (bounded, hidden
    behind the 0.8 s crossfade).
  - Re-verified after fixes: focused test green; `npm test` 262/262;
    `verify-game.mjs` 81/81; `npm run build` green.

## Ralph continuation (v6 visuals + gameplay — next rounds)
- **Ralph round 41 (this round) — visuals (1) stronger night lighting DONE +
  reviewed**: coder raised moon 1.1→1.45 lx, hemi 0.22→0.30, ambient
  0.08→0.12, streetlight pool 55→70 cd (src/world/Lighting.js +
  test/lighting.test.mjs); reviewer ACCEPT-WITH-FIXES (only gap: missing
  changelog entry — fixed, "v6 visuals (1)" section added to
  docs/V2-CHANGELOG.md). Re-verified this round: lighting test 4/4, npm test
  262/262, verify-game 81/81. NEXT: visuals (2) fog/atmospheric depth.
- **Ralph round 42 — visuals (2) fog / atmospheric depth DONE**: fog is now
  quality-tiered (`FOG_TIERS` + `setFogQuality()` in src/game/Game.js, hooked
  into `applySettings`): high 0.022 (pinned baseline) / medium 0.019 / low
  0.018, all color 0x0b1020, every tier inside both gates (vis(30) ≥ 0.60,
  vis(80) < 0.15). Layering added: two additive fog:false ground-haze sheets
  (+2 meshes, 0 lights/points) and `city.ground.material.fogDensity = 0.82`.
  Re-verified: fog test 4/4, sky test 8/8 (fog:false intact), npm test 264/264,
  verify-game 81 ok / 0 fail / 0 skipped, build green. NEXT: visuals (3).
- **Ralph round 43 — visuals (3) snow / weather layering DONE**: the snow sheet
  is now a 4-band depth hierarchy (`src/world/snow.js`: 700/700/260/140 = 1800
  allocated flakes, sizes 0.15→0.035, opacity 0.95→0.34, fall 3.1→1.1 m/s,
  per-band + per-flake crosswind phases so the sheet shears instead of sliding
  as one slab). Quality tiers via `setTier()` routed from
  `Lighting.setQuality`: low 750 (2 bands only) / medium 1050 / high 1500
  drawn, all through `setDrawRange` (no geometry rebuild, zero per-frame
  allocation). Deterministic triangle-envelope squall (own 23 s clock, no
  `Math.random`) temporarily raises density up to the 1800-flake ceiling —
  700 points of margin under the 2500 budget. Re-verified: snow test 6/6,
  city test 23/23, fog 4/4, sky 8/8, lighting 4/4, npm test 270/270,
  verify-game 81 ok / 0 fail / 0 skipped (walker-at-(30,12) kill flow ok),
  build green. NEXT: visuals (4).
- **Ralph round 44 — visuals (4) restrained bloom / emissive DONE**: bloom is
  now source-only. `PostFX.js` `BLOOM` pins strength 0.25→0.18, radius
  0.5→0.35, threshold 0.0→**0.72** (pass order untouched: RenderPass → gtao →
  grade → bloom, bloom last). The gate that matters is the *tonemapped*
  luminance — `Lighting.js` runs ACESFilmic at exposure 1.2, so
  `UnrealBloomPass.highPass` tests post-curve values: the round-41 lit band
  (moon 1.45 / hemi 0.30 / ambient 0.12 / 70 cd pools) sits at 0.50–0.72 while
  every emissive source stays above it (lamp 0.867, spire 0.880, plaza panel
  0.900, facade window 0.776, beacon 0.681), so the ground stops blooming
  entirely. Emissives/halos in `cityDressing.js`: lamp head 3.2→2.2 with halo
  0.5/2.2 → 0.30/1.6, spire 2.5→2.0 with halo 0.6/3 → 0.38/2.2, beacons kept
  at 2.0 (dimmest source, 0.681) with halo 0.5/2.4 → 0.34/1.8; `Lamps.js`
  relight restored to 2.2. Zombies untouched — body 0x401018×0.5 tonemaps to
  0.003 and the hit flash to 0.030, two orders under the cut, so a walker at
  30 m is never bloomed. New `PostFX.setTier()` (high 0.18 / medium 0.12 / low
  0.08) hooked in `applySettings`; low/medium stay the cheap no-composer
  fallback behind `setEnabled(quality === 'high')`. Zero new meshes/lights/
  points. Re-verified: postfx test 7/7, city 23/23, lamps 1/1, fog 4/4,
  sky 8/8, lighting 4/4, snow 6/6, zombie 27/27, npm test 273/273, verify-game
  81 ok / 0 fail / 0 skipped (walker-at-(30,12) kill flow ok), build green.
  Halos re-measured against round 41 as the reviewer asked; still unverified in
  a real browser (headless has no readPixels). NEXT: visuals (5).
- **Ralph round 45 — visuals (5) clearer enemy silhouettes DONE**: the
  readability gate is Michelson contrast between the zombie body and the fog
  backdrop, computed through the real pipeline (sRGB→linear→Lambert under the
  round-41 rig→exposure 1.2→ACESFilmic→FogExp2 blend). Measured: the old MAT2
  colors gave walker 0.95/0.94/0.93, shambler 0.93/0.92/0.90, screamer
  0.94/0.93/0.91 and brute 0.86/0.84/**0.81** at 10/20/30 m on 'high' — the
  brute failed the 0.90 gate at all three distances and shambler/screamer at
  30 m. Fix is the minimum one: lift the four shared MAT2 body colors ~1.6× in
  linear luminance (walker 0x6b7d5c→0x8b9c77, shambler 0x7a6a58→0x998873,
  screamer 0x9c4f5e→0xb46574, brute 0x4c5a44→0x65755b) and mirror them in
  FACEMAT so faces stay seamless with the lifted heads. Result: every type
  ≥0.91 at 30 m on every fog tier (low/medium are thinner-fog, so easier).
  Zero new meshes/lights/points — the 597-mesh peak, 18 lights and 1800 points
  are untouched, and no per-zombie mesh was added. Per-type luminance order
  (walker>shambler>screamer>brute) and hues (screamer R/G>3, walker/brute
  green-dominant) preserved, so silhouettes stay distinct. Bodies tonemap to
  0.07–0.17, still far under the round-44 0.72 bloom cut, so zombies never
  bloom. EYE/EYEMAT/hair/accessories left alone — the eyes already read at
  C≥0.99 and the shape cues are intact. Files src/game/Zombie.js (MAT2 :24-38,
  FACEMAT :121-141) + test/zombie.test.mjs (4 new contrast tests, 31/31).
  Re-verified: zombie 31/31, postfx 7/7, fog 4/4, sky 8/8, lighting 4/4,
  snow 6/6, city 23/23, lamps 1/1, zombie-skin 7/7, skin-perf-gate 1/1,
  decap-head 8/8, npm test 277/277, verify-game 81 ok / 0 fail / 0 skipped
  (walker-at-(30,12) kill flow ok), build green. NEXT: visuals (6).
- **Ralph round 46 — visuals (6) muzzle flash + hit feedback DONE**: two gates
  measured analytically (headless has no readPixels, so both are re-derived in
  the tests). (a) Muzzle flash wash-out: the pistol's 300 cd / 6 m / decay-2
  light adds `fY·I·0.5/d²` = 3.889 linear luminance to a zombie at 5 m
  (tonemapped 0.882 on a walker body — a brief pop, not a white-out) and
  **exactly 0** at 15 m because the 6 m cutoff is already spent; the shotgun's
  500 cd / 8 m light adds 2.43 at 6 m and 0 at 15 m. So no distant body is ever
  pushed over the 0.72 bloom cut and gate (a) PASSES unchanged — the lights,
  their 6/8 m reaches and the sniper's deliberate no-flash design are kept
  as-is. (b) Hit feedback: round 45 lifted MAT2 above the old HITMAT, so
  Michelson C went **negative** — walker −0.434, shambler −0.332, screamer
  −0.247, brute −0.011 (HITMAT tonemapped 0.069 vs bodies 0.07–0.17): a hit
  read as a dark patch. That is the only failing gate. Minimum fix: lift HITMAT
  to color 0xe84a38 + emissive 0xb02214 (self-lit, so it reads at any distance
  and on 'low' where the flash light is gone) → tonemapped 0.327, C 0.305–0.646
  against the four bodies, still under the 0.72 bloom cut (a hit must not
  bloom) and still deep red (R/G 11.8); the 0.15 s window is unchanged and
  verified to survive 60 fps. Low-quality fallback: new `setTier` on
  Pistol/Shotgun + `WeaponBank.setTier` wired into `applySettings` — 'low'
  hides both flash PointLights (intensity pinned to 0) and dims the sprite
  0.9→0.45, while HITMAT-based feedback still reads; no new light is ever
  created, so the 18-light budget is untouched. Zero new meshes/points. Files
  src/game/Zombie.js (HITMAT :41-49), src/game/Pistol.js (FLASH_PEAK :15-19,
  setTier :96-110, flash sites :110-112/:135-139), src/game/Shotgun.js
  (FLASH_PEAK :15-19, setTier :93-110, flash sites), src/game/WeaponBank.js
  (setTier :44-53), src/game/Game.js (applySettings :500-504) + tests
  (zombie +3, pistol +2, shotgun +2). Re-verified: zombie 34/34, pistol 11/11,
  shotgun 12/12, blood 6/6, postfx 7/7, fog 4/4, sky 8/8, lighting 4/4,
  snow 6/6, city 23/23, lamps 1/1, npm test 284/284 (0 fail / 0 skipped),
  verify-game 81 ok / 0 fail / 0 skipped (walker-at-(30,12) kill flow ok,
  597 meshes / 18 lights / 1800 points unchanged), build green.
  NEXT: visuals (7).
- **Ralph round 47 — visuals (7) damage vignette DONE**: the vignette is
  DOM/CSS, not post-processing (PostFX `uVignette` 0.05 untouched). Both red
  layers were measured in sRGB compositing against the round-45 pipeline:
  `.fx-damage` (0 @50% → 0.55 @100%) left the center clear only to t=0.50 but
  tinted 60% of the screen above 5% alpha at the 0.35 fallback peak (67% at
  the 0.60 hook peak), rim alpha 0.19/0.33 effective — pulling a 30 m walker
  from Michelson C 0.967 down to 0.67/0.54, under the 0.90 gate. The real
  offender is `.fx-lowhealth`: clear only to t=0.40, 78% of the screen
  covered, C 0.511 at t=0.5 and 0.097 at the rim, and it never fades while
  pct < 0.3 — a constant frame exactly when the player most needs to see.
  Minimum fix: `.fx-damage` stops → 0 @72% / 0.32 @100% (clear disc covers the
  central 40% band; tinted fraction 0.360 ≤ 0.40; worst local C 0.72 at the
  rim only), `.fx-lowhealth` → 0 @62% / 0.30 @100% and now breathes — a
  deterministic 1.8 s sine pulse in [0.25, 0.75] driven through the opacity
  write that already ran every frame (no extra style write), worst-case rim
  0.225 instead of a constant 0.45. Damage severity now scales with the amount
  dropped (0.18 + 0.006/pt, cap 0.40 fallback; hook peak 0.25 + 0.012/pt, cap
  0.55, was 0.02/pt cap 0.60), and the damage vignette is suppressed while the
  low-health frame is on so the two red layers never stack. Files
  src/styles.css (:68-73, :95-100), src/game/HUD.js (:21, :185-208, :353-355)
  + test/hud-screens.test.mjs (CSS stop parse, center-clear, tinted fraction,
  pulse bounds + determinism, headless no-op; one pinned assertion updated to
  the no-stack rule). Re-verified: hud-screens green, postfx 7/7, zombie 34/34,
  pistol 11/11, shotgun 12/12, fog 4/4, sky 8/8, lighting 4/4, snow 6/6,
  city 23/23, lamps 1/1, blood 6/6, npm test 284/284 (0 fail / 0 skipped),
  verify-game 81 ok / 0 fail / 0 skipped (walker-at-(30,12) kill flow ok,
  597 meshes / 18 lights / 1800 points unchanged), build green.
  NEXT: visuals (8).
- **Ralph round 48 — visuals (8) wave / danger indicators DONE**: wave state
  was unreadable at a glance — the HUD showed only "WAVE n" and "left: n"
  (HUD.js:278-281), so during a 3-6 s intermission the player could not tell
  how much time remained, what composition was coming, or what the next wave
  total was; while fighting there was no readout of how close the wave was to
  its concurrent cap min(8+wave,18) (wave 1 cap 9, wave 5 cap 13). Minimum
  fix, DOM/CSS only: the two existing top-center elements gained a second
  line each — `.hud-wave` now shows "in <s>s — <composition>" built verbatim
  from the existing `WaveManager.nextWavePreview` getter (no duplicated
  composition logic) with an `imminent` highlight at ≤2 s, and `.hud-threat`
  shows "next: <total>" + "cap <n>" during the intermission or
  "room <r>/<cap>" / "CAP <n>/<cap>" with a red `danger` class while
  fighting. The boss is excluded from the cap-pressure test via the already
  wired `hud.boss` (wave 5 `remaining` counts the brute but the brute never
  counts against the spawn cap), so no WaveManager getter was added.
  Sub-lines are written only when their string changes (write-gate), so no
  extra per-frame DOM writes beyond the pre-existing ones; zero new lights,
  meshes, points, and zero new full-screen tint layers — the round-47
  vignette/low-health no-stack rule is untouched (fx root still holds exactly
  fx-damage / fx-dmg-edge / fx-lowhealth). Files src/game/HUD.js (:25-27,
  :56-68, :280-325), src/styles.css (:309-333) + test/hud-screens.test.mjs
  (intermission countdown text, composition verbatim from nextWavePreview,
  cap/danger readout, wave-5 boss exclusion, write-gate, headless degradation,
  fx-layer count unchanged). Re-verified: hud-screens green, postfx 7/7,
  zombie 34/34, pistol 11/11, shotgun 12/12, fog 4/4, sky 8/8, lighting 4/4,
  snow 6/6, city 23/23, lamps 1/1, blood 6/6, npm test 284/284
  (0 fail / 0 skipped), verify-game 81 ok / 0 fail / 0 skipped
  (walker-at-(30,12) kill flow ok, 597 meshes / 18 lights / 1800 points
  unchanged), build green.
  NEXT: visuals (9).
- **Ralph round 49 — visuals (9) HUD/title/pause/game-over readability DONE**:
  measured every text element with Michelson contrast against its actual
  composited background (.screen rgba(4,6,12,0.78) over --bg #05070c, then
  .panel rgba(10,14,24,0.82) over that, sRGB->linear, alpha in linear light).
  Worst offenders were the dim secondary text and opacity-diluted text:
  weapon-slot names at 0.55 opacity (C 0.43 effective over panel),
  tagline.dim at 0.65 (C 0.51), difficulty labels at 0.7 (C 0.56), and the
  two top readouts (.hud-threat / .hud-threat-sub) reading bare off the
  snow-lit scene (C 0.06). Minimum fix, DOM/CSS only: token values lifted
  (--ink #d6deee->#e2e9f6, --ink-dim #8b98b0->#a4b0c6, --banner
  #eef4ff->#f2f6ff), opacities raised (weapon-slot 0.55->0.8 via
  :not(.active), tagline.dim 0.65->0.85, difficulty-label 0.7->0.85),
  .stat text lifted to --banner so the wave/kills/pts line is the clearest
  thing on the game-over screen, .hud-threat + .hud-threat-sub given the
  same panel backing the other clusters use, and the previously unstyled
  .setting-row/.setting-label/.setting-value rules added so settings text is
  explicit. Narrow-screen block fixed: hud-value/weapon-ammo 16px->20px,
  music button 11px->12px. Threshold: 0.60 C over the dark panel (all pairs
  now >= 0.96), 0.30 C for bare text over the snow-lit scene (ink 0.379).
  Zero new lights/meshes/points, zero new full-screen tint layers (fx root
  still exactly fx-damage / fx-dmg-edge / fx-lowhealth), no new per-frame
  DOM writes, headless-safe, round-48 write-gate intact. Files src/styles.css
  (:10-11, :18, :210-212, :300-313, :329-341, :487, :509, :541-543, :565-577,
  :649-651, :664-666) + test/hud-screens.test.mjs (contrast + narrow-size
  assertions). Re-verified: hud-screens green, npm test 284/284
  (0 fail / 0 skipped), verify-game 81 ok / 0 fail / 0 skipped
  (walker-at-(30,12) kill flow ok), build green.
  NEXT: visuals (10).
- **Ralph round 50 — visuals (10) material roughness / contrast / color hierarchy DONE**:
  diagnosed numerically first, no readPixels (verify-game has none): every
  material group was tabulated for roughness/metalness/color and its tonemapped
  luminance re-derived through the shipped curve (sRGB->linear -> Lambert under
  the night rig moon 1.45 / hemi 0.30 / ambient 0.12 -> exposure 1.2 -> ACES).
  The collapse was a roughness-band collision, not a brightness one: bodies sit
  at 0.90/0.95 while ground 0.85, facades 0.88, roof 0.95, planks 0.85, bus
  0.60-0.65 and pole 0.60 overlapped that band, so nothing separated actors from
  scenery. Brightness already ordered correctly (ground 0.2320 > walker 0.1741 >
  brute 0.0703 > pole 0.0018 > wheel 0.0008; HITMAT 0.3272 above every body), so
  colors were left untouched. Minimum fix = move static scenery into a smooth
  band <= 0.70 with a >= 0.20 gap below the untouched 0.90/0.95 body band:
  City.js ground 0.85->0.55, building body + facade variant 0.88->0.62, roof
  0.95->0.70; cityDressing.js bus body 0.6->0.42 / cabin 0.65->0.48 / wheels
  0.5->0.30, planks 0.85->0.68, pole 0.6->0.42. Roughness only affects the
  specular term, so the diffuse silhouette luminance — and with it the round-45
  0.07-0.17 body band, the C >= 0.91-at-30 m gate and HITMAT 0.3272 — is
  unchanged by construction. The moon (1.45 lx) plus the 70 cd streetlight pools
  drive the visible effect: lower roughness widens each specular lobe, so the
  pavement sheen spreads further across the plaza and bus flanks read as sheet
  metal; the installed IBL env map (envmap.js:61 scene.environment) adds the sky
  reflection at zero extra draw calls or lights. Tier-safe: roughness is not
  tier-dependent (Lighting.setQuality / PostFX.setTier / WeaponBank.setTier
  fan-out at Game.js:490-504 touches none of it), so 'low' keeps the same
  separation and no second mechanism doubles any effect. Zero new lights,
  meshes, points, tint layers, or per-frame material writes (asserted); city
  meshes stay 388, bodies stay 0.0703-0.1741, HITMAT 0.3272. Files
  src/world/City.js (:219-228, :263-267, :311-314, :319-322) +
  src/world/cityDressing.js (:48-52, :135-142, :232-236) + new
  test/material-hierarchy.test.mjs (11 assertions). Re-verified:
  material-hierarchy 11/11, npm test 295/295 (0 fail / 0 skipped),
  verify-game 81 ok / 0 fail / 0 skipped (walker-at-(30,12) kill flow ok,
  597 meshes / 18 lights / 1800 points unchanged), build green.
  NEXT: gameplay items (see list below).
- **Audio: COMPLETE + verified** (MusicEngine/MusicDirector/AudioBank wiring,
  music-playlist test, review fixes applied, 262/262, build green).
- **NEXT: visuals** — one small independent round each: (1) stronger night
  lighting + readable streetlights/landmarks; (2) fog/atmospheric depth;
  (3) snow/weather layering; (4) restrained bloom/emissive; (5) clearer enemy
  silhouettes; (6) muzzle flash + hit feedback; (7) damage vignette;
  (8) wave/danger indicators; (9) HUD/title/pause/game-over readability;
  (10) material roughness/contrast/color hierarchy. Each: one file/subsystem,
  focused test, budget check, update TASKS.md.
  - (1) DONE: stronger night lighting — moon 1.1→1.45, hemi 0.22→0.30,
    ambient 0.08→0.12, streetlights 55→70 cd (files src/world/Lighting.js +
    test/lighting.test.mjs; lighting test 4/4, verify-game 81/81).
    Reviewer ACCEPT-WITH-FIXES: all values + 15-light count + zero per-frame
    allocs confirmed; npm test 262/262. Only gap was the missing changelog
    entry — now added to docs/V2-CHANGELOG.md ("v6 visuals (1)"). Reviewer
    flags for later rounds: re-measure bloom halos in item (4); check shadow
    acne/peter-panning under the stronger moon in-browser.
  - (2) DONE: fog / atmospheric depth — quality-tiered FogExp2 (high 0.022 /
    medium 0.019 / low 0.018, color 0x0b1020) + two additive fog:false
    ground-haze sheets and ground `fogDensity` 0.82 (files src/game/Game.js,
    src/world/City.js, test/fog.test.mjs; fog test 4/4, sky test 8/8,
    npm test 264/264, verify-game 81 ok / 0 fail / 0 skipped).
  - (3) DONE: snow / weather layering — 4-band depth hierarchy in
    src/world/snow.js (700/700/260/140 = 1800 flakes, near bigger/faster/
    brighter, far smaller/dimmer/slower, per-band crosswind shear) + quality
    tiers low 750 (2 bands) / medium 1050 / high 1500 via `setTier()` from
    `Lighting.setQuality`, plus a deterministic LCG-free squall that peaks at
    the 1800 ceiling (files src/world/snow.js, src/world/Lighting.js,
    src/game/Game.js, test/snow.test.mjs, test/city.test.mjs; snow test 6/6,
    city test 23/23, npm test 270/270, verify-game 81 ok / 0 fail / 0 skipped).
  - (4) DONE: restrained bloom / emissive — bloom retuned to source-only in
    src/game/PostFX.js (strength 0.25→0.18, radius 0.5→0.35, threshold
    0.0→0.72 measured against the ACES/exposure-1.2 tonemap so the round-41
    lit band 0.50–0.72 stays out and every emissive source stays in; pass
    order unchanged) + new `setTier()` (high 0.18 / medium 0.12 / low 0.08)
    hooked in `applySettings`, with emissives/halos cut in
    src/world/cityDressing.js (lamp 3.2→2.2 halo 0.5/2.2→0.30/1.6, spire
    2.5→2.0 halo 0.6/3→0.38/2.2, beacons 2.0 kept with halo 0.5/2.4→0.34/1.8)
    and the relight value in src/game/Lamps.js (files src/game/PostFX.js,
    src/world/cityDressing.js, src/game/Lamps.js, src/game/Game.js,
    test/postfx.test.mjs, test/city.test.mjs, test/lamps.test.mjs; postfx test
    7/7, city 23/23, lamps 1/1, npm test 273/273, verify-game 81 ok / 0 fail /
    0 skipped).
  - (5) DONE: clearer enemy silhouettes — the four shared MAT2 body colors
    lifted ~1.6× in linear luminance (walker 0x6b7d5c→0x8b9c77, shambler
    0x7a6a58→0x998873, screamer 0x9c4f5e→0xb46574, brute 0x4c5a44→0x65755b)
    and mirrored in FACEMAT, measured through the real pipeline
    (sRGB→linear→Lambert→exposure 1.2→ACES→FogExp2) to close the contrast
    gate C ≥ 0.90 at 10/20/30 m on every fog tier (brute was worst at 0.81 at
    30 m; now ≥0.91 everywhere) with zero new meshes/lights/points and bodies
    still far under the 0.72 bloom cut (files src/game/Zombie.js,
    test/zombie.test.mjs; zombie test 31/31, npm test 277/277, verify-game
    81 ok / 0 fail / 0 skipped).
  - (6) DONE: muzzle flash + hit feedback — HITMAT lifted 0x8a1f2a/0x661111 →
    0xe84a38/0xb02214 so the hit flash is brighter than every round-45 body
    (Michelson C 0.31–0.65, was −0.01…−0.43) while staying under the 0.72
    bloom cut and deep red (R/G 11.8); muzzle-flash peaks made tier-aware via
    new `WeaponBank.setTier` ('low' drops the pistol/shotgun flash PointLights
    and dims the sprite) with the existing 300 cd/6 m and 500 cd/8 m lights
    measured to add 3.89 / 2.43 linear at 5–6 m and exactly 0 at 15 m (files
    src/game/Zombie.js, src/game/Pistol.js, src/game/Shotgun.js,
    src/game/WeaponBank.js, src/game/Game.js, test/zombie.test.mjs,
    test/pistol.test.mjs, test/shotgun.test.mjs; zombie 34/34, pistol 11/11,
    shotgun 12/12, npm test 284/284, verify-game 81 ok / 0 fail / 0 skipped).
  - (7) DONE: damage vignette — `.fx-damage` gradient stops pushed peripheral
    (0 @50%→0 @72%, rim 0.55→0.32) so the center 40% band stays fully clear and
    the tinted fraction dropped to 0.360 (was 0.60–0.67); `.fx-lowhealth`
    (0 @40%→0 @62%, rim 0.45→0.30) now breathes on a deterministic 1.8 s pulse
    in [0.25, 0.75] instead of a constant full-strength frame, and the damage
    flash is suppressed while it is on so the layers never stack; severity
    scales with damage taken (fallback 0.18 + 0.006/pt cap 0.40, hook
    0.25 + 0.012/pt cap 0.55) with zero new DOM nodes, lights, meshes or
    points (files src/styles.css, src/game/HUD.js, test/hud-screens.test.mjs;
    npm test 284/284, verify-game 81 ok / 0 fail / 0 skipped).
  - (8) DONE: wave / danger indicators — the two existing top-center readouts
    gained a second line each instead of a new overlay: `.hud-wave` shows the
    intermission countdown + next-wave composition taken verbatim from the
    existing `nextWavePreview` getter (with an `imminent` highlight at ≤2 s),
    `.hud-threat` shows "next: <total>" + "cap <n>" during the intermission
    and "room <r>/<cap>" / red "CAP <n>/<cap>" while fighting, with the boss
    excluded from the cap-pressure test via the wired `hud.boss`; sub-lines
    are write-gated so no extra per-frame DOM writes occur, and no new
    full-screen tint layer was added (round-47 no-stack rule intact)
    (files src/game/HUD.js, src/styles.css, test/hud-screens.test.mjs;
    npm test 284/284, verify-game 81 ok / 0 fail / 0 skipped).
  - (9) DONE: HUD/title/pause/game-over readability — Michelson contrast
    measured against each element's actual composited background (.screen
    rgba(4,6,12,0.78) over --bg, then .panel rgba(10,14,24,0.82) over that,
    sRGB→linear, alpha in linear light); worst offenders were opacity-diluted
    text (weapon-slot 0.55 → C 0.43, tagline.dim 0.65 → C 0.51,
    difficulty-label 0.7 → C 0.56) and the two bare top readouts over the
    snow-lit scene (C 0.06). Tokens lifted within palette (--ink #d6deee→
    #e2e9f6, --ink-dim #8b98b0→#a4b0c6, --banner #eef4ff→#f2f6ff), opacities
    raised (slot 0.8, tagline.dim 0.85, difficulty-label 0.85), `.stat` →
    --banner so the game-over stat line is the clearest text on its screen,
    `.hud-threat`/`.hud-threat-sub` given the standard panel backing, and the
    unstyled `.setting-row/.setting-label/.setting-value` rules added.
    Narrow-screen sizes restored (hud-value/weapon-ammo 16→20px, music btn
    11→12px). Threshold 0.60 C over panel (all ≥ 0.96), 0.30 C bare over snow
    (ink 0.379); zero new lights/meshes/points/tint layers, no new per-frame
    DOM writes, round-47 no-stack + round-48 write-gate intact
    (files src/styles.css, test/hud-screens.test.mjs;
    npm test 284/284, verify-game 81 ok / 0 fail / 0 skipped).
  - (10) DONE: material roughness / contrast / color hierarchy — tabulated
    every material group's roughness/metalness/color plus its tonemapped
    luminance (sRGB→linear → Lambert under moon 1.45 / hemi 0.30 / ambient 0.12
    → exposure 1.2 → ACES; no readPixels exists in verify-game). The hierarchy
    collapse was a roughness-band collision, not a brightness one: bodies at
    0.90/0.95 were overlapped by ground 0.85, facades 0.88, roof 0.95, planks
    0.85, bus 0.60–0.65 and pole 0.60, while brightness already ordered
    correctly (ground 0.2320 > walker 0.1741 > brute 0.0703 > pole 0.0018 >
    wheel 0.0008, HITMAT 0.3272 above every body). Minimum fix: static scenery
    moved into a smooth band ≤ 0.70 leaving a ≥ 0.20 gap under the untouched
    body band — ground 0.85→0.55, building body + facade variant 0.88→0.62,
    roof 0.95→0.70 (City.js); bus 0.6→0.42 / cabin 0.65→0.48 / wheels 0.5→0.30,
    planks 0.85→0.68, pole 0.6→0.42 (cityDressing.js). Colors untouched, so the
    round-45 body band 0.0703–0.1741, the C ≥ 0.91-at-30 m gate and HITMAT
    0.3272 are unchanged by construction (roughness only scales the specular
    term, never the diffuse silhouette). Moon 1.45 lx + the 70 cd streetlight
    pools drive the effect; the installed IBL env map (envmap.js:61) supplies
    the sky reflection at zero extra draw calls or lights. Roughness is not
    tier-dependent, so 'low' keeps identical separation and no second mechanism
    doubles it; zero new lights/meshes/points/tint layers and no new per-frame
    material writes (asserted).
    (files src/world/City.js, src/world/cityDressing.js,
    test/material-hierarchy.test.mjs; npm test 295/295,
    verify-game 81 ok / 0 fail / 0 skipped).
- **Ralph round 51 — gameplay (1) wave-pacing WIP made green DONE**: the
  working tree carried an uncommitted "v6 gameplay (1)" WaveManager rewrite
  (spawn-cadence curve 0.7→0.45 s floor at wave 6, intermission ceiling
  6→5 s, concurrency cap 8+wave knee at 9 then +0.5/wave to a 16 ceiling,
  shared `queueTypeAt` composition rule) that left 2 tests red (293/295).
  Fixes: `INTERMISSION_MAX` 6.0→5.0 to match the code comment; wave
  transitions restored to `timer = 0` (first spawn one tick after the
  intermission expires, matching the pinned wave-1 opening and the
  natural-clear test); test/wave.test.mjs forceClear + natural-clear cases
  re-pinned to the new 3.0 s wave-2 intermission + 0.7 s first-spawn delay;
  test/boss.test.mjs wave-10 loop uses 7.1 s at i=4 (wave-5 boss
  BOSS_INTERMISSION) instead of 6.1 s. Re-verified: wave 11/11, boss 14/14,
  match 9/9, npm test 295/295 (0 fail / 0 skipped), verify-game 81 ok /
  0 fail / 0 skipped, build green. Changelog entry "v6 gameplay (1) — wave
  pacing curve" appended to docs/V2-CHANGELOG.md. Pacing acceptance test
  added (test/wave-pacing.test.mjs, 6 tests: interval curve 0.7→0.45 floor,
  capFor 9..17→16 ceiling + cap/boss ≤ 24, intermission 3.0/4.5/5.0/boss 7.0,
  queueTypeAt composition + preview/buildQueue consistency, wave-6 live
  0.45 s cadence, cross-instance determinism). Reviewer ACCEPT-WITH-FIXES,
  all 6 items applied: stale min(8+wave,18) comment + verify-game S6 labels
  → capFor; nextWavePreview collapsed to a single queueTypeAt call;
  queueTypeAt docstring corrected (wave-3 i%5 branch is dead); late-wave
  shambler point-safety pin added to wave.test (waves 6/10). Re-verified:
  wave 11/11, wave-pacing 6/6, boss 14/14, match 9/9, npm test 301/301
  (0 fail / 0 skipped), verify-game 81 ok / 0 fail / 0 skipped, build green.
  Committed `c08080e` (5 files: WaveManager.js, wave.test, boss.test,
  wave-pacing.test, verify-game.mjs) + pushed to origin/v2. The rest of the
  WIP was split into two clean commits and pushed: `689e18b` (audio music:
  MusicEngine/MusicDirector/AudioBank/Game + README + music-playlist test)
  and `1b2e381` (v6 visuals 1–10: 23 files incl. material-hierarchy + snow
  tests). Working tree now has only untracked probe/diag leftovers
  (tools/_probe-*, .research artifacts) — no tracked modifications.
  NEXT: gameplay (2) — ammo-drop balance (AmmoDrops.js) with a focused test.
- **Ralph round 51b — gameplay (2) ammo-drop balance DONE**: economy analysis
  (217 kills waves 1–10, ~1015 pistol shots needed vs 623 income at 12/drop →
  pistol dry ~wave 7–8). Fix: BULLETS_PER_DROP 12→18 (AmmoDrops.js:20; income
  ≈917 ≈90% of need — scarce but survives to the wave-10 boss; shells fine
  already; LCG/chances/reserves untouched). test/ammodrop.test.mjs pin 12→18
  + new deterministic 10-wave-economy test (≥0.85×need, <need; shells ≥350).
  Re-verified: ammodrop 9/9, difficulty 7/7, match 9/9, npm test 302/302
  (0 fail / 0 skipped), verify-game 81 ok / 0 fail / 0 skipped, build green.
  Changelog "v6 gameplay (2)" appended. Reviewer pass
  requested. NEXT: commit gameplay (2) after review; then gameplay (3) —
  zombie-type counterplay / special behaviors.
- **Ralph round 51c — gameplay (2) review fixes + commit DONE**: reviewer
  ACCEPT-WITH-FIXES (no must-fix). Applied both should-fix items: economy
  ratio bound tightened 0.85→0.9 (now pins 18/drop — 17 would fail) and the
  PISTOL_NEED=1015 derivation documented in-test (between the 1007 pooled
  and 1115 all-body bounds, ~10% headshot mix; wave-10 shortfall covered by
  non-pistol damage). Re-verified: ammodrop 9/9, npm test 302/302,
  verify-game 81/81, build green. Committed `1041610` + pushed to origin/v2.
  NEXT: gameplay (3) — zombie-type counterplay / special behaviors
  (screamer/brute counterplay tests), then browser smoke + docs.
  ammo-drop balance, zombie-type differences, special behaviors w/ counterplay,
  stamina/flashlight tradeoffs, melee feedback, intermission choices,
  low-health pressure, restart/progression. Each needs a focused acceptance test.
- **Ralph round 52 — gameplay (3) zombie-type stagger resistance DONE +
  reviewed + committed `e8df040` (pushed to origin/v2)**: researcher found
  screamer has no special behavior (stats only, Zombie.js:78) and no
  per-type stagger scaling exists — fast types are trivially kited and the
  brute can be staggered out of its own charge. Change: `staggerResist`
  added to TABLE (Zombie.js:76-79 — walker 1, shambler 1, screamer 1.35,
  brute 0.35), exposed as `this.staggerResist` (:581), knockback()
  multiplies `_kbX/_kbZ` by it (:1295-1296); KB_TIME 0.35 / KB_STRENGTH 3
  unchanged. Higher resist = LESS displacement: screamer 0.675 m vs walker
  0.5, brute 0.175 m; charge survives stagger (stagger block returns before
  charge block, :983 vs :1016). Tests: zombie.test new per-type pin
  (1e-9 exact, ordering brute<walker<screamer, chase resumes), boss.test
  brute pin z=-2.5→-2.175 + chase-resume, TABLE deepEqual pins updated.
  Reviewer ACCEPT-WITH-FIXES; both should-fixes applied (KB_STRENGTH
  comment "× staggerResist" Zombie.js:522-524; TASKS.md round-46-era
  "≈0.53 m" note corrected). Reviewer note for later: RemoteZombie.js:210
  proxy knockback is a no-op stub — mirror staggerResist there if remote
  stagger is implemented. Re-verified: zombie+boss 53/53, npm test 303/303
  (0 fail / 0 skipped), verify-game 81 ok / 0 fail / 0 skipped, build
  green, changelog "v6 gameplay (3)" appended.
  NEXT: gameplay (4) — stamina/flashlight tradeoffs, one focused test.
- **Ralph round 53 — gameplay (4) stamina/flashlight tradeoff DONE +
  reviewed + committed `3a4fb9b` (pushed to origin/v2)**: researcher found
  zero coupling between stamina and the flashlight (HUD.js:221 read a
  nonexistent player.maxStamina). Change: LIGHT_DRAIN 4/s while the
  flashlight is on and sprint is inactive (Player.js:22, branch :130-137 —
  sprint 26/s keeps strict precedence, never 30/s; light-on blocks regen;
  clamp 0), maxStamina=100 (:59), optional 5th ctor arg flashlight=null
  (:42), Game.js:371-373 wires player.flashlight after Flashlight creation
  (survives reset/respawn; Match.js 4-arg Player keeps null → server
  semantics unchanged). Tests: light-on 4/s drain band, regen 18/s when
  off, exact clamp 0, maxStamina pin, back-compat regen; reviewer
  ACCEPT-WITH-FIXES — both should-fixes applied (sprint+light precedence
  pin 25.5–26.5/s; SPRINT_MIN_STAMINA boundary: stamina 4 disables sprint →
  light drain takes over, clamps 0). Re-verified: player+flashlight green,
  npm test 303/303 (0 fail / 0 skipped), verify-game 81 ok / 0 fail /
  0 skipped, changelog "v6 gameplay (4)" appended.
  NEXT: gameplay (5) — melee/reload feedback or intermission choices;
  smallest item first, one focused test.
- **Ralph round 54 — gameplay (5) reload feedback dip DONE + reviewed +
  committed `70da438` (pushed to origin/v2)**: researcher picked reload
  feedback as the smallest gap (melee already has phased feedback;
  intermission choices need new UI). Change: sin(π·p) reload dip
  (DIP_Y -0.05 / DIP_Z +0.06) on the pistol/shotgun view models
  (Pistol.js:25/:133-141, Shotgun.js:25/:129-137), bob/recoil untouched,
  p clamped [0,1]; reviewer ACCEPT-WITH-FIXES — reload branch moved
  BEFORE the view write so the completion frame lands on exact rest
  (removes the 1-frame 2.4 mm deviation), tests updated to match.
  Pins: dip >0.03 y/z near peak, exact rest on completion frame,
  pistol 4/12→12/28, shotgun 3/5→5/28. Re-verified: pistol+shotgun 25/25,
  npm test 305/305 (0 fail / 0 skipped), verify-game 81 ok / 0 fail /
  0 skipped, changelog "v6 gameplay (5)" appended.
  NEXT: gameplay (6) — restart-state test (researcher's cheap second item:
  assert startGame actually clears zombies/kills/ammo/wave, not just
  state PLAYING), then browser smoke + docs.
- **Ralph round 55 — gameplay (6) restart-state coverage DONE + reviewed +
  committed `cef2e07` (pushed to origin/v2)**: test-only change — new
  test/restart-state.test.mjs (3 tests): dirty() (ammo spent, damagePlayer,
  flashlight battery drained 60 frames, 6 walkers spawned+killed, 120 steps,
  forceWaveClear + 240 steps → wave 2) then assertClean() pins PLAYING,
  zombies 0, kills 0, score 0, wave 1, health 100, timeInGame 0, drops 0,
  full mag+reserve, flashlight battery 1 + off, _boss null — via
  debug.resetRun() (test 1) and GAMEOVER→startGame (test 2); test 3 pins
  the startGame-while-PLAYING early-return guard (Game.js:568: kills/score/
  wave survive). Reviewer ACCEPT-WITH-FIXES; all 3 should-fixes applied
  (flashlight/boss coverage, early-return micro-test, shared assertClean).
  No restart bugs found — startGame already clears everything. Re-verified:
  restart-state 3/3, npm test 308/308 (0 fail / 0 skipped), verify-game
  81 ok / 0 fail / 0 skipped, changelog "v6 gameplay (6)" appended.
  NEXT: FINAL VALIDATION round — browser smoke test (audio/visual/gameplay),
  README controls+audio docs pass, docs/V2-CHANGELOG.md review, secrets
  scan; browser is env-bound (page dies ~3-5 s, SwiftShader sandbox).
- **Ralph round 56 — FINAL VALIDATION DONE**:
  (1) Browser smoke E2E PASS against the production build (`npm run build`
      + `npm run preview` :4173, PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers
      node tools/e2e-browser.mjs): 18/18 checks — WebGL canvas, title,
      START, gameplay+HUD, zombies spawn, weapon switch axe/shotgun, shot
      kills, blood particles, score 60 walker, pickup +8, flashlight
      toggle+drain, pause (Esc), resume (P), game over YOU DIED + score,
      restart (playing/wave 1/kills 0/score 0), 0 console errors, 0 page
      errors. The old "page dies ~3-5 s" env limit did NOT bite this run.
  (2) README refreshed to match shipped code: controls table now lists
      Space jump, C crouch, 3/4/5 weapon slots, flashlight stamina-burn
      note; Gameplay section rewritten — 4 zombie types + brute boss every
      5th wave, five weapons with real capacities (shotgun 5/30 start,
      pistol 12/36, sniper 5/20, axe/sword melee), headshot ×2 firearms,
      drops 55% shells +8 / 18% battery +35% (AmmoDrops.js:18-31), score
      incl. brute 150 (Score.js:8), FRENZY title toggle (Screens.js:65-69).
      Audio section already accurate (3 procedural tracks, MusicDirector,
      N/M mute, autoplay, headless no-op).
  (3) Secrets scan: no api keys/tokens/passwords in src/server/tools or
      docs (grep hit only the historical "no secrets found" review note).
  (4) Integration: npm test 308/308, verify-game 81 ok/0 fail/0 skipped,
      build green. Working tree clean except untracked probe leftovers.
  NEXT: optional gh-pages redeploy of the new build (not requested);
  objective otherwise COMPLETE.
- **FINAL VALIDATION**: npm test + npm run build + verify-game.mjs all green;
  browser smoke test of audio/visual/gameplay; README documents controls +
  audio; docs/V2-CHANGELOG.md records improvements; no secrets in workspace.

- **Ralph round 57 — v6 audio (7) mp3 power-metal playlist IN PROGRESS**:
  goal adds 3 Wan2GP/YuE2 power-metal songs looping as one in-game playlist.
  Specs written: tools/audio-specs/df_{exploration,combat,crisis}.json
  (yue2, seeds 1000-1002, duration_seconds 150, style = alt_prompt).
  GPU 1 is fully occupied by tabbyapi (pid 1922550, 22.3 GiB) — YuE2 OOMs
  there; generation runs on GPU 2 (3080) profile 2 instead, detached pid
  2475179, log outputs/wangp-songs-all.log (score ~30 min/song, then
  acoustic+VAE; ~2 h total). Output targets: public/assets/audio/
  song_{exploration,combat,crisis}.mp3.
  Code landed while waiting: AudioBank.playPlaylist(urls, seconds) — reuses
  the playMusic watchdog, adds ONE `ended` advance handler that walks the
  list mod-length (repeat forever), stopMusic gates it, dispose removes it
  (AudioBank.js:1103-1135 + dispose cleanup). Game.js: SONG_PLAYLIST +
  SONG_PLAYLIST_SECONDS=150 constants (:43-51) and startGame now calls
  audio.playPlaylist when the music bus is unmuted (:602-606). Test:
  audio.test.mjs playlist block (src order, wrap, repeat, stopped-inert,
  empty no-op, 2 ended handlers, dispose removes both). Focused run green:
  audio + music-playlist + restart-state 5/5.
  NEXT: when mp3s land — verify files, npm test + build + verify-game,
  browser smoke (playlist rotation), README audio section update, commit.

## Conventions (unchanged)
- No `Math.random` in src (deterministic LCG / fixed seeds).
- Shared materials are never disposed per zombie.
- Budgets: meshes ≤ 600, lights ≤ 40, points ≤ 2500, groans ≤ 4, blood ≤ 300, zombies ≤ 24.
- Headless Node safe (face texture loading is a no-op without `document`).
- Use `edit`, not `write`, for existing files.
- gh-pages deploys: use a temporary git worktree INSIDE the workspace (e.g.
  `.deploy-ghpages`), sync `dist/` into it, commit, push, `git worktree remove`.
  The gh-pages branch has NO `.gitignore`, so `git add -A` in the main working tree
  stages `node_modules`/`dist`/`.research` (happened once — reset + redid via worktree).
  The sandbox `/tmp` does not persist across bash calls, so worktrees cannot live there.

- **v6 audio (8) — trilingual anime playlist DONE (user request)**: 3 new
  YuE2 power-metal songs (AoT-opening inspired): df_javelin_sv (SE, 180 s),
  df_hord_en (EN, 71 s), df_matsubou_ja (JP, 86 s) — generated on GPU 2
  (javelin needed a retry after a 3600 s timeout), wav→mp3 via ffmpeg,
  committed. playPlaylist now takes per-track lengths (_plLens); Game.js
  SONG_PLAYLIST + SONG_PLAYLIST_SECONDS=[180,71,86]; README audio section +
  changelog updated; audio test extended. Evidence: npm test 308/308,
  verify-game 81 ok, E2E 18/18 PASS (dev :5173), browser playlist rotation
  verified (sv→en→ja→sv with per-song lengths). Commit e915b19 pushed.
  NEXT: gh-pages redeploy so the live site serves the new playlist.

- **v6 tooling (1) — agent capabilities upgrade DONE (user request)**:
  RAG + operational docs + guard tools.
  - `tools/rag-index.mjs` + `tools/rag-query.mjs` (+ npm scripts `rag-index`,
    `rag`): dependency-free TF-IDF lexical index over src/server/tools/test/
    docs + loose md/json, chunked at natural boundaries (md headings, JS
    class/method starts, py defs), camel/snake sub-tokenized, sha256
    incremental reuse, output `.research/rag/index.json` (137 files / 391
    chunks). Query: TF-IDF + symbol boost ×2.5 + path boost ×1.2 +
    full-coverage ×1.35; flags --top/--full/--json/--filter/--update; exit
    0 hits / 3 none / 2 usage. Validation: "flashlight drains stamina while
    sprinting" → Player.js:70-165 top hit; "capFor wave spawn cap" →
    WaveManager.js capFor chunk. Complements graft (graph) + zg (embeddings)
    by covering prose docs they miss.
  - `tools/check-assets.mjs` (+ `check-assets`): extracts static + dynamic
    asset refs from shipped code (faces/outfits patterns pinned), verifies
    presence in public/ and dist/, ffprobes audio and compares against
    SONG_PLAYLIST_SECONDS / LEVEL_TRACK_SECONDS parsed **in source order**
    from Game.js (first version sorted alphabetically → false mismatches
    hord/javelin; fixed by mapping playlist index). 34 refs, 0 problems.
  - `tools/secrets-scan.mjs` (+ `secrets-scan`): credential regexes (sk-,
    AKIA, gh[pousr]_, xox, AIza, private-key blocks, basic-auth URLs,
    bearer) with allowlist + `--allow` literals; exit 1 on findings.
    Clean: 196 files scanned.
  - `AGENTS.md` (NEW): operational guide — hard rules, layout, command
    table, 7-step verification workflow, headless drive pattern, three
    code-nav indexes, deploy procedure, delegation conventions.
  - `docs/AGENT-ASSET-PIPELINE.md` (NEW): Wan2GP headless contract
    (env_uv python, GPU 2 only, yue2 prompt=lyrics/alt=style, duration is
    upper bound, save_score .abc/.mid, enhancer off), ffmpeg post-processing,
    Blender flatpak + GLB repair, visual-inspection tool table, SwiftShader
    limits, troubleshooting signature table.
  - README: "100% procedural" claim corrected (asset layer + co-op server);
    agent-nav section now lists all three indexes.
  Evidence: npm test 308/308, verify 81 ok/0/0, build green, check-assets
  34/0, secrets-scan clean, rag hits verified.

- **v6 tooling (2) — agent-guidance + RAG correctness pass DONE (user request)**:
  Audited AGENTS.md / docs/ARCHITECTURE.md / README.md against the code and
  fixed the drift, then fixed two real bugs in the RAG index.
  - **RAG is implemented and now actually works incrementally.**
    `tools/rag-index.mjs` crashed on every second run (`TypeError` at the
    reuse path: `prev.chunks` is a FLAT array, so `chunksByFile.get(rel)`
    returned one chunk object instead of a list) — the index had only ever
    been built with `--force`. Fixed by grouping prev.chunks by file before
    the reuse lookup; rebuild is now incremental + idempotent (144 files /
    411 chunks; second run reuses 144, rebuilds 0).
  - Coverage widened: `LOOSE_FILES` now includes `AGENTS.md`, `index.html`,
    `vite.config.js` (previously unsearchable). Long markdown sections are
    force-split every 270 lines so TASKS.md/CHANGELOG chunks stop being
    unscoreable 650-line blobs.
  - `docs/ARCHITECTURE.md`: budgets restated against the S8 truth
    (meshes ≤ 640 / lights ≤ 40 / points ≤ 2500 / zombies ≤ 24 — the old
    "≤ 12 lights, ~500 meshes" predated the co-op avatars, lamps and blood);
    `test/verify-game.mjs` → `tools/verify-game.mjs` (4 stale paths); the
    "no working browser" rule replaced with the real constraint (browser
    checks run on :5173, not base-pathed :4173 preview).
  - `AGENTS.md`: 350-line rule scoped to NEW files (Zombie.js 1315,
    AudioBank.js 1239, Game.js 927, cityDressing.js 749 already exceed it);
    new "TASKS.md protocol" section (read via RAG not whole, update-in-place,
    keep Status overview current, evidence belongs in docs/.research);
    index-selection rule of thumb (identifier→graft, how/why→zg, prose→RAG);
    `.hermes/` + `docs/spec-*.md` added to Layout.
  - README: layout line no longer claims verify-game lives in `test/`; RAG
    blurb documents `--filter`/`--json` and idempotent rebuilds.
  Evidence: npm test 308/308, verify 81 ok/0/0, build green, check-assets
  34/0, secrets-scan clean 196 files; rag-query verified on AGENTS.md hard
  rules, gh-pages deploy, flashlight/stamina; exit codes 0/3/2 confirmed.

- **v6 visuals (11) — Wan2GP image pass: poster restore + screamer face v2 DONE
  (user request: improve visuals via Wan2GP generate/edit)**:
  - New reusable spec dir `tools/image-specs/` (image counterpart of
    audio-specs). Note: wangp_assets.py reads `model_type`, NOT `model`
    (default qwen_image_21_7B); z_image + mattias LoRA needs
    `"model_type": "z_image"`.
  - `v2_poster_v3.json` — qwen_image_21_7B **edit** (refs → image_mode 3) of
    the shipped wanted poster: restore contrast/sharpness, kill JPEG smearing,
    keep layout + Swedish text. Result: portrait + "EJ LÄNGRE I FART" now
    legible at gameplay distance; shipped as public/assets/posters/poster.jpg
    (old kept at .research/poster_before.jpg).
  - `v2_screamer_face.json` — z_image + mattias LoRA t2i: open-mouth screamer
    portrait (the old face was a closed-mouth snarl that betrayed the type at
    range). Wired by filename swap (Zombie.js loads faces/{type}-face.jpg by
    pattern; check-assets pins the pattern) →
    public/assets/faces/screamer-face.jpg.
  - Verified in-browser: inspect-zombie screamer render shows the open scream;
    e2e-faces PASS, e2e-face-diff PASS, e2e-browser 18/18, look-metrics
    unchanged bands (no bloom-cut regressions), npm test 308/308, verify
    81/0/0, build green, check-assets 34/0, secrets-scan clean.
  - NOTE: inspect-zombie/e2e tools need PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers
    (the hardcoded executablePath fallback misses; AGENT-ASSET-PIPELINE should
    add the env var to every invocation).
  - NEXT (queued image ideas, see this round's analysis): photoreal facade
    512x512 tile (hero facades are the biggest flat spot), wet-asphalt tile
    v2 (current one has a baked-in round puddle ring — bad for 30x30 repeat),
    shotgun viewmodel skin (only weapon without one), muzzle-flash sprite v2,
    ground-grass corner patch, per-type face variants 2/3 refresh.

- **Ralph round 59 — v6 hosting (1) hosted global high score DONE (not yet
  committed)**: the previous round left this feature half-landed in the
  working tree (server API + Score helpers + two new test files). This round
  finished and verified it.
  - Fixed `test/score-hosted.test.mjs` line 19: `async () {` was missing the
    `=>` (whole file failed to parse — the suite was actually red, not green).
  - `Score.commitRecord(fetchFn)` now forwards the injected fetch to
    `submitBest` (was dropping it → fell to real fetch → 0 POSTs) and always
    calls submitBest so a new best is mirrored even when this run is not a
    record. Game.js game-over path keeps `newRecord()` + `submitBest()`.
  - `Score._apiBase()` now targets `location.origin` (the game-server host),
    NOT the Vite base path: Pages has no backend, so the old base-path URL
    404'd and logged a console error in every E2E run. Headless falls back to
    BASE_URL. `vite.config.js` gained a `/api/highscore` → :8080 proxy
    (MP_SERVER honored) so the dev page reaches the backend.
  - `Screens.showTitle` installs a `_onBestChange` refresh for the title HIGH
    SCORE label when the async GET lands late; `Screens.dispose()` now removes
    that hook (dispose-reversal rule). `test/hud-screens.test.mjs` covers the
    late refresh + dispose clearing the callback.
  - Docs: README "Hosted high score" section + kill-scoring line; AGENTS.md
    server.js layout line (API + HIGHSCORE_FILE/DIST_DIR overrides);
    docs/V2-CHANGELOG.md "v6 tooling (1)" style entry "v6 hosting (1)".
  - Evidence: npm test 314/314 (was 308 + 6 new), verify-game 81 ok / 0 fail /
    0 skipped, build green, check-assets 34/0, secrets-scan clean, E2E 18/18
    PASS on :5173 with 0 console errors (the 404 is gone), live browser title
    shows the hosted best (4242) via GET /api/highscore.
  - NEXT: commit + push the working tree (server.js, Score.js, Screens.js,
    Game.js, vite.config.js, .gitignore, README, AGENTS.md, CHANGELOG, 2 new
    tests + hud-screens edit); optional gh-pages redeploy. Note: :8080 is
    running an OLD server build (no /api/highscore) — restart `npm run server`
    before trusting live probes; the dev :5173 proxy reaches the :8080 API.
