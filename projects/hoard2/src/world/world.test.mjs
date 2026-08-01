/* ============================================================
   hoard2 · src/world/world.test.mjs — node:test of the WORLD owner's PURE contract (Rule 9: WHY).
   ------------------------------------------------------------
   The facade itself needs THREE + the engine barrel (shaders → ERR_UNKNOWN_FILE_EXTENSION in node), so we
   isolate + test the PURE pieces the DONE criteria rest on:
     • the DECREPIT profile OBJECT differs from the baked PROFILES[0] in the ways that make it "decrepit"
       (low/sparse/desaturated/dark) — the thing that makes createCity render a ruin, not a city;
     • nightFactor ramps 0 (day) → 1 (deep night) MONOTONICALLY across the cycle, and setNight overrides it;
     • the ruin scatter + harvest nodes are non-empty, SEEDED (same seed → same positions), keep the arena
       heart open, don't clump — and a sim-fork consumption does NOT change them (decorrelated, DONE #10).
   The baked PROFILES[0] is deep-imported from citygen.js (proven node-safe: inline string shaders, no file
   imports) purely as the diff BASELINE — the barrel is never imported here.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES } from '../../../../packages/engine-core/src/citygen.js';
import { createRng } from '../core/rng.js';
import * as config from '../core/config.js';
import { buildDecrepitProfile, buildIntactProfile } from './profile.js';
import { nightFactorAt, resolveNight, phaseAt, phaseForNight, smoothstep, weatherKindAt, rainAmountAt } from './daynight.js';
import { scatterRuins, deriveHarvest } from './scatter.js';

const SUN = config.SUN;

/* tiny pure hex→saturation (HSL S) — no THREE. Lets us assert "desaturated" numerically. */
function satOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return 0;
  const d = mx - mn;
  return l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
}
const avgSat = (arr) => arr.reduce((s, h) => s + satOf(h), 0) / arr.length;

/* ------------------------------------------------------------------ PROFILE (the ruin skin) */
test('decrepit profile has the full createCity shape (every field the generator reads)', () => {
  const p = buildDecrepitProfile(0.7);
  for (const k of ['key', 'name', 'towers', 'ground', 'street', 'sidewalk', 'park', 'water',
    'shopfronts', 'glass', 'winColors', 'hMax', 'sigma', 'roofRate', 'pSplit', 'nightLit', 'coast', 'landmarks']) {
    assert.ok(k in p, `missing profile field: ${k}`);
  }
  assert.ok(Array.isArray(p.towers) && p.towers.length > 0);
  assert.equal(typeof p.coast.base, 'number');
});

test('decrepit differs from PROFILES[0] in the ways that make it DECREPIT (low/sparse/dark/desat)', () => {
  const base = PROFILES[0];               // manhattan — a colourful, tall, lit city
  const p = buildDecrepitProfile(0.7);
  assert.ok(p.hMax < base.hMax, `ruins are LOW: ${p.hMax} < ${base.hMax}`);
  assert.ok(p.roofRate < base.roofRate, `roofs collapsed: ${p.roofRate} < ${base.roofRate}`);
  assert.ok(p.nightLit < base.nightLit, `abandoned/dark at night: ${p.nightLit} < ${base.nightLit}`);
  assert.ok(avgSat(p.towers) < avgSat(base.towers), `desaturated bodies: ${avgSat(p.towers).toFixed(3)} < ${avgSat(base.towers).toFixed(3)}`);
  assert.notEqual(p, base, 'it is a distinct object, not the baked profile');
});

test('buildDecrepitProfile is pure: coast.base drives the extent knob, same args ⇒ same object', () => {
  assert.equal(buildDecrepitProfile(3.0).coast.base, 3.0, 'coast.base is the passed value (→ createCity extent)');
  assert.notEqual(buildDecrepitProfile(3.0).coast.base, buildDecrepitProfile(0.7).coast.base);
  assert.deepEqual(buildDecrepitProfile(0.7), buildDecrepitProfile(0.7), 'deterministic');
});

