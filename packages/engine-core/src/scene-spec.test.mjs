/* scene-spec.test.mjs — L109: the repo's FIRST unit test (plain `node --test`, no framework). Runs headless
   (no GPU, no DOM) because scene-spec.js is a pure module — that decoupling is the point. `npm test`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSceneSpec, fromURLParams, toURLParams, applySceneSpec } from './scene-spec.js';

const parse = (qs) => fromURLParams(new URLSearchParams(qs));

// Criterion 2 — the SCENE URL vocabulary → the expected spec object (≥10 real links incl. ?t/?style/?vector/?world).
test('fromURLParams: SCENE URL vocabulary → spec', () => {
  const cases = [
    ['', { v: 1, engine: 'city' }],
    ['?city=424242', { v: 1, engine: 'city', seed: 424242 }],
    ['?profile=neoTokyo', { v: 1, engine: 'city', profile: 'neoTokyo' }],
    ['?t=0.3', { v: 1, engine: 'city', time: 0.3 }],
    ['?time=dusk', { v: 1, engine: 'city', time: 0.75 }],
    ['?t=0.3&time=night', { v: 1, engine: 'city', time: 0.0 }],           // ?time overrides ?t (city applies ?t then ?time)
    ['?weather=rain', { v: 1, engine: 'city', weather: 'rain' }],
    ['?style=pixel', { v: 1, engine: 'city', post: 'pixel' }],
    ['?style=toon&vector=1', { v: 1, engine: 'city', post: 'toon', vector: true }],
    ['?style=vector', { v: 1, engine: 'city', vector: true }],            // legacy: the material axis, NOT a post mode
    ['?cam=iso', { v: 1, engine: 'city', camera: 'iso' }],
    ['?world=1&preset=archipelago', { v: 1, engine: 'world', world: { preset: 'archipelago' } }],
    ['?city=7&profile=paris&t=0.5&weather=fog&style=pixel&cam=persp',
      { v: 1, engine: 'city', seed: 7, profile: 'paris', time: 0.5, weather: 'fog', post: 'pixel', camera: 'persp' }],
  ];
  for (const [qs, expected] of cases) assert.deepEqual(parse(qs), expected, `for "${qs}"`);
});

test('fromURLParams drops unknown/invalid values (a bad ?param just leaves the field unset)', () => {
  // ?time=<garbage> is the ckpt-7 headline delta: it DROPS (validate-and-drop), it does NOT fall back to noon like
  // city's old `?? 0.5`. Without this case the delta was untested (mutation-A survived the suite).
  for (const qs of ['?style=bogus', '?cam=top', '?weather=hail', '?profile=atlantis', '?city=1.5', '?t=abc', '?t=Infinity', '?time=midnight', '?time=xyz'])
    assert.deepEqual(parse(qs), { v: 1, engine: 'city' }, `for "${qs}"`);
});

test('toURLParams is null/undefined-safe (SDK robustness)', () => {
  assert.equal(toURLParams(null), '');
  assert.equal(toURLParams(undefined), '');
  assert.equal(toURLParams(42), '');
  assert.equal(toURLParams({ v: 1, engine: 'city' }), '');   // a bare spec has no URL-expressible fields
});

// Criterion 3 — validateSceneSpec rejections, each with a readable error.
test('validateSceneSpec rejects malformed specs', () => {
  assert.equal(validateSceneSpec({ v: 1 }).ok, true);
  assert.equal(validateSceneSpec({ v: 2 }).ok, false);                     // wrong version → own loader
  assert.equal(validateSceneSpec({ v: 1, time: Infinity }).ok, false);     // isFinite, not isNaN
  assert.equal(validateSceneSpec({ v: 1, time: NaN }).ok, false);
  assert.equal(validateSceneSpec({ v: 1, post: 'nope' }).ok, false);
  assert.equal(validateSceneSpec({ v: 1, vector: 'yes' }).ok, false);      // must be boolean
  assert.equal(validateSceneSpec({ v: 1, seed: 1.5 }).ok, false);          // non-int
  assert.equal(validateSceneSpec({ v: 1, camera: 'top' }).ok, false);
  assert.equal(validateSceneSpec({ v: 1, world: 'oops' }).ok, false);      // malformed world payload
  assert.equal(validateSceneSpec({ v: 1, world: { preset: 'moon' } }).ok, false);  // bad preset
  assert.equal(validateSceneSpec(null).ok, false);
  assert.equal(validateSceneSpec([]).ok, false);
  assert.match(validateSceneSpec({ v: 1, time: Infinity }).errors[0], /time/);
});

// Builder-UI seed — unknown TOP-LEVEL sections are TOLERATED (a future SiteSpec's pages/theme), surfaced not rejected.
test('validateSceneSpec tolerates unknown top-level sections (site-builder forward-compat)', () => {
  const r = validateSceneSpec({ v: 1, engine: 'city', pages: [{ path: '/' }], theme: { ink: '#111' } });
  assert.equal(r.ok, true, 'unknown sections must not fail v1 validation');
  assert.deepEqual(r.unknownSections.sort(), ['pages', 'theme']);
});

// Criterion 4 — round-trip stable (a fixpoint) for the URL-expressible subset.
test('round-trip: toURLParams∘fromURLParams is a stable fixpoint', () => {
  for (const qs of ['?city=7&profile=paris&t=0.5&weather=fog&style=pixel&cam=persp&vector=1',
                    '?world=1&preset=valley', '?time=dusk', '?style=vector', '?cam=dimetric']) {
    const a = parse(qs);
    const b = parse(toURLParams(a));
    const c = parse(toURLParams(b));
    assert.deepEqual(b, a, `re-parse should equal the spec for "${qs}"`);
    assert.deepEqual(c, b, `round-trip must be a fixpoint for "${qs}"`);
  }
});

// applySceneSpec — logic (deferred boot-fields + the string→engine maps) against a stub engine (no GPU).
test('applySceneSpec defers boot-only fields + applies the rest via engine methods', () => {
  const calls = [];
  const engine = {
    vector: false,
    sunRig: { goTo: (t) => calls.push(['time', t]) },
    weatherRig: { setKind: (w) => calls.push(['weather', w]) },
    setPostMode: (n) => calls.push(['post', n]),
    setVector: (b) => calls.push(['vector', b]),
    rig: { setMode: (m) => calls.push(['camera', m]) },
  };
  const r = applySceneSpec(engine, { v: 1, engine: 'city', seed: 9, profile: 'paris', time: 0.4, weather: 'rain', post: 'pixel', vector: true, camera: 'iso' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.deferred, { seed: 9, profile: 'paris', engine: 'city' });    // boot-only → NOT applied
  assert.deepEqual(r.applied.sort(), ['camera', 'post', 'time', 'vector', 'weather']);
  assert.deepEqual(calls.find((c) => c[0] === 'post'), ['post', 7]);              // 'pixel' → mode 7
  assert.deepEqual(calls.find((c) => c[0] === 'camera'), ['camera', 5]);          // 'iso' → CAM.ISOMETRIC
  assert.equal(applySceneSpec(engine, { v: 1, time: Infinity }).ok, false);       // invalid → nothing applied
});
