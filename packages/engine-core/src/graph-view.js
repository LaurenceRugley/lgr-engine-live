/* ============================================================
   graph-view.js — createGraphView: GraphSpec + positions -> a live node/edge mesh group.
   ------------------------------------------------------------
   The engine-first ABILITY atlas (and any future GraphSpec consumer) WIRES rather than reimplements.
   VIZ SLICE 5 rebuilt both layers around one premise from the aesthetics research (design doc §8):
   NOTHING FLAT-SHADED. Every acclaimed graph/star-map renderer adds a view-dependent term; a flat disc
   and a 1px line read as a placeholder no matter how good the data is.

   THE THREE LAYERS (each one draw call, each instanced):
     EDGES  instanced camera-facing RIBBON QUADS (graph-edge.vert/.frag). This is the slice's KEYSTONE.
            LineSegments is locked to 1 device pixel — drivers ignore linewidth — which blocked Harbor
            (wants taper + width-by-weight) AND Pixel (needs >= 1 VIRTUAL pixel or edges strobe and
            vanish in motion). Ribbons unlock both, keep the §6 uniform contract, and add the arc:
            edges now bow out of the graph plane instead of reading as wiring.
     HALO   instanced additive billboards, procedural exp(-d²k) falloff, intensity driven by HEAT.
            This is what gives the engine's bloom pass a graduated signal instead of a flat disc.
     CORE   instanced billboards with an SDF circle, an inner-light term and a fake-fresnel rim.

   HEAT HAS A FLOOR (slice 4, unchanged). Heat is two things summed into one scalar:
     REST heat  — a STATIC per-node floor read from the spec's `ageDays` (recency). Recently-edited notes
                  sit permanently warm; old ones sit at exactly 0. The contribution-graph effect: the
                  graph shows you where the work IS, before you touch anything.
     LIVE heat  — a TRANSIENT pulse above that floor, driven by setHeat() (hover, or a future ops event).
   The decay relaxes toward `rest[i]`, not toward zero: heat = rest + (heat-rest)·e^(-dt/tau). That is why
   hover needs no new state — a hovered node is pushed to 1.0 and slides back to its OWN recency glow.

   CROSS-KIND GLOW (slice 5, DESIGN ruling): heat also lerps the node's colour toward warm white before the
   brightness multiply. Without it, "heat" was only ever a WITHIN-kind brightness rank: a hot terracotta
   `initiative` node stayed darker than a COLD orange `live-ops` node, because hue set the base luminance,
   so it never crossed the bloom knee. Now freshness reads across the whole graph. Capped deliberately
   (HEAT_WHITE_LERP) — push it to 1.0 and every hot node turns white, destroying the kind encoding.

   RESTRAINT (design doc): dim by default, glow by state. prefers-reduced-motion freezes the breathing
   oscillation AND parks the edge-flow band (uFlow=0) — state stays readable through colour/size alone.

   NO SCENE LIGHTS: every material is first-party GLSL. Heat/selection read as BRIGHTNESS pushed past 1.0,
   which createEngineCore's bloomPass picks up for free. That's the "glow is free" premise: no bespoke
   bloom system, just brighter pixels feeding the one the engine already owns.

   PICKING: the visible nodes are billboards now, and a billboard's geometry does not raycast (it is bent
   into place by the vertex shader). So we keep an INVISIBLE unit-sphere InstancedMesh as a pick proxy —
   three's raycaster never checks `.visible`, so it costs zero draw calls and picks exactly the disc the
   user sees (an ortho projection of a sphere of radius r IS a disc of radius r).

   NO-HOT-ALLOC (engine invariant): one scratch Matrix4/Color per view, reused every frame in update().

   C++ anchor: a VIEW over an immutable position map — it owns no positions, only presentation state
   (heat, selection, focus), the way a render adapter wraps a model it never mutates.
   ============================================================ */
import * as THREE from 'three';
import { THEME } from './diagram-theme.js';
import { heatFromAgeDays, HEAT_TAU_DAYS } from './graph-spec.js';
import { createEdgeField } from './createEdgeField.js';
import graphEdgeVert from './shaders/graph-edge.vert';
import graphEdgeFrag from './shaders/graph-edge.frag';
import graphNodeVert from './shaders/graph-node.vert';
import graphNodeFrag from './shaders/graph-node.frag';
import graphHaloFrag from './shaders/graph-halo.frag';

// kind -> theme token (fixed roles, learn once read anywhere): hub=lamplight text, live-ops=ihat warm
// orange (the alive ones), doctrine=jhat cool blue (the rules), initiative=axis terracotta (the projects).
const KIND_COLOR = {
  hub:        THEME.NEUTRAL.text,
  'live-ops': THEME.ACCENT.ihat,
  doctrine:   THEME.ACCENT.jhat,
  initiative: THEME.ACCENT.axis,
  learning:   THEME.ACCENT.guide,   // the docs/guides modules — plum, literally the "guide" accent
  ops:        THEME.ACCENT.gold,    // FACE-1 entities — the engine's GOLD, a real token since slice 14
};
const colorOfKind = (kind) => KIND_COLOR[kind] || THEME.NEUTRAL.dim;

/* PRINT palette (slice 12, the STUDIO look): the SAME hue identities re-derived as INK on paper —
   sourced from THEMES.paper so the graph fills and the DOM chrome share one derivation. */
import { THEMES } from './diagram-theme.js';
/* ACES PRE-COMPENSATION (found by LOOKING at the first studio capture): the paper inks are authored for
   the DOM, which displays them linearly — but the SCENE runs through the ACES tonemap, which crushes dark
   midtones, and the kind hues arrived at the screen as near-black blobs. The GPU-side print map lifts the
   inks so the RENDERED fill lands close to the authored ink weight. One map serves legend + renderer
   (gate N's by-value contract holds); the legend swatch reads a touch brighter than the tonemapped node,
   same hue — the honest cost of one token set feeding two transfer curves. */