test('A3 building variety: the INTACT profile reads as still-standing (taller + roofed) vs the decrepit ruins', () => {
  const d = buildDecrepitProfile(0.7), i = buildIntactProfile(0.7);
  assert.ok(i.hMax > d.hMax, `intact must be TALLER (${i.hMax}) than the collapsed ruins (${d.hMax}) — buildings still up`);
  assert.ok(i.roofRate > d.roofRate, `intact roofs mostly SURVIVE (${i.roofRate}) vs collapsed (${d.roofRate})`);
  assert.ok(i.nightLit > d.nightLit, 'intact keeps a few lit windows (holdouts) vs the abandoned dark');
  assert.deepEqual(i.towers, d.towers, 'SAME grim palette — one dying settlement at different stages, not a fresh suburb');
  assert.deepEqual(buildIntactProfile(0.7), buildIntactProfile(0.7), 'deterministic (seeded world-gen)');
});

/* ------------------------------------------------------------------ DAY/NIGHT curve */
test('nightFactor is 0 across the full day arc [dawnT, duskT]', () => {
  // sample strictly INSIDE the arc (float accumulation can nudge the endpoint a hair past duskT).
  for (let t = SUN.dawnT; t <= SUN.duskT - 1e-6; t += 0.02) {
    assert.equal(nightFactorAt(t, SUN), 0, `day t=${t.toFixed(2)} must be nf=0`);
  }
  assert.equal(nightFactorAt(SUN.dawnT, SUN), 0, 'dawn edge is day');
  assert.equal(nightFactorAt(SUN.duskT, SUN), 0, 'dusk edge (equality) is still day');
  assert.equal(nightFactorAt(SUN.startT, SUN), 0, 'the run starts in daylight → nf=0');
});

test('nightFactor ramps 0→1 MONOTONICALLY from noon through dusk to deep night', () => {
  const noon = (SUN.dawnT + SUN.duskT) / 2;
  let prev = -1, sawZero = false, sawOne = false;
  for (let t = noon; t <= 0.999; t += 0.01) {
    const nf = nightFactorAt(t, SUN);
    assert.ok(nf >= prev - 1e-9, `non-decreasing at t=${t.toFixed(2)} (${nf} < ${prev})`);
    assert.ok(nf >= 0 && nf <= 1, 'in range');
    if (nf === 0) sawZero = true;
    if (nf > 0.999) sawOne = true;
    prev = nf;
  }
  assert.ok(sawZero, 'starts at day (0)');
  assert.ok(sawOne, 'reaches deep night (1) → the sim gets the full night multipliers');
});

test('nightFactor eases back to 0 by dawn (deep night → dawn is non-increasing)', () => {
  let prev = 2;
  for (let t = 0; t <= SUN.dawnT + 1e-9; t += 0.01) {
    const nf = nightFactorAt(t, SUN);
    assert.ok(nf <= prev + 1e-9, `non-increasing pre-dawn at t=${t.toFixed(2)}`);
    prev = nf;
  }
  assert.equal(nightFactorAt(SUN.dawnT, SUN), 0, 'daylight resumes at dawn');
  assert.ok(nightFactorAt(0.0, SUN) > 0.999, 'midnight is full night');
});

test('setNight OVERRIDES the clock (drives both sim + visuals); null restores the clock', () => {
  const dayPhase = SUN.startT;
  assert.equal(resolveNight(null, dayPhase, SUN), 0, 'no override in daylight → 0');
  assert.equal(resolveNight(0.9, dayPhase, SUN), 0.9, 'override wins even at a day phase');
  assert.equal(resolveNight(0, 0.0, SUN), 0, 'override 0 forces day even at midnight');
  // the override also picks a DARK sun phase so visuals follow the forced difficulty.
  assert.ok(phaseForNight(1, SUN, SUN.startT) > SUN.duskT, 'nf=1 → a night-side sun phase');
  assert.equal(phaseForNight(0, SUN, SUN.startT), SUN.startT, 'nf=0 → the daytime start phase');
});

test('phaseAt wraps a full cycle over DAY_LENGTH_S and stays in [0,1)', () => {
  // phase at elapsed 0 == startT (within float epsilon — the modulo math isn't bit-exact for every startT).
  assert.ok(Math.abs(phaseAt(SUN.startT, 0, config.DAY_LENGTH_S) - SUN.startT) < 1e-9, 'phase at t0 is startT');
  const wrapped = phaseAt(SUN.startT, config.DAY_LENGTH_S, config.DAY_LENGTH_S); // exactly one cycle later
  assert.ok(Math.abs(wrapped - SUN.startT) < 1e-9, 'one full DAY_LENGTH_S returns to start');
  for (const e of [0, 100, 270, 539, 700, 1200]) {
    const t = phaseAt(SUN.startT, e, config.DAY_LENGTH_S);
    assert.ok(t >= 0 && t < 1, `t in [0,1) for elapsed=${e}`);
  }
  assert.equal(smoothstep(2, 2, 5), 1, 'degenerate smoothstep is safe');
});

