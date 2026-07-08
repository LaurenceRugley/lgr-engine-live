/* ============================================================
   matrix-grid.js — Slice 1b: index-stable 2×2 matrix-transform grid
   ------------------------------------------------------------
   Visual proof that a 2×2 linear map takes grid points to grid points.
   M(t) = A + t*(B - A) — componentwise interpolation between two 2×2 matrices.

   WHY componentwise lerp (not SLERP or polar decomposition):
     For the LINEAR ALGEBRA lesson we MUST show real intermediate linear maps,
     not a path through "rotation + scale" space. A rotated halfway matrix is NOT
     a rotation; it's a genuine shear at t=0.5. This is the honest in-between.
     (5 effectiveness tests: FAITHFUL = no false intermediate state to unlearn.)

   mathSpec: { A: [[a,b],[c,d]], B: [[e,f],[g,h]] }
     A = start matrix (default: identity)
     B = end matrix (the transform to visualize)

   Returns { gridGroup, update(t) }
     gridGroup — a THREE.Group to add to the scene
     update(t) — call each frame with t ∈ [0,1] to morph the grid

   NO HOT ALLOC: all Float32Arrays are preallocated at creation; update() only
   mutates values. No `new Float32Array` per frame.
   ============================================================ */
import * as THREE from 'three';
import { THEME } from '../diagram-theme.js';

const { ACCENT, NEUTRAL } = THEME;

// Grid parameters: lines from -RANGE to +RANGE with step STEP.
const RANGE = 2.0;
const STEP  = 0.5;
// Number of lines per axis: 2*RANGE/STEP + 1
const N_PER_AXIS = Math.round(2 * RANGE / STEP) + 1;  // 9 for RANGE=2, STEP=0.5

// Each grid line has 2 endpoints; LineSegments pairs them as [v0,v1] per segment.
// N_PER_AXIS vertical lines + N_PER_AXIS horizontal lines, each 2 points, each 3 floats.
const GRID_VERTS  = N_PER_AXIS * 2 * 2;  // 9 lines × 2 directions × 2 verts
const ARROW_VERTS = 2 * 6;               // 2 arrows × (shaft:2 + head:4) verts

// Preallocated flat buffers (no-hot-alloc invariant)
const _gridPos  = new Float32Array(GRID_VERTS * 3);
const _arrowPos = new Float32Array(ARROW_VERTS * 3);
// Ghost (reference) grid: the untransformed identity lattice — static, never updated.
const _ghostPos = new Float32Array(GRID_VERTS * 3);

function hex2rgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
}

// buildGhostGrid: the untransformed identity lattice underlay.
// Fills _ghostPos with the raw grid points (no matrix applied), builds a faint LineSegments.
// Called once at module load time; the result never changes (ghost grid is static).
function buildGhostGrid() {
  // Vertical lines (x = const, y sweeps)
  let vi = 0;
  for (let ix = 0; ix < N_PER_AXIS; ix++) {
    const px = -RANGE + ix * STEP;
    put2(_ghostPos, vi*3, px, -RANGE); vi++;
    put2(_ghostPos, vi*3, px, +RANGE); vi++;
  }
  // Horizontal lines (y = const, x sweeps)
  for (let iy = 0; iy < N_PER_AXIS; iy++) {
    const py = -RANGE + iy * STEP;
    put2(_ghostPos, vi*3, -RANGE, py); vi++;
    put2(_ghostPos, vi*3, +RANGE, py); vi++;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(_ghostPos, 3));
  const [gr, gg, gb] = hex2rgb(ACCENT.guide);
  const col = new Float32Array(GRID_VERTS * 3);
  for (let i = 0; i < GRID_VERTS; i++) { col[i*3]=gr; col[i*3+1]=gg; col[i*3+2]=gb; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // Very faint — 0.18 opacity makes it a ghost "before" state behind the morphed grid.
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.18 }));
}

