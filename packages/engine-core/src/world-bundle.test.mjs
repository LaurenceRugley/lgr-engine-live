/* ============================================================
   world-bundle.test.mjs — the A18 portable-format validator, pinned.
   ------------------------------------------------------------
   Verifies the validator does its ONE job: accept a conformant bundle and REJECT the ways a bundle can be
   broken (foreign/absent format tag, an incompatible version, a missing data file, an asset that names no
   loadable format, a dangling baked reference). Each test encodes WHY a loader would fail on that input —
   this is the "validator catches a deliberately-corrupted bundle" gate as code. Pure: a fake `fileExists`
   stands in for the filesystem.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUNDLE_FORMAT, BUNDLE_VERSION, buildManifest, validateManifest, isVersionCompatible, parseVersion,
} from './world-bundle.js';

// a well-formed manifest + a fileExists that says every referenced file is present.
function goodManifest() {
  return buildManifest({
    name: 'dead-coast', seed: 1337, createdISO: '2026-07-30T00:00:00Z',
    assets: [{ id: 'zombie', role: 'character', gltf: 'assets/zombie.glb', usd: 'assets/zombie.usdz' }],
    baked: [{ id: 'probes', kind: 'irradiance-rgba8', file: 'baked/probes.bin', optional: true }],
  });
}
const ALL_PRESENT = () => true;
const filesPresent = (set) => (p) => set.has(p);

test('a conformant bundle validates ok (0 errors)', () => {
  const r = validateManifest(goodManifest(), { fileExists: ALL_PRESENT });
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.deepEqual(r.errors, []);
});

test('version compatibility: same major loads, newer/older major does not', () => {
  assert.equal(isVersionCompatible('1.0.0', '1.5.0'), true);   // older minor, same major → loadable
  assert.equal(isVersionCompatible('1.9.0', '1.2.0'), false);  // bundle newer than loader → refuse
  assert.equal(isVersionCompatible('2.0.0', '1.0.0'), false);  // major bump → refuse
  assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('nope'), [null, null, null]);
});

test('CORRUPTION: a foreign format tag is rejected', () => {
  const m = goodManifest(); m.format = 'some-other-thing';
  const r = validateManifest(m, { fileExists: ALL_PRESENT });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('format must be')), r.errors.join('; '));
});

test('CORRUPTION: an incompatible (newer-major) version is rejected', () => {
  const m = goodManifest(); m.version = '9.0.0';
  const r = validateManifest(m, { fileExists: ALL_PRESENT });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('not loadable')), r.errors.join('; '));
});

test('CORRUPTION: a missing world data file is caught by fileExists', () => {
  // recipe.json + config.json present, sim-params.json MISSING → an error naming the missing file.
  const present = filesPresent(new Set(['recipe.json', 'config.json', 'assets/zombie.glb', 'assets/zombie.usdz', 'baked/probes.bin']));
  const r = validateManifest(goodManifest(), { fileExists: present });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('sim-params.json') && e.includes('not found')), r.errors.join('; '));
});

test('CORRUPTION: an asset that names neither gltf nor usd is rejected', () => {
  const m = goodManifest(); m.assets.push({ id: 'ghost', role: 'prop' });
  const r = validateManifest(m, { fileExists: ALL_PRESENT });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('ghost') && e.includes('neither gltf nor usd')), r.errors.join('; '));
});

test('CORRUPTION: a dangling (non-optional) baked reference is an error; optional is only a warning', () => {
  const present = filesPresent(new Set(['recipe.json', 'config.json', 'sim-params.json', 'assets/zombie.glb', 'assets/zombie.usdz']));
  // probes.bin is optional → warning, still ok
  let r = validateManifest(goodManifest(), { fileExists: present });
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.ok(r.warnings.some((w) => w.includes('probes') && w.includes('substitute')));
  // make it REQUIRED → now it's an error
  const m = goodManifest(); m.baked[0].optional = false;
  r = validateManifest(m, { fileExists: present });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('probes') && e.includes('not found')));
});

test('a browser-only asset (no USD) loads but WARNS about the iOS gap (honest half)', () => {
  const m = buildManifest({ name: 'x', seed: 1, assets: [{ id: 'critter', gltf: 'assets/critter.glb' }] });
  const r = validateManifest(m, { fileExists: ALL_PRESENT });
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.ok(r.warnings.some((w) => w.includes('critter') && w.includes('iOS')), 'must warn that iOS cannot load a USD-less asset');
});

test('buildManifest stamps the current format + version', () => {
  const m = buildManifest({ name: 'x' });
  assert.equal(m.format, BUNDLE_FORMAT);
  assert.equal(m.version, BUNDLE_VERSION);
  assert.equal(m.world.recipe, 'recipe.json');   // defaults
});
