# Deadfall: Stockholm Afterdark — Visual Upgrade Research & Plan

*Research date: 2026-09-18. Grounded in the live codebase, the live local WanGP install (v12.648 on :7860),
measured screenshot metrics, and web research on Blender-MCP / ComfyUI / 3D-generation tooling.*

---

## 1. Where the visuals stand today

Measured from 8 fresh headless screenshots (`tools/look-capture.mjs` → `.research/look/`) quantified by
`tools/look-metrics.mjs` (re-runnable regression guard):

| Scene | Mean lum (0–255) | Contrast (std) | Color temp | Sat | Bright px | Black px | Sky vs ground |
|---|---|---|---|---|---|---|---|
| Title screen | 23.9 | 22.2 | −0.07 | 20 | 0.7 % | 34 % | sky darker |
| Gameplay (default) | 51.7 | 55.9 | −0.06 | 57 | 4.3 % | 31 % | ground 31 units **brighter** than sky |
| Street intersection | 54.4 | 55.8 | **−0.13** | 64 | 3.8 % | 35 % | ground 48 units brighter than sky |
| Flashlight scene | 104.6 | 87.9 | +0.03 | 51 | 21 % | 7 % | strong local lift |
| Muzzle flash | 105.6 | 87.8 | +0.03 | 50 | 22 % | 7 % | strong local lift |

Read-out (consistent with code inspection):

- The night scene works, but **~1/3 of every frame is fully black** and the sky is markedly darker than the
  street — the atmosphere reads as "black with light pools" rather than "a living city at night". A subtle
  lift of ambient + a proper sky/environment balance would improve perceived quality with zero asset cost.
- Strong cool cast (−0.06…−0.13) is correct for moon/snow, but the intersection shot is notably blue-heavy —
  a small warm counter-balance (window light, street lamps) would add depth.
- No environment map ⇒ no reflections on wet snow/roads, no ambient richness. This is the single cheapest,
  highest-impact fix available (one texture + `PMREMGenerator`).
- No normal/AO/roughness maps; zombie bodies are primitive boxes/capsules — the biggest visual ceiling in a
  character-driven zombie shooter.
- No film grain/vignette, no decals (blood pools, graffiti, snow drifts), no lit-window/emissive facade detail,
  flat shader-only sky.
- Positive: flashlight/muzzle events produce strong local contrast (+50 lum) — the game already has great
  *event* lighting; it lacks *ambient* richness.

**Budget guardrails the plan must respect** (from `docs/V2-DECISIONS.md`, `docs/perf-baseline.md`):
meshes ≤ 600, lights ≤ 40, snow ≤ 2500, zombies ≤ 24, render wall ~1.2 ms on SwiftShader with 2–3× headroom,
no `Math.random` (seeded LCG), no per-frame allocations, headless verifier + Playwright E2E must stay green,
GitHub Pages deploy ⇒ raster asset weight matters, "stable performance over excessive effects".

---

## 2. What the local tooling can actually do (verified, not assumed)

### 2.1 WanGP (v12.648, running on :7860) — a full production studio, not just a t2i box

Confirmed live via its API and docs (saved in `.research/wangp/`):

- **Gradio API** at `/gradio_api` (`queue/join` + `call/<endpoint>`), `/config`, `/settings` export. The current
  `tools/generate-zombie-faces.mjs` (Playwright UI scraping) **can be replaced by direct API calls** — faster,
  deterministic, no UI fragility.
- **Built-in MCP server** (v1/v2):
  ```
  python wgp.py --mcp --mcp-api-version 2 \
    --mcp-transport streamable-http --mcp-host 127.0.0.1 --mcp-port 7866
  ```
  (or `--mcp-transport stdio`). Exposes progressive toolboxes:
  - `wangp_generate` — image/video generation from settings; **batch via manifest** (list of tasks, one submission);
  - `wangp_postprocess` — SeedVR2 / FlashVSR / PiD spatial upsampling, RIFE temporal, **film grain**, face refiner;
  - `wangp_models` — discover available models, capabilities, local file availability;
  - `wangp_io` — file read/write/search in the WanGP workspace;
  - `wangp_session` — jobs, queue, notifications, gallery upload/download;
  - `wangp_deepy_templates` / Deepy assistant — local LLMs (incl. **Qwen3.5-VL, a local vision model**) or external
    Claude Code/Codex for prompt enhancement, and `inspect_media` — **asks its LLM questions about generated images**
    (automatic art critique!).