function buildGridLines() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(_gridPos, 3));

  // Color all grid segments in ACCENT.guide (muted plum).
  const [gr, gg, gb] = hex2rgb(ACCENT.guide);
  const col = new Float32Array(GRID_VERTS * 3);
  for (let i = 0; i < GRID_VERTS; i++) { col[i*3]=gr; col[i*3+1]=gg; col[i*3+2]=gb; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7 });
  return new THREE.LineSegments(geo, mat);
}

function buildArrows() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(_arrowPos, 3));

  // Colors: 6 verts for i-hat (all ihat color), 6 verts for j-hat (all jhat color)
  const col = new Float32Array(ARROW_VERTS * 3);
  const [ir, ig, ib] = hex2rgb(ACCENT.ihat);
  const [jr, jg, jb] = hex2rgb(ACCENT.jhat);
  for (let i = 0;  i < 6;  i++) { col[i*3]=ir; col[i*3+1]=ig; col[i*3+2]=ib; }
  for (let i = 6; i < 12; i++) { col[i*3]=jr; col[i*3+1]=jg; col[i*3+2]=jb; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const mat = new THREE.LineBasicMaterial({ vertexColors: true });
  return new THREE.LineSegments(geo, mat);
}

// Write a single 2D point into a Float32Array at offset (z=0).
function put2(buf, offset, x, y) { buf[offset]=x; buf[offset+1]=y; buf[offset+2]=0; }

// Compute arrowhead wedge vertices (in screen 2D).
// dir: [dx,dy] normalized. Returns two points (back-left and back-right of the tip).
const HEAD_LEN  = 0.14;
const HEAD_HALF = 0.40;  // radians ≈ 23°
function headPts(tx, ty, dx, dy) {
  // Rotate direction by ±HEAD_HALF to get arrowhead legs.
  const c1 = Math.cos(HEAD_HALF), s1 = Math.sin(HEAD_HALF);
  const c2 = Math.cos(-HEAD_HALF), s2 = Math.sin(-HEAD_HALF);
  const mx1 = -HEAD_LEN * (dx*c1 - dy*s1);
  const my1 = -HEAD_LEN * (dx*s1 + dy*c1);
  const mx2 = -HEAD_LEN * (dx*c2 - dy*s2);
  const my2 = -HEAD_LEN * (dx*s2 + dy*c2);
  return [tx+mx1, ty+my1, tx+mx2, ty+my2];
}

function updateBuffers(M) {
  // --- Grid lines ---
  // Vertical lines at x = vals, sweeping y from -RANGE to +RANGE.
  // Horizontal lines at y = vals, sweeping x from -RANGE to +RANGE.
  // Each original point p0=(px,py) → M·p0 = (M[0][0]*px+M[0][1]*py, M[1][0]*px+M[1][1]*py)
  const M00=M[0][0], M01=M[0][1], M10=M[1][0], M11=M[1][1];

  let vi = 0;
  // Vertical lines (fixed x, vary y)
  for (let ix = 0; ix < N_PER_AXIS; ix++) {
    const px = -RANGE + ix * STEP;
    // bottom endpoint
    const py0 = -RANGE;
    put2(_gridPos, vi*3, M00*px+M01*py0, M10*px+M11*py0); vi++;
    // top endpoint
    const py1 = +RANGE;
    put2(_gridPos, vi*3, M00*px+M01*py1, M10*px+M11*py1); vi++;
  }
  // Horizontal lines (fixed y, vary x)
  for (let iy = 0; iy < N_PER_AXIS; iy++) {
    const py = -RANGE + iy * STEP;
    const px0 = -RANGE;
    put2(_gridPos, vi*3, M00*px0+M01*py, M10*px0+M11*py); vi++;
    const px1 = +RANGE;
    put2(_gridPos, vi*3, M00*px1+M01*py, M10*px1+M11*py); vi++;
  }

  // --- Basis arrows ---
  // i-hat: origin → M·(1,0) = (M00, M10)
  const ix_t = M00, iy_t = M10;
  const il = Math.sqrt(ix_t*ix_t + iy_t*iy_t) || 1;
  const idx = ix_t/il, idy = iy_t/il;
  const [ih1x, ih1y, ih2x, ih2y] = headPts(ix_t, iy_t, idx, idy);

  let ai = 0;
  // shaft
  put2(_arrowPos, ai*3, 0, 0); ai++;
  put2(_arrowPos, ai*3, ix_t, iy_t); ai++;
  // arrowhead
  put2(_arrowPos, ai*3, ix_t, iy_t); ai++;
  put2(_arrowPos, ai*3, ih1x, ih1y); ai++;
  put2(_arrowPos, ai*3, ix_t, iy_t); ai++;
  put2(_arrowPos, ai*3, ih2x, ih2y); ai++;

  // j-hat: origin → M·(0,1) = (M01, M11)
  const jx_t = M01, jy_t = M11;
  const jl = Math.sqrt(jx_t*jx_t + jy_t*jy_t) || 1;
  const jdx = jx_t/jl, jdy = jy_t/jl;
  const [jh1x, jh1y, jh2x, jh2y] = headPts(jx_t, jy_t, jdx, jdy);

  put2(_arrowPos, ai*3, 0, 0); ai++;
  put2(_arrowPos, ai*3, jx_t, jy_t); ai++;
  put2(_arrowPos, ai*3, jx_t, jy_t); ai++;
  put2(_arrowPos, ai*3, jh1x, jh1y); ai++;
  put2(_arrowPos, ai*3, jx_t, jy_t); ai++;
  put2(_arrowPos, ai*3, jh2x, jh2y); ai++;
}

