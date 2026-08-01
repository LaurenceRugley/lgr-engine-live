/* ============================================================
   bortle.test.mjs — checks bortle.js's limiting-magnitude table against the sourcing doc's own
   cited values (~/lgr-business/research/sky-data-sources-2026-07-31.md §4, itself quoting
   Wikipedia's Bortle scale table "as stated, not re-derived") — not re-deriving the table, just
   confirming the code matches what was actually decided, and that the interpolation + sky-glow
   normalization behave as documented (continuous, monotonic, no step function).
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { limitingMagnitude, skyGlow, LA_BORTLE, BORTLE_MIN, BORTLE_MAX } from './bortle.js';

test('limiting magnitude at each class matches the doc\'s cited NELM range midpoint', () => {
  // doc §4 ranges: [1] 7.6-8.0  [5] 5.6-6.0  [9] <=4.0(ish, no lower bound stated)
  assert.ok(limitingMagnitude(1) >= 7.6 && limitingMagnitude(1) <= 8.0, 'Bortle 1 within the doc\'s stated 7.6-8.0 range');
  assert.ok(limitingMagnitude(5) >= 5.6 && limitingMagnitude(5) <= 6.0, 'Bortle 5 within the doc\'s stated 5.6-6.0 range');
  assert.ok(limitingMagnitude(9) <= 4.0, 'Bortle 9 at or below the doc\'s stated <=4.0');
});

test('limiting magnitude is monotonically increasing (better sky = fainter stars visible), continuous', () => {
  let prev = limitingMagnitude(BORTLE_MIN);
  for (let b = BORTLE_MIN + 0.1; b <= BORTLE_MAX; b += 0.1) {
    const m = limitingMagnitude(b);
    assert.ok(m <= prev + 1e-9, `magnitude decreases monotonically as Bortle worsens (${b.toFixed(1)}: ${m} <= ${prev})`);
    assert.ok(Math.abs(m - prev) < 0.5, `no step-function jump between adjacent 0.1 steps (${b.toFixed(1)})`);
    prev = m;
  }
});

test('skyGlow(LA_BORTLE) is meaningfully dimmer than skyGlow(1) — the A/B the app defaults to', () => {
  const glowLA = skyGlow(LA_BORTLE), glowDark = skyGlow(1);
  assert.ok(glowDark - glowLA > 0.5, `dark-site glow (${glowDark}) is much higher than LA's default (${glowLA})`);
  assert.equal(glowDark, 1, 'Bortle 1 (best class) gives full Milky Way glow');
});
