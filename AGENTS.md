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
- **Budgets** (pinned by `tools/verify-game.mjs` S8 — read the gate there, it is
  the authority): **meshes ≤ 800**, lights ≤ 40, points ≤ 2500, zombies ≤ 24.
  Internal caps: blood pool 300 (`Blood.js:17`), stains 120, groan voices 4
  (`AudioBank.js:16`), drops 20 (`AmmoDrops.js:25`), snow 1800 (`snow.js:35`),
  wave concurrency 8+wave to wave 9 then +0.5/wave toward **20** (`WaveManager.js`,
  v37 R3). Watch mesh headroom when adding per-zombie objects: the silhouette
  shell is +6 meshes per non-boss body, so the alive cap costs 6× that.
- **New files stay under ~350 lines**; split a subsystem into helpers instead.
  Several legacy files exceed this (Zombie.js ~2190, AudioBank.js ~1735,
  Game.js ~1730, cityDressing.js ~995) — do not grow them further; extract new
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
- `test/` — `node --test` suite (auto-discovered; **520 tests green** as of v37 R5b).
  `tools/` — manual probes (NOT auto-discovered), including
  `tools/verify-outline.mjs` (headless geometry proof for the zombie silhouette
  shell: containment per frame, rim width in metres, ≥1 px projection, culling
  coupling, boss exemption, dispose cleanliness — run it after touching
  `ZombieOutline.js` / `Zombie.js` shell wiring) and `tools/rim-contrast.mjs`
  (photometric audit of that rim in the browser: what separation it actually
  buys, and why width/colour are not levers).
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

1. `npm test` — must stay green (520/520 baseline, v37 R5b).
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
   **Assert the subject is in frame before believing a verdict.** Scenes 01–08
   teleport to fixed vantages and can capture an empty street; scene 09 spawns
   zombies, aims at them, freezes the sim and exits 1 if fewer than 3 are in the
   view cone. The local VLM will confidently describe outlines on a frame with
   zero zombies in it, so: ask it to count the subjects first, and prefer the
   quantitative probes for anything threshold-like. For the zombie silhouette
   specifically, `tools/rim-contrast.mjs` is the authority — rim width and rim
   colour are both measured non-levers (see its header), and the VLM's rim
   verdict flips with camera range (yes at 4 m, "not discernible" at 6 m).

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

## Graduation (dev → prod)

Prod is a **separate worktree** (`/home/mgr/Workspace/Zombie-prod` on `main`)
that the systemd unit serves. It is outside the session workspace, so its
writes need the wider sandbox mode.

1. `git -C /home/mgr/Workspace/Zombie-prod merge dev`. The **only** conflicts
   are in `dist`: `main` tracks `dist/index.html` as a pointer, not the bundles.
   Resolve by `git rm --cached` the dev-side dist JS/CSS and delete them from
   the worktree, keeping main's `dist/index.html`. **Keep** new
   `dist/assets/audio/**` files — main tracks dist audio and a new runtime
   asset must ship.
2. Commit the merge, then in the prod worktree run `npm test`, `npm run verify`,
   `node tools/check-assets.mjs`, `node tools/secrets-scan.mjs`, `npm run build`.
3. The merge usually already carries the correct `dist/index.html` (main's side
   unchanged from the merge base auto-merges). **Check**
   `grep -o 'assets/[^"]*' dist/index.html` against the built filenames before
   adding a pointer commit; `dist/` is git-ignored so `git add -f` is required.
4. Restart the unit. `systemctl --user` is unreachable in this sandbox — use
   `dbus-send --session --print-reply --dest=org.freedesktop.systemd1
   /org/freedesktop/systemd1 org.freedesktop.systemd1.Manager.RestartUnit
   string:zombie-game.service string:replace`. (`Manager.ReloadUnit` fails with
   `JobTypeNotApplicable`; for unit-file edits use `Manager.Reload` first.)
5. Verify live: `curl -sS https://zombie.p4pps3n.top/ | grep -o 'index-[^"]*\.js'`
   shows the new hash, and `/api/lobby`, `/api/highscore` return 200. The `/ws`
   probe needs `curl --http1.1` (HTTP/2 gives 404) and `--max-time 5` (after the
   101 handshake the stream stays open, so curl exits 28 — that is expected).
6. `git push origin main`.

## Deploy procedure (GitHub Pages)

1. `npm run pages` (build with base `/deadfall-stockholm-afterdark`).
2. `node tools/check-assets.mjs` — confirm `dist/` carries every referenced
   asset (it flags `public/` files missing from `dist/`).
3. Create a worktree **inside the workspace** (sandbox `/tmp` is not
   persistent): `git worktree add .deploy-ghpages gh-pages`, `rm -rf` its
   `assets/` + `index.html`, copy `dist/` contents in, `git add -A` (safe in
   the worktree), commit, push `origin gh-pages`, `git worktree remove`.
   Never `git add -A` in the main tree (stages node_modules/dist).
