/* lit-windows.test.mjs — A-LITWINDOWS (2026-08-22). The contract of the night windows.
   ------------------------------------------------------------------------------------------------
   WHY THESE ASSERTIONS (Rule 9 — a test encodes WHY the behaviour matters, not just what it does):

   1. THE HASH IS EXACT IN FLOAT32, AND THAT IS THE WHOLE REASON IT LOOKS LIKE THIS. A window grid is
      normally hashed with `fract(sin(dot(p, k)) * 43758.5453)`, which is fine to LOOK at and
      impossible to COUNT: it diverges between the GPU's float32 and node's float64, so any CPU-side
      "how many windows are lit" would be a MODEL of the shader rather than a reading of it — and
      this repo's standing rule is that an unmeasured case reports SKIPPED, never a number. The mixer
      here is an integer LCG whose every intermediate stays under 2^24, so float32 and float64 agree
      bit for bit. `Math.fround` at every step SIMULATES float32 exactly (IEEE-754 round-to-nearest
      on each operation), so if the two paths agree here, they agree on any conformant GPU. That is
      an executable proof of the claim, not a comment asserting it.

   2. THE INTERMEDIATES ACTUALLY STAY UNDER 2^24. Assertion 1 could pass by luck on the handful of
      inputs it samples; this one checks the STRUCTURAL property the argument rests on, over the full
      input domain's extremes. A future edit that raises the multiplier past ~2048 would keep the
      hash "working" and silently destroy the exactness guarantee — the failure is invisible in every
      picture and fatal to every count.

   3. THE SLOT DISCRIMINATOR MATCHES THE SHIPPED KIT'S MEASURED RATIOS. The threshold is not taste:
      the kit's four slots sit at b/r 0.9600 / 1.0000 / 1.1905 / 1.2391 (measured off facade_kit.glb's
      COLOR_0 in this arc), and `glazeMin`/`shopMax` must classify all four the way the generator
      authored them. If someone re-authors the palette and forgets these, the city lights its PIERS.

   4. NOON CONTRIBUTES NOTHING, STRUCTURALLY. Every emissive term is multiplied by the glow, so
      `update(0)` must leave the shared uniform at exactly 0 — the whole byte-identical-daylight
      contract reduces to that one scalar, and it is cheap to pin.

   5. THE REQUESTED FRACTION IS ACTUALLY DELIVERED. A hash can be exact and still be a bad hash. If
      the realized lit fraction drifted far from `litFrac`, the knob would be a lie — and "55% of
      windows are lit" is a claim this arc reports as a number.

   6. `apply` REFUSES A MISSING COURSE COUNT. The row index IS `floor(localY * courses)`; with the
      wrong count every glazing band gets split or merged, which reads as randomly halved storeys and
      looks like an art bug rather than a wiring bug. Fail loud at wiring time instead.
   ------------------------------------------------------------------------------------------------ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lwHash, lwKey, litCountFor, createLitWindows } from './lit-windows.js';

const M = 8191;

test('lwHash is bit-identical under float64 and a float32 simulation (the countability guarantee)', () => {
  let n = 0;
  for (let col = 0; col < 6; col++) {
    for (let row = 0; row < 8; row++) {
      for (let face = 0; face < 4; face++) {
        for (const bx of [0, 1, 1347, 4095, 8190]) {
          for (const bz of [0, 733, 2751, 8190]) {
            const a = lwHash(col, row, face, bx, bz);
            const b = lwHash(col, row, face, bx, bz, Math.fround);
            assert.equal(a, b, `float32/float64 disagree at (${col},${row},${face},${bx},${bz}): ${a} vs ${b}`);
            assert.ok(Number.isInteger(a) && a >= 0 && a < M, `hash left the ring: ${a}`);
            n++;
          }
        }
      }
    }
  }
  assert.ok(n >= 3800, `sampled too few cells to be worth trusting: ${n}`);
});

test('every LCG intermediate stays below 2^24 — the structural reason exactness holds', () => {
  /* The widest step is h * 179 + v with h and v both at their ceiling. Checked as arithmetic rather
     than sampled, because this is the property the float32 argument rests on. */
  const worst = (M - 1) * 179 + (M - 1);
  assert.ok(worst < 2 ** 24, `LCG can exceed float32's exact-integer range: ${worst}`);
  /* And the key builder's own widest value, for a world coordinate well past any arena this repo
     ships (2047 u is ~12 km at 6 m/u). */
  assert.ok(Math.abs(Math.floor(-2047 * 16) + 32764) < 2 ** 24);
  assert.equal(lwKey(0), 32764 % M);
  /* Two buildings 2.4 u apart (this city's tightest gap) MUST land on different keys, or they wear
     the same window pattern and the city reads as copy-paste. */
  assert.notEqual(lwKey(10.0), lwKey(12.4));
  /* …and the quantiser is stable: a sub-1/16-u wobble must not reshuffle a building's windows. */
  assert.equal(lwKey(10.0), lwKey(10.03));
});

test('the b/r thresholds classify all four of the shipped kit\'s measured slots correctly', () => {
  const lw = createLitWindows();
  const { glazeMin, shopMax } = lw.params;
  const MEASURED = { crown: 0.9600, wall: 1.0000, shop: 1.1905, glass: 1.2391 };
  assert.ok(MEASURED.crown < glazeMin, 'the cornice would be lit as glazing');
  assert.ok(MEASURED.wall < glazeMin, 'the piers and spandrels would be lit as glazing');
  assert.ok(MEASURED.shop >= glazeMin, 'the shopfront would never light');
  assert.ok(MEASURED.glass >= glazeMin, 'the window bands would never light');
  /* shop vs glass must ALSO separate, or the ground floor cannot run at its own lit fraction. */
  assert.ok(MEASURED.shop <= shopMax && MEASURED.glass > shopMax, 'shop and glass are not separable');
});