const _acesLift = (hex, k = 1.9) => {
  const c = new THREE.Color(hex).multiplyScalar(k);
  c.r = Math.min(c.r, 1); c.g = Math.min(c.g, 1); c.b = Math.min(c.b, 1);
  return '#' + c.getHexString();
};
const KIND_COLOR_PRINT = {
  hub:        _acesLift(THEMES.paper.NEUTRAL.text, 1.6),   // ink — still the strongest mark on the page
  'live-ops': _acesLift(THEMES.paper.ACCENT.ihat),
  doctrine:   _acesLift(THEMES.paper.ACCENT.jhat),
  initiative: _acesLift(THEMES.paper.ACCENT.axis),
  learning:   _acesLift(THEMES.paper.ACCENT.guide),
  ops:        _acesLift(THEMES.paper.ACCENT.gold),   // gold as INK on paper (tokenized, slice 14)
};
const KIND_UNTAGGED = { glow: THEME.NEUTRAL.dim, print: _acesLift(THEMES.paper.NEUTRAL.dim, 1.7) };

/* getKindColors(mode) — the LEGEND's color source, now per RENDER MODE ('glow' = dusk, 'print' = paper).
   Returns the SAME map the renderer paints with (plus the untagged fallback), so a legend built from it
   CANNOT drift from the pixels — the anti-drift gate N asserts this in BOTH modes. Frozen. */
export function getKindColors(mode = 'glow') {
  const m = mode === 'print' ? KIND_COLOR_PRINT : KIND_COLOR;
  return Object.freeze({ ...m, untagged: KIND_UNTAGGED[mode === 'print' ? 'print' : 'glow'] });
}

const HEAT_TAU         = 0.6;   // seconds — heat's exponential decay time-constant (dt-correct, frame-rate independent)
const HEAT_SCALE_GAIN  = 0.18;  // heat=1 -> +18% radius (static, readable even under reduced-motion)
const HEAT_BREATH_GAIN = 0.10;  // heat=1 -> up to +/-10% additional oscillating radius (motion-gated)
const HEAT_COLOR_GAIN  = 0.9;   // heat=1 -> color boosted toward HDR-bright (bloom fodder)
const HEAT_WHITE_LERP  = 0.45;  // heat=1 -> 45% of the way to warm white BEFORE the multiply (cross-kind glow)
const HALO_BASE        = 0.30;  // halo intensity at heat=0 (the resting "this is an object" glow)
const HALO_HEAT_GAIN   = 1.25;  // heat=1 -> +125% halo intensity (the graduated signal bloom wants)
const BREATH_HZ        = 1.6;   // breathing frequency
const FOCUS_DIM        = 0.18;  // non-neighbor NODE brightness multiplier once something is selected
const EDGE_FOCUS_DIM   = 0.10;  // non-incident EDGE multiplier — edges outnumber nodes ~5:1, so they dim harder
const EDGE_EMPH        = 1.6;   // incident-edge EMPHASIS (slice 9): >1 brightens in the frag AND widens ~×1.45 in the vert
const SELECT_POP_S     = 0.45;  // selection pop duration (scale/brightness kick decaying to 0)

// Warm white, not pure white: pure #fff turns a hot node into a hole in the dusk-harbor palette.
const WARM_WHITE = new THREE.Color('#fff2dc');
// PRINT heat tint (slice 12): on paper, "hotter" cannot mean "brighter" (brighter = washed out) — heat
// pulls the fill toward a saturated AMBER instead. Ordering stays monotonic in warmth, probe-assertable.
const PRINT_AMBER = new THREE.Color('#b45309');
const PRINT_SHADOW = new THREE.Color('#3a2e22');   // the drop-shadow ink (halo layer re-purposed)
const PRINT_PAPER  = new THREE.Color('#c9c2b4');   // what a receding mark fades TOWARD on paper (slice 12:
                                                   // focus-dim's multiply-to-black is glow logic — ink recedes
                                                   // by FADING to the page, found by looking at the capture)

/* createGraphView(core, spec, positions, opts) -> { group, pickMesh, nodeCore, nodeHalo, edgeMesh,
     update(dt, now), setSelected(id), setHover(id), setHeat(id, v), getHeat(id), radiusOf(id),
     syncPositions(), setPickScale(k), setNodeScale(k), setMinEdgeWidth(w), setTimeQuantize(fps), dispose }

   POSITIONS ARE LIVE (slice 6): `positions` may be mutated in place by createGraphSim between frames. Node
   matrices, halos and labels hold the same object refs and follow for free; edge endpoints and the pick
   proxy hold copies, so the caller calls syncPositions() on the frames where something actually moved.

   core:      the createEngineCore handle (currently unused directly — reserved for a future bloom-aware
              tuning seam; kept in the signature per the design brief so callers don't need a v2 rewrite).
   spec:      a validated GraphSpec (validateGraphSpec should already have passed).
   positions: the Map<id,{x,y,z}> from createGraphLayout — this module reads positions, never computes them.

   opts.edgeSpeed/dashRatio/edgeOpacity: the §6 edge-flow uniform contract (dashRatio is now the traveling
              band's width along the edge — same name, softer meaning; see graph-edge.frag).
   opts.lift:        arc height as a fraction of edge length (0 = the old straight chords).
   opts.taper:       how much the ribbon narrows toward its midpoint.
   opts.edgeWidth:   base ribbon half-width in WORLD units, before per-edge weight.
   opts.haloScale:   halo radius as a multiple of the core radius.
   opts.heatTauDays: the recency time-constant for the REST-heat floor (default HEAT_TAU_DAYS = 7). A POLICY
              the project owns, not a graph fact. Nodes with no `ageDays` rest at 0.
   opts.batchDiscount: rest-heat multiplier for nodes flagged `batch: true` by the snapshot (a bulk import
              is ONE event, not N hot notes — without this a 15-file import burns a third of the graph).
              Default 0.15: a batch still warms faintly, honest but restrained. Live pulses (hover/select)
              are NOT discounted — only the resting floor. */
