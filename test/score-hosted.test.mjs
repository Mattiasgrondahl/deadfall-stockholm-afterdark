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

test('v6: adoptBest adopts the hosted top-10 leaderboard', async () => {
  const s = new Score({ localStorage: makeStorage() }, () => 1)
  let fired = 0
  s._onBestChange = () => { fired++ }
  await s.adoptBest(fakeFetch({ json: { best: 900, name: 'Zed', top: [{ name: 'Zed', score: 900 }, { name: 'Ana', score: 500 }] } }))
  assert.equal(s.best, 900)
  assert.equal(s.bestName, 'Zed')
  assert.deepEqual(s.top, [{ name: 'Zed', score: 900 }, { name: 'Ana', score: 500 }], 'leaderboard adopted')
  assert.equal(fired, 1, 'change callback fired once')
  // A hostile name in the list is re-sanitized defensively on the client too:
  // control chars AND HTML-significant characters are stripped, and v4 UI also
  // allow-lists the charset to a-z 0-9 space _ ! ?, so a markup payload is fully
  // neutralized (parens/slash/equals dropped too) at the source, not only at render.
  await s.adoptBest(fakeFetch({ json: { best: 10, top: [{ name: '<b>x</b>\n\ny', score: 10 }] } }))
  assert.equal(s.top[0].name, 'bxby', 'control chars + markup + disallowed chars stripped')
  // v4 XSS: a classic img/onerror payload loses every angle bracket + quote + paren.
  await s.adoptBest(fakeFetch({ json: { best: 500, top: [{ name: '<img src=x onerror=alert(1)>', score: 500 }] } }))
  assert.equal(s.top[0].name, 'img srcx onerroralert1', 'XSS payload stripped to the allowed charset')
  assert.ok(!/[<>&"']/.test(s.top[0].name), 'no markup-significant chars survive')
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
  assert.deepEqual(JSON.parse(calls[0].init.body), { score: 777, name: '', room: 'default' }, 'POST carries the (empty) holder name + default room')
  // No best -> no POST.
  const idle = new Score({ localStorage: makeStorage() }, () => 1)
  assert.equal(await idle.submitBest(f), false, 'best 0 submits nothing')
  assert.equal(calls.length, 1, 'no extra call')
})

test('v8: submitBest adopts the returned board so the scorer appears immediately', async () => {
  // The POST response carries the room's updated top-10 with the player's new
  // entry slotted in; submitBest must adopt it so the title board shows the
  // player's name without waiting for a reload/adoptBest.
  const s = new Score({ localStorage: makeStorage() }, () => 1)
  s.name = 'Rex'
  s.value = 450
  s.newRecord()
  let fired = 0
  s._onBestChange = () => { fired++ }
  const posted = await s.submitBest(fakeFetch({
    json: { best: 900, name: 'Zed', top: [
      { name: 'Zed', score: 900 }, { name: 'Rex', score: 450 }, { name: 'Ana', score: 300 }
    ] }
  }))
  assert.equal(posted, true, 'POST landed')
  assert.deepEqual(s.top.map((e) => e.name), ['Zed', 'Rex', 'Ana'], 'board adopted from the POST response')
  assert.equal(s.best, 900, 'higher hosted best adopted')
  assert.equal(s.bestName, 'Zed', 'holder name adopted')
  assert.equal(fired, 1, 'change callback fired so the title board re-renders')
})

test('v9: submitRun posts the finished run even when it is NOT a local record', async () => {
  // A fresh player has no local best yet, so newRecord()/submitBest would drop
  // the run. submitRun posts the run's value to the hosted top-10 regardless,
  // letting the server decide qualification.
  const calls = []
  const f = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, json: async () => ({ best: 1000, name: 'REAPER', top: [{ name: 'REAPER', score: 1000 }, { name: 'Newbie', score: 320 }] }) }
  }
  const s = new Score({ localStorage: makeStorage(900) }, () => 1)
  s.name = 'Newbie'
  s.setRoom('ROOM7')
  s.value = 320 // below the local best of 900 → not a record
  const posted = await s.submitRun(f)
  assert.equal(posted, true, 'run posted despite not beating the local best')
  assert.equal(calls.length, 1, 'one POST')
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body), { score: 320, name: 'Newbie', room: 'ROOM7' }, 'posts the run value + name + room')
  assert.equal(s.best, 1000, 'hosted best (1000) adopted over the local 900')
  assert.equal(s.bestName, 'REAPER', 'hosted holder name adopted')
  assert.deepEqual(s.top.map((e) => e.name), ['REAPER', 'Newbie'], 'hosted board adopted')
})

test('v9: submitRun skips a zero run and survives offline', async () => {
  const f = async () => ({ ok: true, json: async () => ({}) })
  const s = new Score({ localStorage: makeStorage() }, () => 1)
  s.value = 0
  assert.equal(await s.submitRun(f), false, 'zero run posts nothing')
  const s2 = new Score({ localStorage: makeStorage() }, () => 1)
  s2.value = 150
  assert.equal(await s2.submitRun(async () => { throw new Error('network down') }), false, 'network failure is swallowed')
})
