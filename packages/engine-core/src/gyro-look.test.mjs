// gyro-look.test.mjs — node:test of the PURE mapGyroToLook mapping (no DOM, no GPU)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapGyroToLook } from './gyro-look.js';

// Helper: build a fake DeviceOrientationEvent-shaped object
const evt = (beta, gamma) => ({ beta, gamma });

// Portrait (screenAngle = 0):
//   dGamma > 0 → yawDeg > 0 (looking right)
//   dBeta  > 0 → pitchDeg > 0 (looking up)
test('portrait: positive dGamma → yawDeg positive (looking right)', () => {
  const r = mapGyroToLook(evt(10, 5), { beta: 10, gamma: 0 }, 0);
  assert.ok(r.yawDeg > 0, `expected yawDeg > 0, got ${r.yawDeg}`);
  assert.equal(r.yawDeg, 5);
});

test('portrait: positive dBeta → pitchDeg positive (looking up)', () => {
  const r = mapGyroToLook(evt(20, 0), { beta: 10, gamma: 0 }, 0);
  assert.ok(r.pitchDeg > 0, `expected pitchDeg > 0, got ${r.pitchDeg}`);
  assert.equal(r.pitchDeg, 10);
});

// Landscape-right (screenAngle = 90):
//   dBeta  > 0 → yawDeg > 0 (looking right — axes swapped vs portrait)
//   dGamma > 0 → pitchDeg < 0
test('landscape-right (90°): positive dBeta → yawDeg positive', () => {
  const r = mapGyroToLook(evt(15, 0), { beta: 10, gamma: 0 }, 90);
  assert.ok(r.yawDeg > 0, `expected yawDeg > 0, got ${r.yawDeg}`);
  assert.equal(r.yawDeg, 5);
});

test('landscape-right (90°): positive dGamma → pitchDeg negative', () => {
  const r = mapGyroToLook(evt(10, 8), { beta: 10, gamma: 0 }, 90);
  assert.ok(r.pitchDeg < 0, `expected pitchDeg < 0, got ${r.pitchDeg}`);
  assert.equal(r.pitchDeg, -8);
});
