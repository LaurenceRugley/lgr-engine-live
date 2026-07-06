/* ============================================================
   agents.js — Lesson 11 (city LIFE) → Lesson 24 (it drives the REAL streets).
   ------------------------------------------------------------
   L11 gave the city motion, but the cars only RINGED the island on a rim loop — a
   carousel, not traffic. The generator (citygen.js) has always reserved STREET GAPS
   between its blocks; L24 finally makes those gaps real roads and puts vehicles ON
   them: cars that drive a segment, reach an intersection, pick a turn, and carry on.
   The backbone the city was missing — and the step toward coastlines + water life.

   STILL THEATER, WITH A SIM-READY SEAM. These cars don't plan trips. At each
   intersection a tiny ROUTER picks the next road (mostly straight, sometimes a turn).
   That router is a single injectable function — swap it for John's logistics planner
   (origin→destination A* over this same graph) and nothing else changes. Build the
   foundation to fit the ambition; don't fake a seam you'd tear out (Laurence's call).

   THREE IDEAS, EACH ITS OWN C++ ANCHOR:
   1. STREET GRAPH = nodes (intersections) + edges (road segments). The classic
      adjacency structure. C++: `struct Node { vec2 p; vector<int> edges; };` +
      `struct Edge { int a, b; };` — an adjacency LIST, not a matrix (most node pairs
      aren't connected, so we store only the few that are).
   2. ROUTE-FOLLOWING = a STATE MACHINE walking that graph. A car's state is
      (which edge, how far along, which direction). Advance a scalar `s` each frame;
      when `s` passes the edge length, you're AT a node — transition to a new edge.
      C++: exactly a hand-rolled FSM; the "transition table" is the router.
   3. MANY CARS CHEAPLY = INSTANCING. One geometry, one draw call, a per-instance
      matrix (+ colour). All cars = 1 call; all headlight pools = 1 call. Same trick
      rain/snow (weather-rig) already use. We do the path math on the CPU (trivial at
      this count) and only upload the matrices.

   ART DIRECTION (Laurence's steer): SPARSE, charming, inhabited — NOT a traffic sim.
   A handful of cars, a few biased onto the central avenues, sitting IN their lanes
   (two-way: each keeps to its own right, so opposite traffic auto-separates). The
   NIGHT is the money shot — warm headlight pools + red tail-lights streaming through
   the grid after dark, lit off the SunRig's night signal.
   ============================================================ */
import * as THREE from 'three';
import { vectorize } from './vector-style.js';
import { LAYOUT, mulberry32 } from './citygen.js';

/* A soft round glow sprite (white→transparent radial) for the night head/tail lights.
   Canvas → CanvasTexture: paint a radial gradient once, hand it to the GPU as a sprite map. */
