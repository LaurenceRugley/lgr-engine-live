/* ============================================================
   ground-clamp.test.mjs — ARC A-CLAMP (2026-08-21): the ground clamp's two rules, red-then-green.
   ------------------------------------------------------------
   WHY THIS TEST EXISTS (Rule 9 — encode WHY, not "it runs"). The clamp makes exactly two promises, and
   both of them are business rules that a plausible "improvement" would quietly break:

     1 · NO GEOMETRY BELOW THE FLOOR, ON EVERY FRAME. The envelope may bleed the held lift DOWN as slowly
         as it likes, but it may never return less than what this frame's pose requires. Somebody who
         later "smooths the pop" by damping the attack breaks the guarantee while every average still
         looks fine — and a foot dipping through the floor for three frames is invisible to a census that
         samples one. So the test asserts the hard floor DIRECTLY, including the case where the smoothing
         would have won (a big jump after a long quiet stretch).

     2 · THE SOLE IS MEASURED OFF THE MESH, AND EACH CORNER AGAINST THE GROUND UNDER ITSELF. Two prior
         arcs died on the first half: the Quaternius zombie has no toe bone, so a bone-driven ruler read
         it +0.0178 CLEAR while its foot mesh was −0.0567 SUNK (swing-ledger, A-GROUND FINDING 2). The
         second half is what makes the clamp survive a slope: sampling the floor under the BODY instead of
         under each corner is right only while `groundAt` is a flat constant, which is a hoard2 accident.
         Both are asserted against geometry built here, so this pins the RULE, not an asset.

   The synthetic rig is a bare SkinnedMesh with a two-bone skeleton and hand-written skin weights, so the
   thing under test is the arithmetic and nothing else — no GLB, no loader, no file I/O.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GROUND_CLAMP, measureSoleBoxes, bindSoleBoxes, soleLift, clampEnvelope } from './ground-clamp.js';

/* A rig with ONE sole bone ("FootL") and one non-sole bone ("Hips"), and geometry hanging BELOW the foot
   bone's origin — the zombie's defect in miniature: the skeleton stops at the ankle and the mesh does not.
   `soleDrop` is how far the lowest vertex sits below the bone, in the bone's own space. */
function makeRig({ soleDrop = 0.1, rootY = 0 } = {}) {
  const root = new THREE.Group();
  const hips = new THREE.Bone(); hips.name = 'Hips'; hips.position.set(0, 1, 0); root.add(hips);
  const foot = new THREE.Bone(); foot.name = 'FootL'; foot.position.set(0, -1, 0); hips.add(foot);
  // four vertices on the sole (a small square) + one on the hips, so the mesh has a non-sole bone too.
  const pos = new Float32Array([
    -0.05, -soleDrop, -0.05, 0.05, -soleDrop, -0.05, 0.05, -soleDrop, 0.05, -0.05, -soleDrop, 0.05,
    0, 0.2, 0,
  ]);
  const skinIndex = new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]);
  const skinWeight = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  const mesh = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
  mesh.name = 'Body';
  root.add(mesh);
  /* THE BIND POSE IS TAKEN AT THE ORIGIN, THEN THE BODY IS PLACED — and getting that backwards is a real
     trap this fixture walked into on its first run. `new Skeleton(bones)` calls `calculateInverses()`
     against the bones' CURRENT world matrices, so binding after moving the root bakes the root's offset
     into every boneInverse and the rig then reads as if it were still at the origin. A GLB's inverses come
     from the file, in the asset's own space, which is what this order reproduces. */
  root.updateMatrixWorld(true);
  // bone index 0 = FootL (the sole bone), 1 = Hips. Bind with the identity, exactly as GLTFLoader does.
  const skeleton = new THREE.Skeleton([foot, hips]);
  mesh.bind(skeleton, new THREE.Matrix4());
  root.position.y = rootY;
  root.updateMatrixWorld(true);
  return { root, mesh, foot, hips, skeleton };
}

test('the sole box is measured off the MESH, not the bone — the defect no bone ruler could see', () => {
  const { root, foot } = makeRig({ soleDrop: 0.1, rootY: 0 });
  const table = measureSoleBoxes(root);
  const entries = bindSoleBoxes(root, table);
  assert.equal(entries.length, 1, 'exactly one sole bone should be measured (FootL); Hips is not a sole');
  assert.equal(entries[0].bone.name, 'FootL');
  assert.equal(entries[0].n, 4, 'all four sole vertices belong to the foot; the hips vertex must not');

  // The foot BONE sits at world y = 0 (hips 1, foot -1). The mesh hangs 0.1 below it. A ruler that read
  // the bone would call this rig CLEAR on a floor at y = 0; the clamp must want a 0.1 lift.
  foot.updateWorldMatrix(true, false);
  assert.ok(Math.abs(foot.matrixWorld.elements[13]) < 1e-9, 'precondition: the foot BONE is exactly on the floor');
  const lift = soleLift(entries, () => 0, new THREE.Vector3());
  assert.ok(Math.abs(lift - 0.1) < 1e-6, `mesh-driven lift should be the 0.1 sole drop, got ${lift}`);
});

