/* ============================================================
   character-ground-report.test.mjs — ARC A-CENSUS (2026-08-20): the MEASURED-FLOOR receipt, red-then-green.
   ------------------------------------------------------------
   WHY THIS TEST EXISTS (Rule 9 — encode WHY, not "it runs"). Arc A-GROUND wired a ground probe onto every
   pooled zombie and proved the wiring landed: `surfaceProbedCount 96/96`. An independent refutation then
   established that ZERO of those 96 rigs ever took the measured path — the Quaternius zombie is a FLAT rig
   (no articulated foot←knee←thigh chain), `_chainLenOf` returns 0 for such a chain, and the measured branch
   is gated `L > 0`. The ability was STRUCTURALLY UNREACHABLE for the arc's headline class and reported
   nothing about it, so a green instrument sat on top of an inert feature.

   The property under test is therefore NOT "setFootIK works". It is: **a rig that cannot deliver a measured
   floor must SAY SO, and a rig that can must not be slandered.** If someone later changes the reachability
   predicate to a constant — in either direction — one of these two halves goes red. A one-sided test
   (assert `reachable === false` on the zombie) would pass just as happily against `reachable = false`
   hard-coded, which is the exact class of check the refutation caught. So both arms are asserted, against
   two skeletons that differ in ONE property: whether the foot has a knee and a thigh above it.

   The skeletons are synthesised here rather than loaded from the shipped GLBs on purpose: this pins the
   TOPOLOGY RULE, not two assets. `spawn()` reaches the profile adapter through bone NAMES, so each synthetic
   skeleton carries the naming family it is imitating (mixamo / quaternius) — see character-rig-profiles.js.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCharacterRig } from './createCharacterRig.js';

/* Build a gltf-like source (`{ scene, animations }`) — the documented injection point createCharacterRig
   already takes for tests (`gltf:`), so no loader and no file I/O. `articulated` decides the ONE difference:
   FLAT hangs each foot straight off the hips (foot.parent === hips → the chain has no thigh), ARTICULATED
   inserts a thigh and a shin, which is exactly what `_legChain` walks to set its `articulated` flag. */
function makeSkeleton({ articulated, names }) {
  const scene = new THREE.Group();
  const bone = (name, parent, y) => { const b = new THREE.Bone(); b.name = name; b.position.set(0, y, 0); (parent || scene).add(b); return b; };
  const hips = bone(names.hips, null, 1.0);
  // The layer bones the profile adapter resolves (present so `resolveRig` detects the family and does not
  // warn about a half-built skeleton). Their positions are irrelevant to this test.
  bone(names.spine, hips, 0.2); bone(names.head, hips, 0.5); bone(names.neck, hips, 0.4);
  bone(names.armL, hips, 0.3); bone(names.armR, hips, 0.3); bone(names.foreArmR, hips, 0.2);
  for (const side of ['L', 'R']) {
    const footName = side === 'L' ? names.footL : names.footR;
    if (articulated) {
      const thigh = bone(`${names.thigh}${side}`, hips, -0.1);
      const shin = bone(`${names.shin}${side}`, thigh, -0.45);
      bone(footName, shin, -0.45);
    } else {
      bone(footName, hips, -1.0);   // FLAT: hips → foot, nothing between (the Quaternius shape)
    }
  }
  return { scene, animations: [] };
}

const MIXAMO = { hips: 'Hips', spine: 'Spine2', head: 'Head', neck: 'Neck', armL: 'LeftArm', armR: 'RightArm', foreArmR: 'RightForeArm', footL: 'LeftFoot', footR: 'RightFoot', thigh: 'UpLeg', shin: 'Leg' };
const QUAT = { hips: 'Hips', spine: 'Torso', head: 'Head', neck: 'Neck', armL: 'UpperArmL', armR: 'UpperArmR', foreArmR: 'LowerArmR', footL: 'FootL', footR: 'FootR', thigh: 'UpperLeg', shin: 'LowerLeg' };

async function spawnRig(gltf) {
  const rig = createCharacterRig({ gltf });
  await rig.ready;
  return rig.spawn();
}

