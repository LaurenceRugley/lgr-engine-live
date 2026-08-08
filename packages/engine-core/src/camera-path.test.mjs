/* camera-path.test.mjs — node:test, headless (THREE math works fine without a GPU). Rule 9: each test
   states the consequence of failure — this is the spline+banking math a real flythrough is verified
   against visually (tools/camera-banking-probe.mjs); these pin the ALGEBRA so a regression here would
   otherwise only ever show up as "the capture looks a bit off," which is exactly the class of bug this
   whole arc is about (numbers green, picture wrong). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCameraPath, bankAngleFromCurvature } from './camera-path.js';

const UP = new THREE.Vector3(0, 1, 0);

test('createCameraPath throws with fewer than 2 waypoints (fails loud, not on a garbage curve)', () => {
  assert.throws(() => createCameraPath([{ x: 0, y: 0, z: 0 }]));
  assert.throws(() => createCameraPath([]));
});

test('the curve INTERPOLATES every waypoint exactly — an authored beat must actually be visited', () => {
  // WHY: this is the whole reason Catmull-Rom was chosen over a raw B-spline (see camera-path.js header)
  // — an approximating curve that only passes NEAR a waypoint would silently break every authored beat.
  const wp = [
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 2, -5),
    new THREE.Vector3(25, 1, -20), new THREE.Vector3(30, 5, -40),
  ];
  const path = createCameraPath(wp);
  // recover each waypoint's own global-t by walking the SAME centripetal knot math a second, independent
  // way: probe pointAt densely and find where it's closest to each waypoint, then assert that distance ~0.
  for (const w of wp) {
    let best = Infinity;
    for (let i = 0; i <= 2000; i++) {
      const t = i / 2000;
      const p = path.pointAt(t);
      best = Math.min(best, p.distanceTo(w));
    }
    assert.ok(best < 0.01, `waypoint (${w.x},${w.y},${w.z}) was never visited within 0.01 world units (closest: ${best})`);
  }
});

test('the curve is C0/C1-ish continuous across a segment boundary — no position or tangent-direction jump', () => {
  // WHY: this is the actual "jitter" the owner complained about — a discontinuous tangent at a waypoint
  // reads as the camera's heading SNAPPING mid-flight, even if position itself doesn't visibly teleport.
  const wp = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 4, 0), new THREE.Vector3(20, 4, -20), new THREE.Vector3(0, 0, -20)];
  const path = createCameraPath(wp);
  // segment boundaries land at cumulative knot fractions; probe just before/after a few candidate t's
  // densely enough to catch ANY boundary in [0.2, 0.8] without hand-deriving the exact knot values.
  const eps = 1e-4;
  let maxTangentJump = 0, maxPosJump = 0;
  for (let i = 1; i < 999; i++) {
    const t = i / 999;
    const pBefore = path.pointAt(t - eps), pAfter = path.pointAt(t + eps);
    maxPosJump = Math.max(maxPosJump, pBefore.distanceTo(pAfter));
    const tanBefore = path.tangentAt(t - eps).normalize(), tanAfter = path.tangentAt(t + eps).normalize();
    maxTangentJump = Math.max(maxTangentJump, tanBefore.distanceTo(tanAfter));
  }
  assert.ok(maxPosJump < 0.05, `position jumped by ${maxPosJump} across some t — the curve is not even continuous (C0)`);
  assert.ok(maxTangentJump < 0.3, `tangent DIRECTION jumped by ${maxTangentJump} across some t — a C1 curve should ease, not snap (this is the owner's "jittery" symptom)`);
});

test('a straight-line path has ~zero curvature everywhere (no phantom banking on a straight flight)', () => {
  const wp = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0), new THREE.Vector3(20, 0, 0), new THREE.Vector3(30, 0, 0)];
  const path = createCameraPath(wp);
  for (let i = 1; i < 20; i++) {
    const t = i / 20;
    const { magnitude } = path.curvatureAt(t, UP);
    assert.ok(magnitude < 1e-4, `straight path should have ~0 curvature at t=${t}, got ${magnitude}`);
  }
});

test('a one-directional turn has CONSISTENTLY-SIGNED curvature — banking never flip-flops mid-turn', () => {
  // WHY: a sign flip mid-turn would bank the camera the WRONG way for an instant — visually worse than
  // no banking at all. Waypoints trace a quarter-circle-ish arc (one consistent turn direction).
  const R = 20, N = 6;
  const wp = [];
  for (let i = 0; i < N; i++) { const a = (i / (N - 1)) * (Math.PI / 2); wp.push(new THREE.Vector3(R * Math.sin(a), 0, -R * Math.cos(a))); }
  const path = createCameraPath(wp);
  let sawPositive = false, sawNegative = false;
  for (let i = 5; i < 95; i++) {   // stay off the very ends, where the finite-difference probe is one-sided
    const { signed, magnitude } = path.curvatureAt(i / 100, UP);
    // near-zero curvature (incl. the real, expected transition right at the path's own start/end, where
    // the phantom-mirrored endpoint tangent eases the curve INTO its steady turn) has no meaningful sign
    // to check — only assert sign-consistency where the curve is CLEARLY mid-turn.
    if (magnitude < 0.02) continue;
    if (signed > 0) sawPositive = true; else if (signed < 0) sawNegative = true;
  }
  assert.ok(!(sawPositive && sawNegative), 'a single-direction arc must never show BOTH curvature signs — that is a sign flip mid-turn');
  assert.ok(sawPositive || sawNegative, 'a real quarter-circle arc must show SOME non-zero signed curvature somewhere');
});

test('bankAngleFromCurvature: zero curvature or zero speed banks to exactly 0', () => {
  assert.equal(bankAngleFromCurvature(0, 20), 0);
  assert.equal(bankAngleFromCurvature(0.5, 0), 0);
});

test('bankAngleFromCurvature: sign of curvature flips the bank direction, magnitude does not', () => {
  const pos = bankAngleFromCurvature(0.02, 15);
  const neg = bankAngleFromCurvature(-0.02, 15);
  assert.ok(pos > 0 && neg < 0, `expected opposite-sign bank for opposite-sign curvature, got ${pos} / ${neg}`);
  assert.ok(Math.abs(pos - Math.abs(neg)) < 1e-9, 'magnitude must be identical for equal-magnitude opposite curvature');
});

test('bankAngleFromCurvature clamps to maxBankRad — no real aircraft banks past its own cap', () => {
  const maxBankRad = THREE.MathUtils.degToRad(35);
  const extreme = bankAngleFromCurvature(50, 100, { maxBankRad });   // an absurdly tight/fast turn
  assert.ok(Math.abs(extreme - maxBankRad) < 1e-9, `expected the clamp to bind at ${maxBankRad}, got ${extreme}`);
});

test('bankAngleFromCurvature: a tighter turn (bigger |curvature|) banks harder, monotonically', () => {
  const shallow = bankAngleFromCurvature(0.005, 15);
  const sharp = bankAngleFromCurvature(0.03, 15);
  assert.ok(sharp > shallow, `a sharper turn must bank MORE, got shallow=${shallow} sharp=${sharp}`);
});
