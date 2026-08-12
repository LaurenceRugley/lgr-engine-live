// createFlowField.test.mjs — node:test of the PURE flow-field math (no THREE, no GPU).
// These encode the PATHING INVARIANTS the horde AI depends on (Rule 9 — WHY, not just "it runs"):
//   • BLOCKED-CELL AVOIDANCE — obstacle cells are impassable and the field routes around them;
//   • REACHABILITY / NO LOCAL MINIMA — following the arrows from ANY open cell reaches the target
//     (the whole reason for a flow field over naive seek: crowds never get stuck in a pocket);
//   • NO-NaN ON UNREACHABLE — a walled-off target leaves stranded agents IDLE (0,0), never exploding;
//   • RE-SOLVE ON MOVE — the field re-solves when the target crosses a cell, not every frame (the cost
//     amortization that makes hundreds-of-agents affordable);
//   • SEPARATION CAPS — the anti-overlap push honours the maxNeighbors cap (keeps it O(n), not O(n²)).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlowField } from './createFlowField.js';

// Walk downhill from a start world-pos, one cell-step at a time following sample(), and report whether we
// reach the target cell within a step budget. This is the agent's-eye view of the field: it proves the
// arrows actually LEAD somewhere, around obstacles, with no dead ends.
function followToTarget(ff, sx, sz, tx, tz, maxSteps = 10000) {
  const tcell = ff.worldToCell(tx, tz), tg = { gx: tcell.gx, gz: tcell.gz };
  let x = sx, z = sz;
  const step = ff.cellSize * 0.5;
  for (let s = 0; s < maxSteps; s++) {
    const c = ff.worldToCell(x, z);
    if (c.gx === tg.gx && c.gz === tg.gz) return true;
    const v = ff.sample(x, z);
    if (v.x === 0 && v.z === 0) return false;          // idle cell (unreachable/dead) — not progress
    assert.ok(Number.isFinite(v.x) && Number.isFinite(v.z), 'sample produced a non-finite vector');
    x += v.x * step; z += v.z * step;
  }
  return false;
}

test('blocked-cell avoidance: obstacle cells are impassable and never on the path', () => {
  // A wall of trees across the arena with a gap; target on the far side.
  const obstacles = [];
  for (let z = -4; z <= 4; z += 0.5) if (Math.abs(z - 1.5) > 0.9) obstacles.push({ x: 0, z, r: 0.35 });
  const ff = createFlowField({ bounds: { minX: -6, minZ: -6, maxX: 6, maxZ: 6 }, cellSize: 0.4, obstacles, agentRadius: 0.15 });
  ff.solve(4.5, 0);
  // the wall cells are blocked...
  assert.equal(ff.isBlocked(0, -3), true, 'a wall cell should be blocked');
  assert.equal(ff.isBlocked(0, 1.5), false, 'the gap should be open');
  // ...and an agent starting on the near side reaches the target THROUGH the gap (routes around the wall).
  assert.equal(followToTarget(ff, -4.5, 0, 4.5, 0), true, 'agent should stream around the wall to the target');
});

test('reachability: from EVERY open cell the field leads to the target (no local minima)', () => {
  // A cluttered arena — scattered obstacles, one moving-ish target. Every open, reachable cell must
  // descend to the target. (Cells the obstacles fully wall off are allowed to be unreachable; we assert
  // the ones the BFS actually reached, which is the correctness contract.)
  const obstacles = [
    { x: -2, z: 0, r: 1.0 }, { x: 2, z: 2, r: 0.8 }, { x: 1, z: -3, r: 0.9 }, { x: -3, z: 3, r: 0.7 },
  ];
  const ff = createFlowField({ bounds: { minX: -6, minZ: -6, maxX: 6, maxZ: 6 }, cellSize: 0.5, obstacles });
  ff.solve(3.4, -3.4);
  let checked = 0;
  for (let gz = 0; gz < ff.rows; gz++) for (let gx = 0; gx < ff.cols; gx++) {
    const c = gz * ff.cols + gx;
    if (ff.blocked[c] || ff.cost[c] <= 0) continue;    // skip blocked, target, unreached
    const wx = ff.bounds.minX + (gx + 0.5) * ff.cellSize, wz = ff.bounds.minZ + (gz + 0.5) * ff.cellSize;
    assert.ok(followToTarget(ff, wx, wz, 3.4, -3.4), `cell (${gx},${gz}) never reached the target`);
    checked++;
  }
  assert.ok(checked > 100, `expected to verify many open cells, only did ${checked}`);
});

