/* street-grid.test.mjs — A-DRESS (2026-08-15). The contract of the road-marking material patch.
   ------------------------------------------------------------------------------------------------
   WHY THESE ASSERTIONS (Rule 9 — the test says why the behaviour matters):

   1. IT CHAINS, IT DOES NOT CLOBBER. The ground this is most useful on ALREADY carries
      `applyGroundMacro` — the world-scale de-tiler that stops a 6 m tile reading as a grid from the
      air. `onBeforeCompile` is a single slot on a material: an assignment silently deletes whatever
      was there. That failure has no error, no warning and no visible symptom except "the de-tiling
      stopped working", found three arcs later by someone looking at a wide shot. So the chain is
      asserted by patching a sentinel first and proving it still runs, AND by proving the previous
      patch's own injected source survives into the final program.

   2. THE PROGRAM CACHE KEY IS DISTINCT. Three keys its compiled-shader cache on material type plus
      `customProgramCacheKey`. Two materials that agree on the key SHARE one compiled program, so a
      road-patched ground and a plain one would render with each other's uniforms — the exact bug
      `triplanar-forge.js` records paying for. The key must differ from the un-patched material AND
      must still fold in the key of whatever it chained onto.

   3. THE GRID PITCH REACHES THE SHADER. The road and `createStreetKit`'s lamp posts are two
      descriptions of ONE lattice; if the pitch uniform silently defaulted, the markings and the
      furniture would stand on different grids, which is a bug visible from the pavement.
*/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyStreetGrid } from './street-grid.js';

/* A stand-in for a THREE.Material — this module only ever touches `onBeforeCompile`,
   `customProgramCacheKey`, `needsUpdate` and `userData`, so a plain object exercises the whole of it
   without a GPU. (The real shader compile is verified in the browser: see the runtime-shader rule in
   the project CLAUDE.md, which this arc paid for once already with a GLSL reserved word.) */
const fakeMat = () => ({ userData: {} });      // a real THREE.Material always has userData
const fakeShader = () => ({
  uniforms: {},
  vertexShader: '#include <common>\nvoid main(){\n#include <begin_vertex>\n}',
  fragmentShader: '#include <common>\nvoid main(){\n#include <map_fragment>\n}',
});

test('IT CHAINS: an existing onBeforeCompile still runs, and its injected source survives', () => {
  const mat = fakeMat();
  let priorRan = 0;
  mat.onBeforeCompile = (shader) => {
    priorRan++;
    shader.uniforms.uPrior = { value: 7 };
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n// PRIOR-PATCH-MARKER');
  };
  mat.customProgramCacheKey = () => 'prior-key';

  applyStreetGrid(mat, { spacing: 4.6 });
  const sh = fakeShader();
  mat.onBeforeCompile(sh, null);

  assert.equal(priorRan, 1, 'the previous patch must be CALLED, not replaced');
  assert.equal(sh.uniforms.uPrior.value, 7, 'and its uniforms must survive into the same shader');
  assert.ok(sh.fragmentShader.includes('PRIOR-PATCH-MARKER'), 'and its injected GLSL must still be there');
  assert.ok(sh.fragmentShader.includes('uSgPitch'), 'alongside this one');
  assert.ok(mat.customProgramCacheKey().includes('prior-key'), 'the cache key folds in the chained key');
});

test('THE CACHE KEY IS DISTINCT — two differently-patched materials must not share a program', () => {
  const plain = fakeMat();
  const patched = fakeMat();
  applyStreetGrid(patched, { spacing: 4.6 });
  assert.equal(plain.customProgramCacheKey, undefined);
  assert.ok(typeof patched.customProgramCacheKey === 'function');
  assert.ok(patched.customProgramCacheKey().startsWith('lgr-street-grid'));
});

test('THE PITCH REACHES THE SHADER — the road and the lamp posts share ONE lattice', () => {
  const mat = fakeMat();
  applyStreetGrid(mat, { spacing: 4.6, roadHalf: 1.081, walkHalf: 1.725 });
  const sh = fakeShader();
  mat.onBeforeCompile(sh, null);
  assert.equal(sh.uniforms.uSgPitch.value, 4.6);
  assert.equal(sh.uniforms.uSgRoadHalf.value, 1.081);
  assert.equal(sh.uniforms.uSgWalkHalf.value, 1.725);
  /* the world-XZ varying is what makes the whole thing geometry-free — no UVs are consulted at all. */
  assert.ok(sh.vertexShader.includes('vSgXZ = (modelMatrix * vec4(position, 1.0)).xz'),
    'the coordinate must be world XZ, not a UV: that is why a 100x100 city costs the same as a 19x19 one');
});

test('THE SHADER USES NO GLSL RESERVED WORDS as identifiers (this arc shipped `half` once)', () => {
  const mat = fakeMat();
  applyStreetGrid(mat, { spacing: 4.6 });
  const sh = fakeShader();
  mat.onBeforeCompile(sh, null);
  /* Not an exhaustive GLSL keyword list — a regression guard for the class of bug that cost a browser
     round-trip here, plus the ones a road shader is most likely to reach for. */
  for (const word of ['half', 'input', 'output', 'sampler', 'filter', 'partition']) {
    const re = new RegExp(`(float|vec2|vec3|vec4|int)\\s+${word}\\b`);
    assert.ok(!re.test(sh.fragmentShader), `'${word}' is a GLSL reserved word and must not be declared`);
  }
});
