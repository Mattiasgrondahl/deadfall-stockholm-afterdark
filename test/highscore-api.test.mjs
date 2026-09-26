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

test('GET /api/highscore returns the seed best (root + base path)', async () => {
  const s = await listen({ highScore: 1234 })
  try {
    const a = await (await fetch(s.base + '/api/highscore')).json()
    const b = await (await fetch(s.base + '/deadfall-stockholm-afterdark/api/highscore')).json()
    assert.deepEqual(a, { best: 1234 })
    assert.deepEqual(b, { best: 1234 })
  } finally { s.close() }
})

test('POST raises the best only upward; garbage is ignored', async () => {
  const s = await listen({ highScore: 500 })
  try {
    const post = (body) => fetch(s.base + '/api/highscore', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    assert.deepEqual(await (await post(JSON.stringify({ score: 100 }))).json(), { best: 500 }, 'lower is ignored')
    assert.deepEqual(await (await post(JSON.stringify({ score: 900 }))).json(), { best: 900 }, 'higher wins')
    assert.deepEqual(await (await post('not json')).json(), { best: 900 }, 'bad body ignored')
    assert.deepEqual(await (await post(JSON.stringify({ score: -5 }))).json(), { best: 900 }, 'negative ignored')
    const r = await fetch(s.base + '/api/highscore', { method: 'DELETE' })
    assert.equal(r.status, 405, 'DELETE rejected')
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
