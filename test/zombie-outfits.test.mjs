// Focused tests for the v26 archetype-prop module: each trade gets a distinct,
// geometry-based silhouette (no printed-cloth image), female archetypes carry a
// long-hair back panel, and the shared geometry/materials are reused (no
// per-spawn allocation of the resources themselves).
import assert from 'node:assert'
import { buildOutfitProps, FEMALE_OUTFITS, OUTFIT_PROP_GEO, OUTFIT_PROP_MAT } from '../src/game/ZombieOutfits.js'

const tie = { name: 'tie' }
const stripe = { name: 'stripe' }

// Each archetype yields its recipe; tie/stripe reuse the caller's shared mats.
{
  const office = buildOutfitProps(0, { tie, stripe })
  assert.equal(office.length, 1, 'office worker has a necktie')
  assert.equal(office[0].mesh.material, tie, 'tie reuses the shared tie material')
  assert.equal(office[0].parent, 'torso', 'tie is torso-mounted')

  const cop = buildOutfitProps(2, { tie, stripe })
  assert.equal(cop.length, 1, 'cop has a chest badge')
  assert.equal(cop[0].mesh.geometry, OUTFIT_PROP_GEO.badge, 'cop badge uses the shared badge geometry')
  assert.equal(cop[0].mesh.material, OUTFIT_PROP_MAT.badge, 'cop badge uses the shared badge material')

  const fire = buildOutfitProps(3, { tie, stripe })
  assert.equal(fire.length, 1, 'fireman has a hi-vis stripe')
  assert.equal(fire[0].mesh.material, stripe, 'stripe reuses the shared hi-vis material')

  const mail = buildOutfitProps(1, { tie, stripe })
  assert.equal(mail.length, 1, 'mailman has a satchel strap')
}

// Female archetypes carry a skirt + a long-hair back panel parented to the head.
{
  for (const o of [4, 5, 6]) {
    assert.ok(FEMALE_OUTFITS.has(o), `archetype ${o} is flagged female`)
    const props = buildOutfitProps(o, { tie, stripe })
    const skirt = props.find(p => p.parent === 'torso' && (p.mesh.geometry === OUTFIT_PROP_GEO.skirt || p.mesh.geometry === OUTFIT_PROP_GEO.shortSkirt || p.mesh.geometry === OUTFIT_PROP_GEO.pleat))
    const hair = props.find(p => p.mesh.geometry === OUTFIT_PROP_GEO.longhair)
    assert.ok(skirt, `female archetype ${o} has a skirt`)
    assert.ok(hair, `female archetype ${o} has long back hair`)
    assert.equal(hair.parent, 'head', 'long hair is head-mounted')
  }
}

// Jogger + gym read through colour alone (no extra body prop).
{
  assert.equal(buildOutfitProps(7, { tie, stripe }).length, 0, 'jogger has no extra prop')
  assert.equal(buildOutfitProps(8, { tie, stripe }).length, 0, 'gym guy has no extra prop')
}

// Unknown archetype index is safe (empty), and a missing shared mat is skipped.
{
  assert.equal(buildOutfitProps(99, { tie, stripe }).length, 0, 'unknown archetype yields no props')
  assert.equal(buildOutfitProps(0, {}).length, 0, 'tie with no shared material is skipped')
}

// Geometry + material maps are shared (same object across two builds => no
// per-spawn allocation of the resources themselves).
{
  const a = buildOutfitProps(2, { tie, stripe })[0].mesh.geometry
  const b = buildOutfitProps(2, { tie, stripe })[0].mesh.geometry
  assert.strictEqual(a, b, 'badge geometry is shared across spawns')
}

console.log('zombie-outfits OK')