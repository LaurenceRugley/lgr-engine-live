/* ============================================================
   @lgr/engine-core — createLattice (Lesson R, scene 8).
   ------------------------------------------------------------
   A wireframe crystal turning slowly on paper: ink edges, inked vertex nodes, a
   blueprint-cream ground. The editorial/print end of the ring — and its second BRIGHT
   scene (the ring was 5 dark / 1 bright before this lesson).

   ── THE DISTINCTNESS PROBLEM, AND WHY THIS ISN'T A RE-SKINNED CONSTELLATION ──
   Constellation is built on createEdgeField too, so the brief (rightly) demanded proof
   these two can't collapse into each other. They differ on all three axes that matter:

     STRUCTURE  Constellation is a FLAT SCATTERED CLOUD — 44 random points, edges wired to
                each node's 2 nearest neighbours (an emergent, irregular web).
                Lattice is a SOLID: the real vertices and real edges of a polyhedron,
                rotating in 3D. You read a shape, not a spray.
     BLENDING   Constellation ADDS gold light onto ink. Lattice SUBTRACTS — dark ink
                alpha-blended onto cream (edge-ink.frag: additive ink on paper would race
                to white and disappear).
     TONE       'dark' vs 'bright'. Their mean colour is at opposite ends of the range, so
                the probe's pairwise mean-RGB gate has an enormous margin, not a squeaker.

   So the two share the SEAM (createEdgeField: positions + pairs in, one draw call out) and
   nothing else — which is precisely what a good seam is for. Reuse the mechanism, not the look.

   Pack contract: { scene, camera, update(dt,elapsed), dispose(), usesBloom:false, tone:'bright' }.
   usesBloom is FALSE on purpose: bloom exists to make lights bleed, and there are no lights
   here — blooming a drawing would just fog the paper.
   Reduced motion: every animated term is f(elapsed) → the director's static frame (elapsed=0)
   is a still, fully-drawn crystal. No hot allocation in update().
   ============================================================ */
import * as THREE from 'three';
import { createEdgeField } from '../createEdgeField.js';
import edgeFlowVert from '../shaders/edge-flow.vert';
import edgeInkFrag from '../shaders/edge-ink.frag';

/* L-N re-skin defaults.
   THE PAGE IS CREAM AGAIN (L-S). In Lesson R this scene shipped a COOL BLUE page and the header
   here blamed "the dusk grade". That was half right: the ring's grade was indeed cooling the page
   — but not because it's a dusk grade. It isn't one. The director calls `sunRig.goTo(sunT)`, which
   only sets a GOAL that `sunRig.update(dt)` eases toward — and the director never calls update()
   (see createHeroDirector's L-S note). So the whole ring is graded at the core's BOOT time, t=0.5
   = NOON, whose gradeTint is #d6e6f4: cool blue. That was the cast, and no in-pack colour could
   escape it, because a gain multiply can't be cancelled by picking a different input.

   Lesson S gives packs the actual lever — an optional `filmic` grade override — so this scene now
   opts out of the ring's tint and gets the page it was designed for. */
const PAPER = new THREE.Color('#e8e0cd');   // the sheet, as authored — with a neutral grade it now READS as cream
const INK   = new THREE.Color('#16233d');   // deep drafting navy — the line
const NODE  = new THREE.Color('#8c3b2e');   // oxide red — the surveyor's mark at each vertex

/* L-S gave this scene a NEUTRAL grade so its page could finally be cream instead of the ring's cool
   noon slate. L-V DEEPENS it — the owner's word was "deeper somehow, I don't even know", so this is an
   iteration offered for judgement, not a spec I was handed.

   What "deeper" means for a DRAWING, as opposed to just "darker": a drawing has more TONAL SEPARATION —
   the ink is properly black, the page is properly light, and the mid-greys that make it look washed and
   photocopied are squeezed out. That is exactly what CONTRAST does (post-filmic.frag:162 pivots around
   mid-grey: `(col - 0.5) * uGradeContrast + 0.5`) — it pushes the ink down and the paper up at once. So:

     contrast 1.00 → 1.22   the ink goes properly dark, the page properly bright — the main move.
     tint  white → (0.96, 0.92, 0.86)   a gain slightly BELOW 1: takes the glare off the paper so it
                                        reads as a warm sheet under a lamp, not a lightbox. Also stops
                                        the raised contrast from blowing the page out to pure white.
     sat 1.00 → 0.94        pulls the oxide-red node marks back toward ink; a drafting sheet is nearly
                            monochrome, and a punchy red would read as UI, not as a survey mark.
     lift stays TRUE BLACK  lifting shadows is precisely the "washed" look we're removing.

   The grade block itself still runs (L92/L93 polish + vignette) — this only replaces its INPUTS. */
const DEEP_FILMIC = {
  tint:     new THREE.Color(0.96, 0.92, 0.86),
  lift:     new THREE.Color(0, 0, 0),
  sat:      0.94,
  contrast: 1.22,
};

