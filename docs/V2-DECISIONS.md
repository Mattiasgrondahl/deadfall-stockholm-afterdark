# Version 2 — Decisions Log

Record important visual, audio, and architecture decisions as they are made
(one entry each: decision, rationale, where it lives).

- v1 frozen at `feat/iteration-2` (3ddf023); v2 work on branch `v2`; merge
  v2→v1 only after full acceptance. (carried from V1–V13)
- Gameplay V2 scope (axe+shotgun, flashlight, drops, score, blood, groans)
  completed in tasks V1–V13; the current run covers visual/atmosphere/audio/
  presentation/performance phases only, per docs/V2-PLAN.md.
- GPU-1 children are unreliable in this deployment (multiple pre-write deaths).
  Escalation policy: after 3 consecutive GPU-1 child failures on the same task,
  the orchestrator performs the task directly on GPU-0 and records the escalation.
  Round-1 evidence: the broad V2P-1 spec (file + wiring + tests + 4 test runs)
  killed a GPU-1 child pre-write; the narrowed single-file spec succeeded.
  → Keep GPU-1 delegations single-file / single-deliverable where possible.
- V2P-1 sky: the dome follows the player each frame (position.copy), so the
  shader gradient stays view-relative; the moon is placed along the same
  direction as Lighting.js moonlight (MOON_OFFSET -18,30,-15) so the lit side
  matches shadow direction; moon + silhouettes use fog:false because FogExp2
  density ~0.032 fully hides 360–400 m objects; silhouette layout uses a
  glibc-style LCG (s=(s*48271)%65537, seed 9137) — always non-negative, same
  family already accepted in the V13 review.
- V2P-2 palette & materials: night look achieved by retuning material parameters
  only, never geometry or layout — LCG seed/call order untouched so city layout
  stays byte-identical. Per-zone tint = multiplicative scalar on the LCG-picked
  base color (center ×1.12 → outskirts ×0.78) to give the city a subtle
  brightness gradient at near-zero cost (no new materials, no new meshes).
  Roughness/metalness retuned (buildings 0.88/0.05; metal dressing
  0.5–0.65 / 0.2–0.35) so streetlights + moonlight produce visible specular
  response instead of flat matte surfaces. Streetlight head emissive left
  as-is: falloff curve + warm halo belong to V2P-5.
- V2P-3 fog: FogExp2 density lowered 0.032 → 0.022 in Game.js setupScene() —
  a single-parameter change; fog color (0x0b1020) and the sky's fog:false
  dome/silhouettes untouched. Rationale: at 0.032, exp(−(dρ)²) left 30 m
  targets at ~40% visibility (unplayable haze inside streetlight/flashlight
  range); 0.022 keeps 30 m at ~0.65, 50 m ~0.30, 80 m ~0.045 — depth cue
  preserved without hiding targets. The gates (30 m ≥ 0.60, 80 m < 0.15) are
  pinned in test/fog.test.mjs so later tuning cannot regress readability.
  Height-based fog considered and rejected: FogExp2 has no height term, and a
  custom height-fog shader adds per-pixel cost with no benefit at this city
  scale — revisit only if V6P-1 shows headroom.
- V2P-4 moonlight & ambient: the goal is contrast, not brightness — raise the
  key light (moon 0.8 → 1.1 lx) while lowering the fill floor (hemi 0.3 →
  0.22, ambient 0.15 → 0.08) so shadowed alleys stay dark and moonlit surfaces
  pop; exposure 1.2 stays fixed so the scene remains readable. Shadow bias
  0.004 ≈ 0.2 texel (44 m frustum over 2048 px → ~0.0215 m texel) plus
  normalBias 0.05 targets acne at grazing angles on flat ground without
  peter-panning. mapSize / frustum / PCFSoft untouched: shadow-cost
  measurement is V2P-6, streetlight falloff + halo is V2P-5. New values are
  pinned in test/lighting.test.mjs so later tuning cannot regress silently.
- V2P-5 streetlights: the goal was a punchier falloff + warmer color without
  adding lights (17/40 in use; more PointLights = more per-pixel cost, and
  V2P-6 will measure shadow/light cost before any additions). Choice: hotter,
  tighter pool (55 cd / 14 m, decay 2 unchanged) + warm sodium amber 0xffb066
  shared by the lamp light, the head emissive (now 3.2), and the halos — one
  warm source everywhere. The glow is carried by 40 additive halo sprites
  (one shared SpriteMaterial + procedural 64×64 radial canvas texture):
  sprites billboard for free, are static (no per-frame work), add zero lights
  and zero per-frame allocation, and cost only 40 scene objects (298/600
  mesh-equivalent budget). Sprite over billboarded mesh: no per-frame lookAt
  cost. Deliberate asymmetry: all 40 fixtures glow (fixture language) while
  only the 12 nearest (6 on low quality) actually cast light — the same
  asymmetry v1's emissive heads already had; halos reinforce "this street is
  lit" even where the pooled light hasn't reached. Muzzle-flash color
  (0xffb878 in Shotgun.js) intentionally untouched — V2P-8 territory.
  Baseline correction discovered here: pre-change clean boot is 258 meshes,
  not the 270 recorded in earlier rounds (worktree probe @ 608946f); the
  corrected baseline is recorded in TASKS.md.
