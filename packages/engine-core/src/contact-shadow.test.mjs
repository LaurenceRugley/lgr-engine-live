/* ============================================================
   contact-shadow.test.mjs — createContactShadows CONTRACT (Rule 9: encode WHY, not "runs").
   The grounding ability is opt-in + default-inert; the invariants that MATTER and are node-testable: it
   builds ONE static InstancedMesh sized to each footprint, a dynamic pool parks unused slots OUT of view
   (so a half-full horde never leaves stray patches at the origin — the bug that a naive pool would ship),
   and it constructs headless without throwing (safe to import in a non-DOM/test env).
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createContactShadows } from './contact-shadow.js';

test('constructs headless + builds ONE static InstancedMesh sized per footprint', () => {
  const cs = createContactShadows({ groundY: 0.3, strength: 0.4, softness: 1.5 });
  cs.setStatic([{ x: 5, z: -3, r: 2 }, { x: -8, z: 1, r: 1 }, { x: 0, z: 0, r: 0 } /* r=0 → filtered */]);
  const inst = cs.group.children.find((o) => o.isInstancedMesh);
  assert.ok(inst, 'a static InstancedMesh was built');
  assert.equal(inst.count, 2, 'the r=0 footprint is filtered (only real objects get a patch)');
  assert.equal(inst.renderOrder, 1);
  assert.equal(typeof inst.raycast, 'function', 'patches are non-picking (raycast overridden)');
});

test('the dynamic pool PARKS unused slots out of view (no stray origin patches on a half-full horde)', () => {
  const cs = createContactShadows({ groundY: 0.3, dynamicPool: 4 });
  const dyn = cs.group.children.find((o) => o.isInstancedMesh);
  assert.ok(dyn && dyn.count === 4, 'a 4-slot dynamic pool exists');
  cs.updateDynamic([{ x: 2, z: 2, r: 0.5 }]);   // only 1 of 4 active
  const m = new (dyn.instanceMatrix.array.constructor)(16);
  dyn.getMatrixAt(0, { fromArray(a, o = 0) { for (let i = 0; i < 16; i++) m[i] = a[o + i]; return this; } });
  // slot 0 (active) sits near the ground; slots 1..3 (parked) are pushed far below with zero scale.
  const parked = { fromArray(a, o = 0) { this.a = a.slice(o, o + 16); return this; } };
  dyn.getMatrixAt(3, parked);
  assert.ok(parked.a[13] < -100, 'a parked slot is shoved far below the ground (Y ≪ 0)');
  assert.equal(parked.a[0], 0, 'a parked slot is zero-scaled (invisible)');
});

test('setStatic replaces the previous static mesh (rebuild is idempotent, no leak of old patches)', () => {
  const cs = createContactShadows({});
  cs.setStatic([{ x: 1, z: 1, r: 1 }, { x: 2, z: 2, r: 1 }]);
  cs.setStatic([{ x: 3, z: 3, r: 1 }]);
  const insts = cs.group.children.filter((o) => o.isInstancedMesh);
  assert.equal(insts.length, 1, 'only the latest static mesh remains');
  assert.equal(insts[0].count, 1);
});
