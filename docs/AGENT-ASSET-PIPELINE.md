# AGENT-ASSET-PIPELINE.md — how agents generate images/audio and inspect the game visually

Companion to `AGENTS.md`. Everything here is local and key-free: generation
runs against a **Wan2GP** install at `/home/mgr/Wan2GP`, inspection runs against
the dev server with the repo's own Playwright Chromium.

## 1. Wan2GP headless asset generation

**Entry point:** `tools/wangp_assets.py` wraps Wan2GP's in-process API
(`shared/api.py` session), so generation does **not** need the Gradio UI on
:7860 and can use a different GPU than the live server.

```bash
/home/mgr/Wan2GP/env_uv/bin/python tools/wangp_assets.py spec.json \
    --visible 2 --profile 2 --out public/assets/<subdir> [--dry-run] [--json] [--timeout 5400]
```

- **Use `/home/mgr/Wan2GP/env_uv/bin/python`, never system `python3`** — the
  system interpreter lacks numpy (`ModuleNotFoundError: No module named
  'numpy'`).
- **GPU 2 (RTX 3080) only.** GPUs 0/1 hold ~23 GiB of tabbyapi; a job that
  lands there OOMs or hangs. `--visible 2` is mandatory.
- `--profile 2` selects the Wan2GP compute profile; `--dry-run` validates each
  task via `validate_task` and exits without generating.
- One job per session, sequentially; on timeout the tool cancels + drains the
  queue (the abort runs on a daemon thread).
- **Long jobs → background tasks.** A yue2 song takes 30–90 min (the score
  stage dominates). A 3600 s timeout killed the first Swedish song mid-score;
  `--timeout 5400` completed it. Launch with a background job and poll
  `job_output`, never block the session.
- Attachments (refs/mask/guide) must be **absolute paths** — the tool chdirs.

### Spec schema (spec.json)

```json
{ "kind": "image" | "audio",
  "name": "output-stem",
  "prompt": "...", "alt_prompt": "...", "seed": 20260922,
  "resolution": "1024x1024", "steps": 40, "cfg": 4.0,
  "duration_seconds": 180,
  "loras": ["...safetensors"], "refs": ["abs/path.png"],
  "mask": "abs/path.png", "guide": "abs/path.abc",
  "custom_settings": { "save_score": 1 }, "settings": { } }
```

### kind=image → which model

- `qwen_image_21_7B` — edits/inpaint. Semantics: `refs` → `image_mode 3` +
  `video_prompt_type "I"`; `guide` → `"V"`; `mask` → adds `"A"`. UI defaults:
  `image_mode=1`, steps 40, guidance 4.0. LanPaint modes 2/3/4/5.
- `z_image` — pure t2i; LoRA support. Project LoRA:
  `/home/mgr/Wan2GP/loras/z_image/mattias_1024_z_2.safetensors`.
- Legacy UI-scraping tools (need WanGP Gradio on :7860):
  `tools/generate-zombie-faces.mjs` (9 faces + LoRA),
  `tools/generate-weapon-textures.mjs`, `tools/generate-outfit-textures.mjs`
  (aspect-matched resolutions, PNG→JPEG via sharp).

### kind=audio → yue2 (YuE2 full-song music model)

- `prompt` = **lyrics** (section tags `[Verse]`/`[Chorus]` help), `alt_prompt`
  = **style description** — the reverse of the usual convention.
- `duration_seconds` is an **upper bound**: frames = `duration × 25`
  (`max_tokens`; frame_rate 25, sample_rate 48000). The model can finish
  earlier — always measure with ffprobe and sync `SONG_PLAYLIST_SECONDS`.
- Two phases: "abc" (score) then "semantic" (audio render); initial cache
  60×25 frames. `model_mode`: 0 full / 1 melody / 2 off.
- `custom_settings.save_score = 1` writes `.abc` + `.mid` beside the song —
  keep them: `.abc` files are valid `guide` inputs for follow-up generations,
  and `audio_guide` + `audio_prompt_type="A"` supports hum-to-song.
- yue2 enhancer flags (when the optional text/vision enhancer is enabled):
  `T1` = lyrics, `L2O` = style, `B2O`, `T1,B2O`. **Leave it off**
  (`enhancer_enabled = 0`, the default in `tools/wangp_assets.py:197`) — the
  Florence/Llama/Qwen engines add latency and failure modes for no quality win
  in this pipeline.
- Defaults dump: `.research/soundtrack_yue2_settings.json` (steps 32, cfg 1.0,
  temperature 1.0, top_k 100, top_p 0.95). Weights are CC BY-NC 4.0 under
  `ckpts/yue2` (YuE2_VAE_bf16); LoRA dir `loras/yue2/` is empty.

### Post-processing (ffmpeg)

```bash
ffmpeg -y -i in.wav -af "loudnorm=I=-16:TP=-1.5:LRA=11" -codec:a libmp3lame -b:a 192k out.mp3
ffprobe -v quiet -show_entries format=duration -of csv=p=0 out.mp3   # verify
```

Then drop into `public/assets/audio/`, add to `SONG_PLAYLIST` +
`SONG_PLAYLIST_SECONDS` in `src/game/Game.js`, and run
`node tools/check-assets.mjs` (it ffprobes every song and fails on a >1.5 s
mismatch against the declared seconds).

## 2. 3D assets (zombie GLBs)

