# Deadfall: Stockholm Afterdark — Zombie Graphics & Movement Upgrade Plan

*Direction chosen 2026-09-19, inspired by three.js `webgl_animation_skinning_blending`
(skeletal-animation blending, Mixamo model). Decisions locked by the user:*
*mesh route = **hybrid (Pixal3D candidate → Blender finish)**; animation source =
**Mixamo retarget**; perf mitigation if over budget = **LOD swap to primitives beyond ~25 m**.*

---

## 1. Problem statement

Zombies today are rigid BoxGeometry/CapsuleGeometry assemblies driven by a procedural
limb-oscillation walk (`Zombie.js` update: `swing = sin(_time*6 + _phase) * 0.35` on
arm/leg pivots, bob on the group). It reads as "blocks sliding", not "a person running
at you". The three.js skinning-blending example shows the target quality: a **skinned
mesh** whose **animation clips cross-fade** (idle ↔ walk ↔ run ↔ attack), which is
exactly what a chase-then-strike zombie needs.

Faces are already good (AI-generated portraits, emissive self-lit). The bodies and the
motion are the gap — flagged as the biggest visual ceiling in `docs/VISUALS-PLAN.md` §3.

## 2. Target runtime model

Per zombie type (walker / shambler / screamer), one **rigged, textured glTF** with clips:

| Clip | Driven by (existing state) | Blend |
|---|---|---|
| `idle` | not chasing, not attacking | base |
| `walk` | chasing, normal speed | cross-fade ↔ run |
| `run` | chasing + FRENZY / close pursuit | cross-fade ↔ walk |
| `attack` | melee windup/strike window | additive layer over locomotion |
| `hurt` | knockback stagger (0.35 s) | 0.15 s crossfade in/out |
| `death` | `isDead` | one-shot, then corpse sinks (existing) |

- `AnimationMixer` per zombie; `mixer.update(dt)` inside `Zombie.update` — deterministic
  (clip time advances by dt; no `Math.random`), headless-safe (mixer skipped without GL).
- Existing movement logic (yaw/turn/slide/collision) is untouched; only the visual layer
  swaps from primitive pivots to a `SkinnedMesh`.
- Face plane + outfit material scheme kept: the face plane rides the head bone (the
  existing face-texture-on-white + emissiveMap trick applies to the head material slot);
  outfits become material variants on the torso/leg slots (same 3-variant LCG pick).
- Hitboxes (`getHitboxes`) stay analytic (position-based spheres) — unchanged contract.

## 3. Asset pipeline (hybrid route)

```
own generated art (.research/zf-*, outfit-*)        Mixamo (rig + walk/run/attack/death)
        │ WanGP Z-Image full-body refs                       │ FBX
        ▼                                                    ▼
Pixal3D on the 3080 (image→3D candidate) ──────► Blender (headless --background --python)
  (Comfy-Org repack, int8 + low-VRAM fits ~10 GB               retopo ≤2–3k tris · retarget Mixamo rig ·
   on the 3080; per user directive)                             UV-project outfit · texture bake · glTF out
        └────────────► public/assets/zombies/<type>.glb ◄─────┘
```

- **Mesh-generation model: Pixal3D** (TencentARC, SIGGRAPH 2026; MIT license — no
  Tencent-restrictive-terms risk, unlike Hunyuan3D-2). Pixel-aligned image→3D with
  PBR textures; `--low_vram` mode (1024 res, on-demand loading, SDPA backend) fits
  ~10 GB → runs on the **3080**, leaving the 3090 untouched for inference.
  Repackaged for ComfyUI at `Comfy-Org/Pixal3D` (bf16 + int8_convrot diffusion,
  DINOv3 clip_vision, Trellis.2 shape/texture VAEs). Multi-view variant
  (`inference_mv.py`) available if we ever render multi-view refs in WanGP.
  Caveat: the TRELLIS.2 base lists 24 GB as its tested floor — validate the 10 GB
  low-VRAM claim on the 3080 during the pilot; fall back to `--low_vram --resolution
  1024` + SDPA first.
- **Blender is not installed** — one-time setup (portable .run). Scripts under
  `tools/blender/` (`retopo.py`, `retarget-export.py`, `bake-tex.py`), deterministic.
