// createFirstPersonWalker.test.mjs — node:test of the FP walker (pure math; no THREE/GPU).
// Encodes the WALKER INVARIANTS the dive-and-fight embodiment depends on (Rule 9 — WHY, not "it runs"):
//   • FULL YAW — you can spin all the way around (unbounded), the whole point vs seated's clamped ±yaw;
//   • CLAMPED PITCH — but you can't break your neck (look-up/down bounded);
//   • YAW-RELATIVE MOVE — W goes where you FACE (embodiment), not a fixed world axis;
//   • COLLISION — trees + boxes + the arena rim block you (you can never end up inside an obstacle);
//   • DETERMINISM — identical input ⇒ identical motion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFirstPersonWalker } from './createFirstPersonWalker.js';

test('full yaw: mouse-look is UNBOUNDED — you can turn past a full circle', () => {
  const w = createFirstPersonWalker({});
  for (let i = 0; i < 20; i++) w.addLook(-500, 0);      // keep dragging one way
  assert.ok(Math.abs(w.yaw) > Math.PI * 2, `yaw ${w.yaw} should exceed 2π (unbounded, unlike seated)`);
});

test('clamped pitch: you cannot somersault your neck', () => {
  const w = createFirstPersonWalker({ pitchUp: 50, pitchDown: 40 });
  for (let i = 0; i < 50; i++) w.addLook(0, -1000);     // look way up
  assert.ok(w.pitch <= 50 * Math.PI / 180 + 1e-9 && w.pitch >= -40 * Math.PI / 180 - 1e-9, `pitch ${w.pitch} out of clamp`);
  for (let i = 0; i < 100; i++) w.addLook(0, 1000);     // now way down
  assert.ok(w.pitch >= -40 * Math.PI / 180 - 1e-9, `pitch ${w.pitch} below the down clamp`);
});

test('yaw-relative move: W goes where you FACE', () => {
  // yaw 0 → forward is +z
  let w = createFirstPersonWalker({ moveSpeed: 4, accel: 1e6 });
  for (let s = 0; s < 30; s++) w.update(1 / 60, { x: 0, y: 1 });
  assert.ok(w.z > 0.3 && Math.abs(w.x) < 1e-6, `yaw0 forward should be +z, got (${w.x.toFixed(3)},${w.z.toFixed(3)})`);
  // yaw 90° → forward is +x
  w = createFirstPersonWalker({ moveSpeed: 4, accel: 1e6, yaw: Math.PI / 2 });
  for (let s = 0; s < 30; s++) w.update(1 / 60, { x: 0, y: 1 });
  assert.ok(w.x > 0.3 && Math.abs(w.z) < 1e-6, `yaw90 forward should be +x, got (${w.x.toFixed(3)},${w.z.toFixed(3)})`);
  // strafe at yaw 0 → +x (right)
  w = createFirstPersonWalker({ moveSpeed: 4, accel: 1e6 });
  for (let s = 0; s < 30; s++) w.update(1 / 60, { x: 1, y: 0 });
  assert.ok(w.x > 0.3, `strafe-right at yaw0 should be +x, got x=${w.x.toFixed(3)}`);
});

test('collision: a tree trunk blocks you — you never end up inside it', () => {
  const tree = { x: 0, z: 2, r: 0.6 };
  const w = createFirstPersonWalker({ moveSpeed: 6, accel: 1e6, radius: 0.3, colliders: [tree] });
  for (let s = 0; s < 120; s++) w.update(1 / 60, { x: 0, y: 1 });   // walk straight at it for 2s
  const d = Math.hypot(w.x - tree.x, w.z - tree.z);
  assert.ok(d >= tree.r + 0.3 - 1e-3, `ended up inside the trunk: d ${d.toFixed(3)} < ${tree.r + 0.3}`);
  assert.ok(w.z < tree.z, 'should be stopped in FRONT of the trunk, not teleported past it');
});

test('AABB collision: a barrier box ejects you', () => {
  const box = { minX: -1, maxX: 1, minZ: 1, maxZ: 3 };
  const w = createFirstPersonWalker({ moveSpeed: 6, accel: 1e6, radius: 0.3, aabbs: [box] });
  for (let s = 0; s < 120; s++) w.update(1 / 60, { x: 0, y: 1 });
  const inside = w.x > box.minX - 0.3 && w.x < box.maxX + 0.3 && w.z > box.minZ - 0.3 && w.z < box.maxZ + 0.3;
  assert.ok(!inside, `ended up inside the barrier box at (${w.x.toFixed(2)},${w.z.toFixed(2)})`);
});

test('arena bound: you cannot walk off the edge', () => {
  const w = createFirstPersonWalker({ moveSpeed: 8, accel: 1e6, arenaRadius: 5 });
  for (let s = 0; s < 240; s++) w.update(1 / 60, { x: 0, y: 1 });   // run at the rim for 4s
  assert.ok(Math.hypot(w.x, w.z) <= 5 + 1e-6, `walked past the arena rim to r=${Math.hypot(w.x, w.z).toFixed(3)}`);
});

test('eye pose: eye at eye height, direction from yaw/pitch', () => {
  const w = createFirstPersonWalker({ eyeY: 1.4 });
  const e = w.eyePosition();
  assert.ok(Math.abs(e.y - 1.4) < 1e-9, `eye height ${e.y} (idle should be exactly eyeY)`);
  const d = w.eyeDirection();   // yaw0 pitch0 → +z
  assert.ok(Math.abs(d.x) < 1e-9 && Math.abs(d.y) < 1e-9 && Math.abs(d.z - 1) < 1e-9, `dir ${JSON.stringify(d)} ≠ +z`);
});

test('determinism: identical look+move input ⇒ identical state', () => {
  const run = () => {
    const w = createFirstPersonWalker({ colliders: [{ x: 0.5, z: 1.5, r: 0.5 }], arenaRadius: 10 });
    for (let s = 0; s < 90; s++) { w.addLook(s % 10 - 5, s % 7 - 3); w.update(1 / 60, { x: Math.sin(s), y: 1, sprint: s > 45 }); }
    return [w.x, w.z, w.yaw, w.pitch];
  };
  assert.deepEqual(run(), run());
});
