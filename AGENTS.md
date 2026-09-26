# AGENTS.md — operational guide for coding agents in this repo

Read this before touching the codebase. It is the operational companion to
`docs/ARCHITECTURE.md` (ground rules) and `README.md` (user-facing docs). The
asset/visual pipeline is documented separately in `docs/AGENT-ASSET-PIPELINE.md`.

## What this project is

Deadfall: Stockholm Afterdark — a first-person zombie-survival shooter built
with **Three.js ^0.185 + Vite ^8, plain ESM JavaScript** (no TypeScript, no
JSX, no packages other than `three` in `src/`). Single player + WebSocket
co-op (`server/server.js`, 20 Hz tick / 10 Hz snapshots, one room, ≤8 players).
Live site: GitHub Pages (`gh-pages` branch, base `/deadfall-stockholm-afterdark`).

## Hard rules (from docs/ARCHITECTURE.md — violations fail review)

- **Headless-safe construction**: never touch `document`/`window`/`AudioContext`
  unguarded; receive them via constructor params (`env`, `camera`, `renderer`,
  `inputState`). Tests instantiate the real objects with stubs.
- **Determinism**: no `Math.random` in `src/`. Seeded LCGs only — the standard
  shape is `s = (Math.imul(s, 48271) >>> 0) % 65537; return s / 65537`
  (see `src/game/AmmoDrops.js:61` `_rand()`). Fixed `dt = 1/60` stepping.
- **No per-frame allocation** in hot loops; reuse module-level scratch objects.
- **`dispose()` must fully reverse** every side effect (meshes, lights,
  textures, listeners, audio nodes).
- **Budgets** (pinned by `tools/verify-game.mjs` S8): meshes ≤ 640, lights ≤ 40,
  points ≤ 2500, zombies ≤ 24. Internal caps: blood pool 300 (`Blood.js:17`),
  stains 120, groan voices 4 (`AudioBank.js:16`), drops 20 (`AmmoDrops.js:25`),
  snow 1800 (`snow.js:35`), wave concurrency cap ≤ 16 (`WaveManager.js`).
- **New files stay under ~350 lines**; split a subsystem into helpers instead.
  Several legacy files exceed this (Zombie.js 1315, AudioBank.js 1239,
  Game.js 927, cityDressing.js 749) — do not grow them further; extract new
  logic into a focused helper module with its own test.
- In `src/game/Game.js` edit **only inside the `// WIRING:*` regions** unless
  you own the file.
- No placeholders/TODOs left behind. `npm run build` must pass after any task.

## Layout

- `src/main.js` — entry; exposes `window.__game = game` (browser debug handle).
- `src/game/` — Game.js (orchestrator), Player, Zombie, WaveManager, Weapon,
  Sniper/Axe/Sword, Flashlight, AmmoDrops, Blood, AudioBank, MusicEngine,
  MusicDirector, Screens, HUD, CollisionWorld, Input.
- `src/world/` — City, Lighting, Sky, snow, cityDressing (LCG city layout).
- `src/net/` — NetClient, Multiplayer, Match, WorldCore, protocol.
- `server/server.js` — authoritative ws room server (`npm run server`, PORT=8080).
  Also hosts the game over HTTP (`DIST_DIR` overrides the web root) and the
  hosted high score at `GET`/`POST /api/highscore` (persisted to git-ignored
  `server/highscore.json`; `HIGHSCORE_FILE` overrides).
- `public/assets/` — all shipped binary assets (audio, faces, outfits,
  weapons, zombies/GLB, posters, facades, ground, ground).
- `test/` — `node --test` suite (auto-discovered; 308 tests green at the time
  of writing). `tools/` — manual probes (NOT auto-discovered).
