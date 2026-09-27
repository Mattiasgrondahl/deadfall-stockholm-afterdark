// Hosted high-score API (production host): the server answers GET/POST
// /api/highscore at both the root and the Pages base path, keeps a top-10
// leaderboard, and rejects junk. Driven through startServer on an ephemeral
// port — the listen callback is async, so every test waits for the bound port.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startServer } from '../server/server.js'

/** Boot a server and resolve once it is actually listening. */
function listen(opts = {}) {
  const s = startServer({ port: 0, host: '127.0.0.1', ...opts })
  return new Promise((resolve) => {
    const tryPort = () => {
      const a = s.http.address()
      if (a && typeof a === 'object' && a.port) resolve({ ...s, base: `http://127.0.0.1:${a.port}` })
      else setTimeout(tryPort, 10)
    }
    tryPort()
  })
}

test('GET /api/highscore returns the seed best + name + top (root + base path)', async () => {
  const s = await listen({ highScore: 1234, highScoreName: 'Ana' })
  try {
    const a = await (await fetch(s.base + '/api/highscore')).json()
    const b = await (await fetch(s.base + '/deadfall-stockholm-afterdark/api/highscore')).json()
    assert.deepEqual(a, { best: 1234, name: 'Ana', top: [{ name: 'Ana', score: 1234 }] })
    assert.deepEqual(b, { best: 1234, name: 'Ana', top: [{ name: 'Ana', score: 1234 }] })
  } finally { s.close() }
})

test('POST inserts a score into the leaderboard; garbage is ignored', async () => {
  const s = await listen({ highScore: 500 })
  try {
    const post = (body) => fetch(s.base + '/api/highscore', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    // A lower score still earns a leaderboard slot (it is a top-10 list now),
    // while best/name keep mirroring the current leader (500).
    const lower = await (await post(JSON.stringify({ score: 100, name: 'a' }))).json()
    assert.equal(lower.best, 500, 'best stays the leader')
    assert.deepEqual(lower.top, [{ name: '', score: 500 }, { name: 'a', score: 100 }], 'lower joins the list')
    // A higher score takes the lead.
    const higher = await (await post(JSON.stringify({ score: 900, name: 'Zed' }))).json()
    assert.equal(higher.best, 900)
    assert.equal(higher.name, 'Zed')
    assert.deepEqual(higher.top.map((e) => e.score), [900, 500, 100], 'sorted by score desc')
    // Bad bodies and negatives are ignored (list unchanged).
    const junk = await (await post('not json')).json()
    assert.deepEqual(junk.top.map((e) => e.score), [900, 500, 100], 'bad body ignored')
    const neg = await (await post(JSON.stringify({ score: -5 }))).json()
    assert.deepEqual(neg.top.map((e) => e.score), [900, 500, 100], 'negative ignored')
    const r = await fetch(s.base + '/api/highscore', { method: 'DELETE' })
    assert.equal(r.status, 405, 'DELETE rejected')
  } finally { s.close() }
})

test('v6: the leaderboard caps at 10 entries, keeping the highest scores', async () => {
  // Seed a tiny dummy best so the run starts from a known list (isolated from
  // any on-disk record); the dummy (score 1) is pushed out by the 12 posts.
  const s = await listen({ highScore: 1 })
  try {
    const post = (body) => fetch(s.base + '/api/highscore', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    // Push 12 distinct scores; only the top 10 survive, sorted descending.
    for (let i = 1; i <= 12; i++) {
      await post(JSON.stringify({ score: i * 100, name: 'p' + i }))
    }
    const r = await (await fetch(s.base + '/api/highscore')).json()
    assert.equal(r.top.length, 10, 'capped at 10')
    assert.deepEqual(r.top.map((e) => e.score), [1200, 1100, 1000, 900, 800, 700, 600, 500, 400, 300], 'lowest two + dummy dropped, sorted desc')
    assert.equal(r.best, 1200)
    assert.equal(r.name, 'p12')
  } finally { s.close() }
})

test('v3 T6: a hostile XSS name is sanitized server-side, never stored as markup', async () => {
  const s = await listen({ highScore: 10 })
  try {
    const post = (body) => fetch(s.base + '/api/highscore', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    // Control chars stripped, whitespace collapsed, clamped to 24 chars.
    const hostile = '<img src=x onerror=alert(1)>\n\t<b>zz</b>'
    const r = await (await post(JSON.stringify({ score: 500, name: hostile }))).json()
    assert.equal(r.best, 500)
    const holder = r.top[0]
    assert.ok(holder.name.length <= 24, `name clamped to 24 (${holder.name.length})`)
    assert.ok(!new RegExp('[\\u0000-\\u001f\\u007f]').test(holder.name), 'no control characters survive')
    assert.ok(!/\s{2,}/.test(holder.name), 'no runs of whitespace survive')
    // The payload survives as inert TEXT (it is rendered via textContent), but
    // crucially it is never markup: the server stores the raw characters, and
    // the client never uses innerHTML. Assert the record holder is exactly the
    // sanitized string, so a downstream textContent render yields zero nodes.
    assert.equal(holder.name, '<img src=x onerror=alert(1)> <b>zz</b>'.slice(0, 24))
  } finally { s.close() }
})

test('index.html is served cache-negotiated, not immutable', async () => {
  const s = await listen()
  try {
    const html = await fetch(s.base + '/')
    assert.ok(html.ok, 'index served')
    const cc = html.headers.get('cache-control')
    assert.ok(cc === 'no-cache' || cc === null, `index not immutably cached (${cc})`)
  } finally { s.close() }
})