- **In-process Python API** (`shared/api.py`): `init(root, cli_args)`, `submit_task(settings)`,
  `submit_manifest([...])` (batch), `submit_media_postprocessing(...)`, `list_model_metadata`,
  `get_default_settings`, `get_model_schema`, `get_model_availability`. Ideal for scripted asset pipelines.
- **Model coverage** (model families selectable in the running UI): Wan 2.1/2.2 (i2v, **VACE video editing**,
  face injection, spatial/temporal outpainting, **Animate motion transfer**), LTX-2 (cinematic video **with native
  audio**), Qwen Image Edit, **Z-Image** (fast t2i, already in use), Flux, Krea 2, Hunyuan Video, MiniMax H3,
  Infinitalk (lip-sync); audio: ACE-Step songs, MiniMax Audio, Qwen3 TTS; upscalers: SeedVR2, FlashVSR, PiD,
  Chain-of-Zoom; controls: **LoRAs + multipliers** (incl. your `mattias_1024_z_2` character LoRA), ControlNet,
  MatAnyone/SAM2/3 masks, image references w/ background removal, start/end frames.
- **Presets & batch**: settings export to JSON (your `.research/*.json` files *are* this format), LSet files,
  Media Flow plugin (folder-wide batch post-processing), 20+ community plugins.
- **Plugin/agent story**: MCP + agent skills are first-class; WanGP even reuses Claude Code as an LLM backend.

### 2.2 Hunyuan3D-2GP (same author, GPU-poor edition) — text/image → textured 3D meshes

- Shape gen ≈ 6 GB VRAM; shape + texture ≈ 24.5 GB (your 3090 is right at that ceiling — use the **mini/turbo**
  variants for headroom); runs via mmgp offloading.
- **Blender addon** ships with it; outputs glTF (GLTFLoader-compatible), plus ComfyUI wrappers exist
  (ComfyUI-3D-Pack, ComfyUI-Hunyuan3DWrapper).
- Relevance: generate candidate zombie/prop meshes **from your own generated face/outfit images** (single-view
  image→3D), then retopo/rig in Blender. Quality is "good candidate," not final asset — the Blender step is the
  quality gate.

### 2.3 Blender + Blender-MCP

- **Not installed on this machine** (needs a one-time install: apt/snap/portable .run; 64-core + dual RTX 3090
  ⇒ Cycles GPU baking is fast).
- Best MCP option: **ahujasid/mcp-for-blender** (28.9k ★, MIT, actively maintained, 2026-09) — a Blender addon
  that exposes Blender to *any* LLM as MCP tools. Alternatives: HoldMyBeer-gg/blend-ai (AGPL), arjun988/blender-skills
  (94 specialist skills for Claude Code/Codex/Cursor).
- Headless route (no MCP needed): `blender --background --python script.py` for batch retopo/rig/glTF-export —
  scriptable, CI-friendly, deterministic.
- Blender is the *authoring* tool; WanGP/Hunyuan3D are the *generation* tools. They compose:
  **WanGP image → Hunyuan3D mesh → Blender retopo + rig + texture bake → glTF → three.js GLTFLoader.**

### 2.4 ComfyUI (optional parallel backend)

- Community MCP servers exist (artokun/comfyui-mcp 755★, MeiGen-AI-Design-MCP 1.8k★, comfyui_LLM_party 2.4k★)
  and ComfyUI has a native HTTP API (`/prompt`, `/history`).
- It overlaps heavily with WanGP (same models, LoRAs, ControlNets, upscalers) but offers node-graph control,
  IP-Adapter, and 3D-pack integration. **Recommendation: don't add it now** — WanGP already covers the needs and
  is already installed with your LoRA. Keep ComfyUI as the fallback if WanGP's API/API-MCP hits a wall
  (e.g., a workflow needing node-level masking chains).

### 2.5 Environment maps / HDRI

- CC0 night-city HDRI: **Poly Haven / AmbientCG** (free, license-clean).
- Better for *this* game: generate a **2:1 equirectangular night-sky panorama in WanGP** (Z-Image or Qwen, wide
  panorama prompt, equirectangular) → use as both skybox background and PMREM environment in one asset. It will be
  stylistically coherent with the rest (same LoRA/prompt language) instead of a stock photo.
