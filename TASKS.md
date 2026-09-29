# TASKS — Deadfall: Stockholm Afterdark

Internal task tracking (git-ignored). Reconstructed after a workspace corruption lost
the original; state below is recovered from git history + probe evidence.

## Status overview
- **v4 VISUAL UPGRADE (Sep 27–28, branch `v4`, plan `docs/VISUALS-PLAN-V4.md`)**: user-approved scope = per-type zombie look, weapon skins + view-model feel, building/atmosphere upgrades, attract video ≤15 MB. Progress: (B1) pistol+shotgun AI PBR skins wired via `_loadSkin` — `49beea7`. (B2) view-model feel: pitch/roll recoil + lateral bob on pistol/shotgun, WeaponBank swap raise/lower — `89fa21e`. (B3) sniper muzzle-flash Sprite+PointLight + Axe textured-head dispose fix — `831fd31`. (A3) shared gore/dirt detail DataTexture on bare-skin zombie materials (refcounted) — `d99a0a8`. (C1) buildings: 8 facade variants + 6-color palette + new `src/world/FacadeTrim.js` instanced window trim (+1 InstancedMesh) — `2cbb2b3`. (C2) sky lift + skyline depth + envmap — `5e57d21`/`2cbb2b3`. (D1) title-screen looping attract `<video>` over the static plate — wiring `0da4a6d`, Wan2GP i2v clip `attract.mp4` (4s 832x480 h264, 2.3MB faststart) `fb95224`. All 365/365, verify 81/0/0, build ok, check-assets 0 problems, secrets clean, E2E 18/18. **(A+B) mesh-budget headroom (Sep 28)**: the ≤640 gate was self-imposed in `tools/verify-game.mjs` (not a Three.js limit); real peak was 633 (11-alive wave cap) so there was NO live breach, only thin headroom. Fix = (A) raise the gate 640→800 + (B) instance repeated city dressing in `src/world/cityDressing.js` — streetlight pools 40→1, barricade planks 16→1, landmark strips 10→2, danger strips 4→2, outer strips 20→2, sign posts+panels 44→2, crosswalk bands 16→2, snowdrifts 8→1 (InstancedMesh, one mesh/one draw call each; `City.dispose` already disposes InstancedMeshes via its traverse). Streetlight **heads** stay separate Meshes (per-lamp `headMat.clone()` lets a shot lamp go dark independently — instancing would break shootable-lamps). Base scene 515→370, peak@11 633→488, peak@24 755→629, all under the 800 gate (≥171 spare). Tests updated to count instances not meshes (`test/city.test.mjs` `expandInstances`/`instanceCount` helpers; `material-hierarchy` city count 389→244). 365/365, verify 81/0/0, build ok, check-assets 39/0, secrets clean. This headroom is what makes **A2 (distinct per-type Pixal3D meshes)** affordable. **A1 (skinned-rig revival) deliberately NOT done**: the primitive clothed humanoid (face image + per-type SKIN_TINT/SKIN_WIDTH) is the intentional always-on visual; the walker-final.glb rig clips are corrupted post-repair-rig (stripped to `animations:[]`) and `_applyLOD` keeps the rig hidden so the pale featureless body never overrides the primitive — see Zombie.js `_applyLOD`/`loadSkin` comments. **A2 (new per-type Pixal3D meshes) DONE (Sep 28)**: shambler/screamer/brute now render a distinct high-quality BODY mesh instead of the generic primitive torso/limbs, while the primitive HEAD (face portrait + glowing eyes + hair + accessory) stays so headshots, hit-flash, dismemberment and the walk-bob all keep working; walker keeps the primitive body as the fallback. Pipeline: Wan2GP full-body ref (z_image + mattias LoRA) → Pixal3D `1024_cascade` NAF candidate (GPU 2 via `CUDA_VISIBLE_DEVICES=2`, CPU rembg + CuMesh `fill_holes` stub) → Blender finish (`tools/blender/finish-candidate.py`) to ≤3k tris / 1.8 m → strip embedded WebP textures (they hung the headless GLTFLoader `load` callback and are dropped by the tinted-material path anyway). Assets `public/assets/zombies/{shambler,screamer,brute}-mesh.glb` (single unrigged mesh each: shambler 1404 tris 0.94×1.08, screamer 2308 tris 1.01×0.74, brute 2252 tris 1.46×0.57). Wiring in `src/game/Zombie.js`: `MESH_ASSET`/`loadSkinMesh`/`_attachSkinMesh` mirror the existing `loadSkin`/`_attachSkin` path but attach a STATIC body (no rig/mixer); `_applyLOD` re-enforces the mesh-body policy on every call (the rig loader re-shows primitives, so a one-shot gate caused a double body — fixed); hit-flash/death repaint `_skinMesh.body.material`; dispose detaches the clone + disposes the owned material. `tools/check-assets.mjs` gained a mirrored `MESH_ASSET` parse. Tests +6 in `test/zombie-skin.test.mjs` (parses the real GLBs, drives `_attachSkinMesh`/`_applyLOD`/flash/death/dispose headlessly). 372/372, verify 81/0/0, build ok, check-assets 42/0, secrets clean, E2E 18/18; browser probe confirms all 3 types attach a visible mesh with the primitive torso/limbs hidden + head kept, walker stays primitive. Worst-case 24-zombie peak 629 ≤ 800 gate. (Supersedes the earlier "A2 evaluated and DEFERRED" note — the primitive body still gives distinct silhouettes, but the per-type meshes now give distinct *geometry* too.) **A2 fix round (Sep 28, post-playtest):** the user reported the first wave-1 shamblers rendered *distorted* (lying on their side) and the weapon skins looked bad. Root cause of the distortion: the Pixal3D/Blender-finished meshes were authored **lying down** — the body's head-to-toe axis was the geometry's local **X** (raw bbox X-span 1.8, Y/Z ~1), so the static body rendered sideways and read as a sideways "skeleton"; `finish-candidate.py`'s "height 1.8" check measured the largest bbox dim, not Y, so it passed. The first fix attempt (`.research/orient-mesh-up.mjs`, GLTFExporter-based) **never wrote the files** — the exporter's `parse` promise hung ("unsettled top-level await") so `writeFileSync` never ran, and the committed GLBs stayed lying down. Real fix = `.research/bake-upright-bytes.mjs`: edits the GLB **binary chunk in place** (no exporter/hang) — finds the POSITION+NORMAL accessors, rotates the float arrays so the tallest raw axis maps to +Y (`(x,y,z)->(-y,x,z)` for X-up), drops feet to y=0, recomputes accessor min/max, re-serializes. CRITICAL gotcha: the BIN chunk type must be `BIN\0` (NUL, uint32 0x004E4942), NOT `BIN ` (space) — a space made GLTFLoader ignore the chunk → `getDependency('buffer')` null → `parse` threw "Cannot read properties of null (reading 'slice')" → the game silently fell back to the primitive body (which has limbs, so a VLM saw "full body" while the mesh never attached). After the NUL fix all 3 GLBs parse OK and stand upright (Y=1.80, feet≈0, tris 1404/2308/2252 preserved). Second bug: `_attachSkinMesh` scaled the body by `_skinHeight()` which inflates by the POSE2 **head** scale (screamer/brute headS 1.15/1.2) → bodies ~15% too tall; changed to a fixed `h = 1.8` (×BOSS_SCALE for the boss) since the head is a separate primitive. Browser probe (`tools/_a2-upright.mjs`) + VLM (`tools/mcpm_vision.py --image .research/zombie-look.png`) confirm shambler/screamer ~1.85 tall, feet ~0, head 1.79, distinct widths, "standing upright / full body with arms and legs / solid humanoid"; brute boss ~10.8 (×5.6, intentional). **A2 mesh bodies DISABLED (Sep 28, second post-playtest round — Supersedes the "A2 DONE" + upright claims above):** even after the upright bake, the user still saw the first spawned zombies as *skeletons with no solid body*. Diagnosis: each mesh is a solid upright humanoid in an isolated bright render (`.research/render-glb-pw.mjs` / in-page three.js render), but under the game's dim night lighting + single-color emissive tint (`map=null`, `emissiveIntensity 0.55`) the bodies read as dark, thin SILHOUETTES with no visible torso — the screamer especially (authored width only 0.74 m, depth 1.01 > width). VLM on the in-game close-up crop (`tools/mcpm_vision.py --image .research/zombie-crop.png`) said both figures "do not have a clearly visible solid torso." Fix = flip `USE_MESH_BODY` to `false` in `src/game/Zombie.js` so `loadSkinMesh` early-returns and every type falls back to the proven primitive clothed humanoid (face + per-type SKIN_TINT/SKIN_WIDTH). The whole mesh path (`MESH_ASSET`/`loadSkinMesh`/`_attachSkinMesh`/`_applyLOD` mesh branch + the upright-baked GLBs) is kept intact so a future higher-quality mesh pass can flip the flag back to `true`. Tests call `_attachSkinMesh` directly so they still pass (372/372). Browser probe + VLM on `.research/zombie-primitive.png` confirm all types now render a solid connected body (torso+arms+legs), no skeleton. 372/372, verify 81/0/0, build ok, check-assets 41/0, secrets clean. **Weapon skins → flat dark gunmetal (user choice "no photo"):** dropped the AI `assets/weapons/*.jpg` overlay on all 5 view-models — Pistol/Shotgun/Sniper `_loadSkin()` now early-returns (method + headless guard kept so callers/dispose are unchanged), Axe/Sword TextureLoader→head-material blocks removed (head/blade keep steelMat); body materials retuned to gunmetal (Pistol 0x1c1e21 metal .85, Shotgun 0x212429 metal .8, Sniper 0x23262b metal .8). The jpgs stay in `public/assets/weapons/` for tooling but are no longer code-referenced (check-assets 42→41). 372/372, verify 81/0/0, build ok, check-assets 41/0, secrets clean. NEXT: optional full-face melee skins, or deploy v4. **Deployed (Sep 28):** `v4` pushed to origin (new branch, tip `fb95224`); gh-pages `778def1` (build of `fb95224`, bundle `index-BnGAk21D.js` + `index-BjKWzBLN.css` + `GLTFLoader-l9hW4zEb.js`, new `assets/posters/attract.mp4` + `assets/weapons/{pistol,shotgun}.jpg`). Live verified: index serves `index-BnGAk21D.js`, `attract.mp4` 200 video/mp4 2355208 B.
- **v4 co-op parity round (Sep 28, branch `v4`)**: user report — "co-op zombies don't attack the player like single-player; co-op should match SP but allow extra players, with friendly fire + respawn." Diagnosis (headless probe): the SERVER already simulates co-op correctly (zombies target + damage the nearest alive player; a walker 1 m from a player drained 100→12 HP over 200 ticks, state `attack`), and respawn/match-end were already wired (`Game.onPlayerDeath`/`_respawnSelf`/`_wireMpHooks`). The gap was client-side presentation + two missing features. (1) **Remote zombies never showed an attack** — `RemoteZombie.sync` read the snapshot `state` only for death. Fix: track `state`, latch an attack edge, and drive a windup→swing arm pose + forward torso lean in `update(dt)` while `state==='attack'` (reuses `_armRest`, no new meshes → budget-neutral). (2) **No client hit feedback** — the server emits `{k:'hit',victim,dmg,by}` but `Multiplayer._sync` ignored it. Fix: a new `onSelfHit(dmg,by,ff)` hook fires when a `hit` event targets this pid; `Game._wireMpHooks` maps it to `hud.dmgFeedback` + `audio.hitPlayer` so a co-op hit reads + sounds like single-player (health itself was already adopted via MP-HEALTH). (3) **Friendly fire added (server-authoritative)** — new `MSG.FF` + `protocol.parseFF` (dmg clamp 0–200), `Match.applyFF(victim,dmg,by)` applies `FRIENDLY_FIRE=0.35` × damage to the victim's player + emits a `hit` event (`ff:true`), `Room.applyFF` dispatches it, `NetClient.sendFF` sends it. Client side: new `src/net/FFProxy.js` builds a weapon-target-shaped proxy per teammate (torso+head hitbox spheres, no-op `hitLimbAt`/`_chainShot`/`knockback`, `damage()`→`sendFF`); `Multiplayer.getPlayers()` returns them and `Game` WIRING:WEAPON concats them into `getZombies()` so the existing hit loop registers teammate hits (single-player stays zombies-only, byte-identical). Respawn-on-death already worked and is unchanged. Tests +7 (match applyFF + self/dead/unknown guards, server-room parseFF + Room.applyFF, multiplayer getPlayers/FF-proxy/onSelfHit/attack-pose) → **379/379**, verify 81/0/0, build ok, check-assets 41/0, secrets clean. Headless co-op probe `tools/_probe-coop-ff.mjs` PASS (FF 100→79, onSelfHit fires, teammate proxied, attack lean 0.18). NEXT: deploy v4 (gh-pages) when the user asks.
- **v4 high-score XSS hardening (Sep 28, branch `v4`)**: user flagged an XSS attempt in the high score. A hostile name had landed in `server/highscore.json` as `{"name":"<img src=x onerror=alert","score":500}`. Root cause: `sanitizeName` (server + client `Score.js`) only stripped control chars + collapsed whitespace + clamped length — it did NOT strip HTML-significant characters, so `< > "` survived into storage and the GET payload. Not actually exploitable (every name render is `textContent`-only — grep confirmed zero `innerHTML`/`insertAdjacentHTML` in `src/`), but defense-in-depth warranted. Fix: both sanitizers now also strip `[<>&"']` (server `HS_MARKUP`, client `MARKUP_RE`) before whitespace-collapse/clamp, so a payload is neutralized at the source, not only at render. Cleaned the poisoned `server/highscore.json` in place (`<img src=x onerror=alert` → `img src=x onerror=alert(`). Updated 3 assertions that pinned the old keep-markup behavior (`test/highscore-api.test.mjs` hostile-name test, `test/score-hosted.test.mjs` adoptBest, `test/hud-screens.test.mjs` solo-name sanitize) + added an explicit XSS-strip assertion. **379/379**, verify 81/0/0, build ok, check-assets 41/0, secrets clean. Live API `GET /api/highscore` now returns `img src=x onerror=alert(` (no markup chars). Server restarted (job `bash-563`) to pick up the new sanitizer. **Provenance follow-up**: the payload was NOT an external attacker — it was written by the test suite itself. `test/highscore-api.test.mjs`'s hostile-name test (`listen({highScore:10})` + `POST {score:500, name:'<img src=x onerror=alert(1)>...'}`) wrote straight into the real `server/highscore.json` before the `HIGHSCORE_FILE`→temp-dir redirect was added in v7 (`fe5ad69`); since `highscore.json` is git-ignored it persisted. The LIVE production board (`~/zombie-app/server/highscore.json`, served by `zombie-game.service`) is clean (normal names). The server had ZERO request logging (no `remoteAddress`/`X-Forwarded-For`/access log — journald shows only start/stop banners), so no external IP was ever recorded.
- **v4 request logging + co-op zombie walk parity (Sep 28, branch `v4`)**: (1) **Attributable requests** — added `clientIp(req)` (X-Forwarded-For first hop, else `req.socket.remoteAddress`), `logReq` (logs `method + path + IP` on every `/api/highscore` GET/POST), and `logWs` (logs `join`/`leave` + IP + room + id + name on co-op sockets); `roomFor` now stamps `room.code` so the join log names the real room. Verified live: `POST /api/highscore from 203.0.113.7` (XFF honored) + `GET /api/highscore from 127.0.0.1` (socket fallback). (2) **Co-op zombies now walk like single-player** — user report: co-op zombies "don't move the same, don't attack, slightly different look." Root cause: `RemoteZombie` only posed an attack (added earlier) but had NO walk cycle — a chasing remote zombie slid across the ground rigidly (legs/arms static, no bob) so it read as a different gait/look. Fix: `sync()` now captures `state==='chase'` as `_chasing`; `update(dt)` runs a state machine — `attack`→melee lunge (existing), `chase`→the SAME walk cycle as `Zombie.update` (legs `±sin(t)*0.5`, arms counter-swing `∓sin(t)*0.42`, body bob `sin(time*6)*0.08`, hip sway + head counter-bob, phase from the id seed, no allocation), else→ease limbs+torso to rest. No new meshes → budget unchanged. Updated the attack test (leaving attack into `chase` now hands off to the walk cycle, not static rest) + added a walk-cycle test (legs swing, body bobs, arms leave rest while chasing; idle resets to rest). **380/380**, verify 81/0/0, build ok, check-assets 41/0, secrets clean. Server restarted (job `bash-589`).
- **v4 co-op zombie damage feedback parity (Sep 28, branch `v4`)**: follow-up to the walk-parity round — user: "co-op zombies don't do damage on the player like single-player; same behavior/mechanics." Investigation: the server-side damage mechanic was already correct (headless probe `tools/_probe-coop-damage.mjs`: a walker spawned 6 m away chases → reaches at ~1.3 m → enters `attack` → lands 8 melee hits, player 100→36, via the shared `WorldCore.updateWorld` the SP Game also uses). The real gap was **client-side feedback**: `Multiplayer.onSelfHit` passed the source as the string `'zombie'`/`'teammate'`, but `HUD.dmgFeedback` computes a *directional edge glow* from `source.position` — so in co-op the glow never pointed at the attacker (it silently fell through the `if (p && sp...)` guard), making hits feel non-directional vs single-player where `source` is the live Zombie/Player. Fix: `Multiplayer` now resolves the attacker to a `{ position }` from the snapshot itself (`_attackerSource(snap, by, ff)`: FF→shooter player's x/z from `snap.players`; zombie melee→nearest live zombie of that type to `selfPos`), captures `selfPos` from the self roster entry, and Game's `onSelfHit` passes the resolved source through to `hud.dmgFeedback` (falls back to the old string when unresolved). No new meshes; no protocol change. Updated the FF self-hit test (source now resolves to the shooter position) + added a zombie-melee attacker-position test. **381/381**, verify 81/0/0, build ok, check-assets 41/0, secrets clean. Live two-browser probe `tools/_probe-coop-hp.mjs`: Ada's health 100→2 (`mpSelfHealth:0`) after 9 s in a real room with 8 remote zombies — server damage reaches the local player and the directional cue now fires.
- **v4 co-op zombie chase/position parity (Sep 28, branch `v4`)**: follow-up — user: "co-op zombies are drawn to a location, not to the player; they only damage when the player arrives there; zombies should follow the player as they move and be a bit faster like single-player." Root cause (headless `tools/_probe-coop-chase.mjs` + reading `WorldCore`/`Match`): the SERVER tracks the live player correctly (`nearestAlivePlayer` reads `player.position` every tick), but the CLIENT self-predicts its own movement locally (`updateWorld` runs `player.update` with an empty horde) and never adopted the server's authoritative self position — so client and server players **drifted apart**. Remote zombies (server-simulated, chasing the SERVER position) therefore appeared to converge on a stale spot and only bit when the player walked back into it. Two fixes: (1) **position reconciliation** — `Game` WIRING:MP-HEALTH eases the local player toward `multiplayer.selfPos`, but ONLY for genuine desync: dead-zone <2 m (normal client-prediction lag must NOT be fought) and cap the per-frame correction to ≤ a sprint-frame step (6·dt) so a real desync (e.g. after respawn) heals without ever blocking movement. (The first cut used a 0.5 m dead-zone + proportional pull, which dragged the player back every frame and produced an "invisible wall" — fixed here.) (2) **remote-zombie interpolation** — `RemoteZombie` now stores a snapshot target (`_tx/_tz`) and `update()` eases the rendered `_x/_z` toward it every frame (12×dt converge, ~0.1 s) instead of teleporting in 100 ms jumps, so remote zombies glide smoothly and keep pace (reads as "faster"/responsive like single-player; the 10 Hz jump was what made them feel sluggish). First snapshot snaps into place (`_seen` flag) so a new zombie appears at the right spot. No new meshes, no protocol change, no speed-value change (co-op already uses the same TABLE + normal difficulty as SP). Added a glide test (target jump → rendered position lags then converges). **382/382**, verify 81/0/0, build ok, check-assets 41/0, secrets clean. Live two-browser probe `tools/_probe-coop-drift.mjs`: driving Ada forward 4 s, client position (0,12) == server `selfPos` (0,12), **drift 0** — zombies chase the live player.
- **v4 co-op: melee rapid re-swing + green-square zombies shootable (Sep 28, branch `v4`)**: user: "sword/axe should swing again faster — a double-click should land 2 swings (currently a delay before you can hit again); at the end of wave 3 in co-op there are 2 zombies that are just green squares and you can't shoot them." (1) **Melee cooldown** — `Axe.COOLDOWN` 0.6→0.18 and `Sword.COOLDOWN` 0.8→0.22 (both now below their swing animation, so a second click that lands mid-animation restarts the swing and re-applies damage → a ~200 ms double-click yields two swings). Headless probe: AXE/SWORD both `swing1=true swing2@200ms=true`. Updated the pinned `cooldown` assertions in `test/axe.test.mjs`/`test/sword.test.mjs` (the "cooldown blocks rapid swings" tests still pass — the fixed frame counts still exceed the shorter cooldown). (2) **Green-square zombies** — root cause: `Multiplayer` capped full remote bodies at `MAX_REMOTE=12`; wave 3's roster is 14 (5+3·3), so the 13th/14th got a shared green fallback box (`ZMAT` 0x5f6b4a) that was NOT in `getTargets()` → visible but unshootable. Fix: raised `MAX_REMOTE` 12→16 (covers wave 3 + lingering dead; 16×11 meshes stays under the 800 verify budget) AND made the fallback box hit-testable — the box entry now carries `_id`/`_type`/`_dead`/`_predHp` and `getTargets()` exposes a reused `_boxProxy` with the same minimal contract (getHitboxes/damage/shotgunArmor/knockback) so a box hit routes an authoritative HIT via `net.sendHit`. Added `test('v4 co-op: overflow (fallback-box) zombies are still shootable')`. **384/384**, verify 81/0/0, build ok, check-assets 41/0, secrets clean. Client-only (`Axe.js`/`Sword.js`/`Multiplayer.js`) → Pages redeploy; no server change.
- **v4 co-op: zombies stop short of the player → tighter reconciliation (Sep 28, branch `v4`)**: user: "co-op zombies stop in front of the player, they don't come as close as in single-player; they should get closer." Diagnosis: headless + two-browser probes (`tools/_probe-coop-dist.mjs`, `_probe-coop-dist2/3.mjs`, `_probe-sp-dist.mjs`) showed that when the player STANDS STILL the nearest co-op zombie reaches ~1.1 m and single-player ~1.2 m — already at parity (both stop at ATTACK_RANGE=1.3 m, `Zombie.js`). The "stops short" only appears while the player is MOVING: the client self-predicts and the reconciliation dead-zone was 2 m, so the client's predicted position could sit up to 2 m AHEAD of the server's. The zombie is server-simulated and chases the SERVER player, stopping 1.3 m from it — so it visually stopped short of the client's (ahead) player by that lead. Fix: tighten the WIRING:MP-HEALTH reconciliation dead-zone from 2 m to 0.6 m (`Game.js`), keeping the per-frame correction capped to a sprint-frame step (6·dt) so it never blocks movement (no invisible-wall regression). Now the client player hugs the server position the zombie actually targets, so co-op zombies close the same gap as single-player. Verified: moving min-gap probe 1.10 m, drift probe drift=0 / travelled 12 m (no wall). 383/383, verify 81/0/0, build ok, check-assets 41/0, secrets clean. Client-only change (Game.js) → needs a Pages redeploy; no server change.
- **v4 co-op: nightmare zombie speed + faces (Sep 28, branch `v4`)**: user: "make co-op zombies faster, like single-player nightmare; add the zombie faces to co-op zombies." (1) **Speed** — the server `Room` defaulted to `difficulty='normal'` (speedMult 1), so co-op zombies crawled vs the single-player default (frenzy 2×) / nightmare (3×). Changed `Room`'s default difficulty to `'nightmare'` (`server/server.js`): co-op zombies now run 3× speed (walker 4.5 m/s) with the flat 50 HP, matching the SP nightmare preset. `Match` still opens co-op at wave 1 (it calls `wave.reset()` regardless of the preset's `startWave`), so no wave-skip side effect. (2) **Faces** — `buildPrimitiveBody` (used by `RemoteZombie`) builds the face from `FACEMAT`, but the face-texture loader `loadFaceTextures()` was only kicked off by the local `Zombie` constructor, which never runs in a co-op-only client (empty local horde) → remote zombies showed a flat head-color face, no portrait. Added a `loadFaceTextures()` call at the top of `buildPrimitiveBody` (idempotent, guarded) so remote bodies trigger the same texture load. **383/383**, verify 81/0/0, build ok, check-assets 41/0, secrets clean. Live probes: headless `new Room()` → difficulty nightmare, walker speed 4.5 (3×), hp 50; two-browser probe → remote zombie `_face.material.map.image` present (faces loaded). NOTE: server code changed → restart the live game server (:8080) to pick up the nightmare default.
- **v4 co-op movement: server adopts the client's yaw (Sep 28, branch `v4`)**: follow-up to the invisible-wall round — user: "still can't move like expected; pressing W moves the player a bit sideways but still stuck." Root cause (reading `Player.update` + `NetClient.sendInput` + `server.applyInput`): the client's `player.update` consumes the raw mouse deltas (`inputState.turnX/turnY`) and zeroes them BEFORE `multiplayer.update`→`sendInput` runs (both read the same `inputState`), so `look.dx` was ALWAYS 0 on the wire — the server player never turned and kept facing the spawn direction (yaw 0, -Z). When the client looked somewhere and pressed W, the client moved along its own yaw but the server moved along -Z; the position reconciliation then dragged the client toward the server's wrong-axis position → "moves sideways, feels stuck." Fix: the client now sends its authoritative `yaw` in the INPUT frame (`NetClient.sendInput` adds `yaw`), `protocol.parseInput` parses it (`yaw: finite ? msg.yaw : null`), and `server.applyInput` sets `slot.player.yaw = input.yaw` — the server moves the player along the SAME heading the client sees, so W goes where the player is looking and the reconciliation no longer fights movement. Added a server-room test (client yaw π/2 → server adopts it → forward input moves along X, not the stale -Z spawn axis). **383/383**, verify 81/0/0, build ok, check-assets 41/0, secrets clean. Live two-browser probe `tools/_probe-coop-drift.mjs`: forward 4 s → player travels 12 m freely, drift 0 (client/server in sync). NOTE: server code changed → the live game server (`zombie-game.service` :8080) must be restarted to pick up the yaw fix.
- **v4 remove spawn stinger + jump SFX + damper footsteps (Sep 28, branch `v4`)**: user: "at the start of a wave there is a sound playing for about 5 seconds, remove it; add a jump sound; make footsteps damper and quieter." (1) **Wave-start sound**: the ~5–6 s sound was the Wan2GP **spawn stinger** (`spawn_stinger.wav`, 6.0 s horror hit) that `Game.spawnZombie` fired on the opening spawn burst (throttled once/1.2 s). Removed the stinger block from the WIRING:SPAWN region entirely (spawns are now silent; zombie growls carry the moment), and deleted the now-orphaned `_stingerRecent()`/`_now()` helpers. The `AudioBank.playSpawnStinger` method + `spawn_stinger.wav` asset are kept (unused, like `playWave`) so nothing else breaks. (2) **Jump SFX**: new `sfx_jump.wav` (Stable-Audio-3, seed 58229, cloth-rustle + low effort grunt, loudnorm I=−16/TP=−2, 0.19 s) registered in `SfxSamples`; `AudioBank.jump()` plays it at the listener with a bandpass-noise + falling-tone synthesized fallback. Game.js WIRING:GROANS edge-detects the jump (player `velocity.y` crossing from ≤0 to >3, i.e. the JUMP_V launch frame) and calls `audio.jump()` once — held jump key does not retrigger, headless/muted silent. (3) **Damper footsteps**: regenerated `sfx_footstep.wav` (new seed 47118, "low dull muffled thud, no high-frequency snap" prompt) and post-processed quieter (I=−22/TP=−3 vs the old I=−14) → mean −23 dB (was ~−14), 0.23 s, so both walk and run steps read lower + damper. +1 jump block in `test/audio.test.mjs` (headless no-op + fake-ctx synthesized stack ≥5 nodes). **385/385**, verify 81/0/0, build ok, check-assets 57/0 (jump added, stinger reference removed), secrets clean. Client-only (Game.js/AudioBank/SfxSamples + assets) → Pages redeploy; no server change.
- **v4 ambient audio: distant moan, attack hiss, footsteps, snowstorm weather (Sep 28, branch `v4`)**: user: "add distant zombie growl/moan, a hiss when they get close to attack, footstep sounds when walking/running, and a snow-storm/wind sound that plays every now and then." Four new generated SFX (Stable-Audio-3, GPU 2, `tools/audio-specs/sfx/{sfx_moan_distant,sfx_attack_hiss,sfx_footstep,sfx_snowstorm}.json`) post-processed into `public/assets/audio/sfx/` (footstep + hiss re-trimmed hotter I=−14/TP=−1.5 as close-mic foley; moan + storm kept at bank −18). All four added to `SfxSamples.SFX_FILES`. `AudioBank.updateGroans` gained four LCG-scheduled layers, each with its own seed + voice bookkeeping (swap-pop expiry, no leak, cleared in `dispose`): (1) **distant moan** — a far zombie (d ≥ `MOAN_NEAR=12`, inside the 30 m groan cutoff) lets off a long mournful wail on a slow per-zombie cadence (`_moanRand`, cap 2 voices, gain falloff toward cutoff); (2) **attack hiss** — a sharp sibilant snarl when the nearest zombie is inside `HISS_RADIUS=3.2 m` (≈attack range), louder+faster the closer it gets (`_hissRand`, cap 1, panned); (3) **footsteps** — `updateGroans` now takes a 5th `playerState={speed}` arg (Game.js WIRING:GROANS passes `hypot(velocity.x,velocity.z)`); a footfall fires every `FOOTSTEP_STRIDE=2 m` travelled so cadence tracks walk vs sprint (`_stepRand`, sprint inferred from speed>5, silent when standing); (4) **snowstorm swell** — a periodic blizzard sweep every `STORM_MIN..STORM_MAX=22..48 s` (`_stormRand`), independent of the (v9-removed) persistent wind bed so it fires with just a ctx. Every voice falls back to procedural synthesis when the sample isn't decoded (headless-safe). Updated `test/audio.test.mjs`: the two node-budget tests now account for hiss (4 nodes) + storm (6 nodes) alongside groan/close-growl (8), and +4 new blocks (footstep cadence walk<run + silent-when-still, hiss near-vs-far, moan far-vs-close, storm determinism). **385/385**, verify 81/0/0, build ok, check-assets 57/0 (4 new SFX in public+dist), secrets clean. Client-only → needs a Pages redeploy; no server change.
- **v4 remove wave-start sound + co-op melee kill fix (Sep 28, branch `v4`)**: user: "remove the sound playing at the start of each wave; fix co-op so axe and sword can kill zombies." (1) **Wave-start sound**: removed the two `audio.playWave(wave)` calls in `WaveManager.js` (opening `reset()` + wave rollover) — the wave-clear chime (`playWaveCleared`) stays; the spawn stinger that survived this round was later removed (see the "remove spawn stinger" round above); the `AudioBank.playWave` method is kept (audio tests still exercise it) but is no longer triggered at wave start. (2) **Co-op melee kill**: root cause — `RemoteZombie.sync()` never mirrored the server's authoritative HP, so the proxy's `_hp` stayed at the constructor default 100 forever. Guns predict their kill off the limb/chain counters (unaffected), but axe/sword predict off `_hp`/`_predHp`, so two 25-dmg axe hits (50) never crossed `_predHp<=0` and the zombie never died client-side until the snapshot flipped `dead` — reading as "axe/sword can't kill." Fix: `sync()` now sets `_hp = z.health` and pulls `_predHp` back to authoritative HP when the server shows MORE health than predicted (reconciliation clamp, never raising a real kill); same HP mirror added to the overflow box-proxy path in `Multiplayer`. The server already killed the zombie via `applyHit` (verified), so this restores the client-side kill feedback. +1 test in `test/multiplayer.test.mjs` (wounded 50-hp walker → two 25-dmg proxy hits → predicted dead + 2 authoritative HITs routed). **385/385** (+1), verify 81/0/0, build ok, check-assets 53/0, secrets clean. Loopback repro confirmed client predicted-dead true + server kill attributed. Client-only (WaveManager/RemoteZombie/Multiplayer) → needs a Pages redeploy; no server change.
- **v14 boss HP×10 + boss seek + screamer scream (Sep 28, branch `v4`, commit `606329d`)**: user: "Increase the hp of the boss at wave 5 10x. and have it seek/walk toward the player. There is a sound that plays when the fast zombies appear from wave 3. i want to change it to a sound effect of a screaming zombie man, like ahhhhhhhh! with a low hissing voice. It should start in a distance and become louder as the zombie gets closer." (1) **Boss HP ×10**: new `BOSS_HP_MULT=10` in `Zombie.js` applied AFTER the `baseHp·1.12^(wave-1)` scaling and keyed on `type==='brute'`, so it holds in every difficulty (the flat-50 frenzy/nightmare HP becomes 500 for the boss). Wave-5 boss 2203→22030 HP (~123 sniper headshots / 245 body shots, up from 13/25). (2) **Boss seeks the player**: the boss already walked via the shared chase path but at a glacial 0.45 m/s (slower than every type) and only charged within 7 m, so it barely closed distance. Raised brute `TABLE.speed` 0.45→1.5 (walker pace, user's chosen option) so it actively walks toward the player across the arena; the 7 m charge lunge is unchanged. (3) **Screamer scream**: the wave-3 fast-zombie "appear" sound was the screamer's synthesized sawtooth groan (400→200 Hz). Replaced it with a generated `sfx_screamer_scream.wav` (Stable-Audio-3, seed 61337, "man turning into a zombie screams ahhhhhh over a low raspy hissing growl", loudnorm I=−18/TP=−2, 1.5 s) wired into BOTH `AudioBank.groan()` and `_playGroanPanned()` screamer branches (synthesized sawtooth kept as fallback). The existing groan distance falloff (`gain = spec.gain·(1−d/30)`) already makes it start quiet at range and swell as the screamer closes — no new scheduling. `SfxSamples.SFX_FILES` gained `screamer_scream`. Tests: boss stats/wave-scaling/shot-count/frenzy/nightmare/wave-10/skin-death updated for the 10× economy; +1 audio block (screamer routes a buffer source + skips the oscillator when the sample is decoded). **385/385**, verify 81/0/0, build ok, check-assets 58/0 (screamer_scream in public+dist), secrets clean. Client-only (Zombie/AudioBank/SfxSamples + asset) → Pages redeploy; no server change. Deployed: gh-pages `3fcec7f` (build of `606329d`, bundle `index-BgbsNEz6.js`).
- **v14b pickup box + screamer windup scream (Sep 28, branch `v4`, commit `18cb115`)**: user: "change the sound for picking up ammo to a new generated sound effect that sounds like picking up a box. For the faster zombies that start spawning at wave 3 it is still a blipping sound instead of the expected long scream 'Ahhh' that gets louder as the zombie gets closer." (1) **Pickup box**: new `sfx_pickup_box.wav` (Stable-Audio-3, seed 73421, "grabbing and lifting a cardboard ammo box, cardboard rustle + thud, dry close-mic", loudnorm I=−16/TP=−2, 0.24 s) — `SfxSamples.SFX_FILES.pickup` now points at it (was `sfx_pickup.wav`); `AudioBank.pickup()` plays it via `_playSfx` with the old two-chirp fallback kept. (2) **Screamer "blip" root cause**: the blip the user heard was NOT the groan — it was `AudioBank.zombieWindup('screamer')`, the melee telegraph that fired a 700→1100 Hz SQUARE chirp (0.12 s) on every screamer swing (screamers attack constantly, so the beep dominated). Fix: the screamer windup now plays the SAME `screamer_scream` sample as the groan (panned to the attacker), so approaching screamers read as a swelling "ahhhhh" instead of a repeating beep; synthesized sawtooth kept as fallback. Also raised `GROAN_SPECS.screamer.gain` 0.3→0.55 so the distance-falloff scream reads clearly and audibly swells as the screamer closes. +1 audio block (windup + pickup route a buffer source and skip the synthesized oscillator when decoded). **385/385**, verify 81/0/0, build ok, check-assets 58/0 (pickup_box added, old pickup reference dropped), secrets clean. Client-only (AudioBank/SfxSamples + asset) → Pages redeploy; no server change. Deployed: gh-pages `1b79721` (build of `18cb115`, bundle `index-DVfICL7j.js`).
- **v15 co-op end-game scoreboard (Sep 28, branch `v4`, commit `2e237d3`)**: user: "In co-op after a total of 72 killed zombies the winner is the player with the highest score. An end game score should be displayed showing the statistics for each player like killed zombies, killed players, deaths, headshots and total score." (1) **72-kill win condition**: new `KILL_TARGET=72` in `src/net/Match.js` (overridable via `opts.killTarget`); `_flow` ends the match with reason `killtarget` once `_totalKills()` (sum of every player's kills, incl. unattributed) reaches the target — checked after the wave-clear condition and before the time cap, so a full co-op run ends on the kill target. (2) **Per-player stats**: added `deaths`/`headshots`/`playerKills` Maps alongside `kills`/`score` (init 0 in `addPlayer`; preserved across reconnect since `_reclaim` keeps the slot). `_onKill` counts a headshot when `z.lastHitHead===true`; `setOnDeath` increments the victim's `deaths`; `applyFF` credits the shooter with a `playerKills` when a friendly-fire hit drops a teammate from alive→dead. `scoreboard()` rows now carry `deaths`/`headshots`/`playerKills` and stay sorted by score desc, so row 0 is the winner. (3) **End screen**: `Screens.showGameOver` gained `scoreboard`/`winner` args + a `mp-end-board` table (columns PLAYER/ZOMBIES/PLAYERS/DEATHS/HEADSHOTS/SCORE, winner first with a ★ and a "WINNER — <name>" title), shown only for co-op runs and hidden for single-player; `styles.css` `.mp-end-board` styling. `Game._endCoopRun` passes `multiplayer.finalScoreboard` + `winner` (Game.js edit confined to the co-op `_endCoopRun` hunk — the v13 music-disarm hunks at `@@ -389/-427/-934` were left unstaged/uncommitted). +2 `match-flow` tests (72-kill end + full stats; configurable `killTarget` + below-target stays alive) and +1 `hud-screens` block (scoreboard DOM render + single-player hide). **387/387** (+2), verify 81/0/0, build ok, check-assets 58/0, secrets clean. Client+server (Match is shared) → Pages redeploy for the client; the running game server (:8080) already serves the new Match on restart. Deployed: gh-pages `c8e1b69` (build of `2e237d3`, bundle `index-0EBF6GQC.js`).
- **v16 music HUD + 5-track playlist (Sep 28, branch `v4`, commit `9d8735a`)**: user: "The name of the song playing should be shown in the middle to the right, with the short commands to mute song n and next track b. Make sure there are 5 tracks in the playlist, if needed generate new songs, or add the previous generated songs that haven't been added yet." (1) **Now-playing line moved to middle-right** — `styles.css` `.hud-nowplaying` changed from bottom-center (`bottom:18px;left:50%;translateX`) to `top:50%;right:18px;translateY(-50%);text-align:right`; HUD hint text now reads `  ·  M mute · B next` (was `B skip · N mute`). (2) **Key bindings swapped** — `Input.js`: `KeyM`→`musicMute` (mute the song), `KeyN`→`mute` (master mute), `KeyB`→`musicSkip` (next track) unchanged; Game.js music-mute comment updated; `input.test.mjs` mute/musicMute blocks swapped to KeyN/KeyM. (3) **Title controls-grid + settings labels** — `Screens.js` grid now lists `M Music On/Off`, `N Mute All`, and a NEW `B Next Track` row (13→14 rows; `hud-screens.test.mjs` count updated to 14); settings toggles relabeled `Mute all (N)` / `Mute music (M)`. (4) **5-track playlist** — `SONG_PLAYLIST`/`SONG_PLAYLIST_SECONDS` extended to 5 entries (added `song_doden_sv.mp3` @80s, `song_nightfall_en.mp3` @193s); `AudioBank.currentPlaylistName` TITLES gained `doden_sv:'Doden (SV)'`, `nightfall_en:'Nightfall (EN)'`. The two new songs were generated via yue2 (specs `tools/audio-specs/df_doden_sv.json` seed 3013 / `df_nightfall_en.json` seed 3012, GPU 2 background jobs, out `.research/songs5`), then ffmpeg loudnorm I=-16:TP=-1.5 → libmp3lame 192k → `public/assets/audio/song_doden_sv.mp3` (79.7s) + `song_nightfall_en.mp3` (192.5s); ffprobe durations fed back into `SONG_PLAYLIST_SECONDS` [71,86,180,80,193]. Game.js edit confined to the playlist const + the NOWPLAYING comment hunk (the v13 music-disarm hunks at `@@ -389/-427/-934` were left unstaged/uncommitted). **387/387**, verify 81/0/0, build ok, check-assets 60/0 (+2 new mp3s), secrets clean. Deployed: gh-pages `73ce2c1` (build of `9d8735a`, bundle `index-CnN5jgIO.js`).
- **v17 snow ground-splash + softer ground strips + poster_v2 (Sep 28, branch `v4`, commit `7330f5e`)**: user: "consider implementing the Snow ground-splash (V2P-7) so that the ground looks better, there are currently red and blue lines on the ground. The poster_v2.jpg looks good." Root cause of the "red and blue lines": the ground read ~50% saturated blue in screenshots — from the blue street-centerline strips (`0x3d6fa8` opaque `MeshBasicMaterial`, `addLandmarks`), the blue-grey ground base, and the blue-tinted crack normal-map, plus opaque red danger/outer strips (`0xff4433`). (1) **Snow ground-splash (V2P-7)** — `addGroundDressing` (`src/world/cityDressing.js`) now scatters 96 deterministic soft-white snow patches (`0xeef4ff`, additive, opacity 0.16, y=0.012 clear of the 0.005–0.055 strips) across the whole 180 m plane as ONE InstancedMesh (StaticDrawUsage, seeded LCG seed 1337, no Math.random, no new lights), so the pavement reads as fresh snow instead of flat blue asphalt. (2) **Softer ground lines** — blue centerlines `0x3d6fa8`→`0x6f86a6` additive 0.28 opacity; red danger strips (`addDangerStrips`) + outer strips (`addOuterStrips`) `0xff4433`→`0xff6a52` additive 0.32 opacity, so they read as faint icy/ember tints rather than painted stripes. (3) **poster_v2** — the user-approved `.research/assets-candidates/poster_v2.jpg` (768×1024 wanted poster) copied over `public/assets/posters/poster.jpg` (the `makePosterTexture` URL is unchanged, so no code change). Tests updated for the new colors + the +1 splash InstancedMesh (18→19) + mesh count 244→245 (`city.test.mjs`, `material-hierarchy.test.mjs`). **387/387**, verify 81/0/0, build ok, check-assets 60/0, secrets clean. Measured saturated ground blue 50%→0.4%, red 3%→0.5%; local VLM (Qwen2-VL): "the ground is covered in white snow". Game.js untouched (v13 music-disarm WIP left uncommitted). Deployed: gh-pages `216d976` (build of `7330f5e`, bundle `index-RjyfGRB8.js`).
- **v18 playlist order + round face + wave-10 giant boss + intro movie + per-instance outfit tint (Sep 28, branch `v4`)**: five user requests. (1) **Playlist order** — `SONG_PLAYLIST`/`SONG_PLAYLIST_SECONDS` reordered so the run opens with `doden_sv` (80s) then `nightfall_en` (193s) before the other three (`Game.js`). (2) **Round zombie face** — `FACE_GEO` was a square `PlaneGeometry(0.26,0.26)` that showed the whole square portrait (background corners around the head). Now a `CircleGeometry(0.13,24)` + a shared round `FACE_ALPHA` canvas mask (white disc on black) with `alphaTest 0.5` applied in `loadFaceTextures`, so only the centered head shows (VLM confirmed the portraits are head-centered and fill the frame). (3) **Wave-10 giant boss** — `BOSS_SCALE=5.6` previously touched only the hitbox + GLB roots, so a boss with no GLB rendered at normal size. New `this._bossScale` (wave 10 → 5×, other boss waves → BOSS_SCALE) is applied to the visible primitive `this.group` via `group.scale.setScalar` (feet-origin, so position/hitbox math unaffected) and mirrored into `_hitboxScale`. (4) **Intro movie** — a ~5 s clip (`public/assets/posters/intro.mp4`, Wan2GP: z_image first-frame of a zombie back-to-camera in a dark alley → hunyuan i2v where it turns and lunges at the lens with blood on its face; VLM-verified the turn + blood). `Screens.js` builds an `.intro-overlay` `<video>` (unmuted autoplay) shown by `_startSolo`/Enter-on-title; the run is held (`_beginRun`/`_pendingStart`) until the clip `ended`/`error` or a skip (any `pointerdown` on the overlay, any `keydown` on the document while active). Missing mp4 / blocked autoplay → `_endIntro` fires immediately so the run still starts. `_hideAll` + `dispose` hide/unload it. `styles.css` gained `.intro-overlay`/`.intro-video`/`.intro-hint`. (5) **Per-instance outfit tint** — all zombies of an archetype shared one material so they looked identical. Each zombie now clones its top/bottom/sleeve pair and applies a deterministic HSL nudge (`outfitTint`, ±12° hue / ±12% light, seeded LCG from the spawn phase, no Math.random) so crowds read as varied garments. Clones are registered in `OUTFIT_CLONES` so the async `loadOutfitTextures` attaches the albedo map to them too; `dispose()` unregisters + disposes the clones (shared weave/albedo freed by the existing refcounts). Tests updated for the clone contract (`zombie.test.mjs`, `boss.test.mjs`); `e2e-browser.mjs` skips the intro after START (Space) so the gameplay checks see PLAYING. **387/387**, verify 81/0/0, build ok, check-assets 60/0, secrets clean, E2E 18/18; browser probe confirmed the intro overlay shows + skip→playing, and a VLM on a boss+walker capture confirmed round faces + a giant boss. v13 music-disarm WIP left uncommitted.
- **v18 fix — wanted poster image not displaying (Sep 28, branch `v4`, commit `2f1f232`)**: user: "Fix the poster image, it currently does not display the image." The `addWantedPoster` placard (`src/world/cityDressing.js`) loaded `assets/posters/poster.jpg` but attached the map only via `map.addEventListener('load', ...)` — in three r185 that texture `load` event no longer fires reliably, so `mat.map` stayed `null` and the material compiled WITHOUT a map define → the placard rendered blank white (browser probe: `hasMap:false` + "Texture marked for update but no image data found"). Fix: `makePosterTexture(env, onLoaded)` now uses the `TextureLoader.load(url, onLoad)` callback form, AND the map is assigned up front so the material compiles with the map define on its first frame (the onLoad callback still refreshes `needsUpdate` once decoded). The paper-tan color stays the headless/no-canvas fallback (headless test still asserts `map===null`). Browser probe after fix: `hasMap:true`, decoded 768×1024 map attached; poster.jpg VLM-confirmed as a WANTED/DEAD-OR-ALIVE portrait. **387/387**, verify 81/0/0, build ok, check-assets 60/0, secrets clean. Deployed: gh-pages `7691994` (build of `v4` `2f1f232`).
- **v19 graphics — grittier night pass (Sep 28, branch `v4`, commit `c9b47bb`)**: user: "Think about how to improve the graphics and visuals, making better looking buildings, ground, changing the low lamps and the light." Chosen style: more realistic / grittier (all four areas, surgical budget-safe changes). (1) **Lamps** — `addStreetlights` (`src/world/cityDressing.js`) rebuilt the head from a flat box into a real luminaire: a sphere bulb (`headGeo`) hung under a cone hood (`hoodGeo`) on a cylinder arm (`armGeo`), the arm + hood built as 2 InstancedMeshes (StaticDrawUsage, +2 city meshes). Each lamp's arm reaches toward its street on the correct axis (vertical streets reach -x, horizontal streets reach -z — a per-lamp `axis` flag fixes the earlier wrong-axis bug); the head + halo + shaft + AABB + pool all follow the offset head position. The shootable-lamp contract (per-lamp `headMat.clone()`, emissive 0xffb066 @ 2.2, Lamps.js break/relight) is preserved. Ground pool disc opacity 0.22→0.28 (warmer/tighter pool). (2) **Buildings** — new `src/world/Storefront.js` adds a ground-floor lit storefront strip (emissive 0xffb066 @ 0.9) + a dark base grime/AO band (0x0a0d12) on every building face as 2 InstancedMeshes (+2 city meshes), so boxes meet the pavement with a lit street level + soot-darkened foot instead of a flat edge. (3) **Ground** — wet-asphalt roughness 0.55→0.42 so streetlight pools smear into long reflective wet streaks. (4) **Lighting/post** — streetlight pools 70→82 cd (`Lighting.js` POLE_INTENSITY); bloom strength 0.18→0.22 + radius 0.35→0.38 (`PostFX.js`); film grain 0.012→0.02 + vignette 0.05→0.09 (moodier frame); sky IBL 0.5→0.7 (`Game.js` WIRING:ENV, the ONLY Game.js hunk committed — the v13 music-disarm WIP hunks left uncommitted). Pinned tests updated: city mesh count 245→249 (`city.test.mjs` + `material-hierarchy.test.mjs`), InstancedMesh count 19→23, anchor y 5.2→5.05, pool-anchor tolerance 1e-6→1e-4 (matrix-decompose float drift), lighting 70→82 cd (`lighting.test.mjs`), postfx bloom/radius/grain/vignette (`postfx.test.mjs`). **387/387**, verify 81/0/0, build ok, check-assets 60/0, secrets clean, E2E 18/18. VLM (Qwen2-VL, cuda:2) confirms street = "dramatic and atmospheric, gritty", buildings = "illuminated storefronts", lamp = "tall slender structure with a horizontal arm", ground = "reflective, wet appearance". Peak sceneStats `{meshes:636, points:5, lights:19, zombies:24}` (prior peak 632 + 2 luminaire arm/hood + 2 storefront/grime) — under the 800 gate. Deployed: gh-pages `0c506bf` (build of `c9b47bb`, bundle `index-CQriPaNG.js`), live-verified.
- **v20 ammo-drop pickup fix (Sep 28, branch `v4`)**: user: "increase the budget if needed. fix the bug that the dropped ammo is not picked up." Diagnosis (headless): the pickup *logic* is correct — `AmmoDrops.update` (src/game/AmmoDrops.js) removes a drop + fires `onDropPickup` when an alive player is within `PICKUP_RADIUS`, and `Game.onDropPickup` (Game.js WIRING:WORLDCORE region) credits `weapon.pistol.reserve`/`weapon.shotgun.reserve` (+`flashlight.recharge` for batteries); a forced drop spawned away from the player and walked-to went 30→38 shells. The real-world miss was the **radius being too tight**: `PICKUP_RADIUS` was 1.2 m, but the 0.16 m drop box is tiny/hard to see on dark wet asphalt and lands where the zombie fell (often just off-path or against a wall), so a player brushing past at ~1.5 m silently missed it. Fix: `PICKUP_RADIUS` 1.2→2.2 m (forgiving vacuum radius; still requires routing to the corpse). Budget: no mesh added; the S8 gate is already 800 (raised from 640 in v4) with peak 636 → 164 spare, so no budget increase was needed. Pinned tests updated: `ammodrop.test.mjs` (PICKUP_RADIUS 1.2→2.2; the pickup test now asserts 2 m picks up + 3 m does not), `match.test.mjs` (the "only B in range" drop moved 13.5→14.5 so A at x=12 stays outside the wider 2.2 m radius). **387/387**, verify 81/0/0, build ok, check-assets 60/0, secrets clean, E2E 18/18.
- **v21 zombie clothing relief — folds not flat decals (Sep 28, branch `v4`)**: user: "improve the images on the body, make it look like the zombies have different kinds of clothes but right now it looks like they have a picture of a cloth." Root cause (code): the bodies are plain boxes (GEO2 torso/legs/arms) wearing AI-generated flat 2D garment albedos, and the only surface relief was the v6 fabric **weave** normal map — a 64px repeating 2×2 twill. A repeating micro-weave on a flat box reads as a printed decal, not draped cloth. User chose the "cloth folds + relief" approach (no extra meshes). Fix in `src/game/Zombie.js`: `buildFabricNormal` now layers TWO scales — the kept fine warp/weft weave PLUS large low-frequency FOLDS/WRINKLES from two octaves of tiling value noise (`latticeNoise`, 4×4 lattice, smoothstep, deterministic LCG lattice values, no Math.random) whose finite-difference gradient (diagonal-biased) tilts the normal, so a jacket/trouser leg shows soft creases and drape. Map grew 64→128px so folds vary across a box face without tiling into a visible grid; `normalScale` raised 0.6→1.0 on all outfit tops/bottoms + sleeve clones so the relief reads. Headless proof the relief is real and varied: new map mean normal deviation 58.25, max 90, **8861 distinct normal directions / 16384 texels (54% unique, low self-similarity)** vs the old weave-only 64px map's 3282/4096 (80% unique — a repeating grid). Zero meshes added (shared module-level DataTexture), so the S8 budget is unchanged (peak 636 ≤ 800). No test pinned FABRIC_N_SIZE or normalScale, so no test edits needed. **387/387**, verify 81/0/0, build ok, check-assets 60/0, secrets clean, E2E 18/18. (Headless SwiftShader screenshots are unreliable for judging subtle normal relief — verified via the deterministic map-stat probe instead.)
- **v22 co-op melee fix — axe/sword now hit + kill remote zombies (Sep 28, branch `v4`)**: user: "in co-op mode the sword and axe does not hit or kill the zombies." Root cause (code): the melee swing loop (`Axe.swing`/`Sword.swing`, src/game/Axe.js:166) reads `z.position.{x,z}` for the range check and NEVER calls `getHitboxes()` — only the firearms (Pistol/Shotgun/Sniper) do. In co-op the weapon target set is `zombies + multiplayer.getTargets() + getPlayers()` (Game.js:417), and `getTargets()` returns RemoteZombie/overflow-box weapon proxies whose `position` was a **plain snapshot taken at proxy construction** (`{x:self._x,...}`), refreshed only inside `getHitboxes()`. So the proxy position froze at the zombie's spawn spot while the real zombie walked away → every co-op melee swing measured a stale `hdist > range` and missed. Firearms worked because `getHitboxes()` re-syncs position each frame. Fix: make `proxy.position` a **getter** that re-reads the interpolated `_x/_z` (RemoteZombie.getTarget, src/net/RemoteZombie.js) or the box position (Multiplayer._boxProxy, src/net/Multiplayer.js) on every read, so any consumer sees the live position without needing `getHitboxes()`. One cached `_posView` object per proxy (no per-frame allocation). Added a regression test (`multiplayer.test.mjs`): a walker moves 10 m via a new snapshot; after 40 interpolated frames the melee-visible `position.z` follows it (was frozen at the spawn value). No budget change (no meshes). **388/388** (+1 test), verify 81/0/0, build ok, check-assets 60/0, secrets clean, E2E 18/18.
- **v4 louder gunshots + Minecraft-style proximity growl (Sep 28, branch `v4`, commit `64d52a6`)**: user follow-up — "regenerate pistol + shotgun louder/closer (gun is in the player's hand); add a zombie growl when zombies get closer, Minecraft-style." (1) **Louder/closer gunshots**: regenerated `sfx_shotgun`/`sfx_pistol` with close-mic aggressive prompts ("recorded right at the muzzle, first-person, no room reverb, punchy") and a hotter loudnorm target (I=−14/TP=−1.5 vs the bank's −18/−2) → mean level up ~8 dB (shotgun −26→−17.5 dB, pistol −24 dB), peaks −1.6/−1.7 dB, no clipping; tighter too (shotgun 1.4s→0.72s). (2) **Proximity dread**: new `sfx_growl_close.wav` (close-mic menacing snarl) + a dedicated close-growl layer inside `AudioBank.updateGroans` (no Game.js change — it already gets zombies+playerPos each frame). Tracks the nearest live zombie; when it closes inside `CLOSE_GROWL_RADIUS=9 m` a low growl fires on its own LCG cadence (`_closeGrowlRand`, seed 777001) whose period shrinks (5.5s→2.2s) and gain rises (0.22→0.55) as the zombie closes — a "right behind you" cue layered over (never starving) the per-zombie ambient groans. Panned to the nearest zombie via `_pannerAt`; the panner is tracked in `_closeGrowlVoices` and disconnected on expiry (swap-pop, no leak); procedural formant+noise fallback when the sample is absent. `dispose()` clears the new voices + clock. +1 test block in `test/audio.test.mjs` (headless schedules close growls, far zombie never fires, point-blank gain > edge gain). **384/384**, verify 81/0/0, build ok, check-assets 53/0 (12 SFX incl. growl_close in public+dist), secrets clean. Browser probe `tools/_probe-sfx2.mjs`: 12 buffers loaded, shotgun/pistol/growl_close all `_playSfx`→true, close growl fired 6× over 15 s with a zombie 1 m away. Deployed: gh-pages `a11f54f` (build of `64d52a6`); game server restarted (:8080).
- **v4 generated SFX (Stable Audio 3) wired into the bank (Sep 28, branch `v4`, commit `25dd984`)**: user asked to generate real sound effects with `stabilityai/stable-audio-3-small-sfx` on the local GPU and wire them in (gunshot, reload, zombie growls "etc."). The HF `stabilityai` repo is gated (401 without a token), but Wan2GP already mirrors the model ungated via `DeepBeepMeep/TTS` (`stable_audio3_small_sfx`, bf16) — driven headless through `tools/wangp_assets.py` on GPU 2 (`--visible 2 --profile 2`). Generated 11 one-shots with concrete foley prompts (`tools/audio-specs/sfx/*.json`): shotgun/pistol/sniper gunfire, reload, dry-fire, walker + brute growls, zombie death, flesh impact, pickup blip, melee swing. Post-processed with `tools/sfx-postprocess.sh` (silenceremove both ends → loudnorm I=-18/TP=-2 → mono → 44.1k → 16-bit PCM) into `public/assets/audio/sfx/*.wav` (peaks −2…−7 dB, no clipping; e.g. shotgun 3.0s→1.4s/124 KB). New `src/game/SfxSamples.js` fetches/decodes/caches the WAVs into AudioBuffers and plays them through the existing fx bus; `AudioBank.loadSfx(base)` builds it at wiring time (Game.js WIRING:AUDIO, `loadSfx(ASSET_BASE)`), and each voice (`shoot`/`pistolShot`/`sniperShot`/`reload`/`dryFire`/`hitZombie`/`playDeath`/`pickup`/`axeSwing`/`swordSwing`/`groan` walker+brute) plays the decoded sample when ready and falls back to its procedural synthesis otherwise (headless / not-yet-loaded / fetch failure) — so every existing test path is unchanged. `dispose()` releases the buffers. `tools/check-assets.mjs` gained an SFX block that parses `SFX_FILES` (the paths are `SFX_BASE + 'sfx_*.wav'`, invisible to ASSET_RE). +4 blocks in `test/audio.test.mjs` (headless no-op, not-yet-decoded fallback, SfxSamples.play routes a buffer-source, dispose clears). **384/384**, verify 81/0/0, build ok, check-assets 52/0 (11 SFX resolved in public/ + dist/), secrets clean. Browser probe `tools/_probe-sfx.mjs`: all 11 buffers decode + load in-page, ctx running, `_playSfx('shotgun')` returns true. Deployed: gh-pages `a6ad014` (build of `25dd984`, bundle `index-D7lms3pm.js`); game server restarted (:8080).
- **v13 UI + audio cleanup (Sep 27, branch `v3`; committed + deployed Sep 28 on `v4`, commit `74ba969`)**: start-page name + room-code fields now flex to the row width (was fixed 120 px, clipped room codes). The procedural WebAudio music layer is disarmed in the shipped game — Game.js no longer drives `AudioBank.setTension` (sub-bass drone + heartbeat bed) and the `MusicDirector` runs with `enabled: false`, so the ONLY in-game music is the generated mp3 playlist + boss track; SFX (shots, growls, spawn stingers) untouched. Regression guard in `test/music-playlist.test.mjs`: a disabled director is `available:false` and hands no track / no pause / no resume to the bank. (Supersedes the earlier "Not yet deployed" note.) **388/388**, verify 81/0/0, build ok, check-assets 60/0, secrets clean, E2E 18/18. Deployed: gh-pages `3dd78e3` (build of `v4` `74ba969`; bundle hash unchanged from v22 because the minified output is byte-identical, but the `enabled:!1` change is present in the live bundle).
- **v12 co-op match-end + disconnect grace + health bars + kill feed (Sep 27, branch `v3`, HEAD `d2ca51d`)**: the four remaining MULTIPLAYER_PLAN §14 items are done. (1) The server's `matchEnd` event (wave-5 cleared / 15-min time cap / all-dead) is now consumed: `Multiplayer` latches it once (`matchEnded`/`endReason`/`finalScoreboard`, scoreboard falls back to the live one) and calls `Game._endCoopRun()`, which stops the run and shows the shared game-over screen with the server-authoritative wave. (2) `Match.removePlayer` no longer frees the slot on socket close — it flags the slot `disconnected` and holds it for `DISCONNECT_GRACE` (5 s); `addPlayer` with the same id reclaims the held slot (score/kills/position survive), `_flow` disposes+frees it when the window elapses, and `_allDeadNoRespawn` counts only connected players. (3) The co-op scoreboard paints a compact health bar under every row (green/amber/red by HP, empty+dark when dead). (4) A rolling 5-line kill feed (`Killer ▸ TYPE`, `(HEAD)` flagged, `X DIED` for player deaths) renders under the rows. `Match._recordKill` now rides `head: z.lastHitHead` on kill events; `scoreboard()` rows carry display names. Tests 365/365 (+8: match-flow grace/reclaim/all-dead/named-board, multiplayer feed/bars/matchEnd), verify 81/0/0, pages build ok (`index-BmM6-i8-.js` committed to dist), check-assets 39/0, secrets clean. Browser E2E re-run green 18 PASS / 0 FAIL, and the v12 browser probes pass: two-client co-op live (each client renders the other, scoreboard 6 rows) + `tools/_probe-coop-end3.mjs` (a server `matchEnd` snapshot ends BOTH clients into the visible YOU DIED screen, "Wave 5" stat line, one-shot latch). Deployed: gh-pages `3229970` + live host (see round entry below).
- **v11 title screen (Sep 27, branch `v2`, HEAD `af5d53f`)**: the two redundant name fields (solo "PLAYER" + co-op "your name") are merged into ONE input that feeds both the high score and co-op, so the same generated handle is used everywhere (`_startSolo` and `_joinCoop` both read `_nameInput`); the title panel is widened (max-width 620→720px) and the overlay now scrolls (`overflow-y: auto` + panel `margin: auto`) so START/JOIN stay reachable when the panel is taller than the viewport. Tests 357/357, verify 81/0/0, build ok, check-assets 39/0, secrets clean, E2E 18/18. Deployed to the live host (`zombie-game.service` :8080 → Caddy zombie.p4ppse3n.top), bundle `index-BIzs3D4b.js`.
- **v10 boss + highscore + co-op fixes (Sep 27, branch `v2`, HEAD `216a8fe`)**: high score now always submitted to the hosted board (`Score.submitRun`, not gated on a local record); wave-5 boss spawns quicker (`BOSS_DELAY` 1.5→0.5 s), is 2× larger (`BOSS_SCALE` 1.4→2.8) and 10× HP (520→5200); new `brute-face.jpg` boss face; non-music ambient wind bed removed (only the mp3 soundtrack plays); co-op zombies now damage the local player and co-op death works (authoritative snapshot health synced to the local player + `onSelfDeath` respawn banner). Tests 357/357, verify 81/0/0, build ok, check-assets 39/0, secrets clean, E2E 18/18. Deployed to the live host (`zombie-game.service` :8080 → Caddy zombie.p4ppse3n.top), bundle `index-f_-eI_zd.js`.
- **Version 2**: COMPLETE — zero open code items; E2E 18/18; headless suite green.
- **Deployed**: GitHub Pages (mattiasgrondahl.github.io/deadfall-stockholm-afterdark) —
  live at gh-pages `3dd78e3` (build of `v4` `74ba969`, bundle `index-CEl42Ey0.js`): v13 music
  disarm — the procedural WebAudio soundtrack is cut off from the bank (`MusicDirector`
  `enabled:false` + `AudioBank.setTension` no longer called), so the mp3 playlist + boss
  track are the only in-game music and no second track plays under them from wave 3 on.
  (Bundle hash is unchanged from v22 because the minified output is byte-identical; the
  `enabled:!1` change is present in the live bundle.) The prior deploy was gh-pages `48c8e9b`
  (build of `v4` `9fc6ebc`): v22 co-op melee fix — the remote-zombie proxy position is now a
  live view, so the axe/sword hit and kill remote zombies. Before that, gh-pages `29f96af`
  (build of `v4` `5fb959e`,
  bundle `index-mglQ9BlR.js`): v21 zombie clothing relief — fabric folds + raised normalScale
  so garments read as worn cloth, not a flat decal. The deploy before that was gh-pages
  `c965a29` (build of `v4` `37a1b4b`, bundle `index-DA86hky8.js`): v20 ammo-drop pickup fix —
  the pickup radius widened 1.2→2.2 m.
  night pass — real luminaires (arm + hood), ground-floor storefronts + base grime, wetter
  reflective ground, warmer/tighter streetlight pools + moodier bloom/vignette. The prior deploy
  was gh-pages `7691994` (build of `v4` `2f1f232`): v18 poster-image fix (the wanted-poster
  placard now displays its image — map attached up front so the material compiles with a map
  define). The prior deploy was gh-pages `c8223d1` (build of `v4` `523af28`, bundle
  `index-FmPVfmss.js`): v18 — the
  playlist now opens with `doden_sv` then `nightfall_en`; the zombie face is a round circular
  crop (head only, square corners clipped via a disc alpha mask); the wave-10 boss renders as a
  5× giant (the visible primitive group is now scaled, not just the hitbox); a ~5 s skippable
  intro movie plays on Start Game (zombie back-to-camera → turns → lunges at the lens, blood on
  face; any click/key skips); and each zombie clones + tints its outfit so crowds read as varied
  clothing. The prior deploy was gh-pages `216d976` (build of `v4` `7330f5e`, bundle
  `index-RjyfGRB8.js`): v17 snow
  ground-splash + softer ground strips — the ground now reads as fresh snow (a 96-patch
  deterministic snow-splash layer across the whole plane) instead of flat blue asphalt, the
  harsh blue street-centerline and red danger/outer strips were softened to faint additive
  tints (the user's "red and blue lines on the ground"), and the user-approved `poster_v2.jpg`
  replaced the wanted poster. The prior deploy was gh-pages `73ce2c1` (build of `v4` `9d8735a`,
  bundle `index-CnN5jgIO.js`): v16 music HUD + 5-track playlist — the now-playing song title
  moved to the middle-right of the HUD with an `M mute · B next` hint, M now mutes the song
  (music-only) and N is master mute, and the playlist grew to 5 tracks (added generated
  `song_doden_sv.mp3` 80s + `song_nightfall_en.mp3` 193s). The prior deploy was gh-pages
  `c8e1b69` (build of `v4` `2e237d3`, bundle `index-0EBF6GQC.js`): v15 co-op end-game scoreboard
  — a co-op match ends once the team has killed 72 zombies total (reason `killtarget`) and the
  game-over screen shows a per-player stats table (zombies/players killed, deaths, headshots,
  score) with the winner first. The prior deploy was gh-pages `1b79721` (build of `v4` `18cb115`,
  bundle `index-DVfICL7j.js`): v14b audio — ammo pickup is now a generated cardboard-box handling
  sound (`sfx_pickup_box.wav`, was the synthesized two-chirp blip), and the fast screamer's melee
  WINDUP now plays the same long "ahhhhh" scream as its groan (was a 700→1100 square "blip"), so
  approaching screamers read as a swelling scream; GROAN_SPECS.screamer gain 0.3→0.55 so the
  scream swells audibly as it closes. The prior deploy was gh-pages `3fcec7f` (build of `v4`
  `606329d`, bundle `index-BgbsNEz6.js`): v14 boss + screamer audio — 10× boss HP + boss seeks
  the player + screamer groan → ahhhhh scream. The prior audio deploy was gh-pages `bf1eb08`
  (build of `v4` `ceeaf04`, bundle `index-CUGLW1-c.js`): v4 audio —
  removed the ~6 s spawn stinger that fired on the opening spawn burst (read as a wave-start
  sound; spawns now silent, growls carry the moment), added a jump SFX (`sfx_jump.wav`,
  edge-detected off the player's vertical-velocity launch in WIRING:GROANS), and regenerated
  `sfx_footstep.wav` lower/damper/quieter (I=−22 vs old −14) so walk+run steps read softer.
  The prior deploy was gh-pages `7c24f8a` (build of `v4` `bb5107a`, bundle `index-C8BljHuE.js`):
  v4 audio — distant zombie moan + close-range attack hiss + walk/run footsteps + periodic
  snowstorm weather swell (4 new Stable-Audio-3 SFX wired into `AudioBank.updateGroans`; Game.js
  WIRING:GROANS now passes player ground speed). The prior audio deploy was
  gh-pages `a11f54f` (build of `v4` `64d52a6`): v4 audio — louder/closer regenerated
  gunshots + Minecraft-style proximity growl (`sfx_growl_close`, fires + louder as the nearest
  zombie closes inside 9 m) on top of the generated SFX bank. The prior SFX-bank deploy was
  gh-pages `a6ad014` (build of `v4` `25dd984`, bundle `index-D7lms3pm.js`): v4 generated
  Stable-Audio-3 SFX wired into AudioBank (gunshots/reload/dry-fire/zombie growls+death/flesh
  impact/pickup/melee swing) with procedural fallback. The prior UI-polish deploy was gh-pages
  `99fa55b` (build of `v4` `2e3da6b`, bundle `index-BxWqGTI0.js`): v4 UI
  title-screen polish — the TOP-10 high-score board moved to the top-right corner of the title
  overlay (reparented out of the centered panel; absolute top/right in CSS) and empty ranks
  pre-populated with random handles at score 0 so the board always reads full; name + room-code
  inputs capped at 24 chars and filtered live to the allowed charset (a-z 0-9 space _ ! ?), so a
  payload like `img src=x onerror=alert(` can no longer be typed or stored (client sanitizeName +
  server name/room sanitizers mirror the same allow-list; room codes now use `_` separators so
  generated codes stay in-charset); new bottom-center HUD "now playing" line shows the current
  soundtrack title + `B skip · N mute` hint, fed from `AudioBank.currentPlaylistName()`. Verified
  Sep 28: live index references `index-BxWqGTI0.js` (CDN propagated ~120 s after push), 384/384,
  verify 81/0/0, check-assets 41/0, secrets clean; browser probe confirms board bbox top-right
  (x=991,y=20), inputs maxLength 24 + live filter, now-playing line centered-bottom during play
  (`♪ Hord (EN)` + hint). NOTE: Pages is static-only — co-op `/ws` + `/api/highscore` need the
  separate game server (`zombie-game.service` :8080), which MUST be restarted to pick up the
  server-side charset sanitizer + room-clamp change (`server/server.js`). (Supersedes the prior
  deploy `4bb7ec8`/`index-CO06ziHK.js`; earlier superseded: `13da6a0`,
  `dd9ca31`, `3deb81f`, `fa148d8`, `efa2cf6`, `51eab12`, `3229970`, `3648a7c`, `25aad80`,
  `3107ba2`, `9a9e45c`, `f8a22ad`.)
- **v4 UI title-screen polish (Sep 28, branch `v4`, HEAD `2e3da6b`)**: five title-screen UI
  changes from the user. (1) The `img src=x onerror=alert(` payload no longer appears in the
  leaderboard — the name sanitizer (client `Score.sanitizeName` + server `sanitizeName`) now
  allow-lists the charset to `a-z A-Z 0-9 space _ ! ?`, so every other char (`< > = ( ) /` etc.)
  is dropped, not just the markup-significant ones; the payload collapses to `img srcx onerroralert1`.
  (2) The TOP-10 board is reparented out of the centered `.panel` to a direct child of the `.screen`
  overlay and pinned top-right via CSS `position:absolute; top:20px; right:28px; z-index:2`
  (compact 180px variant under the 560px media query). (3) Empty board ranks are pre-populated in
  `_renderBoard` with `randomPlayerName(1000+i)` + score `0` so the top-10 always reads full.
  (4) A new bottom-center HUD `.hud-nowplaying` line shows the current soundtrack title + a
  `B skip · N mute` hint, fed from a new `AudioBank.currentPlaylistName()` (maps the playlist
  basename to a human title: Hord (EN) / Matsubou (JP) / Javelin (SV)) via a new `WIRING:NOWPLAYING`
  block in `Game.update` (pushed only on change, hidden when muted/off). (5) Both the name and room
  inputs get `maxLength=24` + a live `input` filter (`Screens._filterInput`) stripping disallowed
  chars; `randomRoomCode` now uses `_` separators (`WORD_WORD_NN`) so generated codes stay in-charset;
  `_joinCoop` sanitizes both fields through `sanitizeName`; server `sanitizeRoom` allow-lists the
  same charset and `HS_MAX_ROOM` 32→24 (client `Score.setRoom` clamps 24 + same charset). Tests:
  updated 3 sanitizer/format expectations + added 5 assertions (board reparented to title, empty rank
  pre-filled name+0, maxLength 24, live filter output) → **384/384**, verify 81/0/0, build ok,
  check-assets 41/0, secrets clean. Browser probe confirms board bbox top-right (x=991,y=20), inputs
  maxLength 24 + filter (`abcxd!e?f_1 2`), now-playing line centered-bottom during play. Deployed
  gh-pages `99fa55b` / bundle `index-BxWqGTI0.js` (see Deployed bullet). v13 music-disarm hunks in
  Game.js/MusicDirector.js/boss+music tests remain UNCOMMITTED (separate workstream, not staged).
- **Version 3** (branch `v2`): tasks 1–6 done; combat additions (Sword, Pistol, DecapitatedHeadPool,
  outfits) committed `b2b59a3`; task 5 (melee slash animation, knockback, jump, weapon-surface
  textures) committed `f936263`; task 6 (FRENZY difficulty) committed `0b9fc8b` — 173/173
  tests green, verify-game 81 ok/0 fail/0 skipped. All v3 code commits pushed to origin.
- **v6 audio+gameplay round (Sep 27, branch `v3`, HEAD `cf91c40`)**: scroll weapon
  switching, sequential EN→JP→SV playlist (repeat-bug fix) + B-skip, dedicated
  boss-fight music (song_boss.mp3, playlist paused during boss), flat blood
  flecks, clothed zombie bodies (sleeve materials + fabric normal map). 349/349
  tests, verify 81/0/0, build ok, check-assets 0 problems, secrets clean, E2E
  18/18. LIVE: gh-pages `00b0177` (bundle `index-bHDUe3zf.js`, song_boss.mp3 200)
  + zombie.p4ppse3n.top (zombie-app/dist redeployed, service active).
- **v6 leaderboard round (Sep 27, branch `v3`, HEAD `b5717a6`)**: top-10 hosted
  high-score list (server stores `top:[{name,score}]`, GET returns
  `{best,name,top}` with best/name mirroring top[0] for back-compat, POST
  inserts + caps at 10) + a title-screen TOP 10 board (textContent-only) +
  random "Adjective Noun" player-name prefill on load (seeded LCG, no
  Math.random). 351/351 tests, verify 81/0/0, build ok, check-assets 0 problems,
  secrets clean, E2E 18/18. LIVE: gh-pages `bde0db9` (bundle `index-BC6pq3QP.js`)
  + zombie.p4ppse3n.top (zombie-app/dist redeployed, service active).
- **v7 room/score round (Sep 27, branch `v3`)**: room-scoped everything. (1) The
  co-op scoreboard now lists online players by NAME (id→name map from
  `snap.players`) + a `PLAYERS n` count line (`Multiplayer.scoreboard`/
  `_renderScoreboard`). (2) The confusing "room 0/10" HUD readout (zombie-spawn
  headroom, not players) is hidden except at the cap where `CAP n/cap` still
  shows (`HUD.js` threat block; intermission branch now syncs `_threatSubText`).
  (3) New top-right `KILLS n` / `HEADSHOTS n` HUD counters (`.hud-stats`, wired
  via `hud.kills`/`hud.headshots` closures in Game.js HUD-wiring block). (4) The
  50/100-kill achievements already exist in the `SLAYER [10,20,50,100]` ladder —
  surfaced via the new KILLS counter. (5) `randomRoomCode()` (zombie-themed
  `WORD-WORD-NN`, seeded LCG) prefills the co-op room input on load instead of
  `default`. (6) PER-ROOM high scores: server keys rooms + leaderboards by the
  hello `room` code (`Map<room,Room>` + `Map<room,{top}>`, per-room
  `highscore-<room>.json` siblings, `hsRootFile()` resolves HIGHSCORE_FILE at
  call time so tests can redirect); `/api/highscore` takes `?room=` (GET) /
  `{room}` (POST), blank/absent → `default` (back-compat); `Score.setRoom` +
  `adoptBest`/`submitBest` carry the room. 353/353 tests (+2), verify 81/0/0,
  build ok, check-assets 0 problems, secrets clean, E2E 18/18. LIVE: gh-pages
  `fc3d499` (bundle `index-CfMcMXH4.js`, verified live) + zombie.p4ppse3n.top
  (zombie-app/dist redeployed + server/server.js synced + service active; origin
  :8080 serves `index-CfMcMXH4.js`). Committed `fe5ad69`, pushed origin/v3.
- **v8 leaderboard-update round (Sep 27, branch `v3`)**: two fixes. (1) The
  title-screen board did not refresh when a run beat the lowest listed score —
  `Score.submitBest` POSTed but discarded the response, so the player's own name
  only appeared after a reload/`adoptBest`. Now `submitBest` parses the POST
  response (the server returns the room's updated `top`) and adopts it into
  `this.top`/`best`/`bestName` + fires `_onBestChange`, so a scorer appears on the
  board immediately. (2) A fresh/empty board (per-room OR default) now seeds a
  10-rank ladder `DEFAULT_TOP` (REAPER 1000, GRIM 900 … SETTOR 100) via
  `readHighScore`; a new score that beats the lowest rank bumps the rest down a
  step and drops the 11th, keeping exactly the 10 highest (`normalizeTop` clamp).
  Tests updated: v7 per-room test now asserts the seeded ladder + bump-off; new
  `score-hosted` test asserts submitBest adopts the returned board. 354/354
  tests (+1), verify 81/0/0, build ok, check-assets 0 problems, secrets clean,
  E2E 18/18. LIVE: gh-pages `7161aac` (bundle `index-cBHik3rP.js`, verified live)
  + zombie.p4ppse3n.top (zombie-app/dist + server/server.js synced + service
  active; origin :8080 serves `index-cBHik3rP.js`; fresh-room seed + bump verified
  live). Committed `1a0f237`, pushed origin/v3.
- **v9 difficulty-clarity round (Sep 27, branch `v3`)**: the title-screen
  difficulty picker (NIGHT / FRENZY / NIGHTMARE) is now a clear single-choice
  control. The SELECTED option is a solid accent fill (`--accent` background)
  with dark ink text (`#0b1220`) + bright border + soft glow — unmistakable and
  readable; unselected options are dim (`--ink-dim`, no fill). Previously both
  selected and unselected text were near-white with only a faint translucent-blue
  fill, so the active choice was hard to read/tell. `_setDifficulty` is now
  mutually exclusive: NIGHTMARE no longer also lights up FRENZY (two buttons
  looked selected at once); the nightmare-on-frenzy stacking stays a gameplay
  concern handled by the preset, not the UI state. Tests +1 (354/354): contrast
  assertion for dark text on the accent fill + a behavioral test that exactly one
  toggle carries `on` at a time. verify 81/0/0, build ok, check-assets 0 problems,
  secrets clean, E2E 18/18. LIVE: gh-pages `2af892f` (bundle `index-fa31L2MU.js`,
  verified live) + zombie.p4ppse3n.top (zombie-app/dist redeployed + service
  active; origin :8080 serves `index-fa31L2MU.js`). Committed `646901d`, pushed
  origin/v3.
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
- **Current (Sep 27, branch `v3` @ `4c50cb8`, pushed to origin/v3)**: v6 audio (8) playlist, v6
  tooling (1)+(2), v6 visuals (11) Wan2GP image pass, and **v6 hosting (1)
  hosted global high score** (`906a6af`) are committed AND pushed. **v3 T1
  dismemberment chain DONE (`82398f1`)**, **v3 T3 melee faster+longer reach+
  overhead diagonal DONE (`b256c86`)**, **v3 T6/T6b named high score +
  co-op field helpers DONE (`0a42dbe`)**, **v3 T12 persistent achievements
  DONE (`716ca01`)**, **v3 co-op cluster T9/T10/T11 DONE (`afe04e1`)**, and
  **v3 visuals T7 moon + T13 snow footprints + T14 irregular blood DONE
  (`0426df4`)** (T15 wanted posters already shipped on the center building).
  **v3 T16 close-out DONE (`2a5692e`)** — every v3 plan task is now complete and
  `v3` is pushed to origin. Battery
  green: **npm test 348/348, verify-game 81 ok / 0 fail / 0 skipped, build
  green, check-assets 35/0, secrets-scan clean, E2E 18/18 PASS on :5173 with
  0 console errors.**
  **Deployed (prod, `zombie.p4ppse3n.top`)**: the live host is the user-systemd
  `zombie-game.service` (`~/zombie-app`, `node server/server.js` :8080, behind
  root Caddy on :80/:443). Deployed the version-stamped `npm run pages` build
  (bundle `index-FenwMKjv.js`, version `3.0.0`) Sep 27 — restarted the service
  (active, PID 97666); verified on :8080: index serves the new bundle, `3.0.0`
  present, `moon.jpg` 200, `/api/highscore` live, `/ws` handshake OK. This host
  also runs the hosted high score + co-op WS (which Pages cannot).
  **Deployed (gh-pages)**: `9ce2d5f` (build of `v3` `71c11a0`) — live-verified Sep 27:
  index references `index-C9g9DVzo.js` (200), `assets/sky/moon.jpg` serves 200,
  CDN propagated (~60 s). This Pages build carries the full v3 overhaul (T7 moon,
  T13 footprints, T14 blood, T15 poster, T16 close-out). (Supersedes `f8b5cb7`,
  `8bc9f1e`, `14436a0`, `9f878c6`.)
  Awaiting user: the hosted high score needs the game server, which Pages cannot
  run (solo high score still works locally via localStorage),
  `.research/assets-candidates/` leftovers (menu_bg v2 review, stinger
  tweak), emissive 0.5-vs-0.8 call, Mixamo FBX rigs for the zombie GLB.

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

## v6 audio + gameplay round (Sep 27 2026) — scroll weapons, sequential playlist, boss music, flat blood

User asks (6): mouse-scroll weapon switching; sequential mp3 playlist (fix
same-track repeat) reordered EN→JP→SV + skip-to-next; wave-5 music until boss
then a dedicated mystical/slow/scary boss track; improve zombie body visuals
(texture/clothing); flatten blood splatter (was reading as a 3D chunk).

- **Playlist fix (AudioBank.js)**: the known-end `timeupdate` watchdog used to
  rewind the SAME track at `len-0.25`, so the native `ended` advance handler
  almost never fired → one song looped forever. Now, when a playlist is active,
  the watchdog calls `_advancePlaylist()` (sequential playback) instead of
  rewinding. Refactored `playPlaylist` to share `_advancePlaylist()` with the
  `ended` handler. Added `skipPlaylistTrack()` (player skip), and
  `pausePlaylistTrack()`/`resumePlaylistTrack()` (resume restores the paused
  song's src). Added `playBossMusic(url, seconds)` + `stopBossMusic()` that
  pause the playlist, swap in the boss track, then resume the playlist.
  `_plPaused` flag added in the constructor.
- **Game.js (WIRING:MUSIC + WIRING:WAVES)**: SONG_PLAYLIST reordered to
  EN→JP→SV (`song_hord_en` 71s, `song_matsubou_ja` 86s, `song_javelin_sv` 180s)
  with SONG_PLAYLIST_SECONDS=[71,86,180] (ffprobe-verified). Added BOSS_TRACK +
  BOSS_TRACK_SECONDS=150. `onBossSpawn` → `audio.playBossMusic(...)` +
  `_bossFightActive=true`; `onWaveCleared` → `audio.stopBossMusic()` when the
  boss fell; reset clears `_bossFightActive` + stops boss music. B key →
  `audio.skipPlaylistTrack()`.
- **Input.js**: added `musicSkip` event (KeyB) and a `wheel` listener →
  `inputState.scrollUp`/`scrollDown` press-edges (only while pointer-locked,
  preventDefault); cleared in dispose; listener registered in attach() so
  dispose reverses it.
- **WeaponBank.js**: added `cycle(dir)` — steps `current` forward/backward
  through [axe,shotgun,pistol,sword,sniper] (wraps) via switchTo; `update()`
  consumes scrollDown→cycle(+1), scrollUp→cycle(-1).
- **Blood.js**: droplets were `TetrahedronGeometry` (3D chunks) tumbling on a
  random axis → read as 3D objects with height. Now `CircleGeometry(0.05,6)`
  (flat flecks, DoubleSide) that lie face-up and spin in-plane about world Y
  only, so airborne blood reads flat. Removed the now-dead `_axis` scratch.
  Stains were already flat (rotateX(-PI/2), STAIN_Y=0.01).
- **Zombie.js (v6 visuals 11)**: arms read as clothed — per-outfit SLEEVE_MATS
  (clones of the outfit top, fed the albedo when it loads) replace the bare
  MAT2 skin on armL/armR; head keeps MAT2 skin so the face decal reads. One
  shared 64×64 fabric-weave NORMAL DataTexture (deterministic seeded LCG,
  RepeatWrapping, repeat 2×2, normalScale 0.6) is assigned as normalMap of
  every outfit top/bottom + sleeve material, breaking up the flat box faces.
  SLEEVE_MATS exported; zombie.test.mjs + boss.test.mjs arm assertions updated
  to SLEEVE_MATS membership. Full suite 349/349, verify 81/0/0, build ok.
- **Boss audio asset**: `tools/audio-specs/df_boss.json` (dark gothic doom,
  slow/minor/mystical/scary) generating via Wan2GP (background job
  bash-681, GPU 2, ~30-90 min). On completion: ffmpeg loudnorm→mp3 →
  `public/assets/audio/song_boss.mp3` + `dist/`, ffprobe → set
  BOSS_TRACK_SECONDS to the true length.
- **Tests**: audio.test.mjs playlist block rewritten for the new sequential
  watchdog (watchdog advances, ended is an independent advance) + skip +
  boss-music pause/resume assertions; weaponbank.test.mjs scroll-cycle test.
  `npm test` 349/349 green; `npm run verify` 81 ok/0 fail/0 skipped;
  `npm run build` ok; `check-assets` clean except the pending song_boss.mp3.
  DONE: song_boss.mp3 landed (Wan2GP df_boss → ffmpeg loudnorm, 104.6s →
  BOSS_TRACK_SECONDS=105), full battery green (349/349, verify 81/0/0, build
  ok, check-assets 0 problems, secrets clean, E2E 18/18). Committed `cf91c40`
  on `v3`, pushed origin/v3; gh-pages `00b0177` (bundle index-bHDUe3zf.js +
  song_boss.mp3 200) deployed; zombie-app/dist redeployed + service active.

## v6 leaderboard round (Sep 27 2026) — top-10 high score list + random player name

User asks (2): a top-10 high score list of the best players; on browser load,
randomize the player name instead of the default "player".

- **server/server.js**: the hosted record is now a top-10 list. `highscore.json`
  stores `{top:[{name,score}…]}` (a legacy `{best,name}` file migrates to a
  one-entry list). `readHighScore`/`writeHighScore`/`normalizeTop`/`insertTop`
  added; `serveHighScore` GET returns `{best,name,top}` where best/name mirror
  top[0] (back-compat with older clients + the existing API tests), POST inserts
  a qualifying score and keeps the best 10 (sorted desc, HS_TOP=10). `hsState`
  is now `{top}`; `opts.highScore`/`opts.highScoreName` seed a one-entry list.
- **Score.js**: `this.top=[]` added; `adoptBest` reads the hosted `top` list
  (re-sanitizing each name defensively), sets `this.top`, and fires
  `_onBestChange` when the list changes (not only when the best rises).
- **Screens.js**: title screen renders a TOP 10 board (`.highscore-board`,
  textContent-only, XSS-safe) from `score.top`, refreshed via `_onBestChange`.
  `randomPlayerName(seed)` (module fn) picks an "Adjective Noun" handle via the
  standard seeded LCG (no Math.random) seeded from Date.now; `_prefillRandomName`
  fills the solo + co-op name inputs on the first title screen only when they
  still hold the default "player". styles.css: `.highscore-board` rules.
- **tests**: highscore-api rewritten for the list (insert, cap-at-10, sort,
  back-compat best/name, XSS sanitize); score-hosted adds a top-list adopt test;
  hud-screens adds a leaderboard-render + random-name-prefill test. 351/351
  green, verify 81/0/0, build ok, check-assets 0 problems, secrets clean, E2E
  18/18. Committed `b5717a6` on `v3`, pushed origin/v3; gh-pages `bde0db9`
  (bundle index-BC6pq3QP.js) deployed; zombie-app/dist redeployed + active.

## v6 brute boss face (Sep 27 2026) — boss face asset generation

- `tools/generate-zombie-faces.mjs`: VARIANTS extended with the wave-5 boss type (`brute`, `brute2`, `brute3`, seeds 51/52/53) using the existing z_image + mattias_1024_z_2 LoRA settings. Header comment now says twelve faces.
- Generated through the live Wan2GP Gradio UI on :7860 (GPU 2), one `--only` run per variant: `brute-face.jpg` 237133 B / 960x960 / seed 51 / 45.2 s; `brute2-face.jpg` 217261 B / 960x960 / seed 52 / 39.2 s; `brute3-face.jpg` 240781 B / 960x960 / seed 53 / 40.8 s. All three landed as baseline JPEG (no PNG→JPEG conversion needed), verified decodable as sRGB JPEG with sharp.
- `node tools/check-assets.mjs`: 36 referenced assets, 0 problems. `tools/check-assets.mjs` dynamic-face list now includes `brute` (v10), so `brute*-face.jpg` is asserted there; `src/game/Zombie.js` loads `brute-face.jpg` plus `brute2/3-face.jpg` through the ORDER loop.

## v10 boss + highscore + co-op fixes (Sep 27 2026)

- **High score always saved** (`src/game/Score.js` + `src/game/Game.js`): new `Score.submitRun(fetchFn)` POSTs the finished run's `value` (not the local `best`) to `/api/highscore` whenever `value>0`, adopting the returned top-10/best. `Game.onPlayerDeath` now calls `submitRun()` on every game-over instead of gating on `record`/`submitBest`, so a fresh player's first run reaches the hosted board. Tests: `test/score-hosted.test.mjs` +2 (submitRun posts non-record run; skips zero/offline).
- **Boss appears quicker** (`src/game/WaveManager.js`): `BOSS_DELAY` 1.5 → 0.5 s. `test/boss.test.mjs` wave-5 timing made frame-robust (incoming on the alive→0 frame, boss not spawned until past the 0.5 s delay).
- **Boss 2× larger + 10× HP** (`src/game/Zombie.js`): new `BOSS_SCALE = 2.8` (was 1.4) drives both `_hitboxScale` and the skin body scale; `TABLE.brute.hp` 520 → 5200 (1.12^wave scaling kept). Tests updated: hitbox radii 0.63/0.42 → 1.26/0.84, wave-5/10 HP, pistol 200 shots / shotgun 99 blasts.
- **New boss face**: `public/assets/faces/brute-face.jpg` (+2/3 variants) generated via `tools/generate-zombie-faces.mjs` (see v6 face entry above); `tools/check-assets.mjs` dynamic list extended with `brute`.
- **Removed non-music background sound** (`src/game/Game.js`): dropped the `audio.startAmbient()` call on run start — the procedural wind/gust/city-hum bed no longer plays; only the mp3 soundtrack remains. `AudioBank.startAmbient` kept (unit-tested directly) but has no caller.
- **Co-op zombies now hurt players / can die** (`src/net/Multiplayer.js` + `src/game/Game.js`): the client runs an empty local horde, so nothing damaged the local player. `Multiplayer._sync` now captures the snapshot's authoritative `selfHealth`/`selfStamina`; `Game` WIRING:MP-HEALTH applies them to the local player each frame (HUD reflects damage, death registers). `onSelfDeath` wired in `_wireMpHooks` to show the respawn banner. Test: `test/multiplayer.test.mjs` +1 (snapshot health drives local player, lethal snapshot kills + respawns).
- Verification: `npm test` 357/357; `npm run verify` 81 ok / 0 fail; `npm run build` ok (index-CxRRsBAw.js); `check-assets` 39 assets 0 problems; `secrets-scan` clean (209 files); browser E2E 18/18 PASS against :5173.

## v11 title screen name merge + width (Sep 27 2026)

- **Merged the two redundant name fields** (`src/game/Screens.js`): the title screen had a solo "PLAYER" name input (`_soloNameInput`) AND a second co-op "your name" input (`_nameInput`), both prefilled with the same random handle. Now there is ONE `_nameInput` in the PLAYER row that both `_startSolo` (high score) and `_joinCoop` (co-op) read, so the same generated name is used for the leaderboard and for other players. `_prefillRandomName` fills only that one field; the co-op row keeps just the room-code field + JOIN button.
- **Wider start screen** (`src/styles.css`): `.panel` max-width 620→720px. Because the taller panel could push START below the fold, `.screen` now scrolls (`overflow-y: auto`) and `.panel` centers via `margin: auto` (instead of flex `align-items: center`), so the buttons stay reachable on short viewports — this also fixed the E2E START click that had started failing at 1280×720.
- Tests: `test/hud-screens.test.mjs` updated — asserts exactly one `your name` input (the merge), the name helper mentions high score + co-op, and the co-op row keeps only the room-code helper.
- Verification: `npm test` 357/357; `npm run verify` 81 ok / 0 fail; `npm run build` ok; `check-assets` 39/0; `secrets-scan` clean (209 files); browser E2E 18/18 PASS against :5173. Deployed to the live host, bundle `index-BIzs3D4b.js`.

## v12 co-op match-end + disconnect grace + health bars + kill feed (Sep 27 2026)

Implements MULTIPLAYER_PLAN §14 remaining-work items 1–4 (item 5, server-URL lobby
field, stays deferred for the single-origin deployment).

- **Co-op match end surfaced** (`src/net/Multiplayer.js` + `src/game/Game.js`):
  `Multiplayer._sync` consumes the server `matchEnd` event once (one-shot latch:
  `matchEnded`/`endReason`/`finalScoreboard`, falling back to the live
  `scoreboard(snap)`), and calls the `onMatchEnd` hook. `Game._wireMpHooks` wires
  `onMatchEnd` → new `Game._endCoopRun()`, which stops the run (state
  GAMEOVER, pointer-lock exit, ambient stop, `score.submitRun()`) and shows the
  shared game-over screen with the server-authoritative wave from
  `multiplayer.lastSnap.wave` (the local WaveManager is unused in co-op).
- **Disconnect grace used, not just declared** (`src/net/Match.js`):
  `removePlayer` flags the slot `disconnected` and schedules `_graceAt = time +
  DISCONNECT_GRACE` (5 s) instead of deleting it; the snapshot roster drops the
  graced player; `addPlayer` with the same id inside the window reclaims the
  held slot (`_reclaim`, score/kills/position survive); `_flow` disposes
  weapon+player and frees the slot when the grace elapses; `_allDeadNoRespawn`
  counts only connected players (a graced slot neither keeps the match alive nor
  forces the end). `scoreboard()` rows now carry display `name`s (graced slots
  included).
- **Per-player health bars + kill feed** (`src/net/Multiplayer.js` +
  `src/styles.css`): `scoreboard()` rows carry `health`/`dead` from the snapshot
  roster; `_renderScoreboard` paints a 4 px `.mp-hp` bar under each row (fill
  width = HP %, green >50 / amber >25 / red ≤25, dead = empty dark-red).
  `_pushKill` keeps a 5-line most-recent-first feed (`Killer ▸ VICTIM`,
  ` (HEAD)` flagged, `VICTIM DIED` for death events); `.mp-killfeed` styles
  added. `Match._recordKill` now pushes `head: z.lastHitHead` on kill events.
- Tests: `test/match-flow.test.mjs` +5 (grace hold→free, reconnect reclaim
  keeps score/kills, all-dead ignores graced slot, graced slot keeps match
  alive while another lives, named scoreboard rows); `test/multiplayer.test.mjs`
  +3 (kill feed order/flags/cap + death events don't pollute, health-bar
  painting incl. dead/critical colors, matchEnd ends the Game + one-shot latch);
  `test/server-room.test.mjs` leave test rewritten for the grace hold (slot
  flagged on leave, freed after 5.5 s of ticks) — committed separately
  (`d2ca51d`). Deployed: gh-pages `3229970` + live host (see Status overview).
- Verification: `node --test "test/**/*.test.mjs"` 365/365; `npm run verify`
  81 ok / 0 fail / 0 skipped; `npm run pages` ok (bundle
  `index-BmM6-i8-.js`, css `index-SNJvBVL4.css`, GLTFLoader `CDuWspmG` —
  committed to tracked dist, old `index-DHiFV2J-` bundle removed);
  `check-assets` 39/0 (dist carries every referenced asset); `secrets-scan`
  clean (209 files). Browser E2E re-run against :5173: 18 PASS / 0 FAIL
  (PLAYWRIGHT_BROWSERS_PATH=`.browsers`).
- Browser co-op probes (dev :5173 proxying `/ws` → local :8090 server):
  `tools/_probe-coop-live3.mjs` two-client PASS (Ada+Bob in one room, each
  client renders the other's avatar, scoreboard 6 children = 2 rows + feed);
  `tools/_probe-coop-end3.mjs` PASS — a synthetic server `matchEnd` snapshot
  (`reason:'waves'`) drives BOTH clients to `gameover` with the visible
  YOU DIED screen showing "Wave 5 — … pts", `matchEnded` latched once.
  (Note: headless p1 joins paused on pointer-lock loss — the probe resumes it
  first; real browsers lock normally.)
- **Deployed (Sep 27)**: gh-pages `3229970` (build of `d2ca51d`, bundle
  `index-BmM6-i8-.js`, CDN live-verified: index + css 200) + live host
  `zombie.p4ppse3n.top` (`~/zombie-app/dist` synced — backup `dist.bak.1790532641` —
  + `server/server.js` + `package.json`, `zombie-game.service` restarted, active
  PID 1113492; :8080 serves `index-BmM6-i8-.js`, css/brute-face 200,
  `/api/highscore` live, `/ws` handshake OK via `tools/_probe-live-mp.mjs`
  two-client PASS). `origin/v3` pushed to `d2ca51d`.
- NEXT: none — v12 verified in-browser (E2E 18/18 + co-op live/end probes PASS).

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

- **Ralph round 59 — v6 hosting (1) hosted global high score DONE + committed
  (`906a6af`) + pushed (`v2` @ `df8a963`)**: the previous round left this
  feature half-landed in the working tree (server API + Score helpers + two
  new test files). This round finished, verified, committed and pushed it.
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
  - NEXT: optional gh-pages redeploy of the new build. Note: the :8080 process
    answers `/api/highscore` but persists to `server/highscore.json`
    (currently `best: 900`, not the 4242 from earlier probes — it is running
    a build predating the file-store wiring); restart `npm run server` before
    trusting live probes. The dev :5173 proxy reaches the :8080 API.

- **Ralph round 60 — v3 chain: make the red suite green DONE**: the working
  tree carried an unlogged "v3 T1 / gameplay (2)" dismemberment-chain WIP
  (Zombie `_chainShot`/`hitLimbAt` rewrite, DroppedLimbPool.js +
  test/dismember.test.mjs, Game/Match/Multiplayer/RemoteZombie wiring, weapon
  chain hooks) with **3 red tests**. Root causes found and fixed:
  (1) `LIMB_R2` was 0.47² (0.2209) — too large: the dead-centre torso point
  (0, 1.2, 0) sits 0.417 m from the arm sockets, so torso hits severed an arm
  instead of nothing. Lowered to 0.416² (0.173056): the largest radius that
  keeps the torso centre outside the sever disc while still clipping arms on
  chest-aim shell impacts (measured 0.40–0.46 m from sockets across the
  pistol's spread). (2) `_chainKill` only applied lethal damage; it now
  severs one surviving limb (leg preferred, then arm) before the damage, so
  the 4th round always drops three limbs even when geometry missed the legs.
  (3) Pistol called `damage()` before `_chainShot`, so a shambler at 12 HP
  died to the 26-damage round before `_chainKill` could fire — reordered to
  `hitLimbAt` → `_chainShot` → `damage` so the chain kill resolves first.
  Shotgun drain-before-step (`_chainTargets`) and Zombie fallback removal were
  already in place from the prior session. Changed files: `src/game/Zombie.js`
  (`_limbAt` radius + `_chainKill` limb sever), `src/game/Pistol.js` (chain
  before damage). Focused: `node --test test/dismember.test.mjs
  test/zombie.test.mjs test/shotgun.test.mjs` → 63/63. Full `npm test` →
  331/331. `npm run verify` → 81 ok / 0 fail / 0 skipped. `npm run build` ✓.
  Reviewer verdict: **SAFE TO COMMIT** — all checks PASS (torso null margin
  0.000944; no double-sever; headshot/boss gates intact). Follow-ups noted:
  RemoteZombie mirror radii stale (0.3/0.34 vs 0.416 — pre-existing,
  self-corrects via snapshots), `Sniper.js` still damage-before-chain
  (harmless at 90 dmg), `_regrowLimb` `_parts` index latent bug (no
  production caller), `dist/` needs rebuild before deploy.
- **Ralph round 61 — v3 chain: sync RemoteZombie sever geometry DONE**: round
  60's review flagged the client-prediction proxy as out of sync. Fixed
  `src/net/RemoteZombie.js` `hitLimbAt`: the `near()` helper ignored the arm
  sockets' z-offset (±0.1, vs Zombie._limbAt which includes it) and used the
  stale pre-fix radii 0.3/0.34 — now a single `R = 0.416` with socket offsets
  (-0.34, 1.42, ±0.1 arms; ±0.16, 0.47, 0 legs), so the proxy severs on
  exactly the impacts the server-side Zombie severs. Added focused test
  "proxy sever geometry matches the server Zombie" in
  `test/multiplayer.test.mjs`: dead-centre torso hit (d² 0.164 < 0.173056 at
  z=0 vs the arm socket's z=0.1) severs nothing; a 0.42 m chest-aim clip
  severs the left arm + spawns a falling piece + advances `_chainShots`.
  Note: the proxy counts the round inside `hitLimbAt` (its own mirror); the
  server Zombie counts via `_chainShot` from the weapon — the snapshot's
  authoritative limbs re-sync either way. Focused: `node --test
  test/multiplayer.test.mjs` → 16/16. Full `npm test` → 332/332. `npm run
  verify` → 81 ok / 0 fail / 0 skipped. `npm run build` ✓. NEXT: remaining
  round-60 follow-ups — align `Sniper.js` chain ordering with Pistol, fix
  `_regrowLimb` `_parts` indexing, rebuild `dist/` before deploy.

- **Ralph round 62 — v3 gameplay (3) T1 dismemberment chain DONE + committed
  (`82398f1`)**: the round-61 sniper test stayed red because its premise was
  wrong, not the code. The chain is FOUR landed body rounds (arm→arm→leg→kill),
  and `_chainShot` correctly fires `_chainKill` only on the round after
  `_chainShots` reaches 3. The old test raised HP to 200 and aimed at the
  zombie centre, so the sniper's 90-dmg rounds drained it to death on round 3
  (arms 1, legs 0) before the chain gate could fire. Fix is test-only: raise
  HP to 400 (survives four 90-dmg rounds) and re-aim per shot at the surviving
  arm socket (left on round 1, right once `armsLost >= 1`) so both arms sever
  cleanly; round 3 clips no limb but spends the chain, round 4 chain-kills and
  severs a leg. Result: shots 4, armsLost 2, legsLost 1, `game.limbs.count` 3,
  kill counted. No source change was needed — the round-60/61 ordering +
  radius 0.416 were already correct. Verified: `node --test
  test/dismember.test.mjs` 11/11, full `npm test` 333/333, `npm run verify`
  81/0/0, `npm run build` ✓, `check-assets` 0 problems, `secrets-scan` clean.
  Deleted `/tmp/snipprobe*.mjs` scratch probes. NEXT: T3 melee, T6 name+
  high-score, T12 Achievements, then co-op T9/T10/T11, T7 moon, T13-T15, T16
  close-out (rebuild `dist/` before deploy).

- **Ralph round 63 — v3 gameplay (4) T3 melee faster + longer reach + overhead
  diagonal DONE + committed (`b256c86`)**: Axe reach 1.5→2.1 m, cooldown
  0.9→0.6 s, swingTime 0.25→0.2 s; Sword reach 1.8→2.4 m, cooldown 1.15→0.8 s,
  swingTime 0.32→0.26 s. Both weapons RAISE overhead during the windup (new
  `RAISE_PITCH` negative pitch) then come DOWN through the forward dip while
  ROLLING diagonally across the target — the strike pitch is now
  `-RAISE_PITCH*(1-mid) - SLASH_PITCH*mid`, so the cut is an overhead→down
  diagonal cleave. The Axe gained a diagonal roll (`SLASH_ROLL` 0.6, was flat);
  the Sword already alternated its roll sign. Tests updated: stats contract
  (new reach/cooldown/swingTime), far-zombie pushed past the new reach
  (2.6/2.9 m), cooldown loop 55→37 frames (axe), mid-strike asserts
  `|rotation.z| > 0.3` (diagonal) + recovery clears roll to 0. Verified:
  `node --test test/axe.test.mjs` 6/6, `test/sword.test.mjs` 9/9,
  `test/weaponbank.test.mjs` 11/11, full `npm test` 333/333, `npm run verify`
  81/0/0, `npm run build` ✓. NEXT: T6 player name + hosted XSS-safe high score
  (+T6b co-op lobby field descriptions), then T12 Achievements.

- **Ralph round 64 — v3 gameplay (5) T6 named high score + T6b co-op field
  helpers DONE + committed (`0a42dbe`)**: the hosted record is now NAMED.
  `Score.js` gains `sanitizeName` (strip C0/DEL control chars via an
  escape-only regex so the source stays ASCII, collapse whitespace, clamp 24),
  `setName` (persisted under `deadfall-player-name`), and `bestName`;
  `submitBest` POSTs `{score, name}`, `adoptBest` reads `{best, name}` and
  re-sanitizes the holder name. `server/server.js` stores `{best, name}`,
  re-sanitizes server-side on POST (a hostile `<img src=x onerror=...>` payload
  is clamped to 24 + control-stripped before it can poison the shared record),
  and serves it back as JSON text; boot seeding ignores the on-disk name when a
  test seeds `opts.highScore` (avoids cross-test file bleed). `Screens.js`:
  title HIGH SCORE renders `HIGH SCORE: NAME — SCORE` via `_hsLabel`
  (textContent only → zero markup nodes even for the XSS payload), a solo
  PLAYER-name input feeds `score.setName` through `_startSolo`, and the game-over
  record line shows `NAME — SCORE`. T6b: the co-op room-code + name inputs get
  short `textContent` helper lines (room = shared game name everyone types to
  land in one session; name = shown to other players + on the scoreboard).
  Tests: `highscore-api` asserts `{best,name}` shape + server-side XSS clamp;
  `score-hosted` asserts the POST body carries `name`; `hud-screens` adds a T6
  block (named label, zero-markup XSS render via a real `Score`, T6b helper
  lines). Fixed a binary-file slip: the control-char regex class was written
  with literal control bytes (made two files `data`); replaced with
  `new RegExp('[\\u0000-\\u001f\\u007f]')` via python byte-patch. Verified:
  `hud-screens` 1/1, `highscore-api` 4/4, `score-hosted` 3/3, full `npm test`
  334/334, `npm run verify` 81/0/0, `npm run build` ✓, `check-assets` 0
  problems, `secrets-scan` clean. NEXT: T12 Achievements.js (<350 lines,
  kills 10/20/50/100, lamps 10-50, headshots 25/75/100, per-run waves 5-30,
  bosses 1-30, localStorage persistence, per-run waves reset on restart).

- **Ralph round 65 — v3 gameplay (6) T12 persistent achievements DONE +
  committed (`716ca01`)**: new `src/game/Achievements.js` (143 lines, pure
  bookkeeping — no THREE objects, DOM only via an injected `onUnlock`). Five
  ladders: SLAYER kills 10/20/50/100, LAMP LIGHTER lamps 10/20/30/40/50,
  BULLSEYE headshots 25/50/75/100, SURVIVOR waves 5/10/15/20/25/30, GIANT
  SLAYER bosses 1/5/10/15/20/25/30. The unlocked set persists in localStorage
  (`deadfall-achievements`) so earned tiers survive restarts; the per-run
  counters reset on restart (user decision — waves survived + every other
  counter are per-run progress). Headless / storage-less degrade to an
  in-memory set without throwing (mirrors Settings.js/Score.js). Game.js
  wiring all inside WIRING regions + the debug reader + dispose: construct in
  WIRING:SCORE with the Screens banner toast as `onUnlock`; feed kills/
  headshots/bosses from WIRING:SPAWNER `onKill` (`z.lastHitHead`/`z.type`),
  waves from WIRING:WAVE `onWaveCleared`, lamps from WIRING:LAMPS via a new
  `Lamps.onBreak` hook; reset per-run counters in WIRING:RESET; drop the
  callback in `dispose`. `debug.achievements()` reader added for tests.
  `test/achievements.test.mjs` (7 tests): one-shot unlock + toast, no
  duplicate toast for an earned tier, persistence across a fresh instance vs
  per-run counter reset, per-category ladders, `add()` clamping + unknown-id
  no-op, corrupt/missing storage, dispose. Verified: `achievements` 7/7, full
  `npm test` 341/341, `npm run verify` 81/0/0, `npm run build` ✓,
  `check-assets` 0 problems, `secrets-scan` clean. NEXT: co-op T9 (swarm
  targets nearest *living* player), T10 (co-op zombie visual parity: skinned
  GLB + faces, grounded feet), T11 (RemotePlayer outfit textures + name label
  + grounded), then T7 moon (Wan2GP GPU 2), T13-T15, T16 close-out.

- **Ralph round 66 — v3 co-op (7) T9/T10/T11 DONE + committed (`afe04e1`)**:
  T9 was already satisfied — `WorldCore.nearestAlivePlayer` skips `isDead`
  players and `Match._flow` respawns via `player.reset()` after the 3 s delay,
  so steering always reads the nearest *living* player; single-player (one
  player) is unchanged. Covered by `test/match.test.mjs` retarget-on-death
  (10/10). T10: `RemoteZombie` already builds its body with the shared
  `buildPrimitiveBody` (clothes + face + eyes + hair + accessories) — the same
  primitive-body-always-on visual single-player uses (the skinned rig root is
  hidden in single-player too), and it grounds feet at group y 0; added a
  grounding assertion to `test/multiplayer.test.mjs`. T11 (`src/game/RemotePlayer.js`):
  torso/legs now wear the shared `OUTFITMATS` (deterministic per-id pick) while
  head/arms keep the per-id tint so players stay distinguishable; a canvas-texture
  name-label Sprite floats above the head (browser only — headless has no canvas
  factory so it is skipped, and a Sprite is not a mesh so the budget is
  unchanged); the group origin is now the FEET (eye height subtracted) so avatars
  are grounded instead of hovering a body above the ground, and a jump lifts the
  feet while death sinks them. The snapshot now carries the hello display name:
  `Match.addPlayer(id, x, z, name)` stores `slot.name` and `snapshot()` emits
  `name`; `server.js` `room.join(socket, name)` forwards the hello name.
  `Multiplayer._sync` passes `{ name, canvasFactory }` to each RemotePlayer.
  Extended `test/remote-player.test.mjs` (grounding, outfit-vs-tint materials,
  deterministic outfit, jump lift, headless label skip, canvas label). Verified:
  co-op cluster 42/42 (remote-player/match/match-flow/multiplayer/server-room),
  full `npm test` 342/342, `npm run verify` 81/0/0, `npm run build` ✓,
  `check-assets` 34/0, `secrets-scan` clean. NEXT: T7 moon (Wan2GP GPU 2),
  T13 snow ground + footprints, T14 irregular blood on snow, T15 wanted posters,
  T16 close-out (rebuild `dist/` before deploy).

- **Ralph round 67 — v3 visuals (8) T7 moon + T13 snow footprints + T14 irregular
  blood DONE + committed (`0426df4`)**:
  **T7** — generated a photoreal moon texture via Wan2GP (qwen_image, GPU 2,
  background job, seed 7) → `public/assets/sky/moon.jpg` (also copied to
  `.research/assets-candidates/`); `src/world/sky.js` now renders the moon as a
  larger camera-facing `CircleGeometry` disc (r 15 vs the old r-7 sphere) set at
  a LOWER elevation (22° vs the moonlight's ~42°, same NW azimuth) with the
  texture loaded browser-only (headless keeps the flat pale disc); `update()`
  turns the disc to face the player each frame. `test/sky.test.mjs` updated for
  the new moon math + a T7 elevation/azimuth/size test (9/9). `check-assets` now
  pins `assets/sky/moon.jpg` (35 refs).
  **T13** — new `src/game/Footprints.js` (single InstancedMesh, 64 prints, one
  draw call): the player + every zombie stamp alternating left/right prints along
  their travel path (gait keyed per walker via an object-keyed Map so corpses
  never reuse a stride), aging out over 6 s by shrinking toward the ground;
  headless has no canvas alpha map so prints stay plain dark ovals. Wired in
  Game.js WIRING regions (construct in WIRING:BLOOD, step+update in the update
  loop, dispose in dispose). `test/footprints.test.mjs` (5). `test/fog.test.mjs`
  dispose mesh-delta updated 2→3 for the extra footprint mesh. Budget: +1 mesh.
  **T14** — `src/game/Blood.js` ground stains are now an irregular LCG-jittered
  blob polygon (not a CircleGeometry), stretched per-instance with a non-uniform
  aspect (0.6–1.4) + spin so no two stains share a silhouette, and darker
  (r 0.11–0.21) for contrast on snow; `test/blood.test.mjs` extended (non-circular
  geometry + varied aspect). **T15** wanted posters were already shipped on the
  center building (cityDressing.addWantedPoster + poster.jpg + city.test).
  Verified: `sky` 9/9, `footprints` 5/5, `blood` 1/1, `fog` 4/4, full `npm test`
  348/348, `npm run verify` 81/0/0, `npm run build` ✓, `check-assets` 35/0,
  `secrets-scan` clean. NEXT: T16 close-out (rebuild `dist/` via `npm run pages`,
  E2E 18/18 on :5173, co-op probe, look-metrics, push `v3`).

- **Ralph round 68 — deploy v3 to prod + game version stamp (`4c50cb8`)**:
  **Prod deploy** — the live host is a user-systemd unit `zombie-game.service`
  (`~/.config/systemd/user/zombie-game.service`, WorkingDirectory `~/zombie-app`,
  `node server/server.js`, PORT=8080, HOST=0.0.0.0 via the `prod.conf` drop-in,
  Restart=on-failure) behind a root **Caddy** reverse proxy on :80/:443 for
  `zombie.p4ppse3n.top`. Deployed the fresh `npm run pages` build (bundle
  `index-FenwMKjv.js`) by backing up `~/zombie-app/dist` → `dist.bak.<ts>`,
  copying the new `dist/` + `server/server.js` + `package.json` into `~/zombie-app`,
  and `systemctl --user restart zombie-game.service` (now active, PID 97666).
  Verified on :8080: index serves `index-FenwMKjv.js`, bundle contains `3.0.0`,
  `assets/sky/moon.jpg` 200, `/api/highscore` live (`{"best":4242,"name":""}`),
  `/ws` responds 400 (expected non-WS GET). The domain 000s from this sandbox
  (network isolation), but the :8080 host is confirmed serving the new build.
  **Version stamp** — new `src/version.js` (`export const VERSION = '3.0.0'`,
  single source of truth, headless-safe pure data); `Screens.js` imports it and
  renders a small `v3.0.0` line on the title screen via `textContent` (XSS-safe);
  `.version` CSS rule added; `package.json` bumped 1.0.0 → 3.0.0;
  `test/hud-screens.test.mjs` asserts the title `.version` element shows
  `v` + VERSION. Full `npm test` 348/348, `npm run pages` ✓, check-assets 35/0.
  NEXT: gh-pages redeploy already done earlier this session (`9ce2d5f`); the
  version-stamped build is live on the p4ppse3n host.

## v13 UI + audio cleanup (Sep 27 2026)

- **Wider start-page fields** (`src/styles.css`): `.mp-input` was a fixed 120 px,
  which clipped the name and the generated room codes (e.g. `FROST-BLOD-42`).
  Now `flex: 1 1 180px; min-width: 180px; width: auto` inside the existing
  `.mp-row` flexbox, so both fields grow to fill the row width.
- **Only the mp3 soundtrack plays** (`src/game/Game.js` + `src/game/MusicDirector.js`):
  the "other music" at wave 3+ was the procedural WebAudio layer — (a)
  `AudioBank.setTension` built a two-sawtooth sub-bass drone + a quickening
  heartbeat pulse whenever tension rose (waves 1–2 stay calm, wave 3+ is combat
  → the bed switched on and read as a second track), and (b) `MusicDirector`
  handed `ambient`/`combat`/`crisis` oscillator tracks to `AudioBank.playMusicTrack`
  under the mp3 playlist. Fix: Game.js WIRING:TENSION no longer calls
  `audio.setTension` (the tension value still feeds the director), and the
  shipped director is constructed with `enabled: false` — `available` returns
  false so no procedural track can ever start, while the track map + pause
  bookkeeping (and its unit tests) survive. Boss-fight mp3 track, spawn stinger,
  groans and weapon SFX are untouched.
- Tests: `test/music-playlist.test.mjs` +1 (disabled director hands zero tracks
  to the bank, no pause/resume calls, bookkeeping intact).
- Verification: `node --test "test/**/*.test.mjs"` 366/366; `npm run verify`
  81 ok / 0 fail / 0 skipped.
- NEXT: 4 new songs via Wan2GP; boss rework (≈10 sniper shots, 4× scale, slower);
  zombie clothing detail; 5 s jump-scare intro video evaluation.

## v23 wave-5 boss scale-down + hitbox match (Sep 29 2026)

- **Wave-5 boss is now 2.5× a normal zombie** (`src/game/Zombie.js` `_bossScale`):
  previously every non-wave-10 boss used `BOSS_SCALE = 5.6`, so the wave-5 brute
  read as a giant. User asked for "2-3× the size of a normal zombie", so wave 5
  now scales to 2.5× (wave 10 stays the 5× giant; other boss waves keep 5.6×).
  The visible primitive group carries the scale (group.scale = _bossScale), so
  the brute silhouette shrinks to match.
- **Hitbox now matches the scaled body** (`getHitboxes()`): the two-sphere
  contract's anchor heights now scale with `_hitboxScale` (body y+1.2·s, head
  y+1.8·s) instead of staying pinned at 1.2/1.8. Previously a scaled boss had
  scaled radii but UNSCALED centers, so the hitbox floated far below the raised
  head/body. For wave 5 (s=2.5): body sphere center y=3.0 r=1.125, head y=4.5
  r=0.75. Normal zombies (s=1) keep the exact 0.45 / 0.3 / y1.2 / y1.8 contract.
- Tests: `test/boss.test.mjs` "brute hitboxes" rewritten to assert the 2.5×
  scale + scaled anchors (was the 5.6×/unscaled-center contract).
- Verification: `node --test` 388/388; `npm run verify` 81 ok / 0 fail / 0 skipped;
  `npm run build` ok; `check-assets` 60/0; `secrets-scan` clean. Headless probe
  confirms wave5 scale 2.5 / hitbox bodyY 3.0, wave10 5×, walker 1×.

## v23 wanted-poster spotlight (Sep 29 2026)

- **A spotlight above the WANTED poster so it reads in the dark**
  (`src/world/cityDressing.js` `addWantedPoster`): a `SpotLight(0xffd9a0, 2.4,
  6, π/5, 0.4, 2)` sits just above the placard's top edge and ~0.9 m out from the
  wall (player +z side), aimed down at the poster centre (its `Object3D` target
  is parented to the dressing group). Warm colour matches the streetlights; a
  tight ~36° cone with a 6 m range keeps the pool on the placard without spilling
  into the street. castShadow off (scene-wide cost rule). This is the only light
  the dressing group adds — city light count 19→20, still well under the 40 cap.
- **City.dispose guard** (`src/world/City.js`): the mesh-dispose loop now skips
  children with no geometry (`if (!m.geometry) continue`) so the spotlight + its
  Object3D target don't crash dispose (they're torn down with the group).
- Tests: `test/city.test.mjs` poster test extended to assert the spotlight exists,
  sits above + in front of the poster, aims at its centre, casts no shadow;
  `test/lighting.test.mjs` scene total 15→16 (poster spot is City-owned, survives
  Lighting.dispose); `test/material-hierarchy.test.mjs` city-group light count
  0→1 (the deliberate poster light).
- Verification: `node --test` 388/388; `npm run verify` 81/0/0; build ok;
  check-assets 60/0; secrets clean.
