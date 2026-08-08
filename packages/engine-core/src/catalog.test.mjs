/* ============================================================
   catalog.test.mjs — catalog.js shipped with ZERO tests (Lesson 71) and, per DESIGN's 337-export
   orphan audit, zero consumers either — the exact combination that let it drift unnoticed. Arc A-CAT
   gives it its first real consumer (registerAssetCatalog, fed by tools/generate-asset-catalog.mjs) and,
   per that arc's explicit scope, its first tests: the base registry contract (register/get/byKind/
   byGroup/setArt/size — untested before now) plus the new byClassification + registerAssetCatalog.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalog, seedWorldEditorCatalog, registerAssetCatalog } from './catalog.js';

test('register: adds an entry retrievable by id, filling in defaults/art if omitted', () => {
  const cat = createCatalog();
  cat.register({ id: 'x', label: 'X', kind: 'material', group: 'Terrain' });
  const e = cat.get('x');
  assert.equal(e.label, 'X');
  assert.deepEqual(e.defaults, {}, 'defaults defaults to {} when omitted');
  assert.deepEqual(e.art, {}, 'art defaults to {} when omitted');
});

test('register: silently no-ops on a missing entry or missing id (does not throw)', () => {
  const cat = createCatalog();
  assert.doesNotThrow(() => cat.register(null));
  assert.doesNotThrow(() => cat.register({ label: 'no id' }));
  assert.equal(cat.size, 0, 'neither malformed call added an entry');
});

test('register: last write wins on a duplicate id (the documented overwrite contract)', () => {
  const cat = createCatalog();
  cat.register({ id: 'x', label: 'first', kind: 'material' });
  cat.register({ id: 'x', label: 'second', kind: 'material' });
  assert.equal(cat.size, 1, 'one id, one entry');
  assert.equal(cat.get('x').label, 'second', 'the later register() replaces the earlier one');
});

test('registerAll registers every entry in the list, in order', () => {
  const cat = createCatalog();
  cat.registerAll([
    { id: 'a', label: 'A', kind: 'entity' },
    { id: 'b', label: 'B', kind: 'entity' },
  ]);
  assert.equal(cat.size, 2);
  assert.equal(cat.get('a').label, 'A');
  assert.equal(cat.get('b').label, 'B');
});

test('byKind filters correctly across mixed kinds; byGroup filters correctly across mixed groups', () => {
  const cat = createCatalog();
  cat.registerAll([
    { id: 'm1', kind: 'material', group: 'Terrain' },
    { id: 's1', kind: 'scatter', group: 'Vegetation' },
    { id: 'm2', kind: 'material', group: 'Terrain' },
  ]);
  assert.equal(cat.byKind('material').length, 2);
  assert.equal(cat.byKind('scatter').length, 1);
  assert.equal(cat.byKind('entity').length, 0, 'a kind with no entries returns an empty array, not undefined');
  assert.equal(cat.byGroup('Terrain').length, 2);
  assert.equal(cat.byGroup('Nonexistent').length, 0);
});

test('setArt rebinds only the art field of an existing entry, merging (not replacing) it — the placeholder→real swap', () => {
  const cat = createCatalog();
  cat.register({ id: 'x', kind: 'material', defaults: { colorIndex: 3 }, art: { icon: '#fff', placeholder: true } });
  cat.setArt('x', { factory: () => 'mesh' });
  const e = cat.get('x');
  assert.equal(typeof e.art.factory, 'function', 'the new factory landed');
  assert.equal(e.art.icon, '#fff', 'setArt MERGES — a field it does not mention survives');
  assert.deepEqual(e.defaults, { colorIndex: 3 }, 'setArt never touches defaults — only art');
});

test('setArt on an unknown id is a safe no-op', () => {
  const cat = createCatalog();
  assert.doesNotThrow(() => cat.setArt('ghost', { factory: () => {} }));
});

test('size reflects live entry count as entries are added', () => {
  const cat = createCatalog();
  assert.equal(cat.size, 0);
  cat.register({ id: 'x', kind: 'material' });
  assert.equal(cat.size, 1);
  cat.register({ id: 'x', kind: 'material' });   // overwrite, not a second entry
  assert.equal(cat.size, 1);
});

test('all() returns every entry, ignoring kind/group', () => {
  const cat = createCatalog();
  cat.registerAll([{ id: 'a', kind: 'material' }, { id: 'b', kind: 'scatter' }]);
  assert.equal(cat.all().length, 2);
});

test('seedWorldEditorCatalog: one material entry per BIOME, plus the known scatter/entity stubs, all placeholders', () => {
  const cat = seedWorldEditorCatalog();
  assert.ok(cat.byKind('material').length > 0, 'BIOMES seeded at least one material entry');
  assert.ok(cat.byKind('scatter').length >= 3, 'the three known scatter stubs are present');
  assert.ok(cat.byKind('entity').length >= 8, 'the known entity stubs are present');
  for (const e of cat.byKind('scatter')) assert.equal(e.art.placeholder, true, 'scatter stubs ship as placeholders (L72 binds real art)');
});

// ── ARC A-CAT: registerAssetCatalog — the file-index → runtime-catalog bridge ──────────────────────
const FIXTURE_ENTRIES = [
  {
    path: 'packages/engine-core/assets/models/building-g.glb', home: 'engine-core-library', label: 'building-g.glb',
    classification: 'LIBRARY', licence: { type: 'CC0-1.0', source: 'packages/engine-core/assets/models/CREDITS.md:1' },
    provenance: { kind: 'vendored', source: 'Kenney — City Kit (Commercial), v2.1' },
    sizeBytes: 12345, sha256: 'deadbeef', tris: 480, meshes: 3,
  },
  {
    path: 'assets/models/critter.glb', home: 'repo-root-pipeline-proof', label: 'critter.glb',
    classification: 'AMBIGUOUS', licence: { type: 'first-party', source: 'first-party, generated by tools/blender/build_critter.py' },
    provenance: { kind: 'first-party', generator: 'tools/blender/build_critter.py' },
    sizeBytes: 6789, sha256: 'cafef00d', tris: 210, meshes: 1,
  },
];

test('registerAssetCatalog: registers every entry as kind:"asset", id = path, group = home', () => {
  const cat = registerAssetCatalog(createCatalog(), FIXTURE_ENTRIES);
  assert.equal(cat.size, 2);
  const e = cat.get('packages/engine-core/assets/models/building-g.glb');
  assert.equal(e.kind, 'asset');
  assert.equal(e.group, 'engine-core-library');
  assert.equal(e.label, 'building-g.glb');
});

test('registerAssetCatalog: the full generated record survives on entry.asset, untouched', () => {
  const cat = registerAssetCatalog(createCatalog(), FIXTURE_ENTRIES);
  const e = cat.get('assets/models/critter.glb');
  assert.equal(e.asset.classification, 'AMBIGUOUS');
  assert.equal(e.asset.sha256, 'cafef00d');
  assert.equal(e.asset.tris, 210);
  assert.equal(e.asset.provenance.generator, 'tools/blender/build_critter.py');
});

test('registerAssetCatalog: byClassification filters asset entries; byKind("asset") returns only assets', () => {
  const cat = createCatalog();
  seedWorldEditorCatalog(cat);            // some material/scatter/entity noise already in the catalog
  registerAssetCatalog(cat, FIXTURE_ENTRIES);
  assert.equal(cat.byKind('asset').length, 2, 'asset entries are additive alongside the world-editor seed, not a replacement');
  assert.equal(cat.byClassification('LIBRARY').length, 1);
  assert.equal(cat.byClassification('AMBIGUOUS').length, 1);
  assert.equal(cat.byClassification('PROJECT').length, 0, 'a classification with no matching entries returns empty, not undefined');
});

test('registerAssetCatalog: byClassification on non-asset kinds never matches (no asset field to read)', () => {
  const cat = createCatalog();
  cat.register({ id: 'mat-1', kind: 'material', group: 'Terrain' });
  assert.equal(cat.byClassification('LIBRARY').length, 0, 'a material entry has no .asset — must not throw or false-match');
});

test('registerAssetCatalog: defaults to a fresh catalog + empty list when called with no args', () => {
  assert.doesNotThrow(() => {
    const cat = registerAssetCatalog();
    assert.equal(cat.size, 0);
  });
});
