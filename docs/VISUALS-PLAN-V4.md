# Deadfall: Stockholm Afterdark — Visual Upgrade Plan v4

*Branch `v4`. Grounded in direct source inspection + three read-only code audits
(zombies, weapons, buildings) + measured `look-metrics` + verified GLB contents.
Supersedes the assumptions in `docs/VISUALS-PLAN.md` (2026-09-18) and refines
`docs/ZOMBIE-UPGRADE-PLAN.md`.*

## 0. What is already shipped (do NOT redo)

The cheap ambient/atmosphere wins from the old VISUALS-PLAN are already in the
codebase. Verified in source:

- **Lighting/IBL** — ACESFilmic @ 1.2 exposure, moon dir-light 1.45 lx, 12
  streetlight pools @ 70 cd, hemi 0.30 + ambient 0.12, and a **PMREM env map
  baked from the game's own sky** (`src/world/envmap.js`, `Lighting.js`).
- **PostFX** — GTAO + animated film grain + vignette + **restrained bloom**
  (threshold 0.72, only real light sources bloom) (`src/game/PostFX.js`).
- **Buildings** — procedural lit-window facades with color + emissive + **normal
  + roughness** maps, per-window warm/cool variance, flicker (`src/world/City.js`).
- **Ground** — photoreal wet-asphalt color map + cracked/puddle normal + roughness.
- **Sky** — gradient dome + horizon glow + light-pollution haze + twinkling
  starfield + textured moon (`src/world/sky.js`, `assets/sky/moon.jpg`).
- **City dressing** — emissive lamps, beacons, plaza panels, cars, snow drifts.
- **Zombies** — AI faces (self-lit), 9 AI outfit textures, hair, accessories,
  per-type tint/width/emissive, limb-decap/limb-drop/blood pools.
- **Weapons** — muzzle-flash sprites, swing trails, hit markers; sniper/axe/sword
  carry AI-generated PBR skins.

So the plan targets the **specific remaining gaps**, not the generic ones.

## 1. The real gaps (ranked by impact)

1. **Zombies render as primitive boxes — the rig is dead code.** `_applyLOD`
   (`Zombie.js:1022-1027`) forces `root.visible=false` at every distance and
   shows the primitives; `loadSkin` (`Zombie.js:489`) sets `animations: []`.
   `walker-fixed.glb` has **0 clips**; `walker-final.glb` has all 14
   (Idle/Walking/Running/Punch/Death/No — exactly `SKIN_CLIPS`). Net effect: the
   player never sees the skinned mesh, only boxes with a procedural sin() bob.
   All four types share one asset (`SKIN_ASSET:432`).
2. **Pistol & shotgun are untextured flat primitives** (`Pistol.js:72-83`,
   `Shotgun.js:78-88`); no normal/roughness on any weapon. Sniper is a single
   box with no barrel/scope/flash render (`Sniper.js:71`, `_flashT` set but
   never drawn). Recoil is translate-only; bob is 1-axis sub-cm; swap is an
   instant visibility pop (`WeaponBank.js:126`). Axe leaks its texture map on
   dispose (`Axe.js:201-210`; Sword disposes correctly at `Sword.js:225`).
3. **Buildings read flat/procedural.** 67 boxes, only 4 facade variants cloned
   per building (268 texture uploads for 4 patterns, `City.js:334-350`), 4 body
   colors, no aoMap, ground is one plane with flat additive street detail,
   skyline is 12 pure-black boxes (`sky.js:227-242`).
4. **No body gore/dirt** on zombies; faces are flat jpgs on a plane.
5. **No street decals** (graffiti/tire-tracks/drifts) — streets read infinite.

## 2. Tooling reality (verified)

- **Wan2GP** live on :7860; headless via `tools/wangp_assets.py`
  (`/home/mgr/Wan2GP/env_uv/bin/python`, `--visible 2`), project LoRA
  `mattias_1024_z_2`. Good for faces/outfits/weapon-skins/full-body refs + video.
- **Blender 5.2** (flatpak) + `tools/blender/{finish-candidate,finish-bake-rig,
  repair-rig,bake-tex}.py`. Run `fix-glb-image-offsets.mjs` after every export.
