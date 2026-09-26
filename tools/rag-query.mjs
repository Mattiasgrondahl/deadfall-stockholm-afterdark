#!/usr/bin/env node
// tools/rag-query.mjs — lexical search over the local code+docs index.
//
// Reads .research/rag/index.json (built by tools/rag-index.mjs) and ranks
// chunks with TF-IDF plus boosts for symbol hits, path hits and heading
// hits. Prints file:line ranges + short excerpts so an agent gets located
// evidence instead of guesses. Complements `npm run graft -- ask` (code
// graph) and `npm run zg -- query` (embeddings); works with zero setup.
//
// Usage:
//   node tools/rag-query.mjs "how does the flashlight drain stamina"
//   node tools/rag-query.mjs "reload dip view model" --top 8
//   node tools/rag-query.mjs "SONG_PLAYLIST" --full      # print chunk text
//   node tools/rag-query.mjs "wave cap" --filter src/game
//   node tools/rag-query.mjs "wave cap" --json
//   node tools/rag-query.mjs --update "..."              # reindex first
//
// Exit codes: 0 hits found, 3 no hits, 2 bad usage / missing index.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INDEX_FILE = path.join(ROOT, '.research', 'rag', 'index.json')

const STOP = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'from', 'you', 'are', 'not', 'but', 'all', 'can', 'was', 'how', 'does', 'what', 'why', 'when', 'who', 'its', 'our', 'out', 'may', 'also', 'just', 'like', 'such', 'both', 'each', 'some', 'more', 'most', 'very', 'once', 'here', 'where'])

function tokenize(text) {
  const raw = text.toLowerCase().match(/[a-z_$][a-z0-9_$]*|\d+/g) || []
  const toks = []
  for (const t of raw) {
    if (STOP.has(t) || t.length <= 1) continue
    toks.push(t)
    const camel = t.replace(/([a-z])([A-Z])/g, '$1 $2').split(' ')
    if (camel.length > 1) for (const p of camel) if (p.length > 1 && !STOP.has(p)) toks.push(p)
    const snake = t.split('_').filter(p => p.length > 1 && !STOP.has(p))
    if (snake.length > 1) for (const p of snake) toks.push(p)
  }
  return toks
}

function loadIndex() {
  if (!fs.existsSync(INDEX_FILE)) return null
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')) } catch { return null }
}

function score(queryTokens, chunk, df, totalChunks) {
  const tf = new Map()
  for (const t of tokenize(chunk.text)) tf.set(t, (tf.get(t) || 0) + 1)
  const symTokens = new Set()
  for (const s of chunk.symbols) for (const t of tokenize(s)) symTokens.add(t)
  const pathTokens = new Set(tokenize(chunk.file))
  let score = 0
  for (const q of queryTokens) {
    const f = tf.get(q) || 0
    if (f === 0 && !symTokens.has(q) && !pathTokens.has(q)) continue
    const idf = Math.log(1 + (totalChunks / (1 + (df[q] || 0))))
    score += (1 + Math.log(f)) * idf
    if (symTokens.has(q)) score += 2.5 * idf
    if (pathTokens.has(q)) score += 1.2 * idf
  }
  // Small bonus for chunks that cover ALL query tokens (precision signal).
  const covered = queryTokens.filter(q => tf.has(q) || symTokens.has(q)).length
  if (queryTokens.length > 1 && covered === queryTokens.length) score *= 1.35
  return score
}

const argv = process.argv.slice(2)
let top = 5, full = false, json = false, update = false, filter = null
const positional = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--top') top = Math.max(1, Number(argv[++i]) || 5)
  else if (a === '--full') full = true
  else if (a === '--json') json = true
  else if (a === '--update') update = true
  else if (a === '--filter') filter = argv[++i]
  else if (a.startsWith('--')) { console.error(`unknown flag: ${a}`); process.exit(2) }
  else positional.push(a)
}
const query = positional.join(' ').trim()
if (!query) { console.error('usage: node tools/rag-query.mjs "<query>" [--top N] [--full] [--json] [--filter <path-prefix>] [--update]'); process.exit(2) }

if (update) {
  const { spawnSync } = await import('node:child_process')
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'rag-index.mjs')], { stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

const idx = loadIndex()
if (!idx) { console.error(`no index at ${path.relative(ROOT, INDEX_FILE)} — run: node tools/rag-index.mjs`); process.exit(2) }

const qTokens = [...new Set(tokenize(query))]
if (qTokens.length === 0) { console.error('query had no searchable tokens'); process.exit(2) }

let chunks = idx.chunks
if (filter) chunks = chunks.filter(c => c.file.startsWith(filter))
const total = chunks.length || 1
const scored = chunks
  .map(c => ({ c, s: score(qTokens, c, idx.df, total) }))
  .filter(x => x.s > 0)
  .sort((a, b) => b.s - a.s)
  .slice(0, top)

if (scored.length === 0) {
  if (json) console.log('[]')
  else console.log('no hits — try different terms, or `node tools/rag-index.mjs --force` after big edits')
  process.exit(3)
}

if (json) {
  console.log(JSON.stringify(scored.map(({ c, s }) => ({
    file: c.file, startLine: c.startLine, endLine: c.endLine,
    symbols: c.symbols, score: Number(s.toFixed(3)),
    ...(full ? { text: c.text } : {})
  })), null, 1))
} else {
  for (const { c, s } of scored) {
    console.log(`\n### ${c.file}:${c.startLine}-${c.endLine}  (score ${s.toFixed(2)})`)
    if (c.symbols.length) console.log(`    symbols: ${c.symbols.slice(0, 8).join(', ')}`)
    if (full) {
      console.log(c.text)
    } else {
      const lines = c.text.split('\n')
      const hits = new Set()
      for (let i = 0; i < lines.length; i++) {
        const toks = new Set(tokenize(lines[i]))
        for (const q of qTokens) if (toks.has(q)) hits.add(i)
      }
      const shown = [...hits].slice(0, 6)
      if (shown.length === 0) shown.push(0)
      for (const i of shown) console.log(`    ${c.startLine + i}\t${lines[i].trim().slice(0, 160)}`)
    }
  }
}
process.exit(0)