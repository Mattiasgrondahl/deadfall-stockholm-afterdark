# DEPLOYMENT.md — main (prod) + dev (staging) topology

Two long-lived branches, two git worktrees, two servers. Dev work never touches
prod; features graduate dev → main by an explicit merge.

## Branches

| Branch | Role | Served at | Working tree |
|---|---|---|---|
| `main` | stable production | `zombie.p4pps3n.top` → :8080 | `/home/mgr/Workspace/Zombie-prod` |
| `dev`  | active development | :8090 (staging) | `/home/mgr/Workspace/Zombie` |

`main` is the GitHub default branch. `master`/`v2`/`v3`/`v4` are frozen history.
`gh-pages` is the separate GitHub Pages deploy (orthogonal to these local servers).

## Isolation

Each branch has its own git **worktree** (one repo, separate working dirs), so
`main` and `dev` check out independent copies of the tree. Each server is started
with `DIST_DIR` pointing at its own worktree's `dist/`, so a `npm run build` in
`dev` regenerates only `Zombie/dist/` and never changes what prod :8080 serves.
Verified: rebuilding dev changed :8090's bundle hash while :8080 stayed frozen.

`Zombie-prod/node_modules` is a symlink to `Zombie/node_modules` (both trees sit
at the same commit; the server only needs `ws`). Re-create it after a fresh
worktree: `ln -s /home/mgr/Workspace/Zombie/node_modules /home/mgr/Workspace/Zombie-prod/node_modules`.

## Running the servers

```bash
# prod (main) on :8080  — the public domain target
cd /home/mgr/Workspace/Zombie-prod
PORT=8080 NODE_ENV=production DIST_DIR=$PWD/dist node server/server.js

# dev (staging) on :8090
cd /home/mgr/Workspace/Zombie
PORT=8090 NODE_ENV=production DIST_DIR=$PWD/dist node server/server.js
```

The public domain `zombie.p4pps3n.top` reverse-proxies to :8080, so it always
serves `main`. :8090 is the staging endpoint for testing dev builds before merge.

## Graduating a feature dev → main

1. Build + test the feature on `dev` (`npm test`, `npm run verify`, `npm run build`,
   `node tools/check-assets.mjs`, `node tools/secrets-scan.mjs`, E2E) and confirm it
   on :8090.
2. `git -C /home/mgr/Workspace/Zombie-prod merge dev` (fast-forward or merge commit).
3. Rebuild prod: `cd /home/mgr/Workspace/Zombie-prod && npm run build`.
4. Restart :8080 (kill the old pid, relaunch the prod command above).
5. `git -C /home/mgr/Workspace/Zombie-prod push origin main`.

Prod only changes on an explicit merge + rebuild + restart; dev churn is invisible
to players.