/* hoard2 · player/combat.test.mjs — gun/melee resolution INTENT (Rule 9), THREE-free.
   Fakes stand in for the BUILD (castBarriers) and SIM (queryTargets / trySpendStamina) facades so the
   adapters are tested WITHOUT the engine barrel (which pulls shaders and dies under node). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCastWorld, makeCastTargets, meleeArcHits, gateMelee } from './combat.js';

test('castWorld: a dropping bullet buries in the dirt at the ground plane', () => {
  const cast = makeCastWorld(0.3, null);
  const hit = cast(0, 1, 0, 0, -1, 0);            // descends from y=1 to y=-1 through groundY=0.3
  assert.ok(hit, 'a segment crossing the ground returns a hit');
  assert.ok(Math.abs(hit.point.y - 0.3) < 1e-9, 'the hit sits on the ground plane');
  assert.deepEqual([hit.normal.x, hit.normal.y, hit.normal.z], [0, 1, 0], 'ground normal points up');
});

test('castWorld: a nearer BARRIER wins over the ground; a farther one loses', () => {
  const barrierNear = (_seg) => ({ t: 0.1, point: { x: 0, y: 0.5, z: 0.5 }, normal: { x: 0, y: 0, z: -1 }, id: 7 });
  const near = makeCastWorld(0.3, barrierNear)(0, 1, 0, 0, -1, 0);
  assert.ok(Math.abs(near.t - 0.1) < 1e-9, 'barrier at t=0.1 beats the ground at t=0.35');
  const barrierFar = (_seg) => ({ t: 0.9, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: -1 }, id: 7 });
  const far = makeCastWorld(0.3, barrierFar)(0, 1, 0, 0, -1, 0);
  assert.ok(far.t < 0.9, 'the ground (t=0.35) beats a far barrier — nearest hit wins');
});

test('castWorld: a flat segment hitting nothing returns null (a clean miss)', () => {
  const cast = makeCastWorld(0.3, null);
  assert.equal(cast(0, 1, 0, 4, 1, 0), null, 'stays above ground, no barrier → no hit');
});

test('castTargets: resolves the NEAREST zombie the segment sweeps and returns its record', () => {
  const zombies = [{ id: 2, x: 3, z: 0 }, { id: 1, x: 1, z: 0 }];   // out of order on purpose
  const cast = makeCastTargets(() => zombies, 0.45);
  const hit = cast(0, 0.8, 0, 4, 0.8, 0);
  assert.ok(hit, 'a zombie on the line is hit');
  assert.equal(hit.target.id, 1, 'the NEAREST zombie (x=1) is returned, not the far one (x=3)');
  assert.ok(hit.t > 0 && hit.t < 1, 'the hit fraction is within the segment');
});

test('castTargets: empty broadphase or an off-axis zombie → null (no phantom hits)', () => {
  assert.equal(makeCastTargets(() => [], 0.45)(0, 0.8, 0, 4, 0.8, 0), null, 'no candidates → null');
  const offAxis = makeCastTargets(() => [{ id: 9, x: 2, z: 5 }], 0.45);   // 5 units off the line ≫ radius
  assert.equal(offAxis(0, 0.8, 0, 4, 0.8, 0), null, 'a zombie the ray never reaches is not hit');
});

test('meleeArcHits: only zombies in front AND in range are struck', () => {
  const cands = [
    { id: 'front', x: 0, z: 1 },     // dead ahead (facing 0 → forward +z), in range
    { id: 'behind', x: 0, z: -1 },   // directly behind → outside the arc
    { id: 'far', x: 0, z: 5 },       // ahead but out of range
  ];
  const hits = meleeArcHits(0, 0, 0, 1.15, 0.2, cands).map((c) => c.id);
  assert.deepEqual(hits, ['front'], 'the swing hits the zombie in front and in range only');
});

test('gateMelee: a swing lands only when SIM can afford the stamina (risk = you can be caught tired)', () => {
  let spent = 0;
  const richSim = { trySpendStamina: (c) => { spent += c; return true; } };
  assert.equal(gateMelee(richSim, 34), true, 'affordable → the swing resolves');
  assert.equal(spent, 34, 'the exact cost was deducted');
  const tiredSim = { trySpendStamina: () => false };
  assert.equal(gateMelee(tiredSim, 34), false, 'too tired → the swing is REFUSED (no free melee)');
  assert.equal(gateMelee(null, 34), false, 'no sim wired yet → safe refusal, never a throw');
});