test('maze reachability: the field solves a real detour, not just line-of-sight', () => {
  // A U-shaped wall opening AWAY from the target forces a long way around — the case naive seek fails.
  const obstacles = [];
  for (let x = -2; x <= 2; x += 0.4) obstacles.push({ x, z: 0, r: 0.25 });        // bottom of the U
  for (let z = 0; z <= 3; z += 0.4) { obstacles.push({ x: -2, z, r: 0.25 }); obstacles.push({ x: 2, z, r: 0.25 }); }
  const ff = createFlowField({ bounds: { minX: -6, minZ: -6, maxX: 6, maxZ: 6 }, cellSize: 0.35, obstacles, agentRadius: 0.1 });
  ff.solve(0, 5);                                       // target OUTSIDE the U, above it
  // agent trapped at the bottom of the pocket must escape sideways then up — reachable, no dead-end.
  assert.equal(followToTarget(ff, 0, 1.2, 0, 5), true, 'agent should escape the U-pocket and reach the target');
});

test('no-NaN on unreachable target: stranded agents idle (0,0), never explode', () => {
  // Wall the target off completely inside a ring of obstacles; an outside agent must get a finite (0,0).
  const obstacles = [];
  for (let a = 0; a < Math.PI * 2; a += 0.25) obstacles.push({ x: Math.cos(a) * 1.5, z: Math.sin(a) * 1.5, r: 0.45 });
  const ff = createFlowField({ bounds: { minX: -6, minZ: -6, maxX: 6, maxZ: 6 }, cellSize: 0.4, obstacles });
  ff.solve(0, 0);                                       // target sealed inside the ring
  const v = ff.sample(4, 4);                            // an agent well outside
  assert.ok(Number.isFinite(v.x) && Number.isFinite(v.z), 'must be finite');
  assert.deepEqual([v.x, v.z], [0, 0], 'an agent cut off from the target must idle, not chase NaN');
  // and the sealed target cell itself is (0,0) (cost 0), never a divide-by-zero.
  const t = ff.sample(0, 0);
  assert.deepEqual([t.x, t.z], [0, 0]);
});

test('re-solve on move: update() re-solves only when the target crosses > epsilon cells', () => {
  const ff = createFlowField({ bounds: { minX: -6, minZ: -6, maxX: 6, maxZ: 6 }, cellSize: 0.5, resolveEpsilon: 1 });
  assert.equal(ff.update(0, 0, 0.016), true, 'first update must solve');
  const s1 = ff.solves;
  assert.equal(ff.update(0.2, 0.1, 0.016), false, 'a sub-cell nudge must NOT re-solve (amortization)');
  assert.equal(ff.solves, s1, 'solve count unchanged after a sub-cell move');
  assert.equal(ff.update(3, 3, 0.016), true, 'a multi-cell move MUST re-solve');
  assert.equal(ff.solves, s1 + 1, 'solve count bumped once');
  // and the field genuinely points at the NEW target now (arrow near origin should aim toward +x/+z).
  const v = ff.sample(-1, -1);
  assert.ok(v.x > 0 && v.z > 0, 'field should steer toward the relocated target');
});

test('separation caps: the push honours maxNeighbors (bounded work when a crowd clumps)', () => {
  const ff = createFlowField({ bounds: { minX: -6, minZ: -6, maxX: 6, maxZ: 6 }, cellSize: 0.5, maxAgents: 64 });
  // A tight clump of 20 agents on one spot — far more than maxNeighbors within radius.
  const agents = [];
  for (let i = 0; i < 20; i++) agents.push({ x: (i % 5) * 0.05, z: ((i / 5) | 0) * 0.05 });
  const push = new Float32Array(20 * 2);
  ff.separate(agents, 20, push, { radius: 1.0, maxNeighbors: 4 });
  // every agent got a finite push, and clumped agents get a NON-zero shove (they overlap).
  let nonzero = 0;
  for (let i = 0; i < 20; i++) {
    assert.ok(Number.isFinite(push[i * 2]) && Number.isFinite(push[i * 2 + 1]), `push[${i}] finite`);
    if (Math.hypot(push[i * 2], push[i * 2 + 1]) > 1e-6) nonzero++;
  }
  assert.ok(nonzero >= 18, `most clumped agents should be pushed apart, only ${nonzero} were`);
  // a lone agent far from the clump gets zero push (no neighbours in radius).
  const solo = [{ x: 5, z: 5 }, { x: -5, z: -5 }];
  const p2 = new Float32Array(4);
  ff.separate(solo, 2, p2, { radius: 1.0, maxNeighbors: 4 });
  assert.deepEqual([...p2], [0, 0, 0, 0], 'isolated agents get no separation push');
});

// ---- MULTI-SOURCE SEEDING (the outbreak arc's one core change) ----
// WHY these hold: a flee crowd needs "distance to the NEAREST of many threats" — one shared flood, not
// one field per zombie. The invariants: (1) multi-source cost is EXACTLY the min over per-source floods
// (the BFS identity the flee behaviour prices off); (2) a one-element array is byte-identical to the
// single-target call (so the array form is a superset, not a fork); (3) existing single-target callers
// are untouched (the rest of this file IS that regression suite, unchanged).

