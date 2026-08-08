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
  // A3 STRAFE POLARITY (owner: "if I press right I go right"). D must go the CAMERA'S RIGHT, at ANY yaw —
  // a sign error here hides until the yaw changes, so we assert at yaw 0 AND after a 90° turn (the class).
  // Camera-right (forward=(sin,cos), up=+y, three.js right-handed) = cross(up,-forward) = (-cos yaw, sin yaw).
  const camRight = (yaw) => ({ x: -Math.cos(yaw), z: Math.sin(yaw) });
  // yaw 0 → forward +z, so camera-right is -x. Strafe-right (x:1) must move toward -x (NOT +x — that was the bug).
  w = createFirstPersonWalker({ moveSpeed: 4, accel: 1e6 });
  for (let s = 0; s < 30; s++) w.update(1 / 60, { x: 1, y: 0 });
  let r = camRight(0);
  assert.ok(w.x * r.x + w.z * r.z > 0.3, `strafe-right at yaw0 must go camera-right (-x); got (${w.x.toFixed(3)},${w.z.toFixed(3)})`);
  assert.ok(w.x < -0.3, `and that is -x specifically (the fix inverts the old +x bug), got x=${w.x.toFixed(3)}`);
  // yaw 90° → forward +x, so camera-right is +z. The SAME +x input must now move toward +z, not -z.
  w = createFirstPersonWalker({ moveSpeed: 4, accel: 1e6, yaw: Math.PI / 2 });
  for (let s = 0; s < 30; s++) w.update(1 / 60, { x: 1, y: 0 });
  r = camRight(Math.PI / 2);
  assert.ok(w.x * r.x + w.z * r.z > 0.3, `strafe-right at yaw90 must go camera-right (+z); got (${w.x.toFixed(3)},${w.z.toFixed(3)})`);
  assert.ok(w.z > 0.3, `and that is +z specifically (proves the fix holds after a yaw change), got z=${w.z.toFixed(3)}`);
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

// ARC A-CAM+WALK — groundY(x,z) hook (createFirstPersonWalker.js:118-120's own documented gap: eye
// height was a CONSTANT, wrong once the ground itself isn't flat at y=0 — the city's street sits at
// LAYOUT.PLINTH_TOP, not 0).
test('groundY omitted: eyePosition falls back to the ORIGINAL constant eyeY behavior, unchanged', () => {
  const w = createFirstPersonWalker({ eyeY: 1.4 });
  assert.ok(Math.abs(w.eyePosition().y - 1.4) < 1e-9, 'no groundY passed → byte-identical to pre-arc behavior');
});

test('groundY supplied: eye height tracks the sampled ground, not a constant', () => {
  const w = createFirstPersonWalker({ groundY: (x, z) => (x > 5 ? 3 : 0.3), eyeHeight: 1.4 });
  w.setPosition(0, 0);
  assert.ok(Math.abs(w.eyePosition().y - (0.3 + 1.4)) < 1e-9, `low ground: eye should sit at groundY+eyeHeight, got ${w.eyePosition().y}`);
  w.setPosition(10, 0);
  assert.ok(Math.abs(w.eyePosition().y - (3 + 1.4)) < 1e-9, `stepping onto higher ground must raise eye height, got ${w.eyePosition().y}`);
});

test('setGroundY: can be wired after construction (matches setColliders/setAabbs\'s own late-bind convention)', () => {
  const w = createFirstPersonWalker({ eyeY: 1.4 });
  assert.ok(Math.abs(w.eyePosition().y - 1.4) < 1e-9, 'no groundY yet → the constructor default');
  w.setGroundY((x, z) => 5);
  assert.ok(Math.abs(w.eyePosition().y - (5 + 1.4)) < 1e-9, 'setGroundY after construction takes effect immediately');
  w.setGroundY(null);
  assert.ok(Math.abs(w.eyePosition().y - 1.4) < 1e-9, 'clearing groundY (null) restores the constant eyeY fallback');
});

test('resolveSpatial omitted: existing circle/aabb collision is unaffected (byte-identical hoard2 path)', () => {
  const tree = { x: 0, z: 2, r: 0.6 };
  const w = createFirstPersonWalker({ moveSpeed: 6, accel: 1e6, radius: 0.3, colliders: [tree] });
  for (let s = 0; s < 120; s++) w.update(1 / 60, { x: 0, y: 1 });
  const d = Math.hypot(w.x - tree.x, w.z - tree.z);
  assert.ok(d >= tree.r + 0.3 - 1e-3, 'no resolveSpatial passed → the existing circle collision alone must still block');
});

test('resolveSpatial supplied: a wall reported by the injected resolver actually stops the walker', () => {
  // a minimal stand-in for collide.js's resolveSphere(state,dt,cfg): a wall at z=2, push back to z=1.7 on contact.
  const fakeResolve = (state) => { if (state.z > 1.7) state.z = 1.7; };
  const w = createFirstPersonWalker({ moveSpeed: 6, accel: 1e6, resolveSpatial: fakeResolve });
  for (let s = 0; s < 120; s++) w.update(1 / 60, { x: 0, y: 1 });   // walk straight at the wall for 2s
  assert.ok(w.z <= 1.7 + 1e-9, `the injected spatial resolver's wall must stop the walker, got z=${w.z.toFixed(3)}`);
});

test('setResolveSpatial: can be wired after construction, and cleared with null', () => {
  const w = createFirstPersonWalker({ moveSpeed: 6, accel: 1e6 });
  w.setResolveSpatial((state) => { if (state.z > 1) state.z = 1; });
  for (let s = 0; s < 60; s++) w.update(1 / 60, { x: 0, y: 1 });
  assert.ok(w.z <= 1 + 1e-9, `wired-after-construction resolver must still block, got z=${w.z.toFixed(3)}`);
  w.setResolveSpatial(null);
  for (let s = 0; s < 60; s++) w.update(1 / 60, { x: 0, y: 1 });
  assert.ok(w.z > 1.5, `clearing the resolver (null) must let movement past the old wall resume, got z=${w.z.toFixed(3)}`);
});

test('determinism: identical look+move input ⇒ identical state', () => {
  const run = () => {
    const w = createFirstPersonWalker({ colliders: [{ x: 0.5, z: 1.5, r: 0.5 }], arenaRadius: 10 });
    for (let s = 0; s < 90; s++) { w.addLook(s % 10 - 5, s % 7 - 3); w.update(1 / 60, { x: Math.sin(s), y: 1, sprint: s > 45 }); }
    return [w.x, w.z, w.yaw, w.pitch];
  };
  assert.deepEqual(run(), run());
});