- V2P-6a shadow cost: measured in a real browser (Playwright headless
  Chromium, SwiftShader, 1280×720, 180 effective samples/condition):
  shadow-only 0.095 ms/frame, full low-quality fallback 0.165 ms/frame.
  Structural finding: the shadow pass is currently idle — no mesh in the
  scene has `castShadow = true` (only the moon light, Lighting.js:31), so
  the 2048² PCFSoft pass draws nothing every frame, and mapSize/frustum
  tuning is moot until casters exist. DECISION: defer any quality-tier
  decision (1024 mapSize, smaller frustum); instead V2P-6b enables real
  casters (city buildings, zombies, streetlight poles + ground
  `receiveShadow`) because the measured idle cost shows ample headroom, then
  RE-MEASURE with tools/shadow-cost.mjs before any tier decision. Numbers
  recorded in docs/shadow-cost.md for V6P-1.
- V2P-6b real-caster shadow cost: with casters enabled (all city building
  boxes, streetlight poles, and all six body meshes per zombie cast; ground
  receives), the shadow pass is no longer idle: measured A−B = 0.186
  ms/frame (stable across 3 independent probe runs; the idle pass was 0.095),
  and the shadow pass adds +28 draw calls / +916 triangles (A: 134 calls /
  5044 tris). DECISION: shadows ON at high quality remain justified — 0.186
  ms/frame ≈ 1.1% of a 16.7 ms frame budget, ample headroom; a 1024 mapSize
  tier or frustum shrink is still not justified by the data. Revisit only if
  V6P-1 shows frame-time pressure or the caster population grows materially
  (more concurrent zombies near the player). Numbers in docs/shadow-cost.md.
- V2P-7 snow: three separate THREE.Points (near/mid/far) instead of per-vertex
  sizing, because PointsMaterial has no per-flake size attribute (a custom
  shader would add risk for a cosmetic gain). Cost is +2 draw calls; Points
  objects are not counted against the mesh budget, and per-frame CPU stays
  proportional to flake count, not layer count. Total flakes kept at 1500
  (not raised toward the 2500 budget) so Lighting.setQuality's 1500→750
  low-quality toggle keeps its meaning and frame cost stays flat — depth is
  bought with size/opacity/fall-speed differences, not more flakes. Ground
  splash (mentioned in the V2-PLAN phase line) deferred: flakes wrap instead
  of landing, so a real splash would need per-flake ground-collision checks
  against city AABBs every frame — expensive, and the acceptance criterion
  only requires that snow works without obscuring gameplay. Revisit as a
  micro-task before V7P-1 if budget remains. Determinism: the gust is a pure
  function of accumulated dt and wobble uses LCG-drawn phase/frequency, so
  identical dt sequences on two fresh instances are bit-identical — pinned by
  the new twin test.
- V2P-8 sprite over quad for the muzzle flash: an additive radial-glow
  sprite reads far better in the dark than a flat opaque square and
  billboards automatically; the pooled PointLight (already in the 17-light
  budget) stays the only dynamic flash light — no new lights. depthTest
  false keeps the flash visible through the barrel. The pitch kick lives
  on Player (addPitchKick + decay in update) because Player.update writes
  camera.rotation every frame — a weapon-side offset would be overwritten
  the same frame. Kick call sites are typeof-guarded so the plain-object
  fake players in axe/weaponbank tests stay valid. Tracer deferred: it is
  optional in the plan and would add a world-space mesh pool with
  per-blast orientation; revisit after V6P-1 establishes perf headroom.
- V2P-9 beacons as emissive geometry, not lights: readability was bought
  with emissive materials + additive halo sprites instead of new
  PointLights, keeping the light budget at 17/40; fog attenuates emissive
  color the same as lit color, so distant beacons fade gracefully into
  the night instead of punching through the fog. Color language (seeds
  V3P-1 safe-vs-dangerous): warm amber (0xffc878) center spire = primary,
  safe landmark; red (0xff4433) corner beacons = caution, placed 1 m from
  the diagonal spawn points (±85,±85) so the wave origins are marked;
  cool blue (0x3d6fa8) MeshBasicMaterial strips = neutral direction cue
  along the street center lines. No AABBs on any beacon or strip: they
  are purely visual, which keeps collision/verify behavior (and the exact
  87-AABB assertion) byte-identical. Strips sit on nominal center lines
  {±12,±36,±60}; the ±12 streets are slightly off true visual center
  because the center block is special (8×4 building) — acceptable since
  those lines are guaranteed walkable. Spire/beacon castShadow=true
  extends the landmark silhouettes into the moon shadow pass (tiny
  geometry, negligible cost per V2P-6b); strips castShadow=false.
