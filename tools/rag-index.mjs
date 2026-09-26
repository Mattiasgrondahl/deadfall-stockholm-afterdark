#!/usr/bin/env node
// tools/rag-index.mjs — local, dependency-free code+docs index for agents.
//
// Complements the two semantic indexers already wired in (graft: tree-sitter
// code graph; zg: embedding search). This one is a plain lexical index: chunk
// files on natural boundaries, score with TF-IDF + symbol/path boosts, and
// store everything under the git-ignored .research/rag/ directory. No network,
// no model, no native deps — `node tools/rag-index.mjs` is all it takes.
//
// Usage:
//   node tools/rag-index.mjs                # build/update the index
//   node tools/rag-index.mjs --force        # rebuild from scratch
//   node tools/rag-index.mjs --roots a b    # custom roots (default below)
//
// Output: .research/rag/index.json — { meta, files, chunks, df } where every
// chunk carries {file, startLine, endLine, symbols, text}. Query it with
// tools/rag-query.mjs.
//
// Defaults mirror what agents actually need to find: game source, server,
// tools, tests, docs and the top-level README/TASKS.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, '.research', 'rag')
const OUT_FILE = path.join(OUT_DIR, 'index.json')

const DEFAULT_ROOTS = ['src', 'server', 'tools', 'test', 'docs']
const LOOSE_FILES = ['README.md', 'TASKS.md', 'MULTIPLAYER_PLAN.md', 'package.json']
const EXCLUDE_DIRS = new Set(['node_modules', '.browsers', '.research', 'dist', '.git', 'graft', '.zvec-grep', '.zvec-home', '.npm-cache', '.fxhome', '.baseline-head', '.deploy-ghpages'])
const EXCLUDE_PREFIXES = ['tools/_', 'tools/debug-', 'tools/probe-', 'tools/micro-shot']
const EXCLUDE_NAMES = new Set(['package-lock.json'])
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.py', '.md', '.json', '.css', '.html', '.txt', '.yaml', '.yml'])
const MAX_FILE_BYTES = 400_000
const CHUNK_TARGET = 60      // lines per chunk (soft)
const CHUNK_MAX = 90         // hard cap per chunk
const CHUNK_MIN = 6          // skip tiny trailing fragments
const OVERLAP = 6            // lines repeated at chunk seams for context
const MAX_CHUNKS_PER_FILE = 200

function walk(dir, acc) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!EXCLUDE_DIRS.has(e.name)) walk(full, acc)
    } else if (e.isFile()) {
      acc.push(full)
    }
  }
  return acc
}

function collectFiles(roots, loose) {
  const out = []
  for (const r of roots) {
    const abs = path.isAbsolute(r) ? r : path.join(ROOT, r)
    const st = fs.existsSync(abs) && fs.statSync(abs)
    if (st?.isDirectory()) walk(abs, out)
    else if (st?.isFile()) out.push(abs)
  }
  for (const f of loose) {
    const abs = path.join(ROOT, f)
    if (fs.existsSync(abs)) out.push(abs)
  }
  return out.filter(p => {
    const rel = path.relative(ROOT, p).split(path.sep).join('/')
    const ext = path.extname(p)
    if (EXCLUDE_NAMES.has(path.basename(p))) return false
    if (ext && !TEXT_EXT.has(ext)) return false
    if (!TEXT_EXT.has(ext) && !LOOSE_FILES.includes(rel)) return false
    for (const pre of EXCLUDE_PREFIXES) if (rel.startsWith(pre)) return false
    return true
  })
}

