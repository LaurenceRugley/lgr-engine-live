/* ============================================================
   world-recipe-text.test.mjs — the keyword TEXT front-end (Rule 9: encode WHY each word maps where).
   The front-end's whole value is that a DESCRIPTION reliably becomes the right recipe fields. These pin the
   swamp description the shipped map depends on ("foggy swamp, drowned ruins, sparse dead trees, pond") →
   swamp biome · fog weather · sparse+dead forest · a pond — AND that it stays deterministic (no AI, same
   text → same recipe) and doesn't invent fields the schema doesn't have.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { recipeFromText, describeVocabulary, PARSER_BIOMES } from './world-recipe-text.js';
import { normalizeRecipe, mergeRecipes, RECIPE_BIOMES } from './world-recipe.js';

test('the shipped swamp description parses to the swamp semantics (the ?map=swamp contract)', () => {
  const { biome, recipe, matched } = recipeFromText('a foggy swamp with drowned ruins, sparse dead trees, and a stagnant pond at the low ground');
  assert.equal(biome, 'swamp', 'the "swamp" keyword sets the biome');
  assert.equal(recipe.atmosphere.weather, 'fog', '"foggy" → fog weather');
  assert.equal(recipe.forest.count, 44, '"sparse" → fewer trees');
  assert.equal(recipe.water.kind, 'pond', '"drowned/pond/swamp" → a contextual pond');
  // "dead" → an all-dead archetype mix (no live conifer) — the sparse DEAD trees.
  assert.ok(recipe.forest.archetypes.every((a) => a.key !== 'conifer'), 'no live conifers in a dead forest');
  assert.ok(matched.includes('swamp') && matched.includes('fog') && matched.includes('sparse') && matched.includes('dead') && matched.includes('pond'));
});

test('parsing is deterministic — same text → identical recipe (no AI, byte-reproducible)', () => {
  const a = recipeFromText('foggy swamp, sparse dead trees, drowned ruins, pond');
  const b = recipeFromText('foggy swamp, sparse dead trees, drowned ruins, pond');
  assert.deepEqual(a, b);
});

test('a coast parses to an OCEAN water body — distinct from lake and pond (A13)', () => {
  const { recipe, matched } = recipeFromText('a dead coast, foggy, sparse dead trees, the ocean rolling in, surf on the beach');
  assert.equal(recipe.water.kind, 'ocean', '"ocean"/"coast"/"surf"/"beach" → a Gerstner ocean');
  assert.ok(matched.includes('ocean'));
  // the three water kinds stay distinct: lakeshore → lake, drowned pond → pond, coast → ocean.
  assert.equal(recipeFromText('a still lakeshore').recipe.water.kind, 'lake');
  assert.equal(recipeFromText('a stagnant drowned pond').recipe.water.kind, 'pond');
});

test('a lakeshore parses to a LAKE water body, not a pond (A12 water dimension)', () => {
  const { recipe, matched } = recipeFromText('a dead lakeshore, foggy, sparse dead trees, a cold lake meeting the land at the shore');
  assert.equal(recipe.water.kind, 'lake', '"lake"/"shore" → an edge water body, not a small pond');
  assert.ok(matched.includes('lake'));
  // and a plain "drowned pond" still parses to pond (the two water kinds stay distinct).
  assert.equal(recipeFromText('a drowned stagnant pond').recipe.water.kind, 'pond');
});

test('a forest description leaves the biome forest and does not force water on', () => {
  const { biome, recipe } = recipeFromText('a dense living green forest, clear skies');
  assert.equal(biome, 'forest');
  assert.equal(recipe.atmosphere.weather, 'clear');
  assert.equal(recipe.forest.count, 120, '"dense" → more trees');
  assert.ok(!recipe.water || recipe.water.kind !== 'pond', 'no water keyword → no pond');
});

test('the parsed fragment MERGES cleanly over a base into a valid complete recipe', () => {
  // the exact composition ?map=swamp uses: a config base + the parsed description → normalize.
  const base = { meta: { name: 'drowned-swamp' }, structures: { clusters: [{ profile: 'decrepit', pos: [-10, 0, -6] }] }, water: { at: [7, -5], radius: 8 } };
  const parsed = recipeFromText('foggy swamp, drowned pond, sparse dead trees').recipe;
  const full = normalizeRecipe(mergeRecipes(base, parsed));
  assert.equal(full.water.kind, 'pond', 'parser supplies the kind');
  assert.equal(full.water.radius, 8, 'base supplies the config-placed geometry (merge keeps both)');
  assert.equal(full.forest.count, 44);
  assert.equal(full.structures.clusters.length, 1);
  assert.equal(full.buildings.count, 2, 'untouched fields still default (a valid playable arena)');
});

test('first match per group wins (contradictory words resolve, never crash)', () => {
  const { recipe } = recipeFromText('sparse dense forest');   // sparse listed first → sparse wins
  assert.equal(recipe.forest.count, 44);
});

test('the parser biomes are exactly the schema biomes (parser + schema stay in lockstep)', () => {
  for (const b of PARSER_BIOMES) assert.ok(RECIPE_BIOMES.includes(b), `${b} is a schema biome`);
  const vocab = describeVocabulary();
  assert.ok(vocab.biome && vocab.weather && vocab.water, 'describeVocabulary exposes the groups for docs');
});

/* ============================================================
   ARC A21 — URBAN VOCABULARY. Same bar as the swamp/coast/lakeshore tests above: the brief's OWN two
   example sentences must produce meaningfully different, correctly-parsed cities. And — the byte-identical
   discipline this whole arc holds — an ORDINARY forest/swamp description (no city trigger word) must leave
   `city.enabled` false, exactly as it always has been (every existing consumer never sees this field move).
   ============================================================ */