4. **The Pages build itself is the slow part, not the CDN.** After pushing
   `gh-pages`, `GET /repos/<user>/<repo>/pages/builds/latest` stays `building`
   for **5–25 min** (measured: 20+ min with `updated_at` frozen, no log
   endpoint) and the new bundle 404s the whole time while the old one serves
   200. Poll that status **and** the live hash in a loop
   (`curl -s https://<user>.github.io/deadfall-stockholm-afterdark/ | grep -o
   'index-[^"]*\.js'`); a 404 on the new bundle means lag, never a bad deploy —
   confirm the branch content with `git ls-tree -r origin/gh-pages --name-only`.
   Note: `dist/` is git-ignored but ~98 files are force-tracked there (33 audio
   clips + the bundle snapshot) — keep them in sync with `public/assets/audio/`,
   and restore with `git checkout HEAD -- dist/` after `npm run pages`, which
   rewrites `dist/` with base-prefixed paths.

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

## DSH/Ralph recovery and context protocol

The filesystem is the source of truth, not the DSH conversation. Use this
protocol for every long-running implementation round:

- Start from a fresh Ralph round. Never resume a quarantined, looped, or
  context-overflowed session.
- Read `TASKS.md`, `AGENTS.md`, and the relevant `.hermes/deadfall-progress.md`
  section before selecting work. Do not read all of `TASKS.md`; query it with
  the RAG index and inspect only the current task context.
- Before every meaningful action, identify the current task, acceptance
  criterion, and expected changed files.
- After every meaningful action, update `TASKS.md` with changed files, focused
  test results, partial work, blockers, and the exact next action.
- Save durable findings in `docs/` or `.research/`; never rely on chat history.

### Required child-agent workflow

Use one child at a time because the local Flash-Next backend has
`max_batch_size: 1`:

1. researcher — one focused investigation, concise evidence;
2. coder — one file or one small subsystem, focused test;
3. reviewer — inspect the actual files and test evidence.

Keep child reports and handoffs below 8,192 characters and reports below 500
words. Store the useful result in `TASKS.md` before starting the next child.

### Context and loop limits

The DSH role contract is 160,000 context tokens and 26,000 maximum output
tokens. The Flash-Next backend has a 199,936-token cache. The external DSH
watchdog hard-stops sessions at 160,000 measured input tokens and quarantines
them before the backend can request the invalid 200,704-token allocation.

Operationally, start a fresh Ralph round before 120,000 tokens. Do not carry
large tool results, browser captures, full logs, or full source files between
rounds.

Never issue the same tool call with identical actual arguments more than twice.
Changing only its description does not make it a new call. If a command gives
no new information twice, change strategy or inspect the source directly. If
the watchdog quarantines the session, do not press Proceed; start a fresh
session from the filesystem.

### Recovery prompt

Use this after an interruption:

```text
Continue from the filesystem only.

This is a fresh session after a DSH interruption or quarantined session. Do
not replay or resume the previous conversation.

Read TASKS.md and AGENTS.md, inspect git status, and identify the last
incomplete checkpoint. Continue only the smallest unfinished task.

Use one fresh Ralph round and one child at a time. Never repeat an identical
tool call more than twice. Update TASKS.md after every meaningful action with
changed files, focused test results, partial work, and the next action.

Keep the working context below 120,000 tokens. If compaction fails, save state
to `TASKS.md` and start another fresh round.
```

### Skill-loading rules

The following names are documentation topics, not installed DSH skills:

- `audio-postprocessing`
- `blender-asset-authoring`
- `asset-pipeline`

Never call the DSH skill tool for those names. Read the relevant project
documentation directly instead:

```text
docs/AGENT-ASSET-PIPELINE.md
docs/ARCHITECTURE.md
docs/V2-PLAN.md
```

If a skill load returns `unknown or no longer available`, do not retry it.
Record the result as unavailable, inspect the named project documentation or
source files directly, and continue with a different concrete action. Never
repeat a failed skill load with a changed description.

## Conventions for agents working here

- **`dev` is the active line** (`origin/dev`); **`main` is the production line**
  — the systemd `zombie-game.service` serves the `main` worktree
  `/home/mgr/Workspace/Zombie-prod` on :8080 → **https://zombie.p4pps3n.top**
  (Caddy → `172.17.0.1:8080`). `gh-pages` is the Pages build. `v2` and
  `master`/`feat/iteration-2` are the frozen v1/v2 history. Graduating dev →
  prod is a documented flow; see the "Graduation (dev → prod)" section below.
  Commit messages: `v37 <area> (<n>): <summary>` style (dist snapshots:
  `chore(dist): ...`).
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