- V3P-1a plaza halos (safe-zone language): open plazas read as safe/lit
  gathering areas against streetlight-lit streets and unlit alleys, using
  additive ground glow instead of another light source — 22 halo sprites at
  the deterministic plaza centers (LCG seed 7, collected in City.js at layout
  time via a push that consumes no rnd() draw, so the city layout stays
  byte-identical), one shared SpriteMaterial (0xffd9a5, opacity 0.35, y=0.5,
  scale 6). Color choice: a pale amber distinct from streetlight 0xffb066
  (fixture pools), spire 0xffc878 (landmark), and beacon 0xff4433 (caution),
  keeping the V2P-9 color language coherent — plaza amber = safe open space —
  and keeping the color-filtered test assertions (40/1/4) untouched. Ground
  level (y=0.5) rather than streetlight head height: the glow marks the
  ground you stand on, reads as "lit plaza floor", and a 6 m sprite at plaza
  center (15×15 blocks) stays restrained. No lights, no AABBs, no Math.random,
  no per-frame work: +22 sprites only (boot 272 meshes + 68 sprites = 340 ≤
  600; 17 lights, 3 points unchanged). getPlazaCenters() exposes the set for
  V3P-1b signage placement.
- V3P-1b signage + unlit-corridor marking: the central cross (street x=0
  running in z, street z=0 running in x) is THE unlit danger corridor —
  both lines have no streetlight poles (0 ∉ STREETS = [-60,-36,-12,12,36])
  and no blue directionality strips, and they run through the city center
  past the spire. Marked BOTH legs (the cross is one connected route):
  red = caution (0xff4433, already used for the spawn beacons) as ground
  strips; amber = safe (0xffd9a5, the plaza-halo color) as signage at all
  22 plaza centers (post + emissive panel). Details: strips at y=0.09 sit
  above the blue strips' top (0.055), so the two never share faces where
  they cross; 1 m clearance around the center tower (8×4×9, footprint
  x∈[-4,4], z∈[-2,2]); strips extend to ±79.5 (city edge) and pass under
  three parked cars on the axis ((0,39.2), (±39.2,0)) — hidden underneath,
  which reads as a road line under a parked car. Signs are visual-only (no
  AABBs, consistent with the streetlight poles) and carry no halo because
  the plaza already has a ground halo. The outermost ±60 lines are also
  poleless but were left out of V3P-1b (outer streets) — revisit under
  V3P-4 (street directionality). Note correction: node:test counts each
  test() block individually (city.test.mjs went 16 → 17 blocks), so npm
  test totals grow by 1 per added block (109 → 110); the round-10
  "plain script counts as one test" note was wrong.

- V3P-2 eye placement: eyes are nested as children of the head mesh, not siblings in the zombie group. The shared-materials and per-type-body tests pin group.children.length === 6 and the hit-flash/death swap loops iterate _parts only; nesting also inherits per-type head scale and pose (hunched shambler) for free and leaves hitbox anchors untouched. Dead-corpse glow is killed by a one-line swap to shared DEADEYEMAT in the fatal damage branch — otherwise sinking corpses keep glowing like live threats.

- V3P-3 fog-vs-targets verdict: keep ρ = 0.022, no tuning. The two test gates (V(30 m) ≥ 0.60, V(80 m) < 0.15) confine density to [0.01722, 0.02382]; corner-beacon visibility at 118.7 m is faint (0.0003–0.0154) across the entire range, so fog tuning cannot make beacons legible from city center. Beacons are local spawn-zone caution markers — clear within ~35 m, which is their design role (zombies spawn at ±85, ±85). All gameplay-relevant targets (zombies ≤ 30 m, streetlights ≤ 14 m, plazas/signage ≤ 30 m, spire) are clear in their intended ranges. Center-visible beacons would require a budget-neutral halo-scale/emissive change in a cityDressing function — deferred as a V3P-4 candidate, not a fog change.
- V3P-4 scope decision: "street directionality" resolves as ground markings for the unlit outer segments. The end segments of the outermost ±60 street lines (|coord| 60 → 79.5) are the only poleless stretches in the street network (poles exist only at axis coordinates ±24/±60) and were explicitly deferred from V3P-1b. They are marked with the existing red caution language (0xff4433, y = 0.09, above the blue strips top) rather than by adding lamps: no new PointLights (17/40 budget) and streetlight lights are driven from streetlightAnchors in Lighting.js, which this task intentionally does not touch. The other two plan items needed no change: lamp alignment is already uniform (4.2 m offset, −60/−24/24/60 spacing) and vehicle placement was already swept/fixed in 8b-2d. The V3P-3 corner-beacon halo-scale candidate is dropped, not deferred: the V3P-3 verdict established beacons as local spawn-zone markers by design, and center visibility is not a design goal. Phase 3 (V3P-1..V3P-4) complete.

