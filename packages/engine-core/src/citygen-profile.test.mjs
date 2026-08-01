// citygen-profile.test.mjs — node:test of the CITYGEN-PROFILE-OBJECT param (createCity runs headless now
// that the window.__city probe is guarded). Encodes the ability's contract (Rule 9 — WHY):
//   • OMITTING profile indexes the three baked PROFILES EXACTLY as before (the byte-identical baseline —
//     tier-guard + present-parity prove the pixels; this proves the param routing);
//   • profileIndex still works (the existing param is unbroken);
//   • a CUSTOM profile object is actually USED — identity + it DRIVES generation (a distinct coast.base
//     yields a distinct extent; it's consumed, not ignored);
//   • the custom skin is STICKY across reroll (the run needs it to persist);
//   • same (seed, profile) ⇒ same city (the determinism/regression contract).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, PROFILES } from './citygen.js';

test('default (no profile) → indexes the baked PROFILES exactly as before', () => {
  const c = createCity({ seed: 7 });
  assert.equal(c.state.profile, PROFILES[0], 'omitting profile → PROFILES[profileIndex] (default 0)');
  assert.ok(c.state.meshCount > 0, 'the city actually built');
});

test('profileIndex still selects a baked profile (existing param unbroken)', () => {
  assert.equal(createCity({ seed: 7, profileIndex: 1 }).state.profile, PROFILES[1]);
  assert.equal(createCity({ seed: 7, profileIndex: 2 }).state.profile, PROFILES[2]);
});

test('a custom profile OBJECT is used AND drives generation (consumed, not ignored)', () => {
  // a valid full-shape profile with a distinct coastline base → a distinct land extent
  const custom = { ...PROFILES[0], key: 'custom', name: 'Custom', coast: { base: 3.0, out: 1.0, in: 0.6, jag: 1.0 } };
  const baseline = createCity({ seed: 7 });                 // Manhattan, coast.base 0.55
  const c = createCity({ seed: 7, profile: custom });
  assert.equal(c.state.profile, custom, 'the passed object IS the active profile (identity)');
  assert.notEqual(c.extent, baseline.extent, 'a different coast.base must change the extent — proof it drives generation');
  assert.ok(Math.abs(c.extent - baseline.extent - (3.0 - 0.55)) < 1e-6, 'extent shifted by exactly Δcoast.base');
  assert.ok(c.state.meshCount > 0, 'the custom-skinned city built');
});

test('the custom skin is STICKY across reroll/regenerate', () => {
  const custom = { ...PROFILES[1], key: 'run-skin', name: 'Run' };
  const c = createCity({ seed: 3, profile: custom });
  c.generate(99, 2);                                        // reroll with a new seed + a baked index 2
  assert.equal(c.state.profile, custom, 'the custom skin persists (index 2 does NOT override it)');
  assert.equal(c.state.seed, 99, 'but the new seed took (the reroll happened)');
});

test('determinism: same (seed, custom profile) ⇒ same extent + meshCount', () => {
  const mk = () => { const p = { ...PROFILES[0], key: 'det' }; return createCity({ seed: 42, profile: p }); };
  const a = mk(), b = mk();
  assert.equal(a.extent, b.extent);
  assert.equal(a.state.meshCount, b.state.meshCount);
});

/* ============================================================
   ARC A21 — blockPattern (additive). Same discipline as the profile tests above: OMITTING blockPattern
   must be indistinguishable from before it existed (the byte-identical guard — tier-guard/present-parity
   prove the pixels; this proves the param routing + default). 'radial' must be a REAL, different,
   deterministic pattern, not a cosmetic label. 'organic' must say what it is (deferred), not fake it.
   ============================================================ */
test('OMITTING blockPattern (every existing caller) behaves exactly as before adding this param', () => {
  const withDefault = createCity({ seed: 1337, profileIndex: 0 });
  const explicitGrid = createCity({ seed: 1337, profileIndex: 0, blockPattern: 'grid' });
  assert.equal(withDefault.state.sig, explicitGrid.state.sig, 'default omission ≡ explicit "grid"');
  assert.equal(withDefault.extent, explicitGrid.extent);
  assert.equal(withDefault.state.meshCount, explicitGrid.state.meshCount);
});

test('"radial" is a genuinely different, deterministic pattern (not just a label)', () => {
  const grid = createCity({ seed: 1337, profileIndex: 0, blockPattern: 'grid' });
  const radial1 = createCity({ seed: 1337, profileIndex: 0, blockPattern: 'radial' });
  const radial2 = createCity({ seed: 1337, profileIndex: 0, blockPattern: 'radial' });
  assert.notEqual(radial1.state.sig, grid.state.sig, 'radial produces a different layout signature than grid');
  assert.equal(radial1.state.sig, radial2.state.sig, 'same seed ⇒ same radial layout (deterministic)');
  assert.ok(radial1.state.meshCount > 0, 'the radial city actually built');
});

test('"organic" is HONESTLY not yet implemented — it falls back to "grid" (documented, not silently faked)', () => {
  const grid = createCity({ seed: 1337, profileIndex: 0, blockPattern: 'grid' });
  const organic = createCity({ seed: 1337, profileIndex: 0, blockPattern: 'organic' });
  assert.equal(organic.state.sig, grid.state.sig, '"organic" currently generates identically to "grid" (the stated fallback)');
});
