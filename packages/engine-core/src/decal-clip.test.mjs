// decal-clip.test.mjs — node:test of the PURE decal geometry (clipper + box planes + ring). The GPU
// batching/render is browser-verified (tools/capture-decals.mjs); here we pin the maths that MUST be exact
// (Rule 9 — WHY): a wrong clipper smears decals across surfaces; a wrong ring splits a decal at the seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxPlanes, clipToPlane, clipToPlanes, ringPlan } from './decal-clip.js';

const X = { x: 1, y: 0, z: 0 }, Y = { x: 0, y: 1, z: 0 }, Z = { x: 0, y: 0, z: 1 };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const sortPts = (ps) => ps.map((p) => [p.x, p.y, p.z]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);

test('boxPlanes: a point inside the box is on the positive side of all 6 planes', () => {
  const planes = boxPlanes({ x: 0, y: 0, z: 0 }, X, Y, Z, { x: 1, y: 1, z: 1 });   // unit cube, half 1
  const dist = (pl, p) => pl.nx * p.x + pl.ny * p.y + pl.nz * p.z + pl.d;
  for (const pl of planes) assert.ok(dist(pl, { x: 0, y: 0, z: 0 }) > 0, 'centre inside');
  // a point outside (+x) fails exactly one plane
  const outside = { x: 2, y: 0, z: 0 };
  assert.equal(planes.filter((pl) => dist(pl, outside) < 0).length, 1, 'a point just outside +x fails one plane');
});

test('clipper: a big triangle in the z=0 plane clipped by the unit box → the exact [-1,1]² square', () => {
  const planes = boxPlanes({ x: 0, y: 0, z: 0 }, X, Y, Z, { x: 1, y: 1, z: 1 });
  const bigTri = [{ x: -10, y: -10, z: 0 }, { x: 10, y: -10, z: 0 }, { x: 0, y: 10, z: 0 }];   // covers the whole face
  const poly = clipToPlanes(bigTri, planes);
  assert.equal(poly.length, 4, 'a triangle spanning the box face clips to a 4-gon');
  assert.deepEqual(sortPts(poly), [[-1, -1, 0], [-1, 1, 0], [1, -1, 0], [1, 1, 0]], 'exactly the unit square');
});

test('clipper: a triangle fully inside is unchanged; fully outside is empty', () => {
  const planes = boxPlanes({ x: 0, y: 0, z: 0 }, X, Y, Z, { x: 1, y: 1, z: 1 });
  const inside = [{ x: -0.5, y: -0.5, z: 0 }, { x: 0.5, y: -0.5, z: 0 }, { x: 0, y: 0.5, z: 0 }];
  assert.equal(clipToPlanes(inside, planes).length, 3, 'inside triangle survives whole');
  const outside = [{ x: 5, y: 5, z: 0 }, { x: 6, y: 5, z: 0 }, { x: 5, y: 6, z: 0 }];
  assert.equal(clipToPlanes(outside, planes).length, 0, 'outside triangle is culled entirely');
});

test('clipToPlane: inserts exactly the crossing vertex on a half-in edge', () => {
  const pl = { nx: 1, ny: 0, nz: 0, d: 0 };   // keep x >= 0
  const seg = [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 2, z: 0 }, { x: -1, y: 2, z: 0 }];
  const out = clipToPlane(seg, pl);
  // the two x<0 corners are replaced by two crossings at x=0
  assert.ok(out.every((p) => p.x >= -1e-9), 'nothing kept on the negative side');
  assert.ok(out.some((p) => near(p.x, 0) && near(p.y, 0)), 'crossing at (0,0) inserted');
  assert.ok(out.some((p) => near(p.x, 0) && near(p.y, 2)), 'crossing at (0,2) inserted');
});

test('ring recycling: a run never splits across the seam (wraps whole to 0)', () => {
  // capacity 10; append 4, 4 → then 4 won't fit in the 2-slot tail → wraps to 0 (overwrites oldest).
  let cur = 0;
  let r = ringPlan(cur, 4, 10); assert.equal(r.start, 0); cur = r.next; assert.equal(cur, 4);
  r = ringPlan(cur, 4, 10); assert.equal(r.start, 4); cur = r.next; assert.equal(cur, 8);
  r = ringPlan(cur, 4, 10); assert.equal(r.start, 0, 'wrapped whole rather than split at the seam'); cur = r.next; assert.equal(cur, 4);
  // a run bigger than the whole ring is flagged (a decal too big for the buffer)
  assert.equal(ringPlan(0, 12, 10).overflow, true);
});
