/* hoard2 · player/movement.test.mjs — the iso survivor's motion INTENT (Rule 9), THREE-free.
   Each test pins a rule the DONE criteria / game-feel rest on, not just "the function runs". */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampToRadius, resolveCircles, resolveAabbs, aimFacing, isoStep } from './movement.js';

test('clampToRadius keeps the survivor inside the survivable disc (can\'t walk off the arena)', () => {
  const out = { x: 0, z: 0 };
  clampToRadius(100, 0, 26, out);
  assert.ok(Math.abs(Math.hypot(out.x, out.z) - 26) < 1e-9, 'a point outside PLAY_RADIUS is pulled onto the rim');
  clampToRadius(3, 4, 26, out);
  assert.deepEqual([out.x, out.z], [3, 4], 'a point already inside is untouched');
});

test('resolveCircles pushes the body OUT of a tree — trunks are solid', () => {
  const out = { x: 0, z: 0 };
  // stand at (1,0) with radius 0.3, a tree r=1 at the origin → overlap; must end at least r+pr from centre.
  resolveCircles(1, 0, 0.3, [{ x: 0, z: 0, r: 1 }], out);
  assert.ok(Math.hypot(out.x, out.z) >= 1.3 - 1e-6, 'ejected to trunk-radius + body-radius');
  // clear of the tree → no change.
  resolveCircles(5, 0, 0.3, [{ x: 0, z: 0, r: 1 }], out);
  assert.deepEqual([out.x, out.z], [5, 0]);
});

test('resolveAabbs ejects along the axis of least penetration — barriers are solid walls', () => {
  const out = { x: 0, z: 0 };
  const box = { minx: -1, maxx: 1, minz: -1, maxz: 1 };
  // just inside the +x face → should pop out the +x side (least penetration), not teleport across.
  resolveAabbs(0.9, 0, 0, [box], out);
  assert.ok(out.x >= 1 - 1e-9 && Math.abs(out.z) < 1e-9, 'pushed out the near (+x) face');
  // outside the box entirely → untouched.
  resolveAabbs(5, 5, 0, [box], out);
  assert.deepEqual([out.x, out.z], [5, 5]);
});

test('aimFacing points the survivor at the cursor ground point (the gun aims where you aim)', () => {
  assert.ok(Math.abs(aimFacing(0, 0, 0, 1) - 0) < 1e-9, 'target on +z → facing 0');
  assert.ok(Math.abs(aimFacing(0, 0, 1, 0) - Math.PI / 2) < 1e-9, 'target on +x → facing +90°');
  assert.equal(aimFacing(2, 2, 2, 2, 1.23), 1.23, 'cursor ON the survivor → keep previous facing (no NaN)');
});

test('isoStep: diagonal is not faster than cardinal, and sprint outruns walk', () => {
  const params = { walkSpeed: 3, sprintSpeed: 5.2, accel: 14 };
  const state = { x: 0, z: 0, vx: 0, vz: 0, facing: 0 };
  const out = { x: 0, z: 0, vx: 0, vz: 0, moving: false, facing: 0 };
  // huge dt so velocity essentially reaches the desired speed this step.
  isoStep(state, { x: 1, y: 1, sprint: false }, 0, 10, params, out);
  const diagSpeed = Math.hypot(out.vx, out.vz);
  assert.ok(diagSpeed <= 3 + 1e-3, `diagonal speed (${diagSpeed}) must not exceed walk speed (fairness)`);
  isoStep(state, { x: 0, y: 1, sprint: false }, 0, 10, params, out);
  const walkSpeed = Math.hypot(out.vx, out.vz);
  isoStep(state, { x: 0, y: 1, sprint: true }, 0, 10, params, out);
  const sprintSpeed = Math.hypot(out.vx, out.vz);
  assert.ok(sprintSpeed > walkSpeed + 1, 'sprint is meaningfully faster than walk');
});

test('isoStep: no input → not moving and facing is held (idle survivor keeps her heading)', () => {
  const params = { walkSpeed: 3, sprintSpeed: 5.2, accel: 14 };
  const state = { x: 0, z: 0, vx: 0, vz: 0, facing: 1.1 };
  const out = { x: 0, z: 0, vx: 0, vz: 0, moving: false, facing: 0 };
  isoStep(state, { x: 0, y: 0, sprint: false }, 0, 0.016, params, out);
  assert.equal(out.moving, false);
  assert.equal(out.facing, 1.1, 'idle keeps the previous facing');
});