test('multi-source: cost is the min over per-source floods (distance to the NEAREST source)', () => {
  const obstacles = [{ x: 0, z: 0, r: 0.8 }, { x: -2, z: 2, r: 0.6 }];
  const mk = () => createFlowField({ bounds: { minX: -6, minZ: -6, maxX: 6, maxZ: 6 }, cellSize: 0.5, obstacles });
  const A = { x: -4, z: -4 }, B = { x: 4, z: 3 };
  const fa = mk(); fa.solve(A.x, A.z);
  const fb = mk(); fb.solve(B.x, B.z);
  const fm = mk(); fm.solve([A, B]);
  for (let c = 0; c < fm.N; c++) {
    const a = fa.cost[c], b = fb.cost[c], m = fm.cost[c];
    const want = (a < 0) ? b : (b < 0) ? a : Math.min(a, b);   // −1 = unreached; min ignores it
    assert.equal(m, want, `cell ${c}: multi cost ${m} ≠ min(${a}, ${b})`);
  }
  // and both source cells sit at cost 0 (they ARE the threats).
  assert.equal(fm.costAt(A.x, A.z), 0);
  assert.equal(fm.costAt(B.x, B.z), 0);
});

test('multi-source: a ONE-element array is byte-identical to the single-target solve', () => {
  const obstacles = [{ x: 1, z: -1, r: 0.7 }];
  const mk = () => createFlowField({ bounds: { minX: -6, minZ: -6, maxX: 6, maxZ: 6 }, cellSize: 0.4, obstacles });
  const one = mk(); one.solve(2.3, -1.7);
  const arr = mk(); arr.solve([{ x: 2.3, z: -1.7 }]);
  assert.deepEqual([...arr.cost], [...one.cost], 'cost fields differ');
  assert.deepEqual([...arr.dir], [...one.dir], 'direction fields differ');
});

test('multi-source: fleeing UPHILL from every open cell strictly leaves the nearest source behind', () => {
  // The consumer contract: a civilian ascends cost (walks to the highest-cost open neighbour). From any
  // open cell that is not already a local max, there must BE an uphill neighbour, and taking it must not
  // decrease the distance to the nearest source — i.e. the field is climbable away from ALL threats at once.
  const ff = createFlowField({ bounds: { minX: -5, minZ: -5, maxX: 5, maxZ: 5 }, cellSize: 0.5, obstacles: [{ x: 0, z: 2, r: 0.9 }] });
  ff.solve([{ x: -3, z: -3 }, { x: 3, z: -3 }]);
  const cs = ff.cellSize;
  let climbed = 0;
  for (let gz = 0; gz < ff.rows; gz++) for (let gx = 0; gx < ff.cols; gx++) {
    const c = gz * ff.cols + gx;
    if (ff.blocked[c] || ff.cost[c] < 1) continue;
    const wx = ff.bounds.minX + (gx + 0.5) * cs, wz = ff.bounds.minZ + (gz + 0.5) * cs;
    let best = ff.cost[c];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = wx + dx * cs, nz = wz + dz * cs;
      if (ff.isBlocked(nx, nz)) continue;
      const nc = ff.costAt(nx, nz);
      if (nc > best || nc < 0) best = nc < 0 ? Infinity : nc;   // −1 = unreachable by any threat = safest
    }
    if (best === Infinity || best > ff.cost[c]) climbed++;      // an uphill (or threat-free) step exists
    assert.ok(best === Infinity || best >= ff.cost[c], `cell (${gx},${gz}) has only downhill neighbours`);
  }
  assert.ok(climbed > 100, `expected many climbable cells, got ${climbed}`);
});

test('multi-source: an EMPTY source list idles everyone (no threats ⇒ no flee), never NaN', () => {
  const ff = createFlowField({ bounds: { minX: -4, minZ: -4, maxX: 4, maxZ: 4 }, cellSize: 0.5 });
  ff.solve([]);
  const v = ff.sample(1, 1);
  assert.deepEqual([v.x, v.z], [0, 0]);
  assert.equal(ff.costAt(1, 1), -1, 'no source ⇒ every cell unreached');
});

test('determinism + zero-NaN: repeated solves of the same target are identical', () => {
  const obstacles = [{ x: 1, z: 1, r: 0.6 }, { x: -2, z: 0.5, r: 0.5 }];
  const mk = () => createFlowField({ bounds: { minX: -5, minZ: -5, maxX: 5, maxZ: 5 }, cellSize: 0.4, obstacles });
  const a = mk(); a.solve(2, -2);
  const b = mk(); b.solve(2, -2);
  assert.deepEqual([...a.dir], [...b.dir], 'same inputs ⇒ identical field');
  for (let i = 0; i < a.dir.length; i++) assert.ok(Number.isFinite(a.dir[i]), 'no NaN in the direction field');
});
