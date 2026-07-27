/* ============================================================
   @lgr/engine-core — decal-clip (Lesson M5): the PURE geometry for projected decals.
   ------------------------------------------------------------
   Split out of createDecals.js so it is node-testable without THREE. A projected decal is a receiver's
   surface geometry CLIPPED to the box of a projector (think a slide projector throwing a bullet-hole
   image onto whatever wall is in front of it). The two hard bits live here:

     1. boxPlanes(center, right, up, fwd, half) → the 6 INWARD-facing planes of an oriented box. A point is
        inside the box iff it is on the positive side of all six (dist >= 0).
     2. clipToPlanes(polygon, planes) → SUTHERLAND–HODGMAN convex-polygon clipping: clip the polygon by
        each plane in turn, keeping the inside part and inserting new vertices where an edge crosses. A
        convex polygon clipped by a plane stays convex, so the box (6 planes) yields one convex polygon.

   Plane form: { nx, ny, nz, d }, with dist(p) = n·p + d; inside = dist >= 0.
   Vertices are plain { x, y, z } (+ the caller may carry uv separately).

   C++ anchor: Sutherland–Hodgman is the same edge-walk you'd write with a std::vector<Vec3> ping-ponged
   between input and output lists — for each edge (A,B): emit A if inside; emit the intersection if the
   edge crosses the plane. `ringPlan` below is the classic fixed-capacity ring-buffer append (overwrite
   oldest) — a decal that doesn't fit in the tail wraps to 0 so it is never split across the seam.
   ============================================================ */

// The 6 inward planes of an oriented box. right/up/fwd are unit axes; half = {x,y,z} half-extents.
export function boxPlanes(center, right, up, fwd, half) {
  const axes = [right, up, fwd], h = [half.x, half.y, half.z];
  const planes = [];
  for (let i = 0; i < 3; i++) {
    const a = axes[i], hi = h[i], ac = a.x * center.x + a.y * center.y + a.z * center.z;
    // +face: inward normal -a, dist(p) = -a·p + (a·center + h) = a·(center-p) + h
    planes.push({ nx: -a.x, ny: -a.y, nz: -a.z, d: ac + hi });
    // -face: inward normal +a, dist(p) = a·p + (-a·center + h) = a·(p-center) + h
    planes.push({ nx: a.x, ny: a.y, nz: a.z, d: -ac + hi });
  }
  return planes;
}

// Clip a convex polygon (array of {x,y,z}) by ONE plane. Keeps the inside (dist >= 0) part.
export function clipToPlane(poly, pl) {
  if (poly.length === 0) return poly;
  const out = [];
  const dist = (p) => pl.nx * p.x + pl.ny * p.y + pl.nz * p.z + pl.d;
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length];
    const da = dist(A), db = dist(B);
    const aIn = da >= 0, bIn = db >= 0;
    if (aIn) out.push(A);
    if (aIn !== bIn) {
      const t = da / (da - db);
      out.push({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t, z: A.z + (B.z - A.z) * t });
    }
  }
  return out;
}

// Clip by all planes in turn. Returns [] if the polygon is fully outside any plane.
export function clipToPlanes(poly, planes) {
  let p = poly;
  for (let i = 0; i < planes.length; i++) { p = clipToPlane(p, planes[i]); if (p.length < 3) return []; }
  return p;
}

// Plan where to append `n` vertices in a capacity-V ring so a run is never split across the seam:
// if it doesn't fit in the tail, wrap to 0 (overwriting the oldest decals). Returns the start index + the
// advanced cursor. Throws only if n itself exceeds the whole ring (a decal too big for the buffer).
export function ringPlan(cursor, n, capacity) {
  if (n > capacity) return { start: 0, next: n % capacity, overflow: true };
  const start = cursor + n <= capacity ? cursor : 0;    // wrap whole if it won't fit in the tail
  return { start, next: (start + n) % capacity, overflow: false };
}
