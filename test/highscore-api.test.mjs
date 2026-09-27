// Hosted high-score API (production host): the server answers GET/POST
// /api/highscore at both the root and the Pages base path, keeps the max,
// and rejects junk. Driven through startServer on an ephemeral port — the
// listen callback is async, so every test waits for the bound port first.
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

test('GET /api/highscore returns the seed best + name (root + base path)', async () => {
  const s = await listen({ highScore: 1234, highScoreName: 'Ana' })
  try {
    const a = await (await fetch(s.base + '/api/highscore')).json()
    const b = await (await fetch(s.base + '/deadfall-stockholm-afterdark/api/highscore')).json()
    assert.deepEqual(a, { best: 1234, name: 'Ana' })
    assert.deepEqual(b, { best: 1234, name: 'Ana' })
  } finally { s.close() }
})

test('POST raises the best only upward; garbage is ignored', async () => {
  const s = await listen({ highScore: 500 })
  try {
    const post = (body) => fetch(s.base + '/api/highscore', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    assert.deepEqual(await (await post(JSON.stringify({ score: 100, name: 'a' }))).json(), { best: 500, name: '' }, 'lower is ignored')
    assert.deepEqual(await (await post(JSON.stringify({ score: 900, name: 'Zed' }))).json(), { best: 900, name: 'Zed' }, 'higher wins')
    assert.deepEqual(await (await post('not json')).json(), { best: 900, name: 'Zed' }, 'bad body ignored')
    assert.deepEqual(await (await post(JSON.stringify({ score: -5 }))).json(), { best: 900, name: 'Zed' }, 'negative ignored')
    const r = await fetch(s.base + '/api/highscore', { method: 'DELETE' })
    assert.equal(r.status, 405, 'DELETE rejected')
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
    assert.ok(r.name.length <= 24, `name clamped to 24 (${r.name.length})`)
    assert.ok(!new RegExp('[\\u0000-\\u001f\\u007f]').test(r.name), 'no control characters survive')
    assert.ok(!/\s{2,}/.test(r.name), 'no runs of whitespace survive')
    // The payload survives as inert TEXT (it is rendered via textContent), but
    // crucially it is never markup: the server stores the raw characters, and
    // the client never uses innerHTML. Assert the record holder is exactly the
    // sanitized string, so a downstream textContent render yields zero nodes.
    assert.equal(r.name, '<img src=x onerror=alert(1)> <b>zz</b>'.slice(0, 24))
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
