/* ============================================================
   character-night-fill.test.mjs — Arc A2 (Rule 9: intent). Pins the night-fill CURVE the whole
   alive-at-night unlock rests on: day is byte-identical (no glow), deep night lifts to max, and the ease-in
   keeps dusk moody (not glowy). A material without emissive is a safe no-op. Would FAIL if the fill leaked
   into daylight or stopped lifting at night. Pure — a fake material, no THREE.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyNightFill, NIGHT_FILL } from './character-night-fill.js';

// a minimal THREE.Color-like + material stand-in
const fakeMat = () => ({ emissive: { _hex: 0, setHex(h) { this._hex = h; } }, emissiveIntensity: 1 });

test('DAY is byte-identical — nf 0 sets ZERO emissive intensity (no night glow bleeds into daylight)', () => {
  const m = fakeMat();
  const k = applyNightFill(m, 0);
  assert.equal(k, 0, 'nf 0 → intensity 0');
  assert.equal(m.emissiveIntensity, 0, 'the material carries no glow by day (the byte-identical guard)');
});

test('DEEP NIGHT lifts to max, with the cool moonlight tint', () => {
  const m = fakeMat();
  const k = applyNightFill(m, 1);
  assert.equal(k, NIGHT_FILL.max, 'nf 1 → max emissive intensity');
  assert.equal(m.emissive._hex, NIGHT_FILL.tint, 'the cool moonlight tint is applied');
});

test('ease-IN — dusk stays moody: nf 0.5 lifts LESS than half of max (gamma > 1 delays the glow)', () => {
  const m = fakeMat();
  const kHalf = applyNightFill(m, 0.5);
  assert.ok(kHalf < NIGHT_FILL.max * 0.5, `nf 0.5 (${kHalf.toFixed(3)}) must be < half of max — the horde reads only as real night falls, not at dusk`);
  assert.ok(kHalf > 0, 'but it is non-zero past day');
});

test('monotonic — more night is never less fill (a swarm never gets DARKER as night deepens)', () => {
  const m = fakeMat();
  let prev = -1;
  for (let nf = 0; nf <= 1.0001; nf += 0.1) { const k = applyNightFill(m, nf); assert.ok(k >= prev, `nf ${nf.toFixed(1)} fill ${k} must be ≥ previous ${prev}`); prev = k; }
});

test('a material without an emissive colour is a safe no-op (non-Standard materials do not crash)', () => {
  assert.equal(applyNightFill({ }, 1), 0, 'no emissive → 0, no throw');
  assert.equal(applyNightFill(null, 1), 0, 'null material → 0, no throw');
});