- Mixamo animations retarget onto our skeleton in Blender (the example's own workflow).
- Every asset recipe recorded in `docs/ASSET-PIPELINE.md` (prompt/settings JSON/output size).

## 4. Pilot → batch order

1. **Walker pilot** end-to-end (art → Pixal3D → Blender → glTF → in-game) — de-risk.
2. **Perf gate** (`tools/perf-measure.mjs`, `tools/shadow-cost.mjs`, `verify-game` S8):
   24 skinned walkers on SwiftShader. If over budget → **LOD swap**: skinned within ~25 m,
   today's primitives beyond (both bodies already exist; `LOD` or distance check in update).
3. Batch Shambler + Screamer through the same scripted pipeline (variants share one mesh,
   material swaps only — mirrors the FACEMAT scheme).
4. Re-measure visuals (`look-capture`/`look-metrics` vs `.research/look/baseline-HEAD/`),
   update `docs/perf-baseline.md` + TASKS.md.

## 5. Budgets & risks

- Meshes ≤ 600 (414/459 now): +1 skinned mesh/zombie vs ~6 primitives today → **net −5
  meshes/zombie**, budget improves. Verts rise (~2–3k vs ~500) — skinning + vertex cost
  is the unknown; that's what the gate measures.
- Determinism: clip time from dt only; per-zombie clip offset from the existing LCG
  `_phase` (desyncs the herd without Math.random).
- Headless: GLTFLoader path is browser-only (same no-op pattern as face textures);
  headless tests keep asserting the primitive stub.
- GitHub Pages weight: ≤ ~2k tris + one 512–1024 atlas per type ≈ ~1–2 MB × 3 — inside
  the asset ledger.
- VRAM: one heavy generator at a time (WanGP currently holds a 3090).

## 6. Boss at the end of level 5 (wave 5) — new scope

The user's "level 5" maps to the game's **wave 5** (the game is wave-based;
`WaveManager.buildQueue(5)` currently yields 20 zombies: walkers + i%5 shamblers
+ i%2 screamers, cap 13). Add a **boss zombie that spawns at the end of wave 5**.

- **Design (to confirm):** a unique heavy type (working name `brute`) — larger
  silhouette (~1.4× scale), high HP (≈ 4× a shambler base, wave scaling on top),
  slower base speed but a short lunge/charge attack, and a telegraphed heavy melee.
  It spawns **once the wave-5 queue is fully spawned and cleared** (last-kill
  trigger), or as the final entry of the wave-5 queue — pick during implementation.
- **Visuals ride the same pipeline:** the boss is a fourth glTF from the
  §3 pipeline (own generated art → Pixal3D candidate → Blender finish →
  `public/assets/zombies/brute.glb`), with clips `idle/walk/charge/attack/hurt/death`
  — the boss is the natural showcase for the skinning-blend work (charge ↔ walk
  cross-fade is the same mechanism as run ↔ walk).
- **Budget:** boss counts within the 24-zombie cap (wave-5 cap is 13 → fits);
  +1 mesh, +1–2 lights max (e.g. a rim light) — re-check S8 budgets.
- **Tests:** new `test/boss.test.mjs` — spawn trigger at wave-5 end, stats,
  charge state machine, kill economy vs pistol/axe/sword, frenzy interaction
  (flat-50 vs boss base), headless-safe.
- **UI:** boss health bar in the HUD + a wave-5 "boss incoming" banner (Screens.js).

## 7. GPU allocation (user directive, 2026-09-19)

- **WanGP (image models, incl. Z-Image for faces/outfits/full-body refs) may run on
  the 3080** — free the 3090 for other jobs.
- **Video models (LTX-2, Wan video/VACE, etc.) must NOT touch the 3090** — that card
  hosts the current inference model. Run video generation on the 3080 only.
- **Pixal3D (image→3D) targets the 3080** — int8_convrot weights + `--low_vram`
  (1024 res) reported to fit ~10 GB, comfortably inside the 3080's 24 GB and clear of
  the 3090. Validate peak VRAM during the Walker pilot; if it exceeds expectations,
  drop resolution/num_views before considering the 3090 (which stays reserved).
- Blender Cycles bakes run on whichever card is free (3080 first choice); they are
  short and splittable, so they can interleave with WanGP/Pixal3D jobs.

## 8. Open items

- Install Blender + Pixal3D env (TRELLIS.2 base + natten + utils3d; one-time, needs
  approval + GPU window on the 3080).
- Mixamo export format (FBX → Blender → glTF) vs direct glTF where possible.
- Whether `run` should be a distinct clip or a timeScale-up of `walk` (pilot decides).
- Boss spawn trigger (last-kill vs final-queue-entry) and final stat block.
- Validate Pixal3D peak VRAM on the 3080 (`--low_vram`, SDPA backend) during the pilot.