export function createGraphView(core, spec, positions, opts = {}) {
  const nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
  const edges = Array.isArray(spec.edges) ? spec.edges : [];
  const N = nodes.length;

  let _mode = 'glow';       // 'glow' (dusk/additive) | 'print' (paper/solid — slice 12 STUDIO)
  let _lastEdgeFloor = 0;
  let _kindColor = KIND_COLOR;
  let _heatTint = WARM_WHITE;
  let _colorFloor = 0;      // pixel-mode node luma floor (QA fix 3; 0 = off)
  let _haloHueClamp = 0;    // pixel-mode halo hue clamp (QA fix 3b; 0 = full cross-kind lerp)

  const idIndex = new Map(nodes.map((n, i) => [n.id, i]));

  const RM = (typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reducedMotion = () => !!(RM && RM.matches);

  // ---- adjacency (focus-dim: a node stays lit if it's the selection or a direct neighbor) ----
  const neighbors = new Map();   // id -> Set<id>
  for (const n of nodes) neighbors.set(n.id, new Set());
  for (const e of edges) {
    if (neighbors.has(e.from) && neighbors.has(e.to)) {
      neighbors.get(e.from).add(e.to);
      neighbors.get(e.to).add(e.from);
    }
  }

  // ---- degree (in+out) -> base scale, log-scaled (same importance metric the label layer ranks by) ----
  const degree = new Map();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) || 0) + 1);
    degree.set(e.to, (degree.get(e.to) || 0) + 1);
  }
  const baseScaleOf = (n) => 0.26 * (1 + 0.35 * Math.log2(1 + (degree.get(n.id) || 0)));

  // ---- shared per-node state ----
  const _m = new THREE.Matrix4();
  const _col = new THREE.Color();
  const baseScale = new Float32Array(N);
  const baseColor = new Array(N);   // one THREE.Color per node, computed once (kind is immutable per-view)
  const pos = new Array(N);         // cached positions for fast per-frame matrix writes

  nodes.forEach((n, i) => {
    const p = positions.get(n.id) || { x: 0, y: 0, z: 0 };
    pos[i] = p;
    baseScale[i] = baseScaleOf(n);
    baseColor[i] = new THREE.Color(_kindColor[n.kind] || KIND_UNTAGGED.glow);
  });

  // ---- NODE LAYERS: one quad geometry shared by core + halo, billboarded in the vertex shader ----
  const quadGeo = new THREE.PlaneGeometry(1, 1);

  const coreMat = new THREE.ShaderMaterial({
    vertexShader: graphNodeVert,
    fragmentShader: graphNodeFrag,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uSizeMul:  { value: 1.0 },
      uScale:    { value: opts.nodeScale ?? 1.0 },
      uRimPower: { value: 2.6 },
      uPrint:    { value: 0 },   // slice 12: 1 = flatten fresnel/inner-light (solid print fill)
      uRimGain:  { value: 0.55 },
    },
  });
  const haloMat = new THREE.ShaderMaterial({
    vertexShader: graphNodeVert,
    fragmentShader: graphHaloFrag,
    transparent: true,
    depthWrite: false,
    depthTest: false,           // halos are light, not matter — they wash over whatever passes behind
    blending: THREE.AdditiveBlending,
    uniforms: {
      uSizeMul:  { value: opts.haloScale ?? 3.2 },
      uScale:    { value: opts.nodeScale ?? 1.0 },
      uFalloff:  { value: 5.5 },
    },
  });

  const nodeCore = new THREE.InstancedMesh(quadGeo, coreMat, Math.max(N, 1));
  const nodeHalo = new THREE.InstancedMesh(quadGeo, haloMat, Math.max(N, 1));
  for (const m of [nodeCore, nodeHalo]) {
    m.count = N;                 // N may be 0 (empty spec) — never draw the padding instance max(N,1) implies
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;     // the vertex shader moves the geometry; three's bounds would cull wrongly
  }
  nodeHalo.renderOrder = 1;
  nodeCore.renderOrder = 2;

  // ---- PICK PROXY: an invisible unit sphere per node. Never drawn; raycast exactly. ----
  // Written ONCE, at the BASE radius: the hit area must not breathe with heat, or a node would dodge the
  // cursor that is warming it.
  const pickGeo = new THREE.SphereGeometry(1, 12, 8);
  const pickMat = new THREE.MeshBasicMaterial();
  const pickMesh = new THREE.InstancedMesh(pickGeo, pickMat, Math.max(N, 1));
  pickMesh.count = N;
  pickMesh.visible = false;   // three's Raycaster does not test .visible — zero draw calls, full picking

  nodes.forEach((n, i) => {
    const s = baseScale[i];
    const p = pos[i];
    _m.makeScale(s, s, s).setPosition(p.x, p.y, p.z);
    pickMesh.setMatrixAt(i, _m);
    nodeCore.setMatrixAt(i, _m);
    nodeHalo.setMatrixAt(i, _m);
    nodeCore.setColorAt(i, baseColor[i]);
    nodeHalo.setColorAt(i, baseColor[i]);
  });
  pickMesh.instanceMatrix.needsUpdate = true;

  // ---- EDGES: instanced ribbon quads. One draw call for every edge in the graph. ----
  // An edge whose endpoint has no position (a DANGLING [[link]] — the honest L08 finding) is skipped here
  // but counted; the validator already flagged it at snapshot time.
  const edgeMat = new THREE.ShaderMaterial({
    vertexShader: graphEdgeVert,
    fragmentShader: graphEdgeFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime:       { value: 0 },
      uColor:      { value: new THREE.Color(THEME.ACCENT.guide) },
      uSpeed:      { value: opts.edgeSpeed ?? 0.35 },
      uDashRatio:  { value: opts.dashRatio ?? 0.30 },
      uFlow:       { value: 1 },
      // Tuned by LOOKING (slice 5): at 0.42 opacity and a 1.3px ribbon, additive blending contributed ~0.07
      // to the frame and the edges simply were not there. Additive is unforgiving of thin + transparent —
      // the two multiply. Widen first, then brighten.
      uOpacity:    { value: opts.edgeOpacity ?? 0.62 },
      uRest:       { value: opts.edgeRest ?? 0.55 },
      uLift:       { value: opts.lift ?? 0.18 },
      uWidthScale: { value: 1.0 },
      uMinWidth:   { value: 0.0 },   // world units; the consumer raises this in pixel mode
      uTaper:      { value: opts.taper ?? 0.35 },
    },
  });

  let skippedDangling = 0;
  const edgeEnds = [];   // [fromId, toId] per DRAWN edge, in instance order (dangling edges are skipped)
  const edgeIdxA = [];   // the same, as node INDICES — syncPositions() walks these every moving frame
  const edgeIdxB = [];
  /* SLICE 14 — the UNIFIED SEAM: geometry construction moved to createEdgeField (segments: 24,
     dynamic: true, material: injected). The tessellation lesson below stays because it is why the seam
     takes a `segments` option at all.

     The ribbon's base strip: EDGE_SEGMENTS quads laid end to end along the edge's length.
       ------------------------------------------------------------------------------------
       IT MUST BE TESSELLATED, and this is the whole reason the first attempt drew straight lines. The
       vertex shader lifts each vertex by sin(t·PI). With a single 4-vertex quad, t is only ever 0 or 1 —
       and sin(0) = sin(PI) = 0. The curve was evaluated at exactly the two points where it has no
       displacement, and the rasterizer linearly interpolated a dead-straight ribbon between them. A vertex
       shader can only bend geometry it has vertices to bend.

       Caught by reading actual pixels along an edge (lit at the chord, dark at the apex). A formula check
       had "confirmed" the arc earlier — it only confirmed the arithmetic on the CPU, never that a curve
       reached the screen. Verify the rendering, not the math.

       24 segments is smooth at any zoom this atlas reaches and costs 50 verts per edge — the strip is
       shared by every instance, so this is 50 vertices TOTAL, not 50 per edge.
       uv.x runs 0->1 along the edge (the §6 `aT`); uv.y runs 0->1 across the ribbon. */
    const EDGE_W = opts.edgeWidth ?? 0.055;   // world units; ~2.4 screen px at the atlas's framing zoom
    const pairs = [], colA = [], colB = [], width = [];
    for (const e of edges) {
      const a = positions.get(e.from), b = positions.get(e.to);
      if (!a || !b) { skippedDangling++; continue; }
      edgeEnds.push(e.from, e.to);   // parallel to the instance order — focus-dim indexes into this
      edgeIdxA.push(idIndex.get(e.from));   // and the integer form, for the per-frame endpoint rewrite
      edgeIdxB.push(idIndex.get(e.to));
      pairs.push([idIndex.get(e.from), idIndex.get(e.to)]);
      const ca = baseColor[idIndex.get(e.from)];
      const cb = baseColor[idIndex.get(e.to)];
      colA.push(ca.r, ca.g, ca.b);
      colB.push(cb.r, cb.g, cb.b);
      // Width by edge weight: an unweighted edge is 1.0, so the default graph is uniform-width.
      width.push(EDGE_W * (0.7 + 0.3 * (Number.isFinite(e.weight) ? e.weight : 1)));
    }
    // THE SEAM (slice 14): one buffer-math implementation for the hero AND the graph. The graph's
    // extra per-instance attributes attach onto the seam's geometry — consumers extend, never re-implement.
    const edgeField = createEdgeField({ positions: pos, pairs, segments: 24, dynamic: true, material: edgeMat });
    const edgeGeo = edgeField.geometry;
    const E = pairs.length;
    edgeGeo.setAttribute('aColorA', new THREE.InstancedBufferAttribute(new Float32Array(colA), 3));
    edgeGeo.setAttribute('aColorB', new THREE.InstancedBufferAttribute(new Float32Array(colB), 3));
    /* Pristine copies for setEdgeColorFloor (slice 11): the floor rescales FROM these, so toggling
       pixel↔harbor is lossless (repeated floor applications would otherwise compound). */
    edgeGeo.userData.colA0 = Float32Array.from(colA);
    edgeGeo.userData.colB0 = Float32Array.from(colB);
    edgeGeo.setAttribute('aWidth',  new THREE.InstancedBufferAttribute(new Float32Array(width), 1));
    // aDim starts all-lit. Rewritten only when the selection changes — 211 floats, not a per-frame cost.
    edgeGeo.setAttribute('aDim', new THREE.InstancedBufferAttribute(new Float32Array(E).fill(1), 1));
  const edgeMesh = edgeField.mesh;   // the seam owns mesh+frustumCulled=false; we own draw order
  edgeMesh.renderOrder = 0;

  const group = new THREE.Group();
  group.add(edgeMesh);   // edges under the nodes — nodes read on top
  group.add(nodeHalo);
  group.add(nodeCore);
  group.add(pickMesh);   // invisible; here so it inherits the group's transform

  // ---- HEAT: a static recency FLOOR + a decaying pulse above it (the seam hover / live-ops drive) ----
  // rest[i] is computed ONCE from the spec's frozen `ageDays` — no clock is read here, ever.
  const heatTauDays = opts.heatTauDays ?? HEAT_TAU_DAYS;
  const batchDiscount = opts.batchDiscount ?? 0.15;
  const rest = new Float32Array(N);
  const heat = new Float32Array(N);
  nodes.forEach((n, i) => {
    rest[i] = heatFromAgeDays(n.ageDays, heatTauDays) * (n.batch ? batchDiscount : 1);
    // FACE-1 STATE (slice 13): a RED ops entity holds a high rest floor — it PULSES through the existing
    // heat/breath path (and under reduced-motion still reads by COLOR via the state tint below).
    if (n.state === 'red') rest[i] = Math.max(rest[i], 0.85);
    heat[i] = rest[i];
  });

  /* STATE TINT (slice 13, §12 "dim by default, glow by STATE" made literal): a per-node color mix applied
     AFTER the heat lerp — red burns red, stale cools grey, unknown greys out; green/working add nothing
     (the kind color + activity heat already say it). Computed once; zero per-frame cost for stateless nodes. */
  const STATE_TINT = { red: [new THREE.Color('#ff3b30'), 0.55], stale: [new THREE.Color('#6a6a72'), 0.5], unknown: [new THREE.Color('#8a8a90'), 0.6] };
  const stateTint = nodes.map((n) => (n.state && STATE_TINT[n.state]) || null);

  /* setState (slice 13) — the LIVE seam: what a future poller (or an ops event bus) calls when the world
     changes between snapshots. Updates the tint AND the red rest-floor exactly like construction did, so
     a snapshot-red and a runtime-red are indistinguishable (one mechanism, two entry points). */
  function setState(id, state) {
    const i = nodes.findIndex((n) => n.id === id);
    if (i < 0) return;
    nodes[i].state = state;
    stateTint[i] = STATE_TINT[state] || null;
    const base = heatFromAgeDays(nodes[i].ageDays, heatTauDays) * (nodes[i].batch ? batchDiscount : 1);
    rest[i] = state === 'red' ? Math.max(base, 0.85) : base;
    heat[i] = Math.max(heat[i], rest[i]);
  }

  // setHeat clamps UP to the floor: a live pulse can only ever add to what recency already says. Pushing a
  // node below its own rest heat would mean "this note is older than it is" — not a state the data can be in.
  function setHeat(id, v) {
    const i = idIndex.get(id);
    if (i == null) return;
    heat[i] = Math.max(rest[i], v);
  }
  // getHeat — the read seam (the capture probe asserts recency actually reached the renderer; without this
  // the only proof heat flowed would be "the screenshot looks warm", which is not a proof).
  function getHeat(id) {
    const i = idIndex.get(id);
    return i == null ? 0 : heat[i];
  }
  // radiusOf — the node's base radius in WORLD units. Exposed so an overlay (graph-labels) can place itself
  // clear of the sphere using the very number the sphere was scaled by. A label layer that re-derived the
  // degree→scale formula would drift the moment this one is tuned (Rule 6: don't fork the convention).
  function radiusOf(id) {
    const i = idIndex.get(id);
    return i == null ? 0 : baseScale[i];
  }

  // ---- LOOK KNOBS: the switcher drives these; the view stays look-agnostic ----
  function setNodeScale(k) { coreMat.uniforms.uScale.value = k; haloMat.uniforms.uScale.value = k; }
  /* setMinEdgeWidth(w) — world-space floor on ribbon width. THE pixel-mode anti-strobe knob: below one
     virtual pixel an edge samples in and out of existence as the camera moves, which is the single
     failure mode that kills the pixel look (and which a static screenshot cannot reveal). */
  function setMinEdgeWidth(w) { edgeMat.uniforms.uMinWidth.value = w; }
  /* setTimeQuantize(fps) — step the flow band's clock at `fps` logical frames per second (0 = smooth).
     Marching ants at ~10 fps read as authentic pixel animation; the same band at 60 fps strobes against
     the palette's colour steps. We quantize the CLOCK, not the shader, so the shader stays look-agnostic. */
  let timeQuantFps = opts.timeQuantFps ?? 0;
  function setTimeQuantize(fps) { timeQuantFps = fps || 0; }
  /* TWO LAYERS drive the edge look, multiplied (slice 8): the LOOK layer (absolute values the look
     switcher sets — pixel-mode survival knobs) × the STYLE layer (the owner's edge-preset multipliers:
     arc/straight × normal/bold). Existing setters keep their absolute semantics and write the LOOK layer;
     setEdgeStyle writes the STYLE layer; _applyEdgeUniforms derives the product. With style at identity
     (the default) the uniforms are bit-identical to slice 7 — the composition costs nothing until used. */
  let _lookWidth = 1.0, _lookRest = opts.edgeRest ?? 0.55, _lookOpacity = opts.edgeOpacity ?? 0.62;
  let _styleLift = opts.lift ?? 0.18, _styleWidthMul = 1.0, _styleRestMul = 1.0, _styleOpacityMul = 1.0;
  function _applyEdgeUniforms() {
    edgeMat.uniforms.uLift.value       = _styleLift;
    edgeMat.uniforms.uWidthScale.value = _lookWidth * _styleWidthMul;
    edgeMat.uniforms.uRest.value       = Math.min(1, _lookRest * _styleRestMul);
    edgeMat.uniforms.uOpacity.value    = Math.min(1, _lookOpacity * _styleOpacityMul);
  }
  function setEdgeWidthScale(s) { _lookWidth = s; _applyEdgeUniforms(); }
  /* setEdgeRest(r) / setEdgeOpacity(o) — the OTHER pixel-mode survival knob, and the one the motion gate
     actually caught. A palette has a first non-black step; an edge dimmer than half that step quantizes to
     pure black. Width alone does not save it — a wide black line is still black. See graph-edge.frag. */
  function setEdgeRest(r) { _lookRest = r; _applyEdgeUniforms(); }
  function setEdgeOpacity(o) { _lookOpacity = o; _applyEdgeUniforms(); }
  /* setEdgeStyle — the owner's live edge-preset seam (uniforms only, no rebuild): lift in [0..], the rest
     as multipliers over whatever the current LOOK layer says. getEdgeStyle exposes both layers + the live
     uniform products so a probe can assert a preset actually reached the GPU-bound values. */
  function setEdgeStyle({ lift, widthMul, restMul, opacityMul } = {}) {
    if (lift       != null) _styleLift       = lift;
    if (widthMul   != null) _styleWidthMul   = widthMul;
    if (restMul    != null) _styleRestMul    = restMul;
    if (opacityMul != null) _styleOpacityMul = opacityMul;
    _applyEdgeUniforms();
  }
  function getEdgeStyle() {
    return {
      lift: _styleLift, widthMul: _styleWidthMul, restMul: _styleRestMul, opacityMul: _styleOpacityMul,
      uniforms: {
        uLift: edgeMat.uniforms.uLift.value, uWidthScale: edgeMat.uniforms.uWidthScale.value,
        uRest: edgeMat.uniforms.uRest.value, uOpacity: edgeMat.uniforms.uOpacity.value,
      },
    };
  }

  /* ============================================================
     VIZ SLICE 6 — POSITIONS ARE NOW LIVE (the force sim mutates the shared Map every tick).
     ------------------------------------------------------------
     Three of our four position consumers need NOTHING: `pos[i]`, the label layer's `it.p`, and the halo all
     hold the SAME object references the sim writes through, so they follow for free. That is the whole
     payoff of "one source of truth" — no events, no copies, no invalidation protocol.

     Two consumers hold COPIES and must be re-uploaded:
       EDGE ENDPOINTS  aEndA/aEndB were baked into instanced attributes at construction (the seam's handles).
       PICK PROXY      the invisible sphere matrices.

     And they are re-uploaded ONLY when something actually moved. `sim.settled` is exact (velocities snap to
     0, alpha snaps to 0 — see graph-sim.js PITFALL 3), so a resting graph performs zero buffer writes and
     zero GPU uploads. Skipping the write is not an optimisation here; it is the thing that makes the
     hard-stop mean something. `posUploads` counts them so a probe can assert the skip actually happens.
     ============================================================ */
  const edgeA = new Int32Array(edgeIdxA);
  const edgeB = new Int32Array(edgeIdxB);
  const _fromAttr = edgeField.endA;   // the seam's dynamic endpoint handles (slice 14)
  const _toAttr = edgeField.endB;
  let pickScale = 1.0;
  let posUploads = 0;

  function syncPositions() {
    const fa = _fromAttr.array, ta = _toAttr.array;
    for (let k = 0; k < edgeA.length; k++) {
      const a = pos[edgeA[k]], b = pos[edgeB[k]];
      const o = k * 3;
      fa[o] = a.x; fa[o + 1] = a.y; fa[o + 2] = a.z;
      ta[o] = b.x; ta[o + 1] = b.y; ta[o + 2] = b.z;
    }
    edgeField.commitEndpoints();

    for (let i = 0; i < N; i++) {
      const s = baseScale[i] * pickScale;
      const p = pos[i];
      _m.makeScale(s, s, s).setPosition(p.x, p.y, p.z);
      pickMesh.setMatrixAt(i, _m);
    }
    pickMesh.instanceMatrix.needsUpdate = true;
    posUploads++;
  }

  /* setPickScale(k) — grow the invisible hit spheres. §9 wants a generous grab radius, larger on touch,
     because a fingertip is ~44px and a leaf node is ~12. The VISUAL radius is untouched: this only widens
     what the raycaster sees. */
  function setPickScale(k) {
    if (k === pickScale) return;
    pickScale = k;
    syncPositions();
  }

  // ---- SELECTION + FOCUS-DIM ----
  let selectedId = null;
  let hoverId = null;
  let selectPopT = Infinity;   // seconds since setSelected() — Infinity = settled, no pop in flight

  /* emphasisId — what the neighbourhood highlight is centred on. A CLICK locks it (selection); a HOVER
     applies it transiently when nothing is locked (§9: hover on desktop, tap-to-lock on touch). One id, so
     the node dim, the edge dim and the label hiding can never disagree about what is being emphasised. */
  const emphasisId = () => (selectedId != null ? selectedId : hoverId);

  /* Edges obey focus too. Selecting a node should make the graph QUIETER: its neighbourhood stays lit and
     everything else recedes. Dimming only the nodes left ~200 bright arcs shouting over faded spheres —
     the picture got busier exactly when the user asked it to narrow. Costs one buffer write per click. */
  function refreshEdgeDim() {
    const em = emphasisId();
    const attr = edgeGeo.getAttribute('aDim');
    const arr = attr.array;
    for (let i = 0; i < arr.length; i++) {
      if (em == null) { arr[i] = 1; continue; }
      const a = edgeEnds[i * 2], b = edgeEnds[i * 2 + 1];
      arr[i] = (a === em || b === em) ? EDGE_EMPH : EDGE_FOCUS_DIM;   // slice 9: incident edges now EMPHASIZE (brighten + widen), not merely survive
    }
    attr.needsUpdate = true;
  }

  function setSelected(id) {
    const before = emphasisId();
    selectedId = id;
    selectPopT = 0;
    if (emphasisId() !== before) refreshEdgeDim();
  }

  /* setHover(id) — the desktop neighbourhood highlight. Recomputed ONLY when the hovered node CHANGES
     (211 floats per change), never per frame: a pointer resting on a node must not cost a buffer upload
     every tick. A locked selection outranks hover, so moving the mouse cannot silently unfocus what the
     user clicked. */
  function setHover(id) {
    if (id === hoverId) return;
    const before = emphasisId();
    hoverId = id;
    if (emphasisId() !== before) refreshEdgeDim();
  }

  // ---- update(dtSeconds, nowSeconds): the ONE per-frame write. No allocation on the hot path. ----
  function update(dt, now) {
    const motion = !reducedMotion();
    const t = timeQuantFps > 0 ? Math.floor(now * timeQuantFps) / timeQuantFps : now;
    edgeMat.uniforms.uTime.value = t;
    edgeMat.uniforms.uFlow.value = motion ? 1 : 0;

    if (selectPopT < Infinity) selectPopT += dt;
    const popT = Math.min(selectPopT / SELECT_POP_S, 1);
    const em = emphasisId();
    const selIndex = selectedId != null ? idIndex.get(selectedId) : undefined;   // the POP is selection-only
    const emIndex = em != null ? idIndex.get(em) : undefined;
    const focusActive = emIndex != null;
    const inFocus = focusActive ? neighbors.get(em) : null;

    for (let i = 0; i < N; i++) {
      // Exponential relaxation toward the recency FLOOR: frame-rate independent (a multiplicative
      // e^(-dt/tau) on the EXCESS over rest, not a linear heat -= k*dt). rest=0 → the old decay-to-zero.
      if (heat[i] > rest[i]) {
        heat[i] = rest[i] + (heat[i] - rest[i]) * Math.exp(-dt / HEAT_TAU);
        if (heat[i] - rest[i] < 0.001) heat[i] = rest[i];   // settle exactly, don't asymptote forever
      }

      const isSelected = i === selIndex;
      const isEmphasis = i === emIndex;
      const selPop = isSelected ? (1 - popT) : 0;   // 1 -> 0 over SELECT_POP_S, then stays 0
      const breath = motion ? Math.sin(now * BREATH_HZ * Math.PI * 2 + i) : 0;
      const s = baseScale[i] * (1 + HEAT_SCALE_GAIN * heat[i] + HEAT_BREATH_GAIN * heat[i] * breath + 0.6 * selPop);

      const p = pos[i];
      _m.makeScale(s, s, s).setPosition(p.x, p.y, p.z);
      nodeCore.setMatrixAt(i, _m);
      if (_mode === 'print') _m.setPosition(p.x + 0.05, p.y, p.z + 0.09);   // shadow offset: down-right on screen under the iso camera
      nodeHalo.setMatrixAt(i, _m);

      const dim = (focusActive && !isEmphasis && !inFocus.has(nodes[i].id)) ? FOCUS_DIM : 1;
      // GAIN CAP (slice 10, QA fix 6): heat + selection pop could stack past the point where ACES+bloom
      // bleach the node to white — the selected node stopped reading as its KIND. The cap keeps the hot
      // ceiling below the bleach point; hue survives selection (judged by screenshot, harbor selected-state).
      const gain = Math.min(dim * (1 + HEAT_COLOR_GAIN * heat[i] + 0.8 * selPop), 2.0);

      // CROSS-KIND GLOW: bend the hue toward warm white by heat FIRST, then multiply. Hue still names the
      // kind; heat now names the freshness in a currency every kind shares — luminance.
      if (_mode === 'print' && dim < 1) {
        _col.copy(baseColor[i]).lerp(PRINT_PAPER, 0.78);   // recede toward the paper, keep a ghost of the hue
      } else {
        _col.copy(baseColor[i]).lerp(_heatTint, HEAT_WHITE_LERP * heat[i]).multiplyScalar(_mode === 'print' ? Math.min(gain, 1.15) : gain);
        if (stateTint[i]) _col.lerp(stateTint[i][0], stateTint[i][1]);   // FACE-1: state overrides mood (red = red in every look)
      }
      // COLOR FLOOR (slice 10, QA fix 3 — the uRest lesson applied to NODES): in pixel mode a focus-dimmed
      // or resting-dark node quantizes to pure #000 (DB32's darkest non-black swatch sits at luma ~0.133;
      // anything below half that rounds to black — the same palette black-hole the EDGES hit in slice 5,
      // same constant family). The floor rescales luma up while preserving hue. 0 = off (harbor).
      if (_colorFloor > 0) {
        const luma = 0.2126 * _col.r + 0.7152 * _col.g + 0.0722 * _col.b;
        if (luma > 1e-5 && luma < _colorFloor) _col.multiplyScalar(_colorFloor / luma);
      }
      nodeCore.setColorAt(i, _col);

      // The halo carries heat as INTENSITY. This is the graduated signal the bloom pass thresholds against.
      // HUE CLAMP (slice 10, QA fix 3b — the olive artifact): the halo's warm-white lerp lands additive
      // in-between hues that DB32 quantizes to olive/mustard swatches at fine grids. _haloHueClamp scales
      // the lerp away (1 = halo stays pure kind hue; intensity still carries heat). Pixel sets 1.
      // …and under the hue clamp (pixel), the BASE halo goes too: a faint grey-brown halo ring is exactly
      // what DB32 quantizes to olive crescents (the residual half of the artifact — blobs died with the
      // lerp, rims died with this). Quiet nodes get clean discs; heat/selection still glow.
      if (_mode === 'print') {
        // PRINT: the halo layer is the DROP SHADOW — fixed ink tone, normal blending; heat/selection do
        // not brighten a shadow (that would read as a glow leaking through the paper).
        _col.copy(PRINT_SHADOW);
      } else {
        _col.copy(baseColor[i]).lerp(_heatTint, HEAT_WHITE_LERP * heat[i] * (1 - _haloHueClamp))
            .multiplyScalar(dim * (HALO_BASE * (1 - _haloHueClamp) + HALO_HEAT_GAIN * heat[i] + 0.6 * selPop));
      }
      nodeHalo.setColorAt(i, _col);
    }
    nodeCore.instanceMatrix.needsUpdate = true;
    nodeHalo.instanceMatrix.needsUpdate = true;
    if (nodeCore.instanceColor) nodeCore.instanceColor.needsUpdate = true;
    if (nodeHalo.instanceColor) nodeHalo.instanceColor.needsUpdate = true;
  }

  function dispose() {
    quadGeo.dispose(); coreMat.dispose(); haloMat.dispose();
    pickGeo.dispose(); pickMat.dispose();
    edgeGeo.dispose(); edgeMat.dispose();
  }

  return {
    group, pickMesh, nodeCore, nodeHalo, edgeMesh,
    update, setSelected, setHover, setHeat, getHeat, radiusOf,
    syncPositions, setPickScale,
    setNodeScale, setMinEdgeWidth, setTimeQuantize, setEdgeWidthScale, setEdgeRest, setEdgeOpacity,
    setEdgeStyle, getEdgeStyle,
    kindColor: (kind) => _kindColor[kind] || KIND_UNTAGGED[_mode === 'print' ? 'print' : 'glow'],   // ACTIVE map (slice 12) — gate N's third witness must follow the mode
    setState,   // FACE-1 live seam (slice 13)
    setColorFloor: (v) => { _colorFloor = v; }, setHaloHueClamp: (v) => { _haloHueClamp = v; },
    /* setRenderMode (slice 12) — 'glow' | 'print'. THE TRAP this seam exists for: additive halos + bloom
       are INVISIBLE on a light background (additive toward white is a no-op), so STUDIO is a rendering-
       strategy swap, not a palette swap: halo becomes a NORMAL-blended ink drop-shadow (tighter falloff,
       smaller size), heat tints toward amber instead of white, the fresnel/inner-light flatten (uPrint),
       edges swap to normal blending, and the kind palette swaps to the paper inks. One call, reversible. */
    setRenderMode(mode) {
      _mode = mode === 'print' ? 'print' : 'glow';
      const print = _mode === 'print';
      _kindColor = print ? KIND_COLOR_PRINT : KIND_COLOR;
      _heatTint = print ? PRINT_AMBER : WARM_WHITE;
      haloMat.blending = print ? THREE.NormalBlending : THREE.AdditiveBlending;
      haloMat.uniforms.uSizeMul.value = print ? 1.35 : (opts.haloScale ?? 3.2);
      haloMat.uniforms.uFalloff.value = print ? 10.0 : 5.5;
      haloMat.needsUpdate = true;
      coreMat.uniforms.uPrint.value = print ? 1 : 0;
      edgeMat.blending = print ? THREE.NormalBlending : THREE.AdditiveBlending;
      edgeMat.needsUpdate = true;
      // Rebuild node base colors + edge gradient colors from the active palette, keeping the floor state.
      nodes.forEach((n, i) => baseColor[i].set(_kindColor[n.kind] || KIND_UNTAGGED[_mode === 'print' ? 'print' : 'glow']));
      const { colA0, colB0 } = edgeGeo.userData;
      let k = 0;
      for (let e = 0; e < edgeEnds.length / 2; e++) {
        const ca = baseColor[edgeIdxA[e]], cb = baseColor[edgeIdxB[e]];
        colA0[k] = ca.r; colB0[k] = cb.r; k++;
        colA0[k] = ca.g; colB0[k] = cb.g; k++;
        colA0[k] = ca.b; colB0[k] = cb.b; k++;
      }
      this.setEdgeColorFloor(_lastEdgeFloor);   // re-derives the live attrs from the fresh pristine copies
    },
    activeKindColors() {
      return Object.freeze({ ..._kindColor, untagged: KIND_UNTAGGED[_mode === 'print' ? 'print' : 'glow'] });
    },
    get renderMode() { return _mode; },
    /* setEdgeTaper (slice 11): taper is aesthetic in harbor but a SURVIVAL variable in pixel — at the arc
       apex the ribbon is (1-taper)x wide, and on a dark-kind edge at the flow trough that coverage loss is
       exactly what tips the additive contribution under the quantizer's black threshold. Pixel mode
       flattens the taper like it widens/brightens everything else. */
    setEdgeTaper: (v) => { edgeMat.uniforms.uTaper.value = v; },
    /* setEdgeColorFloor (slice 11) — the DB32 black-hole fix, EDGE half: a dark-kind edge (learning-plum,
       luma ~0.13) at rest (×0.78) sits under half the palette's darkest non-black swatch and quantizes to
       pure #000 between flow crests — found when the motion gate's "best edge" pick landed on a plum edge
       after the 64th node shifted the layout. Same constant family as the node floor + uRest; rescales
       from pristine copies so the toggle is lossless. 0 = off (harbor). */
    setEdgeColorFloor(floorLuma) {
      _lastEdgeFloor = floorLuma;
      const A = edgeGeo.getAttribute('aColorA'), B = edgeGeo.getAttribute('aColorB');
      const { colA0, colB0 } = edgeGeo.userData;
      for (const [attr, src] of [[A, colA0], [B, colB0]]) {
        const dst = attr.array;
        for (let i = 0; i < src.length; i += 3) {
          const luma = 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
          const k = (floorLuma > 0 && luma > 1e-5 && luma < floorLuma) ? floorLuma / luma : 1;
          dst[i] = src[i] * k; dst[i + 1] = src[i + 1] * k; dst[i + 2] = src[i + 2] * k;
        }
        attr.needsUpdate = true;
      }
    },
    dispose,
    get skippedDangling() { return skippedDangling; },
    get posUploads() { return posUploads; },   // slice 6: the probe asserts this FREEZES once the sim settles
    get emphasisId() { return emphasisId(); },
  };
}
