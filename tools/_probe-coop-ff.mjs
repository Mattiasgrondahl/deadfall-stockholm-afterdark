// tools/_probe-coop-ff.mjs — headless end-to-end check of the v4 co-op parity
// fixes: friendly fire (player→player damage via MSG.FF) + remote-zombie attack
// pose + self-hit feedback. Drives a real Room (server) with fake sockets and
// two real Multiplayer controllers, no browser needed.
import { Room } from '../server/server.js'
import { Multiplayer } from '../src/net/Multiplayer.js'
import { MSG, SERVER_TICK } from '../src/net/protocol.js'
import * as THREE from 'three'

class FakeWS {
  constructor() { this.sent = []; this.onopen = null; this.onmessage = null; this.onclose = null }
  send(s) { this.sent.push(JSON.parse(s)) }
  close() {}
  receive(m) { if (this.onmessage) this.onmessage({ data: JSON.stringify(m) }) }
}
function fakeDoc() {
  const mk = () => ({ children: [], style: {}, textContent: '', appendChild(c) { this.children.push(c) }, removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1) }, get firstChild() { return this.children[0] || null } })
  const body = mk(); return { body, createElement: () => mk() }
}

const room = new Room()
const scene = new THREE.Scene()
const doc = fakeDoc()

// Join two players through the real Room (assigns p0/p1 in join order).
const sA = new FakeWS(), sB = new FakeWS()
const pidA = room.join(sA, 'Ada')
const pidB = room.join(sB, 'Bob')

// Build two Multiplayer controllers wired to those sockets.
function makeClient(ws, pid) {
  const mp = new Multiplayer({ scene, env: { document: doc }, Socket: function () { return ws }, url: 'ws://x/ws', name: pid, room: 'r' })
  mp.socket = ws
  ws.onopen && ws.onopen()
  ws.receive({ t: MSG.WELCOME, pid, roster: [] })
  return mp
}
const A = makeClient(sA, pidA)
const B = makeClient(sB, pidB)

// Friendly fire: p0 shoots p1 through the real Room.applyFF path.
const victim = room.match.getPlayer(pidB).player
const hp0 = victim.health
room.applyFF(sA, { t: MSG.FF, victim: pidB, dmg: 60 })
console.log('FF applied:', hp0, '->', victim.health, '(expect 79)')

// Snapshot -> B adopts + the self-hit event fires onSelfHit.
let bHits = []
B.onSelfHit = (dmg, by, ff) => bHits.push({ dmg, by, ff })
room.tick(SERVER_TICK)
const snap = room.match.snapshot()
B.socket.receive({ t: MSG.SNAP, ...snap, events: [{ k: 'hit', victim: pidB, dmg: 21, by: pidA, ff: true }] })
console.log('B onSelfHit calls:', bHits.length, JSON.stringify(bHits))

// getPlayers exposes the teammate proxy on the other client.
A.socket.receive({ t: MSG.SNAP, ...snap })
const mates = A.getPlayers()
console.log('A sees teammates:', mates.map((p) => p.id))

// Remote zombie attack pose: feed an attack snapshot, drive update.
const zsnap = { ...snap, zombies: [{ id: 'z1', type: 'walker', x: 1, z: 2, health: 100, state: 'attack', facing: 0 }] }
A.socket.receive({ t: MSG.SNAP, ...zsnap })
const ze = A.zombies.get('z1')
if (ze && ze.update) { for (let i = 0; i < 30; i++) ze.update(1 / 60) }
console.log('z1 attack state:', ze && ze._state, 'lean:', ze && ze.group.rotation.x.toFixed(3))

const pass = victim.health === 79 && bHits.length === 1 && mates.map((p) => p.id).includes(pidB) && ze && ze._state === 'attack' && ze.group.rotation.x > 0
console.log(pass ? 'PASS' : 'FAIL')
process.exit(pass ? 0 : 1)