// moto.test.mjs — A-MOTO (2026-08-18): jumpable BY CONSTRUCTION, pinned against the FINISHED grid.
//
// The swing arc's costliest lesson was tuning a mechanic in a room that could not host it, and the
// cure was box-arena's paired derivations (swingableHeight/swingableRope) whose round-trip is a
// CHECK, not a coincidence. These tests hold moto.js to the same standard:
//   • the derivation pair must round-trip EXACTLY (algebra, not tolerance-tuning);
//   • the guarantee must be counted off the BUILT Float32Array, never off the formula that built it
//     (the A-SKYLINE discipline: "asked for 70%, got 70.0%, counted off the finished geometry");
//   • and the metric must be able to go RED — every guarantee here carries a negative control that
//     flattens the field and demands the count collapse (technique #9: a metric that cannot fail on
//     the broken arm is not a metric).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  jumpableWavelength, launchSpeed, airtimeForFlip, flipRampSpec, createMotoTerrain,
} from './moto.js';
import { BIKE_PROFILE } from './pilot.js';

const V = BIKE_PROFILE.maxSpeed, G = BIKE_PROFILE.gravity, PR = BIKE_PROFILE.airPitchRate;

/* ── the paired derivations ─────────────────────────────────────────────────────────────────── */

test('round-trip: launchSpeed(jumpableWavelength(v, F)) = v/√F exactly — the margin has ONE meaning', () => {
  for (const F of [1.0, 1.5, 2.2]) {
    for (const A of [0.4, 0.9, 1.6]) {
      const wl = jumpableWavelength({ speed: V, amplitude: A, g: G, launchFactor: F });
      const back = launchSpeed({ wavelength: wl, amplitude: A, g: G });
      assert.ok(Math.abs(back - V / Math.sqrt(F)) < 1e-12,
        `F=${F} A=${A}: launchSpeed round-trip ${back} vs ${V / Math.sqrt(F)}`);
    }
  }
});

test('airtimeForFlip is the backflip budget: margin · 2π / pitchRate', () => {
  const t = airtimeForFlip({ pitchRate: PR, margin: 1.15 });
  assert.ok(Math.abs(t - (1.15 * 2 * Math.PI) / PR) < 1e-12);
  // and at the shipped numbers it is a real, human-scale hang time — not a degenerate 0 or a 10 s float
  assert.ok(t > 1.2 && t < 3.5, `flip needs ${t.toFixed(2)} s of air`);
});

test('flipRampSpec solves the drop so its own T-formula returns the asked-for airtime', () => {
  const need = airtimeForFlip({ pitchRate: PR });
  const spec = flipRampSpec({ speed: V, airtime: need, g: G });
  const T = (spec.vy0 + Math.sqrt(spec.vy0 * spec.vy0 + 2 * G * spec.drop)) / G;
  assert.ok(Math.abs(T - need) < 1e-9, `solved drop ${spec.drop.toFixed(3)} gives T=${T.toFixed(3)} vs need ${need.toFixed(3)}`);
  assert.ok(spec.drop > 0, 'at these numbers the basin is a real carve, not a clamped 0');
});

/* ── the guarantee, counted off the finished grid ───────────────────────────────────────────── */

const DEF = { speed: V, g: G, pitchRate: PR, mesh: false, seed: 7 };

test('the built field launches a full-throttle bike: crest count from the grid, not the formula', () => {
  const T = createMotoTerrain(DEF);
  const c = T.stats.crests;
  assert.ok(c.crests >= 20, `a 120 u field should carry many crests, got ${c.crests}`);
  assert.ok(c.frac >= 0.65, `≥65% of built crests must launch at design speed; got ${(c.frac * 100).toFixed(1)}% of ${c.crests}`);
  assert.ok(c.vNeedMedian <= V, `median crest launch speed ${c.vNeedMedian.toFixed(2)} must be ≤ design ${V}`);
  // the closed loop, same as the lab's rope: the level's own derived launch speed is v/√F
  assert.ok(Math.abs(T.stats.launchSpeedDesign - V / Math.sqrt(T.stats.launchFactor)) < 1e-9);
});

