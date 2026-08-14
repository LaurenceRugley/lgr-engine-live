/* ============================================================
   createCrowdTiers.test.mjs — A-AERIAL's `mark`, and ONE invariant above all others (Rule 9).
   ------------------------------------------------------------
   THE INVARIANT THAT MATTERS: `mark` DEFAULTS TO AN EXACT NO-OP. This repo's whole city budget and its
   byte-identical tier baselines rest on new abilities being opt-in — the reason the last three arcs
   landed without breaking `npm run tier-guard` is that each one's default was, provably, nothing. A
   comment saying "default null = no-op" is a wish (Rule 16); the check is that no geometry, no
   material and no extra child object exists on the default path, so an existing consumer cannot
   inherit a second draw call by upgrading.

   THE SECOND: a mark is a SIGNAL, so it must be unlit and exempt from the scene's tone mapping. That
   is not decoration — the measured cause of OPEN #25's first half is that the state colour is a
   DIFFUSE ALBEDO in a shadowed canyon, and a lit marker would inherit exactly the problem it exists
   to fix. Encoding it here means a future "tidy-up" that swaps in MeshStandardMaterial goes red.

   Headless: the tier-A horde is built only after `rig.ready` resolves, so a rig whose promise never
   settles exercises the construction path this test is about without needing a GLB or a GL context.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrowdTiers } from './createCrowdTiers.js';

// a rig stand-in whose ready never settles → the horde is never built, which is also the real
// "asset missing" path createCrowdTiers documents (capsules carry the whole crowd).
const pendingRig = () => ({ ready: new Promise(() => {}) });

test('DEFAULT: `mark` unset builds NO mark mesh at all — an existing consumer inherits zero new objects', () => {
  const t = createCrowdTiers({ rig: pendingRig(), size: 32 });
  const meshes = t.group.children.filter((o) => o.isInstancedMesh);
  assert.equal(meshes.length, 1, 'only tier B\'s capsule mesh exists');
  assert.equal(t.group.children.find((o) => o.name === 'crowd-marks'), undefined);
  assert.equal(t.counts.marks, 0);
});

test('OPT-IN: a `mark` block adds exactly ONE more InstancedMesh, hidden until there is an outbreak', () => {
  const t = createCrowdTiers({ rig: pendingRig(), size: 32, mark: {} });
  const marks = t.group.children.find((o) => o.name === 'crowd-marks');
  assert.ok(marks && marks.isInstancedMesh, 'one extra instanced mesh, not one object per agent');
  assert.equal(marks.count, 0);
  assert.equal(marks.visible, false, 'no outbreak, no draw call');
  assert.equal(marks.castShadow, false, 'a signal does not cast shadows');
  assert.equal(t.group.children.filter((o) => o.isInstancedMesh).length, 2, 'capsules + marks, and nothing else');
});

test('a mark is UNLIT and TONE-MAPPING-EXEMPT — the measured cure for a state colour lost in shadow', () => {
  const t = createCrowdTiers({ rig: pendingRig(), size: 8, mark: {} });
  const marks = t.group.children.find((o) => o.name === 'crowd-marks');
  assert.equal(marks.material.isMeshBasicMaterial, true, 'lit would re-inherit the canyon shadow it exists to defeat');
  assert.equal(marks.material.toneMapped, false, 'tone-mapped would re-inherit the scene exposure');
});

test('marks are sized and placed from the SIM, and only the infection states get one', () => {
  const t = createCrowdTiers({ rig: pendingRig(), size: 8, groundY: 0, capsule: { radius: 0.03, height: 0.26 }, mark: { angular: 0.01, minSize: 0.05, height: 0.35 } });
  const marks = t.group.children.find((o) => o.name === 'crowd-marks');
  const recs = [
    { id: 0, alive: true, x: 0, z: 0, vx: 0, vz: 0, state: 's', incubT: 0, incubDur: 1 },
    { id: 1, alive: true, x: 10, z: 0, vx: 0, vz: 0, state: 'i', incubT: 0, incubDur: 1 },
    { id: 2, alive: true, x: 0, z: 100, vx: 0, vz: 0, state: 'e', incubT: 0.5, incubDur: 1 },
    { id: 3, alive: false, x: 0, z: 0, vx: 0, vz: 0, state: 'i', incubT: 0, incubDur: 1 },
  ];
  const src = { max: recs.length, get: (i) => recs[i], forEach: (f) => recs.forEach((c, i) => f(i, c)) };
  t.update(1 / 60, 0, 0, 0, src);
  assert.equal(t.counts.marks, 2, 'S gets no mark and a dead agent gets no mark — the mark IS the outbreak');
  assert.equal(marks.count, 2);
  assert.equal(marks.visible, true);

  /* CONSTANT APPARENT SIZE IS THE HALF THAT DOES THE WORK AT RANGE (the ledger's A-AERIAL ablation:
     unlit alone took the wide shot from 0% to 2% legible; adding this took it to 95%). So the far
     agent's mark must be BIGGER in world space than the near one's, by the distance ratio — the
     opposite of what every other renderable in the scene does, and therefore worth pinning. */
  const scaleOf = (i) => { const m = new (marks.instanceMatrix.array.constructor)(16); for (let k = 0; k < 16; k++) m[k] = marks.instanceMatrix.array[i * 16 + k]; return Math.hypot(m[0], m[1], m[2]); };
  const near = scaleOf(0), far = scaleOf(1);
  assert.ok(far > near * 5, `the 100 u mark (${far.toFixed(3)}) dwarfs the 10 u one (${near.toFixed(3)}) — it is sized in SCREEN space`);
  assert.ok(Math.abs(far / near - 10) < 0.5, 'and the ratio is the distance ratio, not an arbitrary curve');

  /* THE FLOOR: at zero distance the mark must still exist, or an agent standing on the camera vanishes. */
  const t2 = createCrowdTiers({ rig: pendingRig(), size: 4, mark: { angular: 0.01, minSize: 0.05 } });
  const m2 = t2.group.children.find((o) => o.name === 'crowd-marks');
  const one = [{ id: 0, alive: true, x: 0, z: 0, vx: 0, vz: 0, state: 'i', incubT: 0, incubDur: 1 }];
  t2.update(1 / 60, 0, 0, 0, { max: 1, get: () => one[0], forEach: (f) => f(0, one[0]) });
  assert.ok(Math.hypot(m2.instanceMatrix.array[0], m2.instanceMatrix.array[1], m2.instanceMatrix.array[2]) >= 0.05);
});

test('the capsule pass is UNSCATHED by the mark pass — the shared scratch scale is restored', () => {
  const t = createCrowdTiers({ rig: pendingRig(), size: 4, mark: {} });
  const caps = t.group.children.find((o) => o.isInstancedMesh && o.name !== 'crowd-marks');
  const recs = [{ id: 0, alive: true, x: 3, z: 4, vx: 0, vz: 0, state: 'i', incubT: 0, incubDur: 1 }];
  const src = { max: 1, get: () => recs[0], forEach: (f) => f(0, recs[0]) };
  t.update(1 / 60, 0, 0, 0, src);   // marks run AFTER capsules and share `_s`…
  t.update(1 / 60, 0, 0, 0, src);   // …so the SECOND frame is where a leaked scale would show up
  const s = Math.hypot(caps.instanceMatrix.array[0], caps.instanceMatrix.array[1], caps.instanceMatrix.array[2]);
  assert.ok(Math.abs(s - 1) < 1e-6, `a capsule is drawn at unit scale, got ${s} — the mark pass leaked its scale`);
});