export function createLattice(core, {
  detail   = 1,        // Icosahedron subdivision: 0 = 12 vertices, 1 = 42 (a proper crystal)
  radius   = 3.1,
  paper    = PAPER,    // L-N re-skin: the page
  ink      = INK,      // L-N re-skin: the edge ink
  node     = NODE,     // L-N re-skin: the vertex marks
  width    = 0.022,    // ribbon half-width — a drafting pen, not a highlighter
  flow     = 1.0,      // 0 = flat ink, 1 = the draw-on pulse travels the edges
  filmic   = DEEP_FILMIC,      // L-V: deepened grade (was L-S's neutral); pass null to take the ring's grade
} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color().copy(paper);   // clone: never capture the caller's ref

  const { x: w, y: h } = core.drawBuffer;
  const camera = new THREE.PerspectiveCamera(46, w / h, 0.1, 100);
  camera.position.set(0, 0, 10.5);
  camera.lookAt(0, 0, 0);

  const group = new THREE.Group();
  scene.add(group);

  /* ── The crystal's REAL topology ──────────────────────────────────────────────
     Take an icosahedron's triangles and harvest their unique vertices + unique edges.
     Three gives non-indexed geometry here (every triangle carries its own 3 verts), so
     the same corner appears many times — we weld by rounding the position to a key, which
     is what turns "a soup of triangles" into "a graph of nodes and struts".
     C++ anchor: building an adjacency list from a triangle soup via a spatial hash. */
  const src = new THREE.IcosahedronGeometry(radius, detail);
  const p = src.getAttribute('position');
  const keyOf = (i) => `${p.getX(i).toFixed(3)}_${p.getY(i).toFixed(3)}_${p.getZ(i).toFixed(3)}`;
  const index = new Map();          // welded key → node id
  const verts = [];                 // node id → [x,y,z]
  const idOf = (i) => {
    const k = keyOf(i);
    let id = index.get(k);
    if (id === undefined) { id = verts.length; index.set(k, id); verts.push([p.getX(i), p.getY(i), p.getZ(i)]); }
    return id;
  };
  const seen = new Set();
  const pairs = [];
  for (let t = 0; t < p.count; t += 3) {          // one triangle at a time
    const a = idOf(t), b = idOf(t + 1), c = idOf(t + 2);
    for (const [i, j] of [[a, b], [b, c], [c, a]]) {
      const k = i < j ? `${i}_${j}` : `${j}_${i}`;
      if (seen.has(k)) continue;                   // each strut is shared by 2 faces — emit once
      seen.add(k);
      pairs.push([i, j]);
    }
  }
  src.dispose();                                   // the soup was scaffolding; the graph is the scene

  const positions = new Float32Array(verts.length * 3);
  verts.forEach((v, i) => { positions[i * 3] = v[0]; positions[i * 3 + 1] = v[1]; positions[i * 3 + 2] = v[2]; });

  /* ── Edges: the shared seam, driven by an INJECTED ink material ────────────────
     createEdgeField's default material is the additive comet glow (Constellation's look).
     The seam explicitly supports injecting your own — so we hand it the blueprint ink and
     get the same one-draw-call ribbon machinery with an entirely different result. */
  const inkMat = new THREE.ShaderMaterial({
    vertexShader:   edgeFlowVert,     // untouched: it only billboards the ribbon
    fragmentShader: edgeInkFrag,
    uniforms: {
      uWidth: { value: width },       // consumed by edge-flow.vert
      uColor: { value: new THREE.Color().copy(ink) },
      uTime:  { value: 0 },
      uSpeed: { value: 0.11 },
      uDash:  { value: 1.0 },
      uFlow:  { value: flow },
    },
    transparent: true,
    blending:    THREE.NormalBlending,   // ink ON paper — additive would erase it
    depthWrite:  false,
    depthTest:   false,                  // a blueprint shows ALL struts, front and back
  });
  const edges = createEdgeField({ positions, pairs, color: ink, width, material: inkMat });
  group.add(edges.mesh);

  /* ── Vertex marks: a small inked dot at each node ──────────────────────────────
     One InstancedMesh of tiny spheres, flat-coloured (MeshBasicMaterial needs no light —
     there are no lights in this scene, by design). */
  const dotGeo = new THREE.SphereGeometry(0.075, 10, 8);
  const dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().copy(node) });
  const dots = new THREE.InstancedMesh(dotGeo, dotMat, verts.length);
  dots.frustumCulled = false;
  const _m = new THREE.Matrix4();
  for (let i = 0; i < verts.length; i++) {
    _m.makeTranslation(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    dots.setMatrixAt(i, _m);
  }
  dots.instanceMatrix.needsUpdate = true;
  group.add(dots);

  /* ── update — rotation scalars + the edge field's clock. No allocation. ───────── */
  function update(dt, elapsed) {
    group.rotation.y = elapsed * 0.16;                   // the crystal turns: you read the SOLID
    group.rotation.x = 0.28 + Math.sin(elapsed * 0.09) * 0.10;
    edges.update(elapsed);                               // drives uTime → the draw-on pulse
  }

  /* ── dispose — owns the edge field + the dot geo/material. ────────────────────── */
  function dispose() {
    edges.dispose();          // frees the injected material + the instanced geometry
    dotGeo.dispose();
    dotMat.dispose();
    group.remove(edges.mesh, dots);
    scene.remove(group);
  }

  return { scene, camera, update, dispose, usesBloom: false, tone: 'bright', filmic };
}
