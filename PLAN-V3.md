# PLAN-V3 — v3 gameplay & visuals overhaul (checkpoint file)

Branch `v3` off `v2` @ `87f5da1`. This file is the crash-resume checkpoint:
read it first, do the next unchecked task, tick it, commit. Verification
battery after every increment: `npm test` (baseline 314 + new), `npm run
verify` (81/0/0), `npm run build`, `node tools/check-assets.mjs`,
`node tools/secrets-scan.mjs`; browser E2E at close-out (18/18, 0 console
errors, dev :5173, PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers).

Commit style: `v3 <area> (<n>): <summary>`. Update TASKS.md per its protocol.

## Tasks

- [ ] **T1 Zombie dismemberment chain** (Zombie.js + test/dismember.test.mjs)
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

- [ ] **T3 Melee faster + longer reach + overhead diagonal swing**
  (Axe.js, Sword.js + their tests): shorter swing recovery, longer reach,
  animation = raise overhead → diagonal down-slash across the zombie body.

- [x] **T4 Crouch keybind → Left Ctrl** DONE `61bfa48`: ControlLeft primary,
  KeyC alias kept; input.test + README updated.

- [ ] **T5 Difficulty: FRENZY default + NIGHTMARE add-on** (Screens.js title
  toggles, Game.js WIRING region, Zombie.js DIFFICULTY table, WaveManager,
  test/difficulty.test.mjs). User decision: Nightmare **stacks on FRENZY** —
  FRENZY stays the default mode; Nightmare is an extra toggle on top:
  zombie speed × 1.5 on top of FRENZY's 2× (3× total), run starts at wave 3,
  and it keeps FRENZY's flat-50-HP rule. Nightmare requires FRENZY (enabling
  it turns FRENZY on; turning FRENZY off turns Nightmare off).

- [ ] **T6 Player name for standard games + named high score, XSS-safe**
  (Screens.js input, Score.js, server /api/highscore payload {best, name}):
  sanitize (strip control chars, clamp ~24 chars, HTML-escape), render via
  textContent only. Title HIGH SCORE line shows `NAME — SCORE`. User
  decision: the name IS hosted — server stores {best, name} so every visitor
  sees the record holder's name; server-side re-validation (clamp + strip)
  keeps a hostile POST from poisoning the shared record. Test with an
  `<img src=x onerror=...>` payload producing zero markup nodes.
  - **T6b Co-op lobby field descriptions** (Screens.js title CO-OP row):
    the room-code field (currently placeholder "room code", default value
    "default") gets a short helper description — it is the shared room/game
    name every player must type to land in the same session; the name field
    gets one too (display name shown to other players + on the scoreboard).
    Render as small `textContent` helper lines under the inputs (same XSS
    rules as above); cover in the hud-screens test.

- [ ] **T7 Moon: lower, larger, detailed** (world/Sky.js + Wan2GP image job):
  generate high-res moon texture (qwen_image, GPU 2, background job) →
  public/assets/sky/moon.jpg; texture-mapped disc, lower elevation, bigger.
  Before/after via tools/look-capture.mjs + look-metrics.

- [ ] **T8 Playlist rotation — verify** (likely DONE by v6 audio (8)):
  confirm playPlaylist rotates javelin→hord→matsubou in browser; remove any
  leftover single-track loop path; README wording.

- [ ] **T9 Co-op zombie swarm targeting** (steering reads nearest **living**
  player from Match/WorldCore — dead/respawning players are ignored until
  respawn; single-player path unchanged; headless 2-player test).

- [ ] **T10 Co-op zombie visual parity** — same skinned GLB + faces as
  single-player (fix any fallback path in the co-op spawn); grounded feet,
  no floating (height from ground plane).

- [ ] **T11 Co-op remote-player visuals** (RemotePlayer.js): outfit textures
  like single-player, name label, grounded (no hover); extend
  test/remote-player.test.mjs.

- [ ] **T12 Achievements** (new src/game/Achievements.js < 350 lines +
  test/achievements.test.mjs): kills 10/20/50/100; lamps shot 10/20/30/40/50;
  headshots 25/50/75/100; waves survived 5/10/15/20/25/30 (**per-run waves
  cleared** — restart resets progress, per user decision); bosses killed
  1/5/10/15/20/25/30. Event hooks + Screens banner toast + localStorage
  persistence (unlocked set survives restarts; per-run counters do not).

- [ ] **T13 Snow ground + footprints** (ground texture swap or snow blend;
  footprint decal pool for player + zombies, fading, budget-checked).

- [ ] **T14 Irregular blood on snow** (Blood.js stains: non-circular
  polygonal/viscous sprites, darker contrast on snow).

- [ ] **T15 Wanted posters on buildings / billboard** (cityDressing/City:
  poster.jpg planes on facades or a billboard prop; lights budget ≤ 40;
  look-capture proof).

- [ ] **T16 Close-out**: full battery + E2E + co-op probe + look-metrics;
  TASKS.md round entry + Status overview; push `v3`.

## Execution order
1. Quick wins: T2, T4, T8-verify, T5.
2. Mechanics: T1, T3, T6, T12.
3. Co-op: T9, T10, T11.
4. Asset jobs (background, GPU 2): T7, T13, T15 (+ T14 sprites).
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