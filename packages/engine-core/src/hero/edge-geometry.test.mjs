/* edge-geometry.test.mjs — node:test, headless, no THREE/GPU. SLICE 14 rewrote this suite DELIBERATELY
   alongside the seam unification (the brief's contract: updated, not deleted). Rule 9: the tests encode
   why the STRIP×INSTANCE split matters — one shared strip, per-edge endpoints, hero and graph on one seam. */
import { test } from 'node:test';
import assert   from 'node:assert/strict';
import { buildEdgeStrip, buildEdgeEndpoints, xyzAt } from './edge-geometry.js';

test('xyzAt reads flat arrays AND Vector3-likes (both caller forms must not silently zero)', () => {
  assert.deepEqual(xyzAt([0, 0, 0, 1, 2, 3], 1), [1, 2, 3]);
  assert.deepEqual(xyzAt([{ x: 7, y: 8, z: 9 }], 0), [7, 8, 9]);
});

test('buildEdgeStrip(1) is the hero contract: 4 verts, 2 tris, aAlong∈{0,1}, aSide∈{-1,+1}', () => {
  // segments=1 must emit exactly the vertex data the old per-edge quad carried — that equivalence is
  // WHY the hero renders identically through the instanced rebuild.
  const s = buildEdgeStrip(1);
  assert.equal(s.vertsPerEdge, 4);
  assert.deepEqual([...s.aAlong], [0, 0, 1, 1]);
  assert.deepEqual([...s.aSide], [-1, 1, -1, 1]);
  assert.equal(s.index.length, 6);
});

test('buildEdgeStrip(24) is the graph contract: tessellation exists so sin(t·π) has vertices to bend', () => {
  // The slice-5 lesson, now encoded at the seam: a 1-segment strip evaluates the lift only where it is
  // zero — the arc needs interior vertices or the GPU draws a straight ribbon over correct math.
  const s = buildEdgeStrip(24);
  assert.equal(s.vertsPerEdge, 50);
  assert.equal(s.index.length, 24 * 6);
  assert.ok(Math.abs(s.aAlong[24] - 0.48) < 0.03, 'interior parameter values exist');
});

test('strip winding matches the shipped graph strip ((a,c,d)+(a,d,b)) — flipping it culls every ribbon', () => {
  const s = buildEdgeStrip(1);
  assert.deepEqual([...s.index], [0, 2, 3, 0, 3, 1]);
});

test('buildEdgeEndpoints: 3 floats per EDGE (per-instance — the memory win over 4-verts-per-edge)', () => {
  const { aEndA, aEndB, nEdges } = buildEdgeEndpoints({ positions: [{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }], pairs: [[0, 1]] });
  assert.equal(nEdges, 1);
  assert.deepEqual([...aEndA], [1, 2, 3]);
  assert.deepEqual([...aEndB], [4, 5, 6]);
});

test('degenerate inputs stay sane: zero pairs, self-loop pair', () => {
  assert.equal(buildEdgeEndpoints({ positions: [], pairs: [] }).nEdges, 0);
  const loop = buildEdgeEndpoints({ positions: [{ x: 1, y: 1, z: 1 }], pairs: [[0, 0]] });
  assert.deepEqual([...loop.aEndA], [...loop.aEndB], 'a self-loop is representable (zero-length ribbon), not a crash');
});
