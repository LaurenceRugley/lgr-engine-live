/* ============================================================
   edge-geometry.js — pure ribbon-buffer builder for createEdgeField.
   ------------------------------------------------------------
   Extracted shader-free + THREE-free so the (off-by-one-prone) buffer math can
   be node:test'd without WebGL — the same testability split as hero-ring.js.

   Given node POSITIONS (flat xyz, or Vector3-likes) and index PAIRS, it emits the
   flat typed arrays for one feathered-ribbon quad per edge: 4 verts, 2 triangles.
   Vertex layout per edge (corner c ∈ 0..3):
     c: 0=(along0,side-1) 1=(along1,side-1) 2=(along1,side+1) 3=(along0,side+1)
   Triangles: (0,1,2) + (0,2,3).

   C++ anchor: filling an interleaved vertex/index buffer for a batch of quads —
   plain index arithmetic, no GPU state.
   ============================================================ */

/* Read xyz for node i from either a flat [x,y,z,...] array or an array of
   {x,y,z} (THREE.Vector3-like). */
export function xyzAt(positions, i) {
  const p = positions[i];
  if (p && typeof p.x === 'number') return [p.x, p.y, p.z];
  const b = i * 3;
  return [positions[b], positions[b + 1], positions[b + 2]];
}

/* ============================================================
   SLICE 14 — THE UNIFIED SEAM. The old buildEdgeBuffers baked endpoints into 4 verts PER EDGE
   (non-instanced); Mission Control proved the better shape: ONE shared tessellated strip (per-vertex
   aAlong/aSide) + per-INSTANCE endpoints (aEndA/aEndB). Same vertex data reaches the shader for
   segments=1 (aAlong ∈ {0,1}, aSide ∈ {−1,+1}, endpoints per rendered vertex via instancing) — the
   hero renders IDENTICALLY — and segments=24 unlocks the graph's curved arcs. Two pure builders:
   ============================================================ */

/* buildEdgeStrip(segments) → { position, aAlong, aSide, index, vertsPerEdge } — the SHARED strip, built
   once, reused by every instance. `position` is a real (t, side01, 0) layout so Three's bounding code has
   something to chew on; both shaders derive placement from aEndA/aEndB and ignore it. */
export function buildEdgeStrip(segments = 1) {
  const s = Math.max(1, Math.floor(segments));
  const nV = (s + 1) * 2;
  const position = new Float32Array(nV * 3);
  const aAlong = new Float32Array(nV);
  const aSide = new Float32Array(nV);
  const index = new Uint32Array(s * 6);
  for (let i = 0; i <= s; i++) {
    const t = i / s;
    const v0 = i * 2, v1 = v0 + 1;
    position[v0 * 3] = t; position[v0 * 3 + 1] = 0; position[v0 * 3 + 2] = 0;
    position[v1 * 3] = t; position[v1 * 3 + 1] = 1; position[v1 * 3 + 2] = 0;
    aAlong[v0] = t; aAlong[v1] = t;
    aSide[v0] = -1; aSide[v1] = 1;
  }
  for (let i = 0; i < s; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    // (a,c,d)+(a,d,b): the same winding the graph strip shipped with (front faces toward the camera
    // after the billboard transform; flipping it culls every ribbon).
    index[i * 6] = a; index[i * 6 + 1] = c; index[i * 6 + 2] = d;
    index[i * 6 + 3] = a; index[i * 6 + 4] = d; index[i * 6 + 5] = b;
  }
  return { position, aAlong, aSide, index, vertsPerEdge: nV };
}

/* buildEdgeEndpoints({ positions, pairs }) → { aEndA, aEndB, nEdges } — PER-INSTANCE endpoint arrays
   (3 floats per EDGE, not per vertex — the instancing win: 211 edges × 24 segments share 50 verts). */
export function buildEdgeEndpoints({ positions, pairs }) {
  const nEdges = pairs.length;
  const aEndA = new Float32Array(nEdges * 3);
  const aEndB = new Float32Array(nEdges * 3);
  for (let e = 0; e < nEdges; e++) {
    const [ia, ib] = pairs[e];
    const A = xyzAt(positions, ia);
    const B = xyzAt(positions, ib);
    aEndA[e * 3] = A[0]; aEndA[e * 3 + 1] = A[1]; aEndA[e * 3 + 2] = A[2];
    aEndB[e * 3] = B[0]; aEndB[e * 3 + 1] = B[1]; aEndB[e * 3 + 2] = B[2];
  }
  return { aEndA, aEndB, nEdges };
}