/* ------------------------------------------------------------------ A6-1 WEATHER SCHEDULE (the sky show) */
test('weatherKindAt only ever returns an engine WEATHER_KIND', () => {
  const KINDS = new Set(['clear', 'rain', 'snow', 'fog']);
  for (let s = 1; s <= 20; s++) for (let t = 0; t < 1; t += 0.005) {
    assert.ok(KINDS.has(weatherKindAt(t, s)), `t=${t.toFixed(3)} seed=${s} → not a weather kind`);
  }
});

test('weather is CLEAR at the boot phase + forward (why: the run/harness sweeps FORWARD from SUN.startT — no startup ramp)', () => {
  // A weather kind active at boot would ease in from frame 0 and read as a startup discontinuity on the
  // cycle-smoothness sweep (which starts at startT and advances the clock FORWARD). So the boot phase and a
  // forward margin (~the first coarse interval, ≈0.03 phase) must be clear; the sweep never revisits phases
  // just BEHIND startT at boot, so a weather window abutting startT from below is fine.
  for (let s = 1; s <= 30; s++) {
    for (const t of [SUN.startT, SUN.startT + 0.01, SUN.startT + 0.02]) {
      assert.equal(weatherKindAt(t, s), 'clear', `seed ${s}: boot+forward t=${t.toFixed(3)} must be clear`);
    }
  }
});

test('weather is OFF the dusk/dawn crossing + deep night (why: protect cycle-smoothness + keep the star show)', () => {
  // The dusk crossing and the whole night arc must stay CLEAR: a weather onset there would stack on the
  // cycle's own biggest brightness step (the smoothness gate) and would fog out the night star field.
  for (let s = 1; s <= 30; s++) {
    // deep night + dawn side + dusk edge and just past it
    for (const t of [0.0, 0.05, 0.1, 0.15, 0.2, SUN.dawnT, SUN.duskT, 0.73, 0.8, 0.9, 0.95, 0.99]) {
      assert.equal(weatherKindAt(t, s), 'clear', `seed ${s}: t=${t} must be clear (night/crossing)`);
    }
  }
});

test('weather is PRESENT during the day (the sky is "packed with the weather", not permanently clear)', () => {
  // every seed gets at least one rain window and one fog window somewhere in the day arc.
  for (let s = 1; s <= 20; s++) {
    let sawRain = false, sawFog = false;
    for (let t = SUN.dawnT; t <= SUN.duskT; t += 0.002) {
      const k = weatherKindAt(t, s);
      if (k === 'rain') sawRain = true;
      if (k === 'fog') sawFog = true;
    }
    assert.ok(sawRain, `seed ${s}: a rain spell exists in the day`);
    assert.ok(sawFog, `seed ${s}: a fog spell exists in the day`);
  }
});

test('weatherKindAt is deterministic per seed, and seeds differ (reproducible for the harness, varied for play)', () => {
  for (const t of [0.3, 0.5, 0.62, 0.66]) {
    assert.equal(weatherKindAt(t, 1337), weatherKindAt(t, 1337), 'pure: same (t,seed) ⇒ same kind');
  }
  // the per-seed jitter shifts the windows → at least SOME phase differs between two seeds.
  let anyDiff = false;
  for (let t = 0.44; t < 0.7; t += 0.002) if (weatherKindAt(t, 1) !== weatherKindAt(t, 7)) { anyDiff = true; break; }
  assert.ok(anyDiff, 'different seeds → different weather timing (not metronomic across seeds)');
});