- V6P-2b shadow-pass decision: keep shadows ON, no mapSize/frustum tier. The measured real-caster cost is 0.186 ms/frame (V2P-6b, stable across three independent probe runs) ≈ 1.1% of a 16.7 ms frame budget, and V6P-1 measured a 2–3× overall headroom margin. V2-PLAN explicitly prefers stable performance over excessive effects, so no tier is justified while the margin holds. Re-measure (tools/shadow-cost.mjs) before adding any tier if a later feature (e.g. V2P-10 restrained bloom) consumes part of the margin. The zombie contact/slide per-frame allocations ranked alongside it were fixed with a caller-owned scratch object (see changelog) rather than a behavior change: steering stays byte-identical and all steering tests plus the full headless verifier pass unchanged.
- V2P-10 bloom — final decision: KEEP as shipped (strength 0.25, radius 0.5, threshold 0.0, full resolution, 2 composer passes). V6P-1 measured a 2–3× frame-headroom margin before it landed; the shipped pass was then measured in a real browser on an identical world state (V2P-10b pixel diff): 31.8% of pixels shifted >8 luminance, mean +3.71/255, bright pixels 1.17% → 1.30% — an active but restrained full-frame glow that preserves readability. V6P-1's stricter suggested shape (threshold ≥ 0.8, half resolution) was not adopted: threshold 0.0 produced the intended restrained night glow at negligible measured cost, and retuning would be a post-release improvement requiring a fresh visual check. Headless runs stay byte-identical: the `instanceof THREE.WebGLRenderer` guard keeps PostFX disabled without a real renderer.
- V7P-4 code-hygiene deferral: the 5 non-blocking should-fix items from the V7P-1 final review — HUD.js:177 per-frame weapon-slot array literals; AudioBank.js:402 bounded (≤ 4) live-voice list rebuild while groans are active; Zombie.js:260 commit-only tangent allocation (rare); AudioBank.js:33 comment vs `entry.p`; WaveManager.js:120/146 cap-comment wording — are deliberately deferred rather than folded into the final docs round. None touches gameplay behavior, tests, budgets, or an acceptance criterion, and all are bounded. They are recorded here as the only known open code items for Version 2 and are candidates for a v2.x cleanup pass.
- Phase 7 complete / Version 2 complete: V7P-1 final review = ACCEPT WITH CAVEATS with zero must-fix; V7P-2 = nothing to fix; V7P-3 = full suite green (npm test 117/117, E2E 18/18 with 0 console/page errors run before build, build green, verify-game 81 ok / 0 fail / 0 skipped FULL ACCEPTANCE, temp probes deleted); V7P-4 = final docs. Every docs/V2-PLAN.md acceptance criterion now has concrete evidence in TASKS.md. Version 2 is complete on branch `v2`; v1 remains frozen at `feat/iteration-2` until the merge decision.
- Round 38 pointer-lock/mouse-look verification note: headless Chromium does not deliver non-zero `movementX` for CDP-synthesized mouse movement while pointer-locked, so the state-injection E2E (which sets yaw/pitch directly) cannot prove mouse look end-to-end headlessly. Verified instead by dispatching a real `mousemove` with explicit `movementX` into the page: the exact yaw delta at `LOOK_SENS` (100 px → 0.22 rad) confirmed the Input.js → Player.js pipeline, and pointer-lock acquisition/retention itself works headlessly (`locked=true` throughout, zero console errors). Decision: keep `tools/e2e-mouselook2.mjs` and `tools/e2e-movement.mjs` as permanent fast acceptance probes for the input paths (mouse look, WASD/sprint, reload) that the main E2E cannot cover; the headless CDP limitation is recorded as a harness artifact, not a game defect. No game code changed.
- Round 39: the five should-fix items deferred in V7P-4 are now resolved (v2.x cleanup pass, direct GPU-0 edits). All are behavior-neutral: HUD per-frame slot-array unroll; groan-voice expiry as in-place swap-pop; comment fixes for the AudioBank `{at, p}` field shape and the WaveManager cap wording; the zombie slide-commit tangent now uses a constructor-owned scratch (`_tan`, mirroring `_cn`). Full suite and E2E pass unchanged (117/117, 81/0/0, 18/18). Version 2 now has zero open code items; the remaining documented items are post-release design options (bloom retune shape, center-visible beacon halos), not defects.
