/* ============================================================
   world-recipe.test.mjs — the recipe schema + normaliser (Rule 9: encode WHY the interpreter can trust it).
   The interpreter always reads a NORMALISED recipe, so the contract that matters is: a caller may set any
   SUBSET and every other field falls back to the documented default, arrays REPLACE (not append), and nested
   objects merge. If normalize dropped a default the interpreter would read `undefined` into a Mesh; if arrays
   appended, a swamp that sets 3 archetypes would silently inherit the forest's too.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRecipe, normalizeRecipe, RECIPE_BIOMES } from './world-recipe.js';

test('defaultRecipe is a complete, self-consistent baseline (the forest defaults)', () => {
  const r = defaultRecipe();
  assert.equal(r.forest.count, 96);
  assert.equal(r.ruins.fork, 'world');
  assert.equal(r.buildings.count, 2);
  assert.equal(r.water.kind, 'none');
  assert.ok(Array.isArray(r.forest.archetypes) && r.forest.archetypes.length === 3);
  assert.equal(r.forest.materials.conifer, 'barkLive');
});

test('normalizeRecipe fills every default a partial omits (no undefined into the interpreter)', () => {
  const r = normalizeRecipe({ meta: { name: 'swamp' } });
  assert.equal(r.meta.name, 'swamp');
  assert.equal(r.forest.count, 96, 'unspecified fields keep the default');
  assert.equal(r.ruins.minSpacing, 3.2);
  assert.deepEqual(r.ground, defaultRecipe().ground, 'a whole untouched subtree is the default');
});

test('normalizeRecipe MERGES nested objects but REPLACES arrays (a swamp sets its own tree mix cleanly)', () => {
  const r = normalizeRecipe({
    forest: { count: 40, archetypes: [{ key: 'bare', weight: 1, r: 0.34 }] },
    water: { kind: 'pond', at: [4, -3], radius: 7 },
  });
  assert.equal(r.forest.count, 40, 'overridden');
  assert.equal(r.forest.minSpacing, 1.9, 'sibling field kept from default (object merge)');
  assert.equal(r.forest.archetypes.length, 1, 'the archetype ARRAY is replaced, not appended');
  assert.equal(r.water.kind, 'pond');
  assert.equal(r.water.radius, 7);
});

test('normalizeRecipe does not mutate the caller partial or the shared defaults', () => {
  const partial = { forest: { count: 10 } };
  const before = JSON.stringify(partial);
  normalizeRecipe(partial);
  assert.equal(JSON.stringify(partial), before, 'the input partial is untouched');
  assert.equal(defaultRecipe().forest.count, 96, 'defaults are freshly built each call, never shared-mutated');
});

test('RECIPE_BIOMES lists the shipped biomes the text front-end recognises', () => {
  assert.ok(RECIPE_BIOMES.includes('forest') && RECIPE_BIOMES.includes('swamp'));
});