function makeGlowTexture() {
  const s = 64, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

/* A closed ring lane (Catmull-Rom through points on a circle) — kept from L11 for the
   PEDESTRIANS, who still stroll the waterfront promenade. `getPointAt(u)` arc-length-
   remaps so equal `u` steps are equal DISTANCE (constant speed) — the L11 lesson. */
function ringLane(r, y) {
  const pts = [];
  const N = 16;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
}

/* Double-humped rush-hour curve (kept from L11): morning (~t=0.33) + evening (~t=0.75)
   peaks, a daytime plateau, a low-but-nonzero night floor. Returns 0..1 → how many
   agents are out right now, so the city quiets overnight and bustles at rush hour. */
function rushHour(t) {
  const hump = (c, w) => Math.exp(-((t - c) * (t - c)) / (2 * w * w));
  const peaks = Math.max(hump(0.33, 0.05), hump(0.75, 0.06));
  const day = THREE.MathUtils.smoothstep(t, 0.24, 0.30) * (1 - THREE.MathUtils.smoothstep(t, 0.80, 0.88));
  return THREE.MathUtils.clamp(0.15 + 0.55 * day + 0.45 * peaks, 0.12, 1.0);
}

/* ---- BUILD THE STREET GRAPH from the shared LAYOUT --------------------------------
   The blocks sit on a regular grid: block-centre g (0..N-1) is at (g-(N-1)/2)*PITCH.
   The STREETS run in the gaps — one gap-line BEFORE block 0, one BETWEEN each pair, one
   AFTER block N-1: that's N+1 lines per axis, at coord (g - N/2)*PITCH for g=0..N. The
   intersections are every (X-line, Z-line) crossing → an (N+1)×(N+1) node grid; edges
   connect orthogonally-adjacent nodes. Same math citygen used to place the blocks, so the
   roads land exactly in the reserved gaps (that's why LAYOUT is shared, not re-guessed). */
function buildGraph() {
  const { PITCH, N, PLINTH_TOP } = LAYOUT;
  const G = N + 1;                                   // 7 grid lines per axis (→ 49 nodes)
  const y = PLINTH_TOP + 0.04;                       // a hair above the street slab (PLINTH_TOP+0.02)
  const linePos = (g) => (g - N / 2) * PITCH;        // gap-line world coord for index g
  const mid = N / 2;                                 // central avenue index (3 for N=6)

  const nodes = [];                                  // {x, z, i, j, edges:[edgeIdx]}
  const idx = (i, j) => j * G + i;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    nodes.push({ x: linePos(i), z: linePos(j), i, j, edges: [] });
  }
  const edges = [];                                  // {a, b, len, main}
  const addEdge = (a, b) => {
    const main = (nodes[a].i === mid || nodes[a].j === mid) && (nodes[b].i === mid || nodes[b].j === mid);
    const e = edges.length;
    edges.push({ a, b, len: PITCH, main });          // every grid edge spans exactly PITCH
    nodes[a].edges.push(e); nodes[b].edges.push(e);
  };
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    if (i < G - 1) addEdge(idx(i, j), idx(i + 1, j)); // horizontal segment → east neighbour
    if (j < G - 1) addEdge(idx(i, j), idx(i, j + 1)); // vertical segment → north neighbour
  }
  return { nodes, edges, y, mid };
}