test('NEGATIVE CONTROL — break the derivation LINK and the guarantee must collapse to zero', () => {
  /* the first draft of this control scaled `amplitude` down 20× and the field LAUNCHED ANYWAY —
     λ ∝ √A, so the derivation rebuilt tighter hills and the guarantee held. That is the
     by-construction property doing its job, so the control it refuted is kept here as prose and the
     real control breaks the LINK: hold amplitude, stretch the derived wavelength 5× — curvature
     falls 25×, the needed speed rises 5×, and nothing may launch. */
  const stretched = createMotoTerrain({ ...DEF, wavelengthScale: 5 });
  const c = stretched.stats.crests;
  assert.equal(c.launchable, 0,
    `5× wavelength must launch nothing at ${V} u/s (needs ${c.vNeedMedian.toFixed(1)} u/s), got ${c.launchable}`);
  assert.ok(c.vNeedMedian > V * 3, `the needed speed moved with the stretch (${c.vNeedMedian.toFixed(1)} u/s)`);
});

test('the built ramp affords the flip: predictedAir (from BUILT lip/basin/slope) ≥ need', () => {
  const T = createMotoTerrain(DEF);
  const f = T.stats.flip;
  assert.ok(f, 'ramp on by default');
  assert.ok(f.predictedAir >= f.need - 1e-6,
    `built ramp predicts ${f.predictedAir.toFixed(2)} s air against a flip need of ${f.need.toFixed(2)} s`);
  assert.ok(f.drop > 0.5, `the basin is a real carve (drop ${f.drop.toFixed(2)} u)`);
  assert.ok(f.slope > 0.3, `the built lip still carries its launch angle (slope ${f.slope.toFixed(2)} — a smoothstepped lip would read ~0 here)`);
});

test('NEGATIVE CONTROL — the flip check can go red: halve the pitch rate and the need outgrows the ramp', () => {
  // same ramp geometry, but ask the stats to judge it against a bike that flips at half rate:
  // need doubles (~4 s) while the built drop stays ~2 s of air. The guarantee must FAIL that bike.
  const T = createMotoTerrain({ ...DEF, pitchRate: PR * 0.45 });
  // pitchRate feeds BOTH the need and the derived drop, so to hold geometry fixed we rebuild at the
  // fast bike's geometry and re-judge: recompute need by hand against the built prediction.
  const slowNeed = airtimeForFlip({ pitchRate: PR * 0.45 });
  const fast = createMotoTerrain(DEF);
  assert.ok(fast.stats.flip.predictedAir < slowNeed,
    `the fast bike's ramp (${fast.stats.flip.predictedAir.toFixed(2)} s) must NOT satisfy a half-rate flip (${slowNeed.toFixed(2)} s)`);
  // and the terrain built FOR the slow bike solves a deeper basin, by construction
  assert.ok(T.stats.flip.drop > fast.stats.flip.drop + 1,
    `slow-flip terrain carves deeper: ${T.stats.flip.drop.toFixed(2)} vs ${fast.stats.flip.drop.toFixed(2)}`);
});

/* ── determinism + the physics/render agreement ─────────────────────────────────────────────── */

test('same seed → byte-identical heightfield; different seed → different field', () => {
  const a = createMotoTerrain(DEF), b = createMotoTerrain(DEF), c = createMotoTerrain({ ...DEF, seed: 8 });
  assert.equal(a.height.length, b.height.length);
  let same = true, diff = false;
  for (let i = 0; i < a.height.length; i++) {
    if (a.height[i] !== b.height[i]) { same = false; break; }
  }
  for (let i = 0; i < a.height.length; i++) {
    if (a.height[i] !== c.height[i]) { diff = true; break; }
  }
  assert.ok(same, 'seed 7 twice must be byte-identical');
  assert.ok(diff, 'seed 8 must differ');
});

test('heightAt agrees with the grid EXACTLY at every vertex it is built from (physics == render source)', () => {
  const T = createMotoTerrain(DEF);
  const { size, cell, worldSize } = T;
  const half = worldSize / 2;
  for (const [i, j] of [[0, 0], [37, 91], [128, 128], [200, 13], [size - 1, size - 1]]) {
    const got = T.heightAt(i * cell - half, j * cell - half);
    const want = T.height[j * size + i];
    assert.ok(Math.abs(got - want) < 1e-5, `vertex (${i},${j}): heightAt ${got} vs grid ${want}`);
  }
});
