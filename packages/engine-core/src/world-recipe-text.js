/* ============================================================
   @lgr/engine-core — world-recipe-text (A9 TEXT→WORLD): the keyword TEXT front-end.
   ------------------------------------------------------------
   THE FRONT-END: map a plain-language DESCRIPTION to world-recipe FIELDS. This is DELIBERATELY a small,
   deterministic KEYWORD parser — NO AI in the loop at runtime. It reads a documented vocabulary out of the
   text ("swamp", "sparse", "dead", "foggy", "drowned/pond") and emits a partial recipe the caller merges
   over a biome base (which supplies config-dependent geometry like structure positions). The RECIPE is the
   real API; this is the ergonomic layer on top. Richer language→recipe mapping (synonyms, quantities, a real
   grammar, or an LLM that EMITS a recipe offline) can layer on later WITHOUT changing the interpreter — the
   recipe stays the contract.

   PURE (no THREE): string in → { biome, recipe, matched } out. node-testable.
   C++ anchor: a tiny hand-rolled tokeniser/keyword table — not a parser generator, just `if (contains(...))`.
   ============================================================ */
import { RECIPE_BIOMES } from './world-recipe.js';

// The documented vocabulary. Each entry: the recipe FRAGMENT it contributes + the keywords that trigger it.
// Grouped so a later group can override an earlier one's field (density after liveness, etc.). Keeping the
// table here (not scattered in if-blocks) means describeVocabulary() can print exactly what the parser knows.
const VOCAB = {
  biome: [
    { tag: 'swamp', words: ['swamp', 'marsh', 'bog', 'wetland', 'fen', 'mire'], biome: 'swamp' },
    { tag: 'forest', words: ['forest', 'woods', 'woodland', 'grove'], biome: 'forest' },
  ],
  liveness: [
    { tag: 'dead', words: ['dead', 'decayed', 'decrepit', 'skeletal', 'withered', 'rotting', 'blighted'],
      recipe: { forest: { archetypes: [{ key: 'bare', weight: 0.8, r: 0.34 }, { key: 'rock', weight: 0.2, r: 0.3 }], materials: { bare: 'bark' }, heightScale: 2.1 } } },
    { tag: 'lush', words: ['lush', 'living', 'green', 'verdant', 'alive'],
      recipe: { forest: { archetypes: [{ key: 'conifer', weight: 0.5, r: 0.38 }, { key: 'bare', weight: 0.3, r: 0.34 }, { key: 'rock', weight: 0.2, r: 0.3 }], materials: { bare: 'bark', conifer: 'barkLive' } } } },
  ],
  density: [
    // ARC A21: the SAME density words also drive the urban `city.layout.subdivisionRate` (the literal
    // lot-splitting "density" knob) — harmless for a non-city recipe (city.enabled stays false, so the
    // value is never read), and gives "a dense grid metropolis" a genuinely denser building fabric.
    { tag: 'sparse', words: ['sparse', 'thin', 'scattered', 'few', 'bare'], recipe: { forest: { count: 44, mobileCount: 24 }, city: { layout: { subdivisionRate: 0.35 } } } },
    { tag: 'dense', words: ['dense', 'thick', 'deep', 'overgrown', 'crowded'], recipe: { forest: { count: 120, mobileCount: 60 }, city: { layout: { subdivisionRate: 0.78 } } } },
  ],
  weather: [
    { tag: 'fog', words: ['foggy', 'fog', 'misty', 'mist', 'haze', 'hazy'], recipe: { atmosphere: { weather: 'fog' } } },
    { tag: 'rain', words: ['rainy', 'rain', 'storm', 'stormy', 'downpour'], recipe: { atmosphere: { weather: 'rain' } } },
    { tag: 'clear', words: ['clear', 'sunny', 'bright', 'cloudless'], recipe: { atmosphere: { weather: 'clear' } } },
  ],
  water: [
    // 'ocean'/'beach'/'coast'/'surf' → the A13 Gerstner OCEAN (an edge-of-sea shoreline); tried FIRST so a
    // coast reads as an ocean, not a pond. Then 'lake' (still-water edge body), then a small pond.
    { tag: 'ocean', words: ['ocean', 'sea', 'seaside', 'beach', 'coast', 'coastal', 'surf', 'shoreline', 'tide'], recipe: { water: { kind: 'ocean' } } },
    { tag: 'lake', words: ['lake', 'lakeshore', 'shore'], recipe: { water: { kind: 'lake' } } },
    { tag: 'pond', words: ['drowned', 'flooded', 'pond', 'water', 'stagnant', 'swamp', 'marsh', 'bog', 'pool'], recipe: { water: { kind: 'pond' } } },
    { tag: 'dry', words: ['dry', 'arid', 'parched', 'cracked'], recipe: { water: { kind: 'none' } } },
  ],

  // ── ARC A21: URBAN VOCABULARY — enough that "a rain-slick harbour city at dusk" or "a dense grid
  // metropolis" produce meaningfully different cities. Deterministic keyword parsing, same discipline as
  // every group above: first match per group wins, no runtime AI.
  city: [
    // the TRIGGER — without one of these words, `recipeFromText` never turns on city.enabled, so an
    // ordinary forest/swamp description is completely unaffected by everything below (byte-identical).
    { tag: 'city', words: ['city', 'metropolis', 'downtown', 'urban', 'town', 'skyline'], recipe: { city: { enabled: true } } },
  ],
  blockPattern: [
    { tag: 'radial', words: ['radial', 'concentric', 'ringroad', 'spokes'], recipe: { city: { blockPattern: 'radial' } } },
    { tag: 'organic', words: ['organic', 'medieval', 'winding', 'labyrinthine'], recipe: { city: { blockPattern: 'organic' } } },
    { tag: 'grid', words: ['grid', 'gridded', 'planned', 'blocks'], recipe: { city: { blockPattern: 'grid' } } },
  ],
  era: [
    { tag: 'modern', words: ['modern', 'glass', 'skyscraper', 'contemporary'], recipe: { city: { era: 'modern' } } },
    { tag: 'classic', words: ['classic', 'old', 'historic', 'colonial', 'baroque'], recipe: { city: { era: 'classic' } } },
    { tag: 'brutalist', words: ['brutalist', 'concrete', 'industrial', 'soviet'], recipe: { city: { era: 'brutalist' } } },
  ],
  height: [
    { tag: 'towering', words: ['towering', 'soaring', 'high-rise', 'vertical'], recipe: { city: { layout: { heightMean: 5.2, heightSpread: 0.32 } } } },
    { tag: 'low-rise', words: ['low-rise', 'squat', 'sprawling', 'flat'], recipe: { city: { layout: { heightMean: 1.4, heightSpread: 0.85 } } } },
  ],
  // urban WATERFRONT — a distinct group from `water` above (which drives the actual Gerstner/pond mesh):
  // this shapes the CITY's own shoreline silhouette (city.waterfront → citygen's coast{}). Both groups can
  // fire from the same word ("harbour" sets water.kind AND city.waterfront) — reusing the existing water
  // field per the arc's own instruction, not duplicating it.
  waterfront: [
    { tag: 'harbour', words: ['harbour', 'harbor', 'port', 'dock', 'docks'], recipe: { water: { kind: 'ocean' }, city: { waterfront: { kind: 'harbour', base: 0.6, out: 0.85, in: 0.7, jag: 1.3 } } } },
    { tag: 'river', words: ['river', 'riverside', 'riverfront', 'quay'], recipe: { water: { kind: 'lake' }, city: { waterfront: { kind: 'river', base: 0.5, out: 0.3, in: 0.9, jag: 0.5 } } } },
    { tag: 'coast', words: ['coast', 'coastal', 'beachfront', 'seafront'], recipe: { water: { kind: 'ocean' }, city: { waterfront: { kind: 'coast', base: 0.55, out: 1.0, in: 0.6, jag: 1.05 } } } },
    { tag: 'inland', words: ['inland', 'landlocked'], recipe: { water: { kind: 'none' }, city: { waterfront: { kind: 'none', base: 1.1, out: 0.4, in: 0.25, jag: 0.4 } } } },
  ],
};