- three.js: `PMREMGenerator.fromEquirectangular(tex)` → `scene.environment` = free reflections on every
  material, including wet snow and roads. No new meshes, no new lights, no per-frame cost beyond one-time PMREM bake.

---

## 3. The upgrade plan, ranked by impact × cost (within the budget)

### Tier 1 — cheap, no new assets or deps, do first (days, not weeks)

1. **Environment map + lighting balance** *(biggest bang for buck)*
   - Generate (WanGP, Z-Image + your LoRA) or download a night-city equirectangular (2048×1024, quantized jpg
     ≈ 200–400 KB).
   - `PMREMGenerator` → `scene.environment` (low intensity, e.g. 0.15–0.3) in `Lighting.js`/`WorldCore.js`.
   - Result: wet-snow sheen, facade ambient, softer blacks; lift overall mean lum from ~52 toward 60–68 and cut
     black-pixel fraction from ~31 % toward <25 % (re-measure with `look-metrics.mjs`).
   - Budget impact: zero meshes, zero lights, one texture. Perf: negligible (PMREM is one-time; env lighting is
     already per-pixel work that exists via hemi/ambient).
2. **Film grain + vignette + grade pass** (PostFX.js)
   - Small `ShaderPass`: grain (animated via seed, deterministic), gentle vignette, subtle S-curve/warm-cool grade
     (warm near streetlights, cool in the open). UnrealBloom stays as shipped.
   - Cost: one extra fullscreen pass ≈ a fraction of the existing bloom cost — within the 2–3× render headroom;
     re-measure with the perf harness and gate on `docs/perf-baseline.md` rules.
   - This single pass changes the "look and feel" more than any geometry change: it makes the night feel *filmed*.
3. **Lit windows / emissive facade detail** (texture, not geometry)
   - Generate window-grid facade textures (WanGP: "night apartment facade, lit windows, snow, Stockholm") or a
     512×512 procedural-emissive tile; assign as emissiveMap on existing building materials.
   - The city suddenly reads as inhabited — the #1 atmospheric upgrade in FPS night scenes. Zero new meshes
     (material maps on existing geometry); watch texture memory (few MB total).
4. **Sky enrichment** (keep the shader sky, add depth)
   - Blend the equirectangular (or a generated panorama strip) behind/into the existing shader sky; add faint
     star twinkle via a seeded-noise term in the sky shader (deterministic, no allocations).
   - Fixes the "sky 30–48 lum darker than ground" imbalance measured above.

### Tier 2 — the character upgrade (weeks; the biggest visual ceiling)

