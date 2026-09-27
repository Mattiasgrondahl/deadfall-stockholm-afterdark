# PLAN-V3 — v3 gameplay & visuals overhaul (checkpoint file)

Branch `v3` off `v2` @ `87f5da1`. This file is the crash-resume checkpoint:
read it first, do the next unchecked task, tick it, commit. Verification
battery after every increment: `npm test` (baseline 314 + new), `npm run
verify` (81/0/0), `npm run build`, `node tools/check-assets.mjs`,
`node tools/secrets-scan.mjs`; browser E2E at close-out (18/18, 0 console
errors, dev :5173, PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers).

Commit style: `v3 <area> (<n>): <summary>`. Update TASKS.md per its protocol.

## Tasks

- [x] **T1 Zombie dismemberment chain** DONE `82398f1` (Zombie.js + DroppedLimbPool.js + test/dismember.test.mjs)
  Body shot 1 → left arm lost; shot 2 → right arm; shot 3 → one leg lost +
  speed × 0.5; shot 4 → dies, drops dead on the ground. Headshot kills
  instantly at any stage. User decision: applies in **all difficulties,
  counted by hits (not damage)** — in FRENZY/Nightmare the flat-50-HP kill
  (2 body shots) simply ends the chain early after the first arm. Per-zombie
  body-shot counter; limbs are detached clones that tumble (LCG) and settle
  on the ground; reuse shared geometry; respect S8 mesh gate (≤ 640);
  coordinate with decap-head pool (fatal body shots must not double-kill).

- [x] **T2 Pistol semi-auto + 12-round mag** (Pistol.js, test/pistol.test.mjs)
  DONE `5889f67`: FIRE_INTERVAL 0.28 → 0.08 s; 12-round mag unchanged; new
  succession test; README updated. 315/315.

- [x] **T3 Melee faster + longer reach + overhead diagonal swing** DONE `b256c86`
  (Axe.js, Sword.js + their tests): shorter swing recovery, longer reach,
  animation = raise overhead → diagonal down-slash across the zombie body.

- [x] **T4 Crouch keybind → Left Ctrl** DONE `61bfa48`: ControlLeft primary,
  KeyC alias kept; input.test + README updated.

- [x] **T5 Difficulty: FRENZY default + NIGHTMARE add-on** DONE `6646d9b`:
  DIFFICULTY gains nightmare {3x, flat 50, startWave 3}; WaveManager takes
  opts.startWave; Game default difficulty = frenzy; title row has a third
  NIGHTMARE toggle (frenzy lights up with it); banner per preset.
  316/316, verify 81/0/0.

- [x] **T6 Player name for standard games + named high score, XSS-safe** DONE `0a42dbe`
  (Screens.js input, Score.js, server /api/highscore payload {best, name}):
  sanitize (strip control chars, clamp ~24 chars, HTML-escape), render via
  textContent only. Title HIGH SCORE line shows `NAME — SCORE`. User
  decision: the name IS hosted — server stores {best, name} so every visitor
  sees the record holder's name; server-side re-validation (clamp + strip)
  keeps a hostile POST from poisoning the shared record. Test with an
  `<img src=x onerror=...>` payload producing zero markup nodes.
  - **T6b Co-op lobby field descriptions** DONE (same commit `0a42dbe`)
    the room-code field (currently placeholder "room code", default value
    "default") gets a short helper description — it is the shared room/game
    name every player must type to land in the same session; the name field
    gets one too (display name shown to other players + on the scoreboard).
    Render as small `textContent` helper lines under the inputs (same XSS
    rules as above); cover in the hud-screens test.

- [x] **T7 Moon: lower, larger, detailed** DONE `0426df4` (world/sky.js + Wan2GP
  image job): generated a photoreal moon texture (qwen_image, GPU 2) →
  public/assets/sky/moon.jpg; the moon is now a larger camera-facing disc
  (CircleGeometry r15 vs the old r7 sphere) set at a LOWER elevation (22° vs the
  light's ~42°) with the texture loaded browser-only (headless keeps the flat
  disc). Sky test updated + a T7 elevation/azimuth test added (9/9).

- [x] **T8 Playlist rotation — VERIFIED DONE** (v6 audio (8) shipped it):
  browser check confirms playPlaylist rotates javelin→hord→matsubou with
  per-song lengths and wraps back to song 1; no leftover single-track loop
  callers (playLevelMusic has no call sites; LEVEL_TRACKS kept for the
  AudioBank API only). README already describes the playlist.

