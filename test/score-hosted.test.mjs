// Score's hosted-backend helpers: adoptBest seeds the stored best from a
// GET response (never lowering it), submitBest POSTs the current best, and
// commitRecord chains the two. A fake fetch keeps this headless and offline.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Score, STORAGE_KEY } from '../src/game/Score.js'

function makeStorage(initial = null) {
  const m = new Map()
  if (initial !== null) m.set(STORAGE_KEY, String(initial))
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }
}
const fakeFetch = (responses) => async (url, init) => {
  const r = typeof responses === 'function' ? responses(url, init) : responses
  if (!r) throw new Error('network down')
  return { ok: r.ok !== false, json: async () => r.json }
}

test('adoptBest raises the local best from the server, never lowers it', async () => {
  const st = makeStorage(400)
  const s = new Score({ localStorage: st }, () => 1)
  assert.equal(s.best, 400)
  await s.adoptBest(fakeFetch({ json: { best: 900 } }))
  assert.equal(s.best, 900, 'server best wins')
  assert.equal(st.getItem(STORAGE_KEY), '900', 'mirrored into storage')
  await s.adoptBest(fakeFetch({ json: { best: 100 } }))
  assert.equal(s.best, 900, 'lower server value never lowers the best')
})

test('adoptBest survives offline, bad json, and missing fetch', async () => {
  const s = new Score({ localStorage: makeStorage(50) }, () => 1)
  await s.adoptBest(fakeFetch(null))
  assert.equal(s.best, 50, 'fetch failure keeps local best')
  await s.adoptBest(async () => ({ ok: true, json: async () => { throw new Error('bad json') } }))
  assert.equal(s.best, 50, 'json failure keeps local best')
  const noFetch = new Score({ localStorage: makeStorage(50) }, () => 1)
  await noFetch.adoptBest(async () => { throw new Error('no fetch') })
  assert.equal(noFetch.best, 50)
})

test('submitBest POSTs the best and commitRecord chains both', async () => {
  const calls = []
  const f = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ best: 777 }) } }
  const s = new Score({ localStorage: makeStorage() }, () => 1)
  s.value = 777
  const made = await s.commitRecord(f)
  assert.equal(made, true, 'record made')
  assert.equal(s.best, 777)
  assert.equal(calls.length, 1, 'one POST')
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body), { score: 777 })
  // No best -> no POST.
  const idle = new Score({ localStorage: makeStorage() }, () => 1)
  assert.equal(await idle.submitBest(f), false, 'best 0 submits nothing')
  assert.equal(calls.length, 1, 'no extra call')
})
