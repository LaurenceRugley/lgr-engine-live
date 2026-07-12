/* ============================================================
   @lgr/engine-core — createConstellation (Lesson K2).
   ------------------------------------------------------------
   K2 hero scene pack: a glowing node field + animated flowing edges.
     • Nodes  — an InstancedMesh of billboarded soft-glow discs (disc-glow.*),
                per-instance size + twinkle phase. Gold on ink; bloom creams the
                brightest twinkles (the "occasional cream pulse").
     • Edges  — the engine-first createEdgeField seam (edge-flow.*): feathered
                glow ribbons with energy flowing along each edge. SAME seam
                Mission Control consumes — scene-agnostic.

   "Orbital drift, NO force sim": the whole field is one Group rotating very
   slowly about Y. Nodes + edges share the group transform, so edges stay attached
   to their nodes for free (no per-frame endpoint rebuild). update() only sets a
   rotation scalar + two uTime uniforms — no hot allocation.

   Pack contract: { scene, camera, update(dt,elapsed), dispose(), usesBloom:true }.
   Dispose owns: disc geometry + disc material + the edge field (geo + material).
   No uniform textures, no owned RTs (all procedural).
   ============================================================ */
import * as THREE from 'three';
import discGlowVert from '../shaders/disc-glow.vert';
import discGlowFrag from '../shaders/disc-glow.frag';
import { createEdgeField } from '../createEdgeField.js';

/* Tiny deterministic PRNG (mulberry32) so the constellation is identical every
   boot — the tier-guard/probe baselines depend on stable geometry. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GOLD = new THREE.Color(1.000, 0.258, 0.101);   // linear-sRGB (ACCENT.ihat) — L-N default node/edge glow
const BACKDROP = new THREE.Color(0x05040a);          // deep ink — L-N default backdrop

export function createConstellation(core, {
  count    = 44,     // node count
  seed     = 0x5eed,
  spanX    = 8.5,    // half-extent of the cloud
  spanY    = 5.0,
  spanZ    = 2.6,
  gold     = GOLD,       // L-N re-skin: node + edge glow colour (linear sRGB); default byte-identical
  backdrop = BACKDROP,   // L-N re-skin: scene background; default byte-identical
} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color().copy(backdrop);   // deep ink — glows pop (clone: don't capture caller's ref)

  const { x: w, y: h } = core.drawBuffer;
  const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 200);
  camera.position.set(0, 0, 14);
  camera.lookAt(0, 0, 0);

  /* One group holds nodes + edges and does the slow orbital rotation. */
  const group = new THREE.Group();
  scene.add(group);

  /* ── Node positions (authored / deterministic) ───────────────────────────── */
  const rng = mulberry32(seed);
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3]     = (rng() * 2 - 1) * spanX;
    pos[i * 3 + 1] = (rng() * 2 - 1) * spanY;
    pos[i * 3 + 2] = (rng() * 2 - 1) * spanZ;
  }

  /* ── Nodes: billboarded soft-glow discs (InstancedMesh) ───────────────────── */
  const discGeo = new THREE.PlaneGeometry(1, 1);
  const sizes  = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    sizes[i]  = 0.32 + rng() * 0.62;      // varied radii
    phases[i] = rng() * Math.PI * 2;
  }
  discGeo.setAttribute('aSize',  new THREE.InstancedBufferAttribute(sizes, 1));
  discGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));

  const discMat = new THREE.ShaderMaterial({
    vertexShader:   discGlowVert,
    fragmentShader: discGlowFrag,
    uniforms: { uTime: { value: 0 }, uColor: { value: gold.clone() } },
    transparent: true,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    depthTest:   false,
  });

  const nodes = new THREE.InstancedMesh(discGeo, discMat, count);
  nodes.frustumCulled = false;
  const _m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    _m.makeTranslation(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    nodes.setMatrixAt(i, _m);
  }
  nodes.instanceMatrix.needsUpdate = true;
  group.add(nodes);

  /* ── Edges: nearest-neighbour pairs (constellation graph, NO force sim) ────── */
  const pairs = [];
  const seen = new Set();
  for (let i = 0; i < count; i++) {
    // find the two nearest nodes to i
    let n1 = -1, n2 = -1, d1 = Infinity, d2 = Infinity;
    for (let j = 0; j < count; j++) {
      if (j === i) continue;
      const dx = pos[i * 3] - pos[j * 3];
      const dy = pos[i * 3 + 1] - pos[j * 3 + 1];
      const dz = pos[i * 3 + 2] - pos[j * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < d1) { d2 = d1; n2 = n1; d1 = d; n1 = j; }
      else if (d < d2) { d2 = d; n2 = j; }
    }
    for (const j of [n1, n2]) {
      if (j < 0) continue;
      const key = i < j ? `${i}_${j}` : `${j}_${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([i, j]);
    }
  }

  const edges = createEdgeField({
    positions: pos,
    pairs,
    color: gold.clone(),
    width: 0.045,
    speed: 0.28,
    dash:  2.0,
  });
  group.add(edges.mesh);

  /* ── update — rotation scalar + uTime uniforms only (no hot alloc) ────────── */
  function update(dt, elapsed) {
    group.rotation.y = elapsed * 0.06;    // very slow orbital drift
    group.rotation.x = Math.sin(elapsed * 0.04) * 0.08;
    discMat.uniforms.uTime.value = elapsed;
    edges.update(elapsed);
  }

  /* ── dispose — owns disc geo/material + the edge field ────────────────────── */
  function dispose() {
    discGeo.dispose();
    discMat.dispose();
    edges.dispose();
    group.remove(nodes, edges.mesh);
    scene.remove(group);
  }

  return { scene, camera, update, dispose, usesBloom: true, tone: 'dark' };
}