test('"a dense grid metropolis" — the brief\'s own example — turns on a dense, grid-pattern city', () => {
  const { recipe, matched } = recipeFromText('a dense grid metropolis');
  assert.equal(recipe.city.enabled, true, '"metropolis" is a city trigger word');
  assert.equal(recipe.city.blockPattern, 'grid', '"grid" sets the block pattern');
  assert.equal(recipe.city.layout.subdivisionRate, 0.78, '"dense" also densifies the urban fabric, not just the forest');
  assert.ok(matched.includes('city') && matched.includes('grid') && matched.includes('dense'));
});

test('"a rain-slick harbour city at dusk" — the brief\'s other example — turns on a harbour city with rain', () => {
  const { recipe, matched } = recipeFromText('a rain-slick harbour city at dusk');
  assert.equal(recipe.city.enabled, true, '"city" is a trigger word');
  assert.equal(recipe.city.waterfront.kind, 'harbour', '"harbour" sets the urban waterfront');
  assert.equal(recipe.water.kind, 'ocean', '"harbour" also drives the actual water MESH via the existing water field (reused, not duplicated)');
  assert.equal(recipe.atmosphere.weather, 'rain', '"rain-slick" tokenises to "rain" → rain weather');
  assert.ok(matched.includes('city') && matched.includes('harbour') && matched.includes('rain'));
});

test('era + height + blockPattern vocabulary each resolve to the right urban fields', () => {
  assert.equal(recipeFromText('a modern glass city').recipe.city.era, 'modern');
  assert.equal(recipeFromText('a brutalist concrete downtown').recipe.city.era, 'brutalist');
  assert.equal(recipeFromText('a classic historic town').recipe.city.era, 'classic');
  assert.equal(recipeFromText('a towering vertical metropolis').recipe.city.layout.heightMean, 5.2);
  assert.equal(recipeFromText('a low-rise sprawling town').recipe.city.layout.heightMean, 1.4);
  assert.equal(recipeFromText('a radial concentric city').recipe.city.blockPattern, 'radial');
});

test('a river city reuses the LAKE water body (an edge body), and coast reuses OCEAN — not a new water kind', () => {
  const river = recipeFromText('a riverside city');
  assert.equal(river.recipe.city.waterfront.kind, 'river');
  assert.equal(river.recipe.water.kind, 'lake', 'river waterfront reuses the existing lake mesh kind, per the schema\'s own instruction');
  const coast = recipeFromText('a coastal city');
  assert.equal(coast.recipe.city.waterfront.kind, 'coast');
  assert.equal(coast.recipe.water.kind, 'ocean');
});

test('an ORDINARY forest/swamp description (no city trigger) leaves city.enabled false — byte-identical for every existing consumer', () => {
  const forest = normalizeRecipe(recipeFromText('a dense living green forest, clear skies').recipe);
  assert.equal(forest.city.enabled, false, 'no city trigger word ⇒ the urban branch never activates');
  const swamp = normalizeRecipe(recipeFromText('foggy swamp, drowned pond, sparse dead trees').recipe);
  assert.equal(swamp.city.enabled, false);
  const coastal = normalizeRecipe(recipeFromText('a dead coast, foggy, sparse dead trees, the ocean rolling in, surf on the beach').recipe);
  assert.equal(coastal.city.enabled, false, '"coast"/"surf"/"beach" alone (no "city"/"metropolis"/etc) do not imply an urban recipe');
});
