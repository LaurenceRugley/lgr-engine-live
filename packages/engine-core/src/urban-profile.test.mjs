/* ============================================================
   urban-profile.test.mjs — ARC A21's OWN HONESTY CHECK (Rule 9: intent, not just behavior).
   ------------------------------------------------------------
   The arc's brief: "prove the schema by round-tripping an existing profile through it and diffing the
   generated output against the profile path — if they can't be expressed, the schema is wrong and you
   should say so rather than bend it." This is that proof, at TWO levels:
     1. OBJECT — an urban recipe built from citygen.js's own literal `manhattan` values, run through
        `cityProfileFromUrban`, must deep-equal `PROFILES[0]` field-for-field. Not "close" — EXACT, because
        the schema fields are meant to carry the same information losslessly, just under the document's own
        naming (heightMean/subdivisionRate/etc instead of hMax/pSplit/etc).
     2. GENERATED OUTPUT — the stronger claim: `createCity({ profile: <round-tripped> })` must produce the
        IDENTICAL `state.sig`/`extent`/`meshCount` as `createCity({ profileIndex: 0 })` at the SAME seed —
        proof that the round-tripped profile doesn't just LOOK equal, it actually drives byte-identical
        generation (the same guarantee citygen-profile.test.mjs already pins for a hand-authored custom
        profile object).
   Also pins the era-preset fallback + neutral-default behavior (no era, no explicit palette → still a
   complete, valid profile — every field defined, nothing null/undefined reaching createCity).
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cityProfileFromUrban, URBAN_ERAS } from './urban-profile.js';
import { createCity, PROFILES } from './citygen.js';

// Manhattan's OWN literal values (citygen.js:80-91), re-expressed under the urban schema's own field
// names — this IS the round-trip: the same numbers/colours, just reorganised into the recipe's document
// shape (layout{}/palette{}/waterfront{}) instead of the flat profile object.
const MANHATTAN_URBAN = {
  key: 'manhattan', name: 'Manhattan', blockPattern: 'grid', era: null,
  layout: { heightMean: 4.6, heightSpread: 0.36, subdivisionRate: 0.60, roofDetailRate: 0.35, nightLitFraction: 0.55, streetWidth: 1 },
  palette: {
    towers: ['#EDE3C8', '#D9B98A', '#B5562F', '#A8C8E8', '#2E3F5C'],
    ground: '#7CC455', street: '#9AA0A6', sidewalk: '#C8CCD0', park: '#5DB347', water: '#29A8D8',
    shopfronts: ['#C04A3A', '#3A7AC0', '#C09A2A'], glass: '#7FA8CC',
    winColors: ['#ffd27a', '#9ad6ff'], roofTint: null,
  },
  waterfront: { kind: 'coast', base: 0.55, out: 1.00, in: 0.60, jag: 1.05 },
  landmarks: ['empireState', 'chrysler', 'liberty'],
  groundWetness: 0, streetLife: 0, location: null, seedOffset: 0,
};

test('ROUND-TRIP (object) — the manhattan urban recipe maps to a profile deep-equal to PROFILES[0]', () => {
  const rebuilt = cityProfileFromUrban(MANHATTAN_URBAN);
  assert.deepEqual(rebuilt, PROFILES[0], 'cityProfileFromUrban(manhattan-equivalent) must equal the real manhattan profile exactly');
});

test('ROUND-TRIP (generated output) — the same seed produces an IDENTICAL city, not just an equal profile', () => {
  const rebuilt = cityProfileFromUrban(MANHATTAN_URBAN);
  const original = createCity({ profileIndex: 0, seed: 1337 });
  const viaUrban = createCity({ profile: rebuilt, seed: 1337 });
  assert.equal(viaUrban.state.sig, original.state.sig, 'determinism signature matches (same rng stream ⇒ same layout)');
  assert.equal(viaUrban.extent, original.extent, 'island extent matches');
  assert.equal(viaUrban.state.meshCount, original.state.meshCount, 'mesh count matches');
});

test('a bare urban recipe (no era, no explicit palette) still resolves to a COMPLETE profile — nothing null reaches createCity', () => {
  const bare = {
    key: null, name: null, blockPattern: 'grid', era: null,
    layout: { heightMean: 2.6, heightSpread: 0.6, subdivisionRate: 0.6, roofDetailRate: 0.3, nightLitFraction: 0.4, streetWidth: 1 },
    palette: { towers: null, ground: null, street: null, sidewalk: null, park: null, water: null, shopfronts: null, glass: null, winColors: null, roofTint: null },
    waterfront: { kind: 'none', base: 0.7, out: 0.7, in: 0.4, jag: 1.0 },
    landmarks: [], groundWetness: 0, streetLife: 0, location: null, seedOffset: 0,
  };
  const p = cityProfileFromUrban(bare);
  for (const field of ['towers', 'ground', 'street', 'sidewalk', 'park', 'water', 'shopfronts', 'glass', 'winColors', 'hMax', 'sigma', 'roofRate', 'pSplit', 'nightLit', 'coast', 'landmarks']) {
    assert.notEqual(p[field], null, `${field} must not be null`);
    assert.notEqual(p[field], undefined, `${field} must not be undefined`);
  }
  assert.equal(p.roofTint, null, 'roofTint IS legitimately nullable (Manhattan itself has none) — the neutral default preserves that');
  // and it must actually generate without throwing, at a real seed.
  const built = createCity({ profile: p, seed: 42 });
  assert.ok(built.state.meshCount > 0, 'the neutral-default profile actually generates a city');
});

test('era presets fill layout+palette defaults, but an explicit city field still wins over the era', () => {
  const withEra = {
    key: null, name: null, blockPattern: 'grid', era: 'brutalist',
    layout: { heightMean: 2.6, heightSpread: 0.6, subdivisionRate: 0.6, roofDetailRate: 0.3, nightLitFraction: 0.4, streetWidth: 1 },
    palette: { towers: null, ground: null, street: null, sidewalk: null, park: null, water: null, shopfronts: null, glass: null, winColors: null, roofTint: null },
    waterfront: { kind: 'none', base: 0.7, out: 0.7, in: 0.4, jag: 1.0 },
    landmarks: [], groundWetness: 0, streetLife: 0, location: null, seedOffset: 0,
  };
  const p1 = cityProfileFromUrban(withEra);
  assert.deepEqual(p1.towers, URBAN_ERAS.brutalist.palette.towers, 'brutalist era supplies its own tower palette');
  assert.equal(p1.roofTint, URBAN_ERAS.brutalist.palette.roofTint, 'brutalist era supplies a roofTint');

  const overridden = { ...withEra, palette: { ...withEra.palette, towers: ['#ff0000'] } };
  const p2 = cityProfileFromUrban(overridden);
  assert.deepEqual(p2.towers, ['#ff0000'], 'an explicit palette.towers wins over the era default');
});

test('cityProfileFromUrban is pure — same input twice ⇒ deep-equal output, and does not mutate its argument', () => {
  const before = JSON.parse(JSON.stringify(MANHATTAN_URBAN));
  const a = cityProfileFromUrban(MANHATTAN_URBAN);
  const b = cityProfileFromUrban(MANHATTAN_URBAN);
  assert.deepEqual(a, b);
  assert.deepEqual(MANHATTAN_URBAN, before, 'the input city object is not mutated');
});
