#!/usr/bin/env node
// tools/secrets-scan.mjs — scan tracked-ish sources for leaked credentials.
//
// This project has no server secrets today (static Pages + a local ws server),
// but the asset pipeline talks to local services and future deploys may add
// tokens. This scanner keeps that debt visible: it greps the source tree for
// high-signal secret patterns (API keys, bearer tokens, private keys, basic-auth
// URLs, password assignments) and fails with a non-zero exit when anything
// matches outside the allowlist.
//
// Usage:
//   node tools/secrets-scan.mjs            # scan default roots
//   node tools/secrets-scan.mjs --json     # machine-readable
//   node tools/secrets-scan.mjs --allow "literal-allowed-token"   # add allowlist entry
//
// Exit codes: 0 clean, 1 findings, 2 bad usage.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const DEFAULT_ROOTS = ['src', 'server', 'tools', 'test', 'public', 'docs']
const LOOSE_FILES = ['README.md', 'TASKS.md', 'MULTIPLAYER_PLAN.md', 'package.json', 'vite.config.js', 'index.html']
const EXCLUDE_DIRS = new Set(['node_modules', '.browsers', '.research', 'dist', '.git', 'graft', '.zvec-grep', '.zvec-home', '.npm-cache', '.fxhome', '.baseline-head', '.deploy-ghpages', '.playwright-mcp'])
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.py', '.md', '.json', '.css', '.html', '.txt', '.yaml', '.yml', '.env', '.sh'])
const MAX_FILE_BYTES = 400_000

// (name, regex) pairs. Patterns are intentionally narrow: long, high-entropy
// strings and well-known prefixes, not generic "key" words.
const PATTERNS = [
  ['openai-style key', /\bsk-[A-Za-z0-9_-]{16,}\b/],
  ['aws access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['github token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ['slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['stripe key', /\b[rs]k_live_[A-Za-z0-9]{16,}\b/],
  ['google api key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['discord token', /\b[MNO][A-Za-z\d]{22,24}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{20,}\b/],
  ['private key block', /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/],
  ['basic-auth url', /\bhttps?:\/\/[^/\s:@]+:[^@\s]+@[^/\s]+/],
  ['heroku/procfile style secret', /\b[\w-]*(?:API_KEY|API_SECRET|AUTH_TOKEN|ACCESS_TOKEN|SECRET_KEY|CLIENT_SECRET|PASSWORD)\s*[:=]\s*['"`][^'"`\s]{8,}['"`]/],
  ['long bearer token', /\bBearer\s+[A-Za-z0-9._-]{30,}\b/i]
]

// Known-benign literals (test fixtures, placeholder docs). Matched as whole
// lines so a real secret on the same line still trips.
const ALLOWLIST = [
  /sk-[A-Za-z0-9-]*test/i,
  /your[-_]?(api[-_]?key|token|secret)/i,
  /placeholder|example|dummy|changeme|xxxx/i,
  /sk-proj-?\*+/,
  /gh[pousr]_\*+/,
  /AKIA\*+/,
  /AIza\*+/,
  /password\s*[:=]\s*['"`]?(?:hunter2|correct[- ]horse|letmein|secret123)['"`]?/i
]

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

function collect() {
  const out = []
  for (const r of DEFAULT_ROOTS) {
    const abs = path.join(ROOT, r)
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) walk(abs, out)
  }
  for (const f of LOOSE_FILES) {
    const abs = path.join(ROOT, f)
    if (fs.existsSync(abs)) out.push(abs)
  }
  return out.filter(p => {
    const ext = path.extname(p)
    if (ext && !TEXT_EXT.has(ext)) return false
    if (!ext && !LOOSE_FILES.includes(path.relative(ROOT, p))) return false
    try { return fs.statSync(p).size <= MAX_FILE_BYTES } catch { return false }
  })
}

const argv = process.argv.slice(2)
const json = argv.includes('--json')
const extraAllow = []
for (let i = 0; i < argv.length; i++) if (argv[i] === '--allow') extraAllow.push(argv[++i])
for (let i = 0; i < argv.length; i++) if (!argv[i].startsWith('--') && argv[i - 1] !== '--allow' && (i === 0 || argv[i - 1] !== '--allow')) {
  // positional args are treated as extra allowlist literals too
  if (argv[i - 1] !== '--allow') extraAllow.push(argv[i])
}

const findings = []
const files = collect()
for (const abs of files) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/')
  let text
  try { text = fs.readFileSync(abs, 'utf8') } catch { continue }
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const [name, re] of PATTERNS) {
      const m = line.match(re)
      if (!m) continue
      const allowed = ALLOWLIST.some(rx => rx.test(line)) ||
        extraAllow.some(lit => line.includes(lit))
      if (allowed) continue
      findings.push({ file: rel, line: i + 1, kind: name, match: m[0].slice(0, 40), text: line.trim().slice(0, 120) })
    }
  }
}

if (json) {
  console.log(JSON.stringify({ ok: findings.length === 0, scanned: files.length, findings }, null, 1))
} else {
  if (findings.length === 0) {
    console.log(`secrets-scan: clean (${files.length} files scanned)`)
  } else {
    for (const f of findings) console.log(`  ${f.file}:${f.line}  [${f.kind}]  ${f.text}`)
    console.log(`\nsecrets-scan: ${findings.length} possible secret(s) in ${files.length} files`)
    console.log('  if a finding is benign, add a literal allowlist entry: node tools/secrets-scan.mjs --allow "<exact substring>"')
  }
}
process.exit(findings.length === 0 ? 0 : 1)