test('a body already clear of the floor is not lifted — the clamp is a floor, never a hoist', () => {
  const { root } = makeRig({ soleDrop: 0.1, rootY: 0.5 });
  const entries = bindSoleBoxes(root, measureSoleBoxes(root));
  assert.equal(soleLift(entries, () => 0, new THREE.Vector3()), 0);
});

test('each corner is sampled against the ground under ITSELF — the clamp holds on a slope', () => {
  const { root } = makeRig({ soleDrop: 0.1, rootY: 0 });
  const entries = bindSoleBoxes(root, measureSoleBoxes(root));
  // A 1-in-1 grade running along +Z. The sole spans z ∈ [-0.05, +0.05], so the floor under the UPHILL
  // corner is 0.05 higher than under the body centre. Sampling at the centre would under-lift by exactly
  // that — which is the latent wrong answer A-CENSUS found in the census's own mesh ruler.
  const slope = (x, z) => z;
  const lift = soleLift(entries, slope, new THREE.Vector3());
  assert.ok(Math.abs(lift - 0.15) < 1e-6, `uphill corner must set the lift (0.1 drop + 0.05 rise), got ${lift}`);
  const atCentreOnly = 0.1 + slope(0, 0);
  assert.ok(lift > atCentreOnly, 'a body-centre sample would have under-lifted; that is the bug this asserts against');
});

test('a floor that declines to answer (non-finite groundAt) is not a floor — that corner is skipped', () => {
  const { root } = makeRig({ soleDrop: 0.1, rootY: 0 });
  const entries = bindSoleBoxes(root, measureSoleBoxes(root));
  assert.equal(soleLift(entries, () => NaN, new THREE.Vector3()), 0, 'NaN must read as "no floor here", never as a lift');
  assert.equal(soleLift(entries, () => Infinity, new THREE.Vector3()), 0);
});

test('THE HARD GUARANTEE: the envelope never returns less than this frame requires', () => {
  // The failure this pins: someone damps the attack to "smooth the pop". Averages stay fine and feet go
  // through the floor for a few frames — invisible to a census that samples one instant.
  let held = 0;
  held = clampEnvelope(held, 0.08, 1 / 60);
  assert.equal(held, 0.08, 'a jump must be answered in ONE frame, not eased into');
  // …and after a long quiet stretch, where a damped attack would be furthest behind. 0.08 u at the
  // default 0.006 u/s needs > 13 s to bleed away — the leak is deliberately slower than a person expects.
  for (let i = 0; i < 60 * 20; i++) held = clampEnvelope(held, 0, 1 / 60);
  assert.equal(held, 0, 'with nothing required, the leak must reach zero');
  held = clampEnvelope(held, 0.25, 1 / 60);
  assert.equal(held, 0.25);
});

test('the release is RATE-LIMITED, and that rate is the bob budget', () => {
  const cfg = { ...GROUND_CLAMP, release: 0.006 };
  let held = 0.1;
  const dt = 1 / 60;
  for (let i = 0; i < 60; i++) held = clampEnvelope(held, 0, dt, cfg);   // one second of leak
  assert.ok(Math.abs(held - (0.1 - 0.006)) < 1e-9, `one second must bleed exactly one release (0.006), got ${held}`);
  // A faster release is a REAL alternative tuning (the probe's red arm uses it), so it must be honoured.
  let fast = 0.1;
  fast = clampEnvelope(fast, 0, dt, { ...cfg, release: 6 });
  assert.equal(fast, 0, 'a release big enough to clear the hold in one frame must clear it');
});

test('maxLift is a ceiling, so a placement bug is left VISIBLE rather than teleported', () => {
  const cfg = { ...GROUND_CLAMP, maxLift: 0.3 };
  assert.equal(clampEnvelope(0, 5, 1 / 60, cfg), 0.3, 'a body 5 u under the floor is a bug, not a gait dip');
});

test('no sole geometry → no entries → the clamp is INERT and says so by being empty', () => {
  // The A-CENSUS failure class in this module's own terms: a rig can be wired, accepted, and unable to run.
  const { root } = makeRig({ soleDrop: 0.1 });
  const empty = bindSoleBoxes(root, measureSoleBoxes(root, /nothing-matches-this/));
  assert.equal(empty.length, 0);
  assert.equal(soleLift(empty, () => 10, new THREE.Vector3()), 0, 'an inert clamp must lift NOTHING, not a default');
});