- `docs/` — ARCHITECTURE, V2-PLAN, V2-CHANGELOG (round history), V2-DECISIONS,
  perf-baseline, AGENT-ASSET-PIPELINE (this agent guide's asset companion).
  `docs/spec-*.md` are per-task implementation specs (git-ignored).
- `.hermes/` — git-ignored mission docs: `deadfall-progress.md` (phase log of
  the v6 improvement workstream), `deadfall-playtest.md`, `evidence/`, and
  `skills/` (task-specific playbooks: game-experience-analyzer,
  game-experience-density-optimizer, game-design-proposal-writer,
  paranoia-ai-system-evolver). Check `.hermes/deadfall-progress.md` before
  starting gameplay/visual/audio work — phases there may already cover it.
- `TASKS.md` — git-ignored work log; see "TASKS.md protocol" below.

## Commands (always run from the repo root)

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on :5173, proxies `/ws` → :8080 (`MP_SERVER` overrides) |
| `npm run build` / `npm run pages` | production build / Pages build (base `/deadfall-stockholm-afterdark`) |
| `npm run preview` | serve `dist/` on :4173 (note: base-pathed bundles 404 at `/` — run browser tools against :5173) |
| `npm test` | `node --test` over `test/` |
| `npm run verify` | headless staged playthrough of the real `Game` (S1–S10) |
| `npm run server` | co-op server on :8080 (PORT/HOST env) |
| `npm run graft-build` / `npm run graft -- ask "..."` | tree-sitter code graph (see below) |
| `npm run zg-index` / `npm run zg -- query "..."` | local embedding semantic search |
| `node tools/rag-index.mjs` / `node tools/rag-query.mjs "..."` | lexical TF-IDF index + query (see below) |
| `node tools/check-assets.mjs` | asset reference integrity + audio-length audit |
| `node tools/secrets-scan.mjs` | credential leak scan (exit 1 on findings) |

The sandbox exports `NODE_ENV=production`, so dev deps need
`npm install --include=dev`; `.npmrc` pins the npm cache inside the workspace
(`~` is read-only here).

## Verification workflow (use all of it, in this order)

1. `npm test` — must stay green (308/308 baseline).
2. `npm run verify` — headless playthrough; must report 0 FAIL. Skipped stages
   are acceptable mid-project, not at acceptance.
3. `npm run build` — bundler resolves everything.
4. `node tools/check-assets.mjs` — every asset referenced by shipped code
   exists in `public/` (and `dist/` when built); audio durations are compared
   against `SONG_PLAYLIST_SECONDS` / `LEVEL_TRACK_SECONDS` in Game.js.
5. `node tools/secrets-scan.mjs` — exit 0.
6. Browser E2E against the **dev server** (`npm run dev` in a background job,
   then `node tools/e2e-browser.mjs`; 18/18 PASS baseline). `E2E_URL` env
   overrides the target. Other probes: `e2e-faces`, `e2e-face-diff`,
   `e2e-mouselook2`, `e2e-movement`, `e2e-walk`, `verify-outfit-textures`.
7. Visual inspection: `tools/look-capture.mjs` → `.research/look/*.png`, then
   `tools/look-metrics.mjs` (quantitative) or `tools/mcpm_vision.py` (local
   VLM). See `docs/AGENT-ASSET-PIPELINE.md` for exact invocations and limits.

**Headless drive pattern** (no browser needed):

```js
const g = new Game({ headless: true })   // StubRenderer + real THREE scene
g.start()
g.debug.setInput({ forward: true })      // input is plain data
for (let i = 0; i < 60; i++) g.step(1 / 60)
g.debug.zombiesAlive(); g.debug.sceneStats(); g.debug.shootOnce()
```

`game.debug` (Game.js:169+) exposes state/playerPos/health/stamina/ammo/wave/
kills readers plus `setPlayerPos`, `setPlayerHealth`, `damagePlayer`,
`shootOnce`, `reloadWeapon`, `setInput`, `spawnZombie`, `killAllZombies`,
`forceWaveClear`, `resetRun`, `sceneStats`, `frameStats`.

## Code navigation (three complementary indexes)

**Rule of thumb:** exact identifier or call graph → graft; "how/why does X
work" → zg; prose history (TASKS/CHANGELOG/README) → RAG. All three caches are
git-ignored and regenerable; if a tool errors, rebuild its cache rather than
falling back to guessing.

- **graft** (tree-sitter graph, zero model): `npm run graft-build` then
  `npm run graft -- ask "who calls setState"` / `-- skeleton src/game/Zombie.js`
  / `-- callers setState` / `-- grep "requestLock"`, `npm run graft-map`.
  Cache in git-ignored `graft/`.
- **zg** (zvec-grep, local `potion-code-16m-v2` embeddings, CPU):
  `npm run zg-index` (~11 s) then `npm run zg -- query "how do zombies steer
  around obstacles"`. Cache in git-ignored `.zvec-home/` + `.zvec-grep/`.
  While indexing, queries fail with `ZVEC_GREP.ENGINE.LOCK.BUSY` — wait.
- **RAG** (this repo's own lexical index, zero deps):
  `node tools/rag-index.mjs` builds `.research/rag/index.json` (incremental:
  unchanged files are reused; `--force` rebuilds). `node tools/rag-query.mjs
  "flashlight drains stamina"` returns ranked `file:start-end` chunks with
  symbol lists and hit lines (`--full` for whole chunks, `--filter src/game`,
  `--json`, `--update` to reindex first). Exit 3 = no hits.
  Use it when graft/zg miss prose-heavy docs (V2-CHANGELOG, README, AGENTS.md,
  TASKS.md). Rebuild after bulk edits: `npm run rag-index` is incremental and
  idempotent (unchanged files are reused).

## Asset generation & visual inspection

See **docs/AGENT-ASSET-PIPELINE.md** — the full contract for:

- Wan2GP headless API (`/home/mgr/Wan2GP/env_uv/bin/python tools/wangp_assets.py
  spec.json --visible 2 --profile 2 --out DIR`) — GPU 2 only (GPUs 0/1 hold
  ~23 GiB of tabbyapi), yue2 audio specifics (duration is an upper bound;
  score stage takes 30–90 min → run as a background job with `--timeout 5400`),
  image models (qwen_image_21_7B edits / z_image t2i + LoRA), spec schema.
- ffmpeg post-processing (WAV→MP3, loudness normalization).
- Blender via flatpak (`flatpak run --filesystem=home org.blender.Blender -b
  --factory-startup --python tools/blender/<script>.py -- ...`) and the
  zombie GLB pipeline (Pixal3D → finish → bake/rig → repair).
- Playwright visual tools, SwiftShader sandbox limits (headless page dies
  ~3–5 s into gameplay — capture pre-gameplay states, use `window.__game`).
- Known failure signatures (corrupted GLB image bufferViews →
  `tools/fix-glb-image-offsets.mjs`; numpy → use env_uv python).

## Deploy procedure (GitHub Pages)

1. `npm run pages` (build with base `/deadfall-stockholm-afterdark`).
2. `node tools/check-assets.mjs` — confirm `dist/` carries every referenced
   asset (it flags `public/` files missing from `dist/`).
3. Create a worktree **inside the workspace** (sandbox `/tmp` is not
   persistent): `git worktree add .deploy-ghpages gh-pages`, `rm -rf` its
   `assets/` + `index.html`, copy `dist/` contents in, `git add -A` (safe in
   the worktree), commit, push `origin gh-pages`, `git worktree remove`.
   Never `git add -A` in the main tree (stages node_modules/dist).
4. CDN propagation takes ~60 s; verify the bundle hash changed
   (`curl -s https://<user>.github.io/deadfall-stockholm-afterdark/ | grep -o 'index-[^"]*\.js'`).
   Note: `dist/` is git-ignored but three soundtrack mp3s are force-tracked
   there — keep them in sync with `public/assets/audio/`.

## Multiplayer quick facts

- Client builds its ws URL from `location.host`; dev proxies `/ws` → :8080
  (`MP_SERVER` env to repoint). Server: `npm run server` (PORT=8080 default).
- Headless netcode tests: `test/server-room.test.mjs`, `net-client`,
  `match-flow`, `remote-player` — no browser needed.
- Co-op browser probe: `tools/_coop-live.mjs` (two pages, one room).

## TASKS.md protocol (the round log agents read and write)

`TASKS.md` is git-ignored and ~120 KB / 1600+ lines. It is the handoff between
rounds, so treat it as a database, not a novel:

- **Read it via RAG, never whole.** `node tools/rag-query.mjs "deploy gh-pages"
  --filter TASKS.md` (or `--update` first) returns the located chunks. Reading
  all 1685 lines burns context for nothing.
- **Update, don't just append.** A round entry goes *under* its version heading
  (`## v3 tasks`, `## Ralph continuation …`), and superseded claims are edited
  in place with `(Supersedes …)` — never leave a stale "DONE"/"IN PROGRESS"
  above a contradicting one.
- **Keep the Status overview at the top current** — it is the only section a
  new agent should need: current branch/HEAD, test + verify + E2E counts, live
  gh-pages commit, and anything awaiting the user.
- **Open questions live in `## Open / awaiting user`**; delete them when the
  user answers. Long evidence dumps belong in `docs/` or `.research/`, not here.
- Never `git add` it without `-f`.

## Conventions for agents working here

- Branch `v2` is the active line (`origin/v2`); `master`/`feat/iteration-2`
  is the frozen v1. Commit messages: `v6 <area> (<n>): <summary>` style.
- `TASKS.md` is git-ignored — add a dated round entry under its version
  heading with what changed plus the verification numbers, and edit stale
  claims in place (see "TASKS.md protocol" above).
- Prefer `edit` (targeted) over full rewrites; keep comments dense — the code
  base documents itself with block comments explaining *why*.
- When delegating (subagents): keep each child single-file / single-deliverable
  (multi-file specs have repeatedly died mid-write). Run long generations as
  background jobs; check `job_output` rather than duplicating work.
- After any change that touches assets or audio, run `check-assets.mjs`;
  after anything that could add a credential, run `secrets-scan.mjs`.