test('A16 rainAmountAt: rain ripples appear ONLY during the rain window, as a smooth ease-in/out hump', () => {
  for (const s of [1, 7, 42, 1337]) {
    for (let t = 0; t < 1; t += 0.005) {
      const amt = rainAmountAt(t, s);
      assert.ok(amt >= 0 && amt <= 1, `rain amount in [0,1] (t=${t.toFixed(3)})`);
      // the coupling contract: when the schedule is NOT raining, the sea is calm (no ripples leak into clear/fog).
      if (weatherKindAt(t, s) !== 'rain') assert.equal(amt, 0, `clear/fog → no rain ripples (t=${t.toFixed(3)})`);
    }
    // mid-window the rain is near-full and strictly above the ease-in edge (a hump, not a step or a flat line).
    assert.ok(rainAmountAt(0.60, s) > 0.5, `mid-window rain is substantial (seed ${s})`);
    assert.ok(rainAmountAt(0.60, s) > rainAmountAt(0.565, s), `rain eases IN — peaks mid-window, not at the edge (seed ${s})`);
  }
});

/* ------------------------------------------------------------------ SCATTER (ruins + harvest) */
const ScatterCfg = { count: 14, innerR: 8, outerR: config.PLAY_RADIUS - 2, minSpacing: 3.2 };

test('scatterRuins is non-empty, keeps the arena heart open, and does not clump', () => {
  const rng = createRng(config.DEFAULT_SEED).fork('world');
  const ruins = scatterRuins({ rng, ...ScatterCfg });
  assert.ok(ruins.length > 0, 'ruins placed');
  for (const r of ruins) {
    const d = Math.hypot(r.x, r.z);
    assert.ok(d >= ScatterCfg.innerR - 1e-6, `ruin outside the open heart (d=${d.toFixed(2)} ≥ ${ScatterCfg.innerR})`);
    assert.ok(d <= ScatterCfg.outerR + 1e-6, `ruin inside the play ring (d=${d.toFixed(2)})`);
    assert.ok(r.r > 0, 'ruin has a collision footprint');
  }
  for (let i = 0; i < ruins.length; i++) for (let j = i + 1; j < ruins.length; j++) {
    const d = Math.hypot(ruins[i].x - ruins[j].x, ruins[i].z - ruins[j].z);
    assert.ok(d >= ScatterCfg.minSpacing - 1e-6, `min spacing held (${d.toFixed(2)} ≥ ${ScatterCfg.minSpacing})`);
  }
});

test('scatterRuins is SEEDED: same master seed ⇒ identical ruin positions', () => {
  const a = scatterRuins({ rng: createRng(1337).fork('world'), ...ScatterCfg });
  const b = scatterRuins({ rng: createRng(1337).fork('world'), ...ScatterCfg });
  assert.deepEqual(a, b, 'reproducible from the seed');
  const c = scatterRuins({ rng: createRng(9999).fork('world'), ...ScatterCfg });
  assert.notDeepEqual(a, c, 'a different seed → a different (but valid) layout');
});

test('a SIM-fork consumption does NOT perturb the world scatter (decorrelated forks, DONE #10)', () => {
  // baseline: draw world ruins from a fresh master.
  const base = scatterRuins({ rng: createRng(1337).fork('world'), ...ScatterCfg });
  // now drain the SIM stream first (as the sim would during a run), THEN draw the world ruins.
  const r2 = createRng(1337);
  const simFork = r2.fork('sim');
  for (let i = 0; i < 500; i++) simFork();          // sim rolls a horde's worth of randomness
  const after = scatterRuins({ rng: r2.fork('world'), ...ScatterCfg });
  assert.deepEqual(base, after, 'world ruins are identical regardless of sim activity → a world roll never shifts the sim trace');
});

test('deriveHarvest gives BOTH sources (wood on trees, scrap on ruins), all amounts positive', () => {
  const rng = createRng(config.DEFAULT_SEED).fork('world');
  const ruins = scatterRuins({ rng, ...ScatterCfg });
  const trees = [{ x: 1, z: 1 }, { x: -4, z: 3 }, { x: 10, z: -2 }];
  const h = deriveHarvest(trees, ruins);
  assert.equal(h.wood.length, trees.length, 'a wood node per tree');
  assert.equal(h.scrap.length, ruins.length, 'a scrap node per ruin');
  assert.ok(h.wood.every((n) => n.amount > 0 && Number.isFinite(n.x) && Number.isFinite(n.z)), 'wood nodes valid');
  assert.ok(h.scrap.every((n) => n.amount > 0), 'scrap nodes valid');
  // determinism: same inputs ⇒ same nodes.
  assert.deepEqual(h, deriveHarvest(trees, ruins), 'harvest derivation is pure');
});
