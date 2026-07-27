/* chart.test.mjs — VIZ SLICE 20. The chart's PURE half is the half that can lie: a tick algorithm that
   drops the last tick, a log scale that maps 0 to the axis, a series mapper that draws a line through a
   gap. These tests encode WHY each rule exists, because each one is a chart LIE a student would believe. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceTicks, logTicks, makeScale, seriesToPoints, chartLayout } from './chart.js';

test('niceTicks: human numbers (1-2-5 on geometric thresholds), never raw divisions', () => {
  // 0-100 asked for 5 ticks: the nice answer is a step of 20 (six ticks), NOT a step of 25 — and
  // certainly not 50, which is what a naive ladder produces (that bug is why this assertion is here).
  assert.deepEqual(niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
  const t = niceTicks(0, 37, 5);
  assert.ok(t.every((v) => Number.isInteger(v * 10)), `ticks should be round, got ${t}`);
  assert.ok(t[t.length - 1] <= 37, 'a tick must never exceed the domain');
});

test('niceTicks: the LAST tick survives float drift (the classic dropped-tick bug)', () => {
  const t = niceTicks(0, 0.3, 4);
  assert.ok(t[t.length - 1] >= 0.29, `expected a tick at ~0.3, got ${t}`);
  for (const v of t) assert.ok(String(v).length < 8, `float ghost in ticks: ${v}`);
});

test('niceTicks: a degenerate domain does not throw or invent ticks', () => {
  assert.deepEqual(niceTicks(5, 5, 5), [], 'a zero-width domain has no ticks — it must not fake two');
  assert.deepEqual(niceTicks(NaN, 10, 5), []);
});

test('logTicks: decades, subdivided when the span is narrow', () => {
  assert.deepEqual(logTicks(1, 1000), [1, 10, 100, 1000]);
  const narrow = logTicks(1, 20);
  assert.ok(narrow.includes(1) && narrow.includes(10) && narrow.includes(2),
    `a narrow log axis needs subdivisions, got ${narrow}`);
});

test('makeScale linear: maps the domain onto the range, endpoints exact', () => {
  const s = makeScale({ domain: [0, 10], range: [0, 100] });
  assert.equal(s(0), 0);
  assert.equal(s(10), 100);
  assert.equal(s(5), 50);
});

test('makeScale linear: an INVERTED range (SVG y grows downward) works — the axis is not upside down', () => {
  const s = makeScale({ domain: [0, 100], range: [200, 0] });   // y0=bottom, y1=top
  assert.equal(s(0), 200, 'zero belongs at the BOTTOM of an SVG plot');
  assert.equal(s(100), 0);
});

test('makeScale log: equal ratios map to equal distances (that IS a log axis)', () => {
  const s = makeScale({ domain: [1, 1000], range: [0, 300], type: 'log' });
  assert.ok(Math.abs(s(1) - 0) < 1e-9);
  assert.ok(Math.abs(s(10) - 100) < 1e-6, `a decade should be a third of the axis, got ${s(10)}`);
  assert.ok(Math.abs(s(100) - 200) < 1e-6);
  // 0 and negatives are UNDEFINED on a log axis — clamp, never silently plot at the origin.
  assert.ok(Number.isFinite(s(0)), 'log(0) must not produce -Infinity in a pixel coordinate');
});

test('seriesToPoints: a NaN leaves a GAP — it never draws a line to the origin', () => {
  const sx = makeScale({ domain: [0, 10], range: [0, 100] });
  const sy = makeScale({ domain: [0, 10], range: [100, 0] });
  const pts = seriesToPoints({ data: [{ x: 1, y: 1 }, { x: 2, y: NaN }, { x: 3, y: 3 }] }, sx, sy);
  assert.equal(pts.length, 2, 'the NaN point must be dropped, not zeroed');
  assert.deepEqual(pts.map((p) => p.dx), [1, 3]);
});

test('chartLayout: a linear y-axis starts at ZERO (a truncated axis is the most common chart lie)', () => {
  const L = chartLayout({ series: [{ data: [{ x: 1, y: 90 }, { x: 2, y: 100 }] }] });
  assert.equal(L.yDomain[0], 0, 'y must start at 0 or a 10% difference looks like a 10x difference');
});

test('chartLayout: log y-axis starts at the min (0 is not a point on a log axis)', () => {
  const L = chartLayout({ series: [{ data: [{ x: 1, y: 4 }, { x: 2, y: 400 }] }], yScale: 'log' });
  assert.ok(L.yDomain[0] >= 1, `log domain must be positive, got ${L.yDomain}`);
});

test('chartLayout: every series becomes pixel points inside the plot box', () => {
  const L = chartLayout({
    series: [{ label: 'a', data: [{ x: 0, y: 0 }, { x: 10, y: 50 }] }],
    width: 400, height: 200,
  });
  const pts = L.points[0].pts;
  assert.equal(pts.length, 2);
  for (const p of pts) {
    assert.ok(p.x >= L.plot.x0 - 1e-6 && p.x <= L.plot.x1 + 1e-6, `x ${p.x} escaped the plot box`);
    assert.ok(p.y <= L.plot.y0 + 1e-6 && p.y >= L.plot.y1 - 1e-6, `y ${p.y} escaped the plot box`);
  }
});