- [x] **T9 Co-op zombie swarm targeting** DONE `afe04e1` (already implemented:
  WorldCore.nearestAlivePlayer skips dead/respawning players; single-player
  path unchanged; covered by test/match.test.mjs retarget-on-death, 10/10).

- [x] **T10 Co-op zombie visual parity** DONE `afe04e1` — RemoteZombie uses the
  same buildPrimitiveBody as single-player (clothes + face + eyes + hair +
  accessories; the single-player visual policy is primitive-body-always-on, so
  the co-op bodies already match); grounded feet (group origin at y 0). Added a
  grounding assertion to test/multiplayer.test.mjs.

- [x] **T11 Co-op remote-player visuals** DONE `afe04e1` (RemotePlayer.js):
  outfit materials (shared OUTFITMATS) on torso/legs + per-id tint on head/arms,
  a canvas-texture name-label Sprite (browser only, headless skips it), and
  grounded feet (group origin = feet, eye height subtracted). Snapshot now
  carries the hello display name (Match.addPlayer name + server room.join).
  Extended test/remote-player.test.mjs.

- [x] **T12 Achievements** DONE `716ca01` (new src/game/Achievements.js 143 lines +
  test/achievements.test.mjs): kills 10/20/50/100; lamps shot 10/20/30/40/50;
  headshots 25/50/75/100; waves survived 5/10/15/20/25/30 (**per-run waves
  cleared** — restart resets progress, per user decision); bosses killed
  1/5/10/15/20/25/30. Event hooks + Screens banner toast + localStorage
  persistence (unlocked set survives restarts; per-run counters do not).

- [x] **T13 Snow ground + footprints** DONE `0426df4` (new src/game/Footprints.js):
  a single-InstancedMesh footprint pool (64 prints, one draw call) that the
  player + every zombie stamp along their path, alternating left/right, aging
  out over 6 s (fade by shrinking). Ground already reads as snow (bluish
  roughness-0.55 pavement + snow sheet + drifts). Wired in Game.js WIRING regions
  (construct + step + update + dispose). test/footprints.test.mjs (5); fog.test
  dispose count updated for the extra mesh. Budget: +1 mesh (still ≤ 640).

- [x] **T14 Irregular blood on snow** DONE `0426df4` (Blood.js stains): the ground
  stain geometry is now an irregular LCG-jittered blob polygon (not a
  CircleGeometry), stretched per-instance with a non-uniform aspect + spin so no
  two stains share a silhouette, and darker (r 0.11–0.21) for contrast on snow.
  Extended test/blood.test.mjs (non-circular geometry + varied aspect).

- [x] **T15 Wanted posters on buildings / billboard** ALREADY SHIPPED — the
  weathered WANTED placard (poster.jpg, browser texture with a drawn fallback)
  is mounted on the center building front face via cityDressing.addWantedPoster,
  counted in the mesh budget, adds no collision; covered by test/city.test.mjs
  ("wanted poster mounted on the center building front face"). Look-capture proof
  is env-bound (SwiftShader dies ~3–5 s into gameplay).

- [ ] **T16 Close-out**: full battery + E2E + co-op probe + look-metrics;
  TASKS.md round entry + Status overview; push `v3`.

## Execution order
1. Quick wins: T2, T4, T8-verify, T5.
2. Mechanics: T1, T3, T6, T12.
3. Co-op: T9, T10, T11 — DONE `afe04e1`.
4. Asset jobs (background, GPU 2): T7 DONE `0426df4`; T13/T14 DONE `0426df4`;
   T15 already shipped (poster on center building).
5. T16 close-out.

## Risks / notes
- Mesh budget (limbs, footprints, billboard) — gated by verify S8; reuse pools.
- SwiftShader browser dies ~3–5 s into gameplay — capture pre-gameplay states.
- Wan2GP: GPU 2 only, background jobs with --timeout; see
  docs/AGENT-ASSET-PIPELINE.md.
- Game.js edits only inside // WIRING:* regions.
- FRENZY default + Nightmare starting wave must flow through startGame/
  WaveManager reset cleanly (restart-state test covers wave 1 today — update
  expectations for difficulty-aware start wave).
- High-score name rides the hosted API: keep server validation (clamp + strip)
  so a hostile POST cannot poison the shared record for everyone.