- **Pixal3D** (image→3D, MIT) drivers in `.research/*.py`, targeted at the 3080.
- **No CUDA in this sandbox** (`nvidia-smi` fails; `mcpm_vision.py` → "No CUDA
  GPUs are available"). GPU generation runs as background jobs on GPU 2 (3080).

## 3. Execution plan (branch v4)

### Phase A — Zombies: revive the rig + per-type meshes (biggest win)
- **A1 Revive the skinned rig.** Make `_applyLOD` (`Zombie.js:1022`) actually
  branch on `LOD_DIST=25`: show `root` + hide primitives within 25 m, primitives
  beyond. Load `walker-final.glb` (14 clips) instead of the animation-less
  `walker-fixed.glb`, and keep `animations` (drop the `animations: []` strip at
  `Zombie.js:489`) after confirming the clips render the 1.8 m rest pose without
  the cm-scale distortion that motivated the strip. Restore the baked basecolor
  map on the body (`_attachSkin:910-914`) with `SKIN_TINT` as a multiplier.
  Update `test/zombie-skin.test.mjs` pins (currently pin the rig hidden).
  Cost: 0 new meshes (rig already built per zombie).
- **A2 Per-type meshes.** Generate distinct bodies for shambler/screamer/brute
  via the pipeline (Wan2GP full-body ref → Pixal3D candidate → Blender
  finish/rig/bake → `fix-glb-image-offsets.mjs`) → `assets/zombies/*.glb`.
  Point `SKIN_ASSET` at them; keep walker as fallback. ≤~2–3k tris each.
- **A3 Body gore/dirt.** Blood splats parented to the body in `damage()`
  (capped, disposed with the group) or a baked dirt overlay.

### Phase B — Weapons
- **B1 Pistol + shotgun skins.** Extend `tools/generate-weapon-textures.mjs`
  (add pistol/shotgun variants, same macro-close-up prompt style) → generate on
  3080 → wire via the existing load-event pattern (`Pistol.js`/`Shotgun.js`).
- **B2 View-model feel.** Add pitch/roll recoil + 2-axis bob to firearm
  `update()`; swap raise/lower easing in `WeaponBank.update` using `_swapT`;
  sniper muzzle-flash sprite (no light cost); fix Axe dispose texture leak.

### Phase C — Buildings + atmosphere
- **C1 Buildings.** Share facade materials (bake tiling into geometry UVs, kill
  ~250 texture uploads); extend to 8 facade variants + wider palette; new
  `src/world/FacadeTrim.js` instanced window-sill/frame (+1 mesh); road/sidewalk
  split + lower ground repeat; instanced 2-ring skyline with dim windows.
- **C2 Sky + decals.** Nudge `sky.js` horizon/glow up + a warm light-pollution
  band (target sky−ground delta toward −20); one merged street-decal mesh.

### Phase D — Cinematic (stretch)
- **D1 Attract video.** Wan2GP i2v/LTX-2 clip on the 3080, ≤15 MB, on the title
  screen. Optional title music.

## 4. Guardrails (hard rules)
- Budgets: meshes ≤640, lights ≤40, zombies ≤24, points ≤2500. Mesh headroom is
  tight (~513 with 0 zombies, ~10.9/zombie → 24 ≈ 774 already over), so prefer
  **zero-mesh** wins and InstancedMesh; measure with `verify-game.mjs` S8.
- Determinism: clip time from `dt`; phase offset from LCG `_phase`; no Math.random.
- Headless-safe: GLTFLoader browser-only; headless keeps primitive stub.
- `dispose()` reverses everything; new files <350 lines; `npm run build` green.
- Verify each phase: `npm test` (365/365), `npm run verify` (81/0/0), build,
  `check-assets.mjs`, `secrets-scan.mjs`, E2E 18/18, `look-capture`+`look-metrics`
  vs `.research/look/baseline-HEAD/`.
- GPU jobs: background, `--visible 2`, never the 3090.

## 5. Decisions locked by the user (2026-09)
- Scope: make a plan, create branch v4, implement all changes.
- Zombie route: new per-type meshes via Pixal3D from generated refs.
- GPU: 3080 (GPU 2) jobs are fine.
- Attract video: yes, ≤15 MB.