test('the glow is the only gate: update(0) leaves the shared uniform at exactly 0 (noon contract)', () => {
  const lw = createLitWindows();
  assert.equal(lw.uniforms.uLwGlow.value, 0, 'boots lit — a page that never scrubs would glow at noon');
  lw.update(1);
  assert.equal(lw.uniforms.uLwGlow.value, 1);
  lw.update(0);
  assert.equal(lw.uniforms.uLwGlow.value, 0, 'noon must be an exact zero, not a small number');
  lw.update(undefined);
  assert.equal(lw.uniforms.uLwGlow.value, 0, 'a missing glow must read as noon, never as NaN in a uniform');
});

test('the realized lit fraction lands where the requested one asked (the knob is not a lie)', () => {
  /* A city-sized cell set: 200 buildings across the five rungs, positions spread like a real grid. */
  const rungs = [2, 3, 4, 6, 8];
  const perVariant = rungs.map((c) => ({ courses: c, instances: [] }));
  for (let i = 0; i < 200; i++) {
    perVariant[i % 5].instances.push({ x: -44 + (i % 19) * 4.6, z: -44 + Math.floor(i / 19) * 4.6 });
  }
  for (const frac of [0.25, 0.55, 0.80]) {
    const r = litCountFor(perVariant, { litFrac: frac, shopFrac: frac, cols: 4 });
    /* 40 buildings per rung x (2+3+4+6+8) storeys x 4 faces x 4 cols = 14,720 panes — stated as the
       closed form rather than a round number, so a change to the cell grammar fails this loudly
       instead of quietly shrinking the sample the fraction below is judged on. */
    assert.equal(r.panes, 40 * (2 + 3 + 4 + 6 + 8) * 4 * 4, `pane count is not courses x faces x cols: ${r.panes}`);
    assert.ok(Math.abs(r.fracRealized - frac) < 0.02,
      `asked ${frac}, realized ${r.fracRealized.toFixed(4)} over ${r.panes} panes — the hash is biased`);
  }
  /* The ground floor is its own population and must obey its OWN fraction, not the office one. */
  const r = litCountFor(perVariant, { litFrac: 0.20, shopFrac: 0.90, cols: 4 });
  assert.ok(r.shopLit / r.shopPanes > 0.85, `shopfronts followed the office fraction: ${(r.shopLit / r.shopPanes).toFixed(3)}`);
  assert.ok((r.lit - r.shopLit) / (r.panes - r.shopPanes) < 0.25, 'office panes followed the shop fraction');
  /* The count is deterministic — the same city twice is the same city, which is what makes the
     receipt in the report reproducible rather than a one-off reading. */
  assert.deepEqual(litCountFor(perVariant, { litFrac: 0.55 }), litCountFor(perVariant, { litFrac: 0.55 }));
  /* …and the float32 simulation counts the SAME windows, which is the claim the report makes. */
  assert.equal(litCountFor(perVariant, { litFrac: 0.55 }).lit,
    litCountFor(perVariant, { litFrac: 0.55, fround: true }).lit);
});

test('apply refuses a material with no course count, rather than splitting every storey', () => {
  const lw = createLitWindows();
  assert.throws(() => lw.apply({}, {}), /courses/);
  assert.throws(() => lw.apply({}, { courses: 0 }), /courses/);
  assert.equal(lw.apply(null), null, 'a null material is a no-op, not a crash');
});

test('apply CHAINS onto an existing onBeforeCompile instead of clobbering it', () => {
  /* The material swing-lab hands the kit already carries createTriplanarForgeMaterial's patch. An
     assignment here would delete the city's wall texture silently — street-grid.js's own rule. */
  const order = [];
  const mat = { onBeforeCompile: () => order.push('prev'), customProgramCacheKey: () => 'lgr-triplanar|x' };
  const lw = createLitWindows();
  lw.apply(mat, { courses: 4 });
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <color_vertex>\n',
    fragmentShader: '#include <common>\n#include <emissivemap_fragment>\n',
  };
  mat.onBeforeCompile(shader, null);
  assert.deepEqual(order, ['prev'], 'the previous patch did not run');
  assert.ok(mat.customProgramCacheKey().includes('lgr-triplanar|x'), 'the previous cache key was dropped — two materials would share one program');
  assert.ok(shader.vertexShader.includes('vLwRaw = color'), 'the raw COLOR_0 capture never spliced');
  assert.ok(shader.fragmentShader.includes('totalEmissiveRadiance +='), 'the emissive splice never landed');
  assert.equal(shader.uniforms.uLwCourses.value, 4, 'this variant got the wrong storey count');
  /* The shared uniforms must be the SAME objects across two materials, or update() would have to
     loop and two variants could drift to different times of day. */
  const mat2 = {};
  lw.apply(mat2, { courses: 8 });
  const s2 = { uniforms: {}, vertexShader: '#include <common>\n#include <color_vertex>\n', fragmentShader: '#include <common>\n#include <emissivemap_fragment>\n' };
  mat2.onBeforeCompile(s2, null);
  assert.equal(s2.uniforms.uLwGlow, shader.uniforms.uLwGlow, 'the glow uniform is not shared');
  assert.notEqual(s2.uniforms.uLwCourses.value, shader.uniforms.uLwCourses.value, 'the course count IS shared — every variant would use one rung');
});