5. **Skinned zombie glTF models** — two routes, start with a pilot:
   - **Route A (fast, AI-first):** your existing generated face + outfit images (`.research/zf-*`, `outfit-*`)
     → **Hunyuan3D-2GP** (mini/turbo on the 3090) → textured mesh → Blender retopo (decimate to ≤ ~2–3k tris,
     merge to ≤ 40 draw-adjacent groups), rig (auto-rig pro / Mixamo retarget), export glTF with 1–2 animation
     clips (walk + attack) via baked bone transforms.
   - **Route B (quality-first):** author/fix in Blender directly (MCP-assisted via mcp-for-blender for
     iterative agent-driven modeling, or headless `blender --background --python` for repeatable batches), using
     the AI-generated images as reference/decals (UV-project the generated outfit onto a hand-built mesh —
     Blender's UV-project + texture bake).
   - **Pilot:** one Walker. Validate: glTF load path (GLTFLoader is already a dep), bone/anim mapping to the
     existing `Zombie.js` state machine (reuse its yaw/turn/move logic; replace box/capsule render with skinned
     mesh), perf budget (24 zombies × skinned mesh — measure on SwiftShader; skinned meshes cost more than
     instanced boxes, so expect to cut zombie count or LOD-distance-swap to boxes beyond ~25 m), determinism
     (glTF anims are time-based — fine, no Math.random).
   - If the pilot lands within budget, batch the rest (Screamer, Shambler, variants) via the same pipeline —
     Hunyuan3D/Blender steps scripted, faces/outfits from the existing WanGP manifests.
   - Note: zombie *faces* are already AI-generated and look good; bodies are the gap.

6. **Decals** (blood pools, graffiti, tire tracks, snow drifts)
   - Generated textures (WanGP, 256–512 px, alpha) on a few instanced planes / merged into road geometry;
     budgeted against the mesh cap (use one merged decal mesh with many UV islands, not 600 quads).
   - Big atmosphere gain for cheap: streets stop reading as "infinite procedural".

### Tier 3 — cinematic layer (stretch, high delight, watch asset weight)

7. **Animated title screen / attract mode**
   - Keyframe still (Z-Image + LoRA, portrait 1024) → **Wan 2.2 i2v** or **LTX-2** (native audio) 4–8 s clip
     (e.g., fog rolling over the skyline, a figure in the distance) → mp4/H.264 ≈ 5–15 MB.
   - Optional: **ACE-Step / MiniMax Audio** (both in WanGP) for a 20–30 s title song, or **Qwen3 TTS** for a
     narrative line ("The city fell at midnight.").
   - GitHub Pages hosts video fine; keep total new media < ~15 MB.
   - Bonus: WanGP's **VACE/outpainting** can extend a static screenshot into a slow-pan video for menu backgrounds.
8. **Local vision critique loop** (development tooling, not game code)
   - `tools/look-capture.mjs` (already written) + `tools/look-metrics.mjs` (already written) give an objective
    baseline per change (the table above).
   - For qualitative critique: run the **WanGP MCP server** and use `inspect_media` with the local
    **Qwen3.5-VL** model (already available to WanGP's Deepy/prompt-enhancer stack) — ask targeted questions
    ("Is the snow reading wet? Are the zombies readable at 10 m? Is the sky too dark?") on fresh screenshots.
    This replaces manual screenshot review and works headlessly in CI.
9. **Optional:** ComfyUI (see §2.4) only if WanGP's API/MCP can't express a needed workflow.

---

## 4. Integration architecture for the repo

```
                        ┌─────────────────────────────┐
  prompts + manifests ─▶│  WanGP (:7860)              │
  (JSON, .research/)    │  • Gradio API (direct)       │
                        │  • Python API shared/api.py │
                        │  • MCP server (:7866)       │
                        └──────┬──────────────────────┘
        images / video / audio  │  post-process (SeedVR2, film grain, RIFE)
                               ▼
  Hunyuan3D-2GP ──── 3D mesh (image→3D / text→3D)
                               │
                               ▼
  Blender (+ mcp-for-blender for interactive; --background --python for batch)
   retopo / rig / bake / glTF export
                               │
                               ▼
  public/assets/*.glb + textures (budgeted for GitHub Pages)
                               │
                               ▼
  three.js (GLTFLoader, PMREM env map, PostFX grade)  ──▶  game
                               │
                               ▼
  verification: headless verifier + Playwright E2E (must stay green)
             + look-capture + look-metrics (visual regression guard)
             + (optional) WanGP inspect_media / Qwen3.5-VL (auto art critique)
```

Concrete changes to make:

1. **`tools/wangp-client.mjs`** — direct Gradio-API client (`queue/join` + `call/`) or a thin Node→Python bridge
   over `shared/api.py`. Replaces Playwright UI scraping in `generate-zombie-faces.mjs`,
   `generate-outfit-textures.mjs`, `generate-weapon-textures.mjs`. Accepts a manifest JSON
   (`{tasks: [{prompt, model_type, loras, resolution, seed, out}]}`) and writes outputs to `public/assets/` +
   `.research/`. (Your existing `*.json` settings files drop straight in as task payloads.)
2. **Start WanGP with MCP**: restart with
   `python wgp.py --mcp --mcp-api-version 2 --mcp-transport streamable-http --mcp-host 127.0.0.1 --mcp-port 7866`
   and point your agent's MCP client at `http://127.0.0.1:7866/mcp`. Then any agent (including this one) can
   `wangp_generate`, `wangp_models`, `wangp_postprocess`, `inspect_media` without any scraping.
3. **Blender setup (one-time)**: install Blender (portable .run is simplest), install the mcp-for-blender addon
   (optional), and add `tools/blender/` with headless scripts: `retopo.py`, `rig-export.py`, `bake-tex.py`
   (all `blender --background --python`, deterministic seeds).
4. **Asset pipeline doc**: `docs/ASSET-PIPELINE.md` recording per-asset recipe (prompt, LoRA, model, settings
   JSON, output size) so every texture/mesh is reproducible and auditable — you already do this informally in
   `.research/`; formalize it.
5. **Visual regression guard**: add a `npm run look` script (`look-capture.mjs` + `look-metrics.mjs`) and record
   current numbers in `docs/perf-baseline.md` as soft targets (e.g., gameplay meanY 60±6, black-frac < 25 %,
   detail ≥ 550). Re-run after every art change; fail a PR if a tier-1 change regresses it.
6. **Asset budget ledger**: track total `public/assets` weight (currently small) and cap additions
   (suggest ≤ 15 MB for tier-1/2, ≤ 30 MB if the title video is approved) to keep the GitHub Pages deploy light.

---

## 5. Suggested order of execution

| # | Step | Why first | Est. effort |
|---|------|-----------|-------------|
| 1 | Gradio-API client + restart WanGP with `--mcp` | Unlocks everything else; kills fragile UI scraping | 0.5–1 d |
| 2 | Env map (generated equirectangular or CC0 HDRI) + lighting balance | Biggest perceived gain, zero geometry | 1–2 d |
| 3 | Grain/vignette/grade pass + lit-window emissive textures | "Filmed night" feel; zero geometry | 2–3 d |
| 4 | Sky enrichment + decal textures | Atmosphere depth | 2–3 d |
| 5 | Zombie glTF pilot (Hunyuan3D→Blender→three.js, perf-measured) | The big upgrade; de-risk before committing | 1–3 wk |
| 6 | Batch remaining zombies via pipeline | Linear after pilot | 1 wk |
| 7 | Title video + audio (LTX-2 i2v / ACE-Step) | Delight, low gameplay risk | 1–2 d gen + review |
| 8 | Auto-critique loop (MCP `inspect_media` + local VLM) | Makes all of the above iterative, not guesswork | 0.5 d |

---

## 6. Risks & open questions

- **Skinned-mesh perf**: 24 skinned zombies may exceed the SwiftShader budget where boxes fit. Mitigation:
  LOD swap to the current primitive bodies beyond ~25 m, or cap live zombies at 12–16 for skinned rendering.
  Measure with the existing perf harness before committing.
- **Hunyuan3D quality for humanoids**: single-view image→3D is ambiguous (back side, proportions) and low-poly;
  expect the Blender retopo/rig pass to be most of the work. It's still far cheaper than hand-modeling.
- **VRAM contention**: WanGP, Hunyuan3D, Blender Cycles, and a local VLM all want the 3090s — run one heavy
  generator at a time; Hunyuan3D shape+texture (~24.5 GB) is borderline on a 24 GB card, so prefer mini/turbo
  or shape+texture on the 3080/3090 pair via offloading.
- **Licensing**: Poly Haven/AmbientCG = CC0 (safe). Hunyuan3D-2 weights carry Tencent's license — **check the
  terms for your distribution model before shipping generated meshes**. WanGP T&C require disclosure when a
  product integrates WanGP (not relevant for using it as an offline tool, but noted).
- **GitHub Pages weight**: video + extra textures can bloat the repo; keep the ledger (§4.6) and quantize
  (8-bit jpg, 256–1024 px, glTF with ≤ ~2k tris per zombie).
- **Determinism policy**: all AI outputs are *static assets* — they don't touch the no-`Math.random` rule.
  Keep runtime proceduralism seeded; grain/vignette animation must use the seeded LCG, not `Math.random`.
- **Open decisions for you**:
  1. Zombie route A (AI-first) vs B (Blender-first) for the pilot — I'd run A to de-risk the pipeline, then B
     for final quality.
  2. Is the 3090 free during dev windows (WanGP currently holds it)?
  3. Asset-weight appetite for the title video (≤ 15 MB vs ≤ 30 MB)?
  4. Do you want ComfyUI at all, or is WanGP's API/MCP sufficient (my recommendation: sufficient).

---

## 7. Artifacts produced in this research pass

- `tools/look-capture.mjs` — headless Playwright screenshot capture (title, gameplay, vantages, flashlight, muzzle).
- `tools/look-metrics.mjs` — quantitative per-screenshot metrics (lum, contrast, color temp, saturation,
  bright/black fractions, sky/ground split, detail) — the visual regression guard.
- `.research/look/*.png` — 8 baseline screenshots + metrics table (§1).
- `.research/wangp/` — saved WanGP README, `docs/API.md`, `shared/mcp_server.py`, Hunyuan3D-2GP README
  (reference for the pipeline).