// merge fragment `b` into `a` in place-ish (objects recurse, arrays/primitives replace). Small + local so
// this module doesn't import the recipe normaliser's internals.
function fold(a, b) {
  if (b === undefined) return a;
  if (a === null || typeof a !== 'object' || Array.isArray(a) || b === null || typeof b !== 'object' || Array.isArray(b)) return b;
  const out = { ...a };
  for (const k of Object.keys(b)) out[k] = fold(a[k], b[k]);
  return out;
}

/** recipeFromText(description) → { biome, recipe, matched }. `recipe` is a PARTIAL (config-independent) the
 *  caller merges over a biome base. `matched` lists the vocabulary tags found (for logging / a UI echo). The
 *  FIRST matching entry per group wins (so "sparse dense" resolves to sparse — earliest in the table). */
export function recipeFromText(description = '') {
  const t = ' ' + String(description).toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
  const hit = (w) => t.includes(' ' + w + ' ') || t.includes(' ' + w);   // word-ish contains
  let biome = 'forest';
  let recipe = { biome };
  const matched = [];
  for (const group of Object.keys(VOCAB)) {
    for (const entry of VOCAB[group]) {
      if (!entry.words.some(hit)) continue;
      matched.push(entry.tag);
      if (entry.biome) { biome = entry.biome; recipe.biome = biome; }
      if (entry.recipe) recipe = fold(recipe, entry.recipe);
      break;   // first match per group wins
    }
  }
  return { biome, recipe, matched };
}

/** describeVocabulary() → a plain object { group: [{ tag, words }] } for docs / a help panel. The single
 *  source of truth for "what words the front-end understands" (the .test pins it against RECIPE_BIOMES). */
export function describeVocabulary() {
  const out = {};
  for (const group of Object.keys(VOCAB)) out[group] = VOCAB[group].map((e) => ({ tag: e.tag, words: e.words.slice() }));
  return out;
}

// sanity: the biome tags the parser can emit are exactly the schema's RECIPE_BIOMES (keeps them in lockstep).
export const PARSER_BIOMES = VOCAB.biome.map((b) => b.biome);
void RECIPE_BIOMES;