export function createCityLife({ plinthTop = 0.3, extent = 4.0, profile = null } = {}) {
  const group = new THREE.Group();
  const graph = buildGraph();
  const { nodes, edges } = graph;
  const ROAD_Y = graph.y;

  /* ---- ROAD MARKINGS — dashed centre-lines down every street, one InstancedMesh -----
     The citygen street slab IS the asphalt; a dashed centre-line is the cheap signal that
     reads "road" (and divides the two directions of travel). We skip a margin at each end
     so the dashes don't smear across the intersection — the gaps read as junctions. Colour
     is per-PROFILE (set in setProfile): a yellow Manhattan line, pale Paris, neon Neo-Tokyo.
     MeshBasicMaterial (unlit, fog-aware) so the stripe stays a flat road-paint colour in
     every art style; the post chain (pixel/toon) restyles the whole frame downstream. */
  const DASH = 0.30, GAP = 0.26, ENDPAD = 0.34;      // dash length / gap / clearance at each node
  let dashesPerEdge = 0;
  { const usable = LAYOUT.PITCH - ENDPAD * 2; dashesPerEdge = Math.max(1, Math.floor((usable + GAP) / (DASH + GAP))); }
  const markMat = new THREE.MeshBasicMaterial({ color: '#e8c84a', fog: true });
  const marks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.012, DASH), markMat, edges.length * dashesPerEdge);
  marks.frustumCulled = false; marks.raycast = () => {};
  marks.receiveShadow = false; marks.castShadow = false;
  group.add(marks);
  // lay the dashes once (topology never changes — only the colour does, per profile)
  {
    const d = new THREE.Object3D(); let k = 0;
    for (const e of edges) {
      const A = nodes[e.a], B = nodes[e.b];
      const dx = B.x - A.x, dz = B.z - A.z, len = Math.hypot(dx, dz);
      const ux = dx / len, uz = dz / len;             // unit direction along the edge
      const yaw = Math.atan2(ux, uz);                 // align the dash's long (Z) axis to the road
      const span = len - ENDPAD * 2;
      for (let n = 0; n < dashesPerEdge; n++) {
        const t = ENDPAD + (dashesPerEdge === 1 ? span / 2 : (span * n) / (dashesPerEdge - 1));
        d.position.set(A.x + ux * t, ROAD_Y, A.z + uz * t);
        d.rotation.set(0, yaw, 0);
        d.updateMatrix(); marks.setMatrixAt(k++, d.matrix);
      }
    }
    marks.instanceMatrix.needsUpdate = true;
  }

  /* ---- CARS — one InstancedMesh, per-instance colour + matrix ----------------------- */
  const CARS = 12;                                    // sparse theater (rush-hour scales how many are OUT)
  // Slimmed vs the L11 rim cars so a vehicle sits cleanly INSIDE the 0.55-wu street gap with a
  // right-lane offset (a fat car would mount the kerb). Long axis along local +Z (we yaw it).
  const carGeo = new THREE.BoxGeometry(0.34, 0.26, 0.74);
  // color:null → the flat-vector tier keeps each car's PER-INSTANCE colour (set via setColorAt).
  const carMat = vectorize(new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.5, metalness: 0.3 }));
  const cars = new THREE.InstancedMesh(carGeo, carMat, CARS);
  cars.castShadow = true; cars.receiveShadow = false; cars.frustumCulled = false; cars.raycast = () => {};

  /* ---- NIGHT LIGHTS — billboarded glow POINTS, lit only after dark -------------------
     A warm-white HEADLIGHT glow at each car's nose + a red TAIL-LIGHT glow at its tail.
     We draw them as a single THREE.Points cloud (2 points per car): points always face the
     camera and size-attenuate with distance — so the glow reads as a soft light from ANY
     view, and (being camera-facing sprites) it shows through the OFFICE WINDOW RTT for free,
     exactly like the L21 clouds. Additive blending sums the glow onto the night; opacity
     ramps in from dusk (off the SunRig night signal) so the grid fills with moving light —
     the charm payoff. One geometry, one draw call (instancing's cousin for point sprites).
     C++ anchor: a vertex buffer of positions+colours handed to the GPU as GL_POINTS. */
  const NPTS = CARS * 2;                              // [0..CARS) heads, [CARS..2CARS) tails
  const lightGeo = new THREE.BufferGeometry();
  const lightPos = new Float32Array(NPTS * 3);
  const lightCol = new Float32Array(NPTS * 3);
  const warm = new THREE.Color('#fff0c0'), red = new THREE.Color('#ff3528');
  for (let i = 0; i < CARS; i++) {
    warm.toArray(lightCol, i * 3);                    // heads warm white
    red.toArray(lightCol, (CARS + i) * 3);            // tails red
    lightPos[i * 3 + 1] = -50; lightPos[(CARS + i) * 3 + 1] = -50;  // parked off-screen until lit
  }
  lightGeo.setAttribute('position', new THREE.BufferAttribute(lightPos, 3));
  lightGeo.setAttribute('color', new THREE.BufferAttribute(lightCol, 3));
  const lightMat = new THREE.PointsMaterial({
    size: 0.72, sizeAttenuation: true, map: makeGlowTexture(), vertexColors: true,
    transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const lights = new THREE.Points(lightGeo, lightMat);
  lights.frustumCulled = false; lights.raycast = () => {};

  group.add(cars, lights);

  /* ---- the AGENTS — each car is a little state machine walking the graph -------------
     state: which `edge`, direction `fwd` (a→b vs b→a), distance `s` along it, plus its
     theater params (speed, colour, length, a private RNG for turn choices → reproducible). */
  const COLORS = ['#f4c430', '#c0392b', '#d8dde2', '#9aa7b4', '#6b7785', '#5a7d9a'];
  const carRng = mulberry32(0x24ACE5);                // seeds the initial scatter (deterministic)
  // Bias ~a third of the fleet onto the central avenues (the "main streets" feel busier).
  const mainEdges = edges.map((e, i) => i).filter((i) => edges[i].main);
  const cs = [];                                      // car states
  for (let i = 0; i < CARS; i++) {
    const onMain = i < Math.round(CARS * 0.35) && mainEdges.length;
    const edge = onMain ? mainEdges[(carRng() * mainEdges.length) | 0] : (carRng() * edges.length) | 0;
    const isBus = i === 1;
    cs.push({
      edge, fwd: carRng() < 0.5, s: carRng() * edges[edge].len,
      speed: isBus ? 0.5 : 0.78 + (i % 3) * 0.1,      // bus slower; slight per-car variance
      lenZ: isBus ? 1.45 : 1.0,
      color: COLORS[isBus ? 1 : i === 0 ? 0 : 2 + (i % 4)],
      rng: mulberry32(0xC0FFEE + i * 2654435761),     // private stream for this car's turns
      isBus,
      // L63 INSPECT: live world pos + heading + visible flag, written each frame so the inspection
      // lens can follow this (instanced, mesh-less) car by position alone.
      pos: new THREE.Vector3(), dirX: 0, dirZ: 1, active: false,
    });
  }
  const cCol = new THREE.Color();
  cs.forEach((c, i) => cars.setColorAt(i, cCol.set(c.color)));   // colours uploaded ONCE

  /* THE ROUTER (the sim-ready seam). Given the node we just reached and the edge we came
     in on, return the edge to take next. Default driver: mostly continue STRAIGHT (highest
     direction dot), occasionally turn — readable flowing traffic. A real game swaps this for
     destination routing over the SAME graph; the FSM below doesn't care who decides. */
  function defaultRouter(nodeIdx, fromEdge, rng) {
    const node = nodes[nodeIdx];
    const cands = node.edges.filter((e) => e !== fromEdge);
    if (cands.length === 0) return fromEdge;          // dead-end (never happens on this grid) → U-turn
    // direction we ENTERED the node travelling (unit vector toward the node)
    const fe = edges[fromEdge];
    const other = fe.a === nodeIdx ? fe.b : fe.a;
    const inx = node.x - nodes[other].x, inz = node.z - nodes[other].z;
    const il = Math.hypot(inx, inz) || 1;
    // score each candidate by how "straight ahead" it leaves the node (dot of unit dirs)
    let best = cands[0], bestDot = -2;
    for (const ce of cands) {
      const e = edges[ce];
      const dst = e.a === nodeIdx ? e.b : e.a;
      const ox = nodes[dst].x - node.x, oz = nodes[dst].z - node.z;
      const ol = Math.hypot(ox, oz) || 1;
      const dot = (inx / il) * (ox / ol) + (inz / il) * (oz / ol);
      if (dot > bestDot) { bestDot = dot; best = ce; }
    }
    // 65% keep straight; else pick any legal exit at random (a turn — keeps the grid lively)
    return rng() < 0.65 ? best : cands[(rng() * cands.length) | 0];
  }
  let router = defaultRouter;                          // injectable: cityLife.setRouter(fn)

  // scratch (zero per-frame allocation)
  const dummy = new THREE.Object3D();
  const HIDE = (im, i) => { dummy.position.set(0, -50, 0); dummy.scale.setScalar(0); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); };
  const LANE = 0.085;                                 // right-of-centre lane offset (two-way separation)
  const CAR_Y = LAYOUT.PLINTH_TOP + 0.02 + 0.13;      // rest the body ON the street slab

  /* ---- PEDESTRIANS — kept from L11: stroll the waterfront promenade (rim ring) -------- */
  const PEDS = 14;
  const peds = new THREE.InstancedMesh(
    new THREE.CapsuleGeometry(0.04, 0.10, 3, 6),
    vectorize(new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.8 })), PEDS);
  peds.castShadow = true; peds.receiveShadow = false; peds.frustumCulled = false; peds.raycast = () => {};
  const sidewalk = ringLane(extent - 0.72, plinthTop);
  const pedSpec = [];
  for (let i = 0; i < PEDS; i++) pedSpec.push({ phase: i / PEDS, speed: 0.12 + (i % 4) * 0.02, dir: i % 2 ? 1 : -1, pos: new THREE.Vector3(), active: false });
  const pPos = new THREE.Vector3(), pTan = new THREE.Vector3(), pCol = new THREE.Color();
  pedSpec.forEach((_, i) => peds.setColorAt(i, pCol.set(['#caa', '#9ab', '#bba', '#ab9'][i % 4])));
  group.add(peds);

  /* per-PROFILE road character: the centre-line paint colour. Topology is identical across
     profiles (citygen lays the same grid for all three), so only the PAINT changes here — we
     differentiate Manhattan/Paris/Neo-Tokyo by palette, honestly, not by faking a road layout
     the generator never produced. */
  const LINE_BY_PROFILE = { manhattan: '#e8c84a', paris: '#dcd2bc', neoTokyo: '#5ae8e0' };
  function setProfile(prof) { if (prof) markMat.color.set(LINE_BY_PROFILE[prof.key] || '#e8c84a'); }
  setProfile(profile);

  /* ---- the DRIVER: advance every agent along the graph each frame -------------------- */
  function update(dt, elapsed, rig) {
    const t = rig ? rig.t : 0.5;
    const night = rig ? rig.windowGlow : 0;            // ~1 at night, ~0 at noon (SunRig signal)
    const visibleCars = Math.max(2, Math.round(rushHour(t) * CARS));

    const litNight = night > 0.05;
    for (let i = 0; i < CARS; i++) {
      if (i >= visibleCars) {
        HIDE(cars, i);
        cs[i].active = false;                                          // L63: thinned-out → not followable
        lightPos[i * 3 + 1] = -50; lightPos[(CARS + i) * 3 + 1] = -50;  // douse this car's lights
        continue;
      }
      const c = cs[i];
      // ADVANCE along the current edge; cross zero-or-more nodes if we overran (small dt → ≤1).
      c.s += dt * c.speed;
      let guard = 0;
      while (c.s >= edges[c.edge].len && guard++ < 4) {
        c.s -= edges[c.edge].len;
        const node = c.fwd ? edges[c.edge].b : edges[c.edge].a;  // node we just reached
        const next = router(node, c.edge, c.rng);               // ask the router where to go
        c.edge = next;
        c.fwd = edges[next].a === node;                          // orient so we leave FROM this node
      }
      const e = edges[c.edge];
      const A = c.fwd ? nodes[e.a] : nodes[e.b];
      const B = c.fwd ? nodes[e.b] : nodes[e.a];
      const dx = B.x - A.x, dz = B.z - A.z, len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len;              // travel direction (unit)
      // perpendicular (right of travel) → keep-right lane offset so two-way traffic separates
      const px = -uz, pz = ux;
      const cx = A.x + ux * c.s + px * LANE;
      const cz = A.z + uz * c.s + pz * LANE;
      const yaw = Math.atan2(ux, uz);                  // align car's long (+Z) axis to the road

      dummy.position.set(cx, CAR_Y, cz);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, 1, c.lenZ);
      dummy.updateMatrix(); cars.setMatrixAt(i, dummy.matrix);
      c.pos.set(cx, CAR_Y, cz); c.dirX = ux; c.dirZ = uz; c.active = true;   // L63: live state for the inspect lens

      // NIGHT LIGHTS: a warm glow point at the nose, a red glow at the tail. Lifted just above
      // the bonnet so the sprite peeks over the kerb; parked off-screen by day (opacity also 0).
      const half = 0.74 * c.lenZ * 0.5;                // half the (scaled) car length
      const ly = CAR_Y + 0.06;
      const hi = i * 3, ti = (CARS + i) * 3;
      if (litNight) {
        lightPos[hi] = cx + ux * (half + 0.04); lightPos[hi + 1] = ly; lightPos[hi + 2] = cz + uz * (half + 0.04);
        lightPos[ti] = cx - ux * (half + 0.02); lightPos[ti + 1] = ly; lightPos[ti + 2] = cz - uz * (half + 0.02);
      } else {
        lightPos[hi + 1] = -50; lightPos[ti + 1] = -50;
      }
    }
    cars.instanceMatrix.needsUpdate = true;
    lightGeo.attributes.position.needsUpdate = true;
    // lights fade IN from dusk, full by deep night (so dusk reads as headlights flicking on)
    lightMat.opacity = THREE.MathUtils.clamp(night * 1.8, 0, 1);

    // PEDESTRIANS — stroll the promenade with a walking bob (unchanged L11 theater)
    const visiblePeds = Math.max(2, Math.round(rushHour(t) * PEDS));
    for (let i = 0; i < PEDS; i++) {
      if (i >= visiblePeds) { HIDE(peds, i); pedSpec[i].active = false; continue; }
      const pd = pedSpec[i];
      const u = (pd.phase + pd.dir * pd.speed * elapsed * 0.02 + 1000) % 1;
      sidewalk.getPointAt(u, pPos);
      sidewalk.getTangentAt(u, pTan);
      const bob = Math.sin(elapsed * 6 + pd.phase * 30) * 0.015;
      dummy.position.set(pPos.x, plinthTop + 0.09 + bob, pPos.z);
      dummy.rotation.set(0, Math.atan2(pTan.x * pd.dir, pTan.z * pd.dir), Math.sin(elapsed * 6 + pd.phase * 30) * 0.06);
      dummy.scale.setScalar(1);
      dummy.updateMatrix(); peds.setMatrixAt(i, dummy.matrix);
      pd.pos.set(pPos.x, plinthTop + 0.09, pPos.z); pd.active = true;       // L63: live state for the inspect lens
    }
    peds.instanceMatrix.needsUpdate = true;
  }

  /* L63 INSPECT — cars + pedestrians as followables. STABLE descriptors built once; `active` gates
     out the rush-hour-thinned agents (so the lens never offers a parked-off-screen instance).
     `info()` reads the live edge + heading so the readout tells you what the agent is doing NOW. */
  const followables = [
    ...cs.map((c, i) => ({
      kind: 'car', label: c.isBus ? 'bus' : `car ${i + 1}`,
      getWorldPos: (o) => o.copy(c.pos),
      active: () => c.active,
      info: () => `${c.isBus ? 'bus' : 'car'} · ${edges[c.edge].main ? 'main avenue' : 'side street'} → heading ${compass(c.dirX, c.dirZ)}`,
    })),
    ...pedSpec.map((pd, i) => ({
      kind: 'person', label: `person ${i + 1}`,
      getWorldPos: (o) => o.copy(pd.pos),
      active: () => pd.active,
      info: () => 'person · strolling the waterfront promenade',
    })),
  ];
  function getFollowables() { return followables; }

  return {
    group, update, setProfile, getFollowables,
    graph,                                  // {nodes, edges} — exposed for a future sim/visualiser
    setRouter(fn) { router = fn || defaultRouter; },   // the sim-ready seam (inject real routing)
  };
}

/* 8-point compass from a ground-plane heading (dx along world X, dz along world Z; +Z = North).
   atan2(dx,dz) → 0 at +Z; we round to the nearest of N/NE/E/SE/S/SW/W/NW. */
function compass(dx, dz) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[((Math.round(Math.atan2(dx, dz) / (Math.PI / 4)) % 8) + 8) % 8];
}