- Pixal3D generation drivers live in `.research/*.py` (e.g.
  `pixal3d-noflow.py` NAF shim).
- Blender is installed as flatpak **5.2**:
  `flatpak run --filesystem=home org.blender.Blender -b --factory-startup \
      --python tools/blender/<script>.py -- --in ... --out ...`
  (native fallback: `~/blender-install/blender-4.5.14-linux-x64/blender`).
  Scripts: `finish-candidate.py` (join/scale/decimate ≤3k tris),
  `finish-bake-rig.py` (UV bake + Mixamo retarget), `repair-rig.py` (rescales
  collapsed bone chains), `bake-tex.py`.
- **Known defect:** the Blender glTF export writes image bufferViews 8 bytes
  early → GLTFLoader hands the decoder a corrupt image → SwiftShader GL crash.
  Repair with `node tools/fix-glb-image-offsets.mjs` after every Blender export.
- Budget: ≤ ~3000 tris per zombie, 1.8 m height; the shipped mesh is
  `public/assets/zombies/walker-fixed.glb` (43 bones, 14 animations).

## 3. Visual inspection

Playwright Chromium 1.63 lives in `.browsers/`
(`PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers`, or the tools' hardcoded
`executablePath` `.browsers/chromium_headless_shell-1243/...`). Reinstall:
`node node_modules/playwright-core/cli.js install chromium`.

**All browser tools target the dev server on :5173** (`E2E_URL`/`PERF_URL`/
`INSPECT_URL` env overrides). Do **not** point them at `npm run preview` —
Pages/base-pathed builds 404 module URLs and the tools crash on
`window.__game` being undefined.

| Tool | What it gives you |
|---|---|
| `node tools/look-capture.mjs` | gameplay screenshots → `.research/look/*.png` (title + in-game views) |
| `node tools/look-metrics.mjs [png...]` | quantitative stats per PNG (brightness, saturation, contrast) via sharp — no model needed |
| `python tools/mcpm_vision.py --image <png> [--question "..."] --device cuda:2` | local VLM (Qwen2-VL-2B) answers visual questions, e.g. "is the zombie body visible or a shadow-only silhouette" |
| `node tools/inspect-zombie.mjs` | pre-gameplay rigged-zombie render probe (poses, debug camera, PNG) |
| `node tools/e2e-browser.mjs` | full-flow smoke E2E, 18 assertions, console/page-error capture |
| `node tools/perf-measure.mjs` | fps/heap baselines per condition (idle low/high, active, crowded) |
| `node tools/fog-sight.mjs`, `shadow-cost.mjs` | fog visibility and shadow-cost probes |

`window.__game` (set in `src/main.js:5`) is the in-page debug handle; probes
wait for it with `page.waitForFunction(() => window.__game && ...)`.

### Sandbox / SwiftShader limits (read before trusting a screenshot)

- Headless Chromium renders via **SwiftShader** (software GL). A gameplay page
  reliably dies ~3–5 s after gameplay starts with **zero JS errors** — so
  long-lived interaction probes and late-game screenshots are unreliable
  (docs/perf-baseline.md:98). Capture **pre-gameplay** states
  (`inspect-zombie.mjs` pattern) and verify dynamic behavior headlessly via
  `game.debug` / `test/skin-perf-gate.test.mjs` (static mesh/tri budgets from
  the GLB) instead.
- Launch args the tools use: `--no-sandbox --disable-dev-shm-usage
  --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.
- Startup on SwiftShader is 2.5–2.9 s; keep `waitForFunction` timeouts ≥ 30 s.

## 4. Verification of generated assets

After generating or wiring any asset:

1. `node tools/check-assets.mjs` — every `assets/...` reference in shipped
   code exists in `public/` (and `dist/` when built); song durations match
   `SONG_PLAYLIST_SECONDS`; dynamic face/outfit patterns are pinned. Exit 1
   on any problem.
2. `node tools/e2e-faces.mjs` / `e2e-face-diff.mjs` / `verify-outfit-textures.mjs`
   — texture load + pixel-diff checks in the real browser.
3. `node tools/look-capture.mjs && node tools/look-metrics.mjs` — visual sanity.
4. `node tools/secrets-scan.mjs` — exit 0 (no credentials committed).

## 5. Troubleshooting signatures

| Symptom | Cause / fix |
|---|---|
| `ModuleNotFoundError: No module named 'numpy'` | used system python3 → use `/home/mgr/Wan2GP/env_uv/bin/python` |
| yue2 job times out mid-score | score stage 30–90 min → rerun with `--timeout 5400` as a background job |
| song shorter/longer than declared | yue2 duration is an upper bound → ffprobe + update `SONG_PLAYLIST_SECONDS` (check-assets catches this) |
| `ZVEC_GREP.ENGINE.LOCK.BUSY` | zg is indexing → wait for `zg-index` to finish |
| E2E `Cannot read properties of undefined (reading 'player')` | tool hit a base-pathed preview build → run against :5173 |
| SwiftShader GL crash on skinned mesh | corrupted GLB image bufferViews → `node tools/fix-glb-image-offsets.mjs` |
| page dies seconds into gameplay, no errors | SwiftShader instability → capture pre-gameplay, assert headlessly |
| generation OOM on GPU 0/1 | tabbyapi holds ~23 GiB there → always `--visible 2` |
| `npm install` skips dev deps | sandbox `NODE_ENV=production` → `npm install --include=dev` |