test('A-CENSUS: a FLAT rig asked for a measured floor reports it UNREACHABLE (the refutation, encoded)', async () => {
  const h = await spawnRig(makeSkeleton({ articulated: false, names: QUAT }));
  const before = h.groundReport;
  assert.equal(before.requested, false, 'nothing asked for yet — the receipt starts honest, not optimistic');
  assert.equal(before.reachable, false, 'a foot hanging straight off the hips has no chain length to cast along');

  const rep = h.setFootIK({ plantBand: 0.14, groundProbe: true });
  assert.equal(rep.requested, true, 'the ask is recorded — the config IS accepted, which is why this was invisible');
  assert.equal(rep.reachable, false, 'and the skeleton vetoes it: this is the term A-GROUND had no way to see');
  assert.equal(rep.ok, false, 'so the measured floor is NOT armed, whatever surfaceProbedCount says');
  assert.match(rep.reason, /flat-rig/, 'and the reason names the cause, so the reader is not left to grep for it');

  // WIRING THE PROBE MUST NOT FLIP THE VERDICT — this is the precise lie the old instrument told: the probe
  // lands on every slot, `surfaceProbed` goes true, and a reader concludes the feature is running.
  h.setSurfaceProbe(() => 1);
  assert.equal(h.surfaceProbed, true, 'possession: the rig now holds a probe');
  assert.equal(h.groundReport.ok, false, 'consumption: it still cannot use one — 96/96 probed was never proof');
});

test('A-CENSUS: an ARTICULATED rig reports the measured floor REACHABLE (the other arm — a constant fails here)', async () => {
  const h = await spawnRig(makeSkeleton({ articulated: true, names: MIXAMO }));
  const rep = h.setFootIK({ plantBand: 0.07, groundProbe: true });
  assert.equal(rep.reachable, true, 'foot←shin←thigh is a real chain, so the measured branch can run');
  assert.equal(rep.ok, false, 'but BOTH halves are required — no probe yet, so the floor is still INFERRED');
  assert.match(rep.reason, /no-probe/, 'and it says which half is missing rather than just failing');

  h.setSurfaceProbe(() => 1);
  assert.equal(h.groundReport.ok, true, 'probe + articulated chain + the ask = the measured floor is armed');
});

test('A-CENSUS: not asking for a measured floor is not a failure (a plain foot-lock must stay quiet)', async () => {
  const h = await spawnRig(makeSkeleton({ articulated: true, names: MIXAMO }));
  const rep = h.setFootIK({ plantBand: 0.07 });      // A7-2's original call — no groundProbe
  assert.equal(rep.requested, false, 'no ask');
  assert.equal(rep.ok, false, 'and therefore not armed');
  assert.equal(rep.reason, 'not-requested', 'reported as a choice, not as a defect — the default path is legitimate');
  // The receipt must never be a hidden behaviour switch: releasing foot IK clears the ask and nothing else.
  const off = h.setFootIK(false);
  assert.equal(off.requested, false);
  assert.equal(off.frames, 0, 'no solver frames ran in this test, and the counter says so rather than guessing');
});

test('A-CENSUS: the runtime counters separate "never ran" from "ran and could not measure"', async () => {
  // WHY: `reachable` is a topology claim. A chain can be articulated and still measure degenerate, or the
  // probe can report clear everywhere. `measuredFrames` is the fact that cannot be argued with, and the
  // flat-rig signature (frames high, measuredFrames 0) is what a probe should look for.
  const h = await spawnRig(makeSkeleton({ articulated: false, names: QUAT }));
  h.setSurfaceProbe(() => 1);
  h.setFootIK({ plantBand: 0.14, groundProbe: true });
  for (let i = 0; i < 30; i++) h._applyLayers(1 / 60);
  const rep = h.groundReport;
  assert.equal(rep.frames, 30, 'the foot-IK solver DID run every frame — the feature was live, not skipped');
  assert.equal(rep.measuredFrames, 0, 'and measured the floor on none of them: inert while fully "wired"');
  assert.equal(rep.measured, false);
});
