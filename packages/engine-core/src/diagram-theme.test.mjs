/* diagram-theme.test.mjs — node:test, headless, no DOM/GPU.
   Tests encode WHY behavior matters (Rule 9 — a test that can't fail if the logic changes
   is wrong). Here: the theme is the SINGLE SOURCE OF TRUTH for all visualization color;
   if any token is missing or malformed, every lesson that imports it silently breaks. */
import { test } from 'node:test';
import assert   from 'node:assert/strict';
import { THEME } from './diagram-theme.js';

const HEX_RE = /^#[0-9a-f]{6}$/i;

test('THEME exports a frozen token object with required sections', () => {
  assert.ok(THEME.NEUTRAL,   'NEUTRAL section missing');
  assert.ok(THEME.ACCENT,    'ACCENT section missing');
  assert.ok(THEME.TYPE,      'TYPE section missing');
  assert.ok(THEME.STROKE,    'STROKE section missing');
  assert.ok(THEME.SUBSTRATE, 'SUBSTRATE section missing');
  // Frozen — changing it would silently succeed otherwise, corrupting all consumers.
  assert.throws(() => { THEME.NEUTRAL = {}; }, { name: 'TypeError' }, 'THEME must be frozen');
});

test('NEUTRAL: 5 steps, all valid hex colors', () => {
  const { NEUTRAL } = THEME;
  const keys = ['bg', 'surface', 'border', 'dim', 'text'];
  for (const k of keys) {
    assert.ok(HEX_RE.test(NEUTRAL[k]), `NEUTRAL.${k} = "${NEUTRAL[k]}" is not a valid #rrggbb hex`);
  }
});

test('NEUTRAL: luminance increases monotonically (bg < surface < border < dim < text)', () => {
  // WHY: if the ramp is not monotone, "bg" might not be the darkest and "text" might not
  // be the brightest — inverting contrast and making labels illegible against surfaces.
  const { NEUTRAL } = THEME;
  function lum(hex) {
    const n = parseInt(hex.slice(1), 16);
    return (n >> 16 & 255) + (n >> 8 & 255) + (n & 255);  // sum R+G+B as proxy for luminance
  }
  const steps = ['bg', 'surface', 'border', 'dim', 'text'];
  const lums = steps.map((k) => lum(NEUTRAL[k]));
  for (let i = 1; i < lums.length; i++) {
    assert.ok(lums[i] > lums[i-1],
      `NEUTRAL step order broken: "${steps[i-1]}"(${lums[i-1]}) not darker than "${steps[i]}"(${lums[i]})`);
  }
});

test('ACCENT: 4 roles, all valid hex colors', () => {
  const { ACCENT } = THEME;
  const roles = ['axis', 'guide', 'ihat', 'jhat'];
  for (const k of roles) {
    assert.ok(HEX_RE.test(ACCENT[k]), `ACCENT.${k} = "${ACCENT[k]}" is not a valid #rrggbb hex`);
  }
});

test('ACCENT: dusk derivation intact — axis/guide/ihat match sun-rig KEYFRAMES[3]', () => {
  // WHY: these exact hex values come from the dusk keyframe in sun-rig.js. If someone
  // changes them independently they break the "theme derives from the engine's palette"
  // contract that the design-system doc establishes.
  const { ACCENT } = THEME;
  assert.equal(ACCENT.axis,  '#b0432a', 'axis must be dusk.horizon (#b0432a)');
  assert.equal(ACCENT.guide, '#7a566a', 'guide must be dusk.hemiSky (#7a566a)');
  assert.equal(ACCENT.ihat,  '#ff8a5a', 'ihat must be dusk.sky (#ff8a5a)');
  // jhat is OKLCH-computed (complementary cool blue) — verify it's a valid hex, not a fixed value.
  assert.ok(HEX_RE.test(ACCENT.jhat), 'jhat must be a valid #rrggbb hex');
});

test('TYPE: 5 size steps and required meta fields', () => {
  const { TYPE } = THEME;
  for (const k of ['xs', 'sm', 'md', 'lg', 'xl']) {
    assert.ok(TYPE[k].endsWith('px'), `TYPE.${k} must be a px string`);
  }
  assert.ok(typeof TYPE.font === 'string' && TYPE.font.length > 0, 'TYPE.font must be non-empty string');
  assert.ok(typeof TYPE.lh === 'number' && TYPE.lh > 0, 'TYPE.lh must be a positive number');
});

test('STROKE: 4 roles, each has color (hex) and width (number)', () => {
  const { STROKE } = THEME;
  for (const k of ['axis', 'guide', 'ihat', 'jhat']) {
    assert.ok(HEX_RE.test(STROKE[k].color), `STROKE.${k}.color must be hex`);
    assert.ok(typeof STROKE[k].width === 'number' && STROKE[k].width > 0, `STROKE.${k}.width must be positive number`);
  }
});