export function createMatrixGrid(mathSpec = {}) {
  const A = mathSpec.A ?? [[1,0],[0,1]];
  const B = mathSpec.B ?? [[1,0.5],[0,1]];

  // Precompute the difference matrix (B - A) for lerp at update time.
  const dM = [
    [B[0][0]-A[0][0], B[0][1]-A[0][1]],
    [B[1][0]-A[1][0], B[1][1]-A[1][1]],
  ];

  const ghostGrid = buildGhostGrid();   // faint static reference (before-state)
  const gridLines = buildGridLines();
  const arrows    = buildArrows();

  // Axis lines: the x and y world axes rendered on top for reference.
  // These are FIXED in world space (not transformed) — they mark the canonical axes.
  const axisGeo = new THREE.BufferGeometry();
  const axisPos = new Float32Array([ -RANGE,0,0, RANGE,0,0,  0,-RANGE,0, 0,RANGE,0 ]);
  axisGeo.setAttribute('position', new THREE.BufferAttribute(axisPos, 3));
  const [ar, ag, ab] = hex2rgb(ACCENT.axis);
  const axisCol = new Float32Array(8 * 3);
  for (let i = 0; i < 4; i++) { axisCol[i*3]=ar; axisCol[i*3+1]=ag; axisCol[i*3+2]=ab; }
  axisGeo.setAttribute('color', new THREE.BufferAttribute(axisCol, 3));
  const axisMat   = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2 });
  const axisLines = new THREE.LineSegments(axisGeo, axisMat);

  const gridGroup = new THREE.Group();
  gridGroup.add(ghostGrid);    // rendered first → sits behind the morphed grid
  gridGroup.add(axisLines);
  gridGroup.add(gridLines);
  gridGroup.add(arrows);

  // Initialize at t=0
  const _M = [[A[0][0], A[0][1]], [A[1][0], A[1][1]]];
  updateBuffers(_M);
  gridLines.geometry.attributes.position.needsUpdate = true;
  arrows.geometry.attributes.position.needsUpdate    = true;

  function update(t) {
    const tc = Math.max(0, Math.min(1, t));
    _M[0][0] = A[0][0] + tc * dM[0][0];
    _M[0][1] = A[0][1] + tc * dM[0][1];
    _M[1][0] = A[1][0] + tc * dM[1][0];
    _M[1][1] = A[1][1] + tc * dM[1][1];
    updateBuffers(_M);
    gridLines.geometry.attributes.position.needsUpdate = true;
    arrows.geometry.attributes.position.needsUpdate    = true;
  }

  return { gridGroup, update };
}