// Split a file into chunks at natural boundaries: markdown headings, JS
// function/class/method starts, python defs/classes, or fixed line windows.
function chunkFile(rel, text) {
  const lines = text.split(/\r?\n/)
  const ext = path.extname(rel)
  const isMd = ext === '.md'
  const isPy = ext === '.py'
  const boundaries = [0]
  for (let i = 1; i < lines.length; i++) {
    const L = lines[i]
    let boundary = false
    if (isMd) {
      if (/^#{1,4}\s/.test(L)) boundary = true
    } else if (isPy) {
      if (/^(class |def |@)/.test(L)) boundary = true
    } else {
      if (/^(export )?(async )?function\b/.test(L) || /^export (const|class|let)\b/.test(L)) boundary = true
      else if (/^\s{2}(static )?(get |set |async )?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/.test(L)) boundary = true
      else if (/^export class\b/.test(L) || /^class\b/.test(L)) boundary = true
    }
    if (boundary) boundaries.push(i)
  }
  const chunks = []
  let start = 0
  for (const b of boundaries.slice(1)) {
    if (b - start >= CHUNK_TARGET) {
      pushChunk(chunks, rel, lines, start, b)
      start = b
    }
  }
  if (lines.length - start >= CHUNK_MIN) pushChunk(chunks, rel, lines, start, lines.length)
  else if (chunks.length) {
    // Tiny tail: fold into the previous chunk instead of dropping content.
    const last = chunks[chunks.length - 1]
    last.endLine = lines.length
    last.text = lines.slice(last.startLine - 1, lines.length).join('\n')
  }
  if (chunks.length === 0 && lines.length >= CHUNK_MIN) pushChunk(chunks, rel, lines, 0, lines.length)
  return chunks.slice(0, MAX_CHUNKS_PER_FILE)
}

function pushChunk(chunks, rel, lines, start, end) {
  const body = lines.slice(start, end)
  if (body.join('\n').trim().length === 0) return
  chunks.push({
    id: `${rel}:${start + 1}`,
    file: rel,
    startLine: start + 1,
    endLine: end,
    symbols: extractSymbols(rel, body),
    text: body.join('\n')
  })
}

function extractSymbols(rel, bodyLines) {
  const syms = new Set()
  const isMd = path.extname(rel) === '.md'
  for (const L of bodyLines) {
    let m
    if ((m = L.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/))) syms.add(m[1])
    if ((m = L.match(/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/))) syms.add(m[1])
    if ((m = L.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/))) syms.add(m[1])
    if ((m = L.match(/^\s*(?:static\s+)?(?:async\s+)?(?:get|set)?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/))) {
      if (!['if', 'for', 'while', 'switch', 'catch', 'function'].includes(m[1])) syms.add(m[1])
    }
    if ((m = L.match(/^def\s+([A-Za-z_][\w]*)/))) syms.add(m[1])
    if ((m = L.match(/^class\s+([A-Za-z_][\w]*)/))) syms.add(m[1])
    if (isMd && (m = L.match(/^#{1,4}\s+(.+)/))) syms.add(m[1].trim().slice(0, 80))
  }
  return [...syms].slice(0, 40)
}

const STOP = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'from', 'you', 'are', 'have', 'not', 'but', 'all', 'can', 'was', 'were', 'their', 'there', 'when', 'what', 'which', 'about', 'into', 'over', 'after', 'before', 'your', 'has', 'had', 'him', 'his', 'her', 'she', 'his', 'they', 'them', 'then', 'than', 'only', 'its', 'our', 'out', 'how', 'who', 'why', 'may', 'also', 'just', 'like', 'such', 'both', 'each', 'some', 'more', 'most', 'other', 'these', 'those', 'any', 'because', 'between', 'every', 'does', 'done', 'more', 'very', 'once', 'here', 'where'])

function tokenize(text) {
  const raw = text.toLowerCase().match(/[a-z_$][a-z0-9_$]*|\d+/g) || []
  const toks = []
  for (const t of raw) {
    if (STOP.has(t) || t.length <= 1) continue
    toks.push(t)
    // Identifier sub-tokens: camelCase + snake_case split so "playPlaylist"
    // matches a query for "playlist".
    const camel = t.replace(/([a-z])([A-Z])/g, '$1 $2').split(' ')
    if (camel.length > 1) for (const p of camel) if (p.length > 1 && !STOP.has(p)) toks.push(p)
    const snake = t.split('_').filter(p => p.length > 1 && !STOP.has(p))
    if (snake.length > 1) for (const p of snake) toks.push(p)
  }
  return toks
}

function build(roots, loose, force) {
  let prev = null
  if (!force && fs.existsSync(OUT_FILE)) {
    try { prev = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) } catch { prev = null }
  }
  const files = collectFiles(roots, loose)
  const fileMeta = new Map(prev ? prev.files.map(f => [f.path, f]) : [])
  const chunksByFile = new Map(prev ? prev.chunks.map(c => [c.file, c]) : [])
  const seen = new Set()
  let reused = 0, rebuilt = 0, removed = 0
  const outFiles = []
  const outChunks = []
  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/')
    seen.add(rel)
    let st
    try { st = fs.statSync(abs) } catch { continue }
    if (st.size > MAX_FILE_BYTES) continue
    const hash = createHash('sha256').update(fs.readFileSync(abs)).digest('hex').slice(0, 16)
    const old = fileMeta.get(rel)
    if (old && old.hash === hash && chunksByFile.has(rel)) {
      reused++
      outFiles.push(old)
      for (const c of chunksByFile.get(rel)) outChunks.push(c)
      continue
    }
    rebuilt++
    const text = fs.readFileSync(abs, 'utf8')
    const chunks = chunkFile(rel, text)
    outFiles.push({ path: rel, hash, bytes: st.size, mtimeMs: Math.round(st.mtimeMs), chunks: chunks.length })
    for (const c of chunks) outChunks.push(c)
  }
  if (prev) for (const f of prev.files) if (!seen.has(f.path)) removed++
  // Document frequency over the new corpus.
  const df = {}
  for (const c of outChunks) {
    const uniq = new Set(tokenize(c.text + '\n' + c.file + '\n' + c.symbols.join(' ')))
    for (const t of uniq) df[t] = (df[t] || 0) + 1
  }
  const meta = {
    version: 1,
    generatedAt: new Date().toISOString(),
    roots,
    loose: LOOSE_FILES,
    files: outFiles.length,
    chunks: outChunks.length,
    reused, rebuilt, removed
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify({ meta, files: outFiles, chunks: outChunks, df }))
  console.log(`rag-index: ${outFiles.length} files, ${outChunks.length} chunks (${reused} reused, ${rebuilt} rebuilt, ${removed} dropped) -> ${path.relative(ROOT, OUT_FILE)}`)
}

const argv = process.argv.slice(2)
const force = argv.includes('--force')
const rIdx = argv.indexOf('--roots')
const roots = rIdx >= 0 ? argv.slice(rIdx + 1).filter(a => !a.startsWith('--')) : DEFAULT_ROOTS
build(roots.length ? roots : DEFAULT_ROOTS, LOOSE_FILES, force)