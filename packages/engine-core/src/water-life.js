/* ============================================================
   water-life.js — Lesson 26: WATER LIFE — boats that carve REAL wakes + marine life.
   ------------------------------------------------------------
   This is the payoff of the whole water arc. L03 built an interactive GPU wave-sim; L18 fed it
   rain; L25 gave it a real coastline + harbor. Now we put BOATS on the water — and the killer
   detail is that they don't sit on a fake animated texture: each moving boat INJECTS an impulse
   into the live wave-sim every frame, at its own position, through the EXACT same "drop" path the
   rain and the finger-poke use. The surface carries that disturbance away as the boat moves on, so
   a genuine V-WAKE trails behind it. Most city demos fake their water; ours is real, and this lesson
   is the proof.

   SAME PHILOSOPHY AS L11/L24 (city life): charming THEATER over a sim-ready seam, NOT a physics sim.
   A handful of boats on looped water lanes (reusing the curve-follow idea from the L11 rim cars), a
   few fish that breach, a rare whale, some gulls. Sparse and inhabited — 2–3 motions read as "a
   living sea," and overdoing it would look busy and cheap.

   FOUR IDEAS, EACH ITS OWN C++ ANCHOR:
   1. WAKE = IMPULSE INJECTION. Every frame we write a gaussian bump into the wave-sim height buffer
      at the boat's mapped grid cell. Identical to rain (L18) and the poke (L03) — the sim gained
      another input source for free. C++: `grid[iy][ix] += impulse;` at the boat's uv, each tick.
   2. WORLD → SIM UV. The sim is a 0..1 texture; the boat lives in world space. The visible water
      plane is `waterSize` wide, centred at the origin and laid flat (rot.x = -90°), so the mapping
      is a straight affine: u = x/size + 0.5, v = -z/size + 0.5 (the -z because that rotation sends
      world +z to the plane's -v). C++: a change-of-basis from world metres to texture coords.
   3. ROUTE-FOLLOWING. Boats walk arc-length-parameterised curves (CatmullRom loops) at constant
      speed — the L11 lesson again, on water lanes instead of roads. A light ROUTER seam picks the
      next lane when a boat finishes a lap (theater now; John's port schedule later).
   4. BILLBOARDS for marine life. Gulls + the whale's spout are THREE.Sprites — quads that auto-face
      whatever camera renders them, so they show in the city view AND the office-window RTT for free
      (the L21 cloud trick). Fish/whale bodies are tiny vectorised meshes so they restyle with the
      rest of the frame (vector/pixel/toon).
   ============================================================ */
import * as THREE from 'three';
import { vectorize } from './vector-style.js';
import { createSpriteAnim, loadSpriteSheet } from './sprite-anim.js';
// L61 v2 — the AUTHORED diffusion gull sheet (ComfyUI, pose-locked keyframes), lifted into engine-core
// so EVERY project that builds the water life inherits it (the GLB-model precedent in landmarks.js).
// `?url` emits the asset + hands back its hashed URL; the swappable seam loads it, procedural fallback
// if it's ever missing. 1024×256, cols=4 rows=1, white-on-transparent (luminance) — see the .json sidecar.
import gullDiffusionUrl from '../assets/creatures/gull_diffusion_sheet.png?url';

/* A soft round glow sprite (white→transparent) for the boats' night running lights — same recipe
   as the L24 car head/tail lights, so bow/stern glows read identically and show through the RTT. */
function makeGlowTexture() {
  const s = 64, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
/* A soft vertical spray puff for the whale spout. */
function makeSprayTexture() {
  const s = 64, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s * 0.62, 0, s / 2, s * 0.62, s * 0.5);
  g.addColorStop(0.0, 'rgba(240,250,255,0.95)');
  g.addColorStop(1.0, 'rgba(240,250,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
/* L43: a 4-FRAME gull FLAP sheet (a shallow "M" whose wings raise→lower→raise), drawn procedurally to
   one horizontal strip → CanvasTexture. WHITE on transparent so a per-instance `material.color` tints
   it into colour variants for free. The sprite-anim system windows one frame at a time (UV stepping).
   v2 seam: the diffusion/PixelKit asset-factory can REPLACE this canvas with authored detail frames /
   bit-depth tiers — the animator + wiring stay the same, only this sheet changes. */
function makeGullSheet() {
  const F = 4, s = 64, cv = document.createElement('canvas'); cv.width = s * F; cv.height = s;
  const ctx = cv.getContext('2d');
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const peak = [14, 24, 36, 24];   // wing-raise per frame: up → mid → down → mid = the flap cycle
  for (let i = 0; i < F; i++) {
    const ox = i * s, p = peak[i];
    ctx.beginPath();
    ctx.moveTo(ox + 8, 40); ctx.quadraticCurveTo(ox + 24, p, ox + 32, 36);   // left wing → body
    ctx.quadraticCurveTo(ox + 40, p, ox + 56, 40);                            // body → right wing
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

/* A closed CatmullRom loop through `n` points on a circle of radius `r` (open-water shipping lane).
   getPointAt/getTangentAt are arc-length-remapped → equal param steps are equal DISTANCE (constant
   boat speed), the L11 lesson. */
function circleLane(r, y, n = 18) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
}

/* L28: a COAST-HUGGING lane — a rounded rectangle of half-side L with corner radius rc. Its straight
   edges run parallel to (and just OUTSIDE) the island's straight coast, so boats pass NEAR the
   waterfront on the flat edges (not just the harbor); the rounded corners bulge out to clear the
   island's far corners. This is a PARALLEL-OFFSET path — the same shape as the coast, pushed seaward
   by a fixed margin. C++ anchor: offsetting a closed polyline along its normals (a Minkowski-ish
   inflate), approximated here by a fixed-radius rounded rect. */
function roundedRectLane(L, rc, y) {
  const s = L - rc, pts = [];                       // s = half-length of each straight run
  const P = (x, z) => pts.push(new THREE.Vector3(x, y, z));
  const arc = (cx, cz, a0, a1, n = 4) => { for (let i = 1; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); P(cx + Math.cos(a) * rc, cz + Math.sin(a) * rc); } };
  const ES = 4;                                     // sample points per straight edge
  for (let i = 0; i < ES; i++) P(L, -s + (2 * s * i) / ES);   // +X edge, z: -s → +s
  arc(s, s, 0, Math.PI / 2);                        // +X+Z corner
  for (let i = 0; i < ES; i++) P(s - (2 * s * i) / ES, L);    // +Z edge, x: +s → -s
  arc(-s, s, Math.PI / 2, Math.PI);                 // -X+Z corner
  for (let i = 0; i < ES; i++) P(-L, s - (2 * s * i) / ES);   // -X edge, z: +s → -s
  arc(-s, -s, Math.PI, 1.5 * Math.PI);              // -X-Z corner
  for (let i = 0; i < ES; i++) P(-s + (2 * s * i) / ES, -L);  // -Z edge, x: -s → +s
  arc(s, -s, 1.5 * Math.PI, 2 * Math.PI);           // +X-Z corner
  return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
}

export function createWaterLife({ extent = 8, waterSize = 28, plinthTop = 0.3 } = {}) {
  const group = new THREE.Group();
  group.raycast = () => {};                       // never block the water-poke raycast

  const WATER_Y = 0.06;                           // boats float just above the flat waterline (y≈0)
  // world (x,z) → sim texture uv (see anchor #2). One scratch vec3 reused, zero per-frame alloc.
  const uvOf = (x, z, out) => out.set(x / waterSize + 0.5, -z / waterSize + 0.5, 0);

  /* ---- WATER LANES — the boats' looped routes. The island's straight coast sits at ~8.8 wu on the
     edges and its base-square CORNERS reach ~11.4 wu. L28: lane 0 is now a COAST-HUGGING rounded rect
     (straight edges at 9.5 → boats skim the waterfront on the flat sides; corners bulge to ~12.2 to
     clear the island corners). Lane 1 stays a wide open-water ring; lane 2 is the harbor ferry. ---- */
  const LANES = [
    roundedRectLane(9.5, 3.0, WATER_Y),           // 0: coast-hugging lane (skims the straight shore)
    circleLane(12.7, WATER_Y),                    // 1: outer open-water ring
    // 2: harbor ferry loop — a small loop in the +X open water that dips to the harbor mouth (x≈8.4,z≈0)
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(8.4, WATER_Y, 0),
      new THREE.Vector3(11.0, WATER_Y, -3.6),
      new THREE.Vector3(13.0, WATER_Y, 0),
      new THREE.Vector3(11.0, WATER_Y, 3.6),
    ], true, 'catmullrom', 0.5),
  ];
  const LANE_LEN = LANES.map((c) => c.getLength());

  /* ---- BOATS — a small flotilla. Each is a tiny Group (hull + cabin), vectorised so it adopts the
     flat-vector / pixel / toon styles like everything else. Few enough (4) that per-boat Groups are
     simpler + more flexible than instancing (we want a wake, lights, and a bob per boat). --------- */
  function makeBoat({ scale = 1, hull = '#6b7785', cabin = '#e7ecf2' }) {
    const g = new THREE.Group();
    const hullMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.46 * scale, 0.2 * scale, 1.1 * scale),
      vectorize(new THREE.MeshStandardMaterial({ color: hull, roughness: 0.6, metalness: 0.2, flatShading: true }), { color: hull }),
    );
    hullMesh.position.y = 0.02;
    const cabinMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.3 * scale, 0.22 * scale, 0.42 * scale),
      vectorize(new THREE.MeshStandardMaterial({ color: cabin, roughness: 0.7, flatShading: true }), { color: cabin }),
    );
    cabinMesh.position.set(0, 0.18 * scale, 0.08 * scale);
    g.add(hullMesh, cabinMesh);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } o.raycast = () => {}; });
    g.userData.halfLen = 0.55 * scale;            // half the hull length → place the wake at the stern
    return g;
  }

  // boat states: lane index, arc-length param u, direction, speed, a wake-strength, plus a private
  // phase so the bobbing + light flicker don't move in lock-step.
  const BOATS = [
    { laneIndex: 0, dir: +1, speed: 0.50, wake: 0.024, scale: 1.0, hull: '#5a6675', cabin: '#e7ecf2' },
    { laneIndex: 1, dir: -1, speed: 0.42, wake: 0.022, scale: 1.0, hull: '#7a5b46', cabin: '#d9c3a6' },
    { laneIndex: 0, dir: +1, speed: 0.56, wake: 0.024, scale: 0.9, hull: '#456079', cabin: '#cfe0ee' },
    { laneIndex: 2, dir: +1, speed: 0.34, wake: 0.030, scale: 1.35, hull: '#39505f', cabin: '#e2b85a' }, // the harbor ferry (bigger, slower)
  ];
  BOATS.forEach((b, i) => {
    b.mesh = makeBoat(b);
    b.u = (i * 0.27) % 1;                          // stagger their starting positions
    b.phase = i * 1.7;
    b.isFerry = b.laneIndex === 2;
    group.add(b.mesh);
  });

  /* ---- NIGHT RUNNING LIGHTS — a warm BOW glow + a red STERN glow per boat, drawn as ONE Points
     cloud (2 points per boat), additive, camera-facing — identical tech to the L24 car lights, so
     they read from any angle AND through the office-window RTT. Off by day, ramped in from dusk. -- */
  const NB = BOATS.length, NPTS = NB * 2;          // [0..NB) bows (warm), [NB..2NB) sterns (red)
  const lightGeo = new THREE.BufferGeometry();
  const lightPos = new Float32Array(NPTS * 3).fill(-50);
  const lightCol = new Float32Array(NPTS * 3);
  const warm = new THREE.Color('#fff0c0'), red = new THREE.Color('#ff3528');
  for (let i = 0; i < NB; i++) { warm.toArray(lightCol, i * 3); red.toArray(lightCol, (NB + i) * 3); }
  lightGeo.setAttribute('position', new THREE.BufferAttribute(lightPos, 3));
  lightGeo.setAttribute('color', new THREE.BufferAttribute(lightCol, 3));
  const lights = new THREE.Points(lightGeo, new THREE.PointsMaterial({
    size: 0.6, sizeAttenuation: true, map: makeGlowTexture(), vertexColors: true,
    transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  lights.frustumCulled = false; lights.raycast = () => {};
  group.add(lights);

  /* ---- MARINE LIFE — breachers (fish + a rare whale) and gulls. -------------------------------
     A BREACHER lives underwater (hidden) and every so often arcs up through the surface and dives
     back; the moment it breaks the surface it injects a ripple-RING into the wave-sim (the same
     wake path). Sparse, so each breach feels like a moment. The whale is just a big, rare breacher
     with a spray-sprite spout. */
  function makeBreacherMesh(size, color) {
    // a flattened, stretched sphere = a fish/whale body; vectorised so it restyles with the frame.
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(size, 9, 7),
      vectorize(new THREE.MeshStandardMaterial({ color, roughness: 0.5, flatShading: true }), { color }),
    );
    m.scale.set(0.55, 0.5, 1.0);                   // squash to a torpedo-ish body (long in +Z)
    m.castShadow = false; m.receiveShadow = false; m.raycast = () => {};
    m.position.y = -5;                             // start hidden below the seabed
    return m;
  }
  const BREACHERS = [
    { x: -9.5, z: 6.0, size: 0.18, color: '#5b6f86', period: 11, arcH: 0.55, span: 1.1, whale: false },
    { x: 7.5, z: -9.5, size: 0.16, color: '#4a6076', period: 14, arcH: 0.5, span: 1.0, whale: false },
    { x: -7.0, z: -8.5, size: 0.2, color: '#607089', period: 9, arcH: 0.6, span: 1.2, whale: false },
    { x: 10.5, z: 7.0, size: 0.62, color: '#3a4350', period: 38, arcH: 0.9, span: 2.6, whale: true }, // the rare whale
  ];
  BREACHERS.forEach((b, i) => {
    b.mesh = makeBreacherMesh(b.size, b.color);
    b.heading = Math.atan2(-b.x, -b.z);            // breach heading roughly toward the city centre
    b.t = (i / BREACHERS.length) * b.period;       // desynchronise the schedule
    b.splashed = false;
    group.add(b.mesh);
    if (b.whale) {
      b.spout = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeSprayTexture(), transparent: true, opacity: 0, depthWrite: false, fog: true }));
      b.spout.scale.set(0.6, 1.1, 1); b.spout.position.set(b.x, -5, b.z);
      group.add(b.spout);
    }
  });

  /* GULLS — a few dark sprites skimming low over the water near the coast. Day-favouring (they roost
     at night). Billboards → show through the office glass too. */
  const GULLS = 4;
  const gullAnim = createSpriteAnim({ frames: 4, fps: 7 });  // 4-col strip — matches BOTH the procedural strip AND the diffusion sheet
  const GULL_VARIANTS = ['#ffffff', '#cfd4da', '#c8a06a']; // white · grey · tan — "different colour patterns"
  const gulls = [];

  /* L61 v2 — SWAPPABLE-SHEET SEAM + LUMINANCE×TINT. `loadSpriteSheet` returns a LUMINANCE procedural
     sheet NOW (so the gulls build + fly immediately, with no asset dependency), and async-swaps in the
     authored ComfyUI diffusion sheet when it loads. `luminance:true` means each per-instance
     `material.color` is a clean `tint = lum × color` (palette-swap) — the SAME 3 variants as L43, but
     now via the richer path that also preserves real shading if the authored sheet carries it. */
  let gullSheet = loadSpriteSheet({
    url: gullDiffusionUrl, fallback: makeGullSheet(), luminance: true,
    onReady: (tex) => {                                   // the diffusion sheet arrived → drop it in
      gullSheet = tex;
      for (const g of gulls) {
        const old = g.sp.material.map;
        g.sp.material.map = gullAnim.makeInstanceTexture(tex);   // re-clone+window per instance onto the new sheet
        g.sp.material.needsUpdate = true;
        if (old) old.dispose();                          // free the procedural clone's GPU texture
      }
      if (typeof window !== 'undefined') window.__gullSheet = 'diffusion';
    },
  });
  for (let i = 0; i < GULLS; i++) {
    const map = gullAnim.makeInstanceTexture(gullSheet);   // a per-gull clone → each flaps on its own phase
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: new THREE.Color(GULL_VARIANTS[i % GULL_VARIANTS.length]), transparent: true, opacity: 0, depthWrite: false, fog: true }));
    sp.scale.setScalar(0.5);
    gulls.push({ sp, r: 8.6 + i * 0.5, y: 1.1 + (i % 2) * 0.5, speed: (0.18 + i * 0.03) * (i % 2 ? -1 : 1), phase: i * 1.9 });
    group.add(sp);
  }
  if (typeof window !== 'undefined') {
    window.__gullSheet = window.__gullSheet || 'procedural';   // 'procedural' until the diffusion sheet swaps in
    window.__gullAnim = { frames: gullAnim.frames, variants: GULL_VARIANTS.length, fps: gullAnim.fps };
  }

  /* ---- THE WAKE/BREACH DROP POOL handed to the wave-sim (bound by reference in main.js, exactly
     like the rain pool). Slots [0..NB) = boats (continuous), [NB..NB+NBREACH) = breach rings. ---- */
  const NBREACH = BREACHERS.length;
  const wakeDrops = Array.from({ length: NB + NBREACH }, () => new THREE.Vector3());

  /* THE ROUTER SEAM (mirrors cityLife.setRouter). Called when a boat completes a lap; returns the
     lane index to run next. Default: stay on the same lane (theater). A real game swaps this for a
     port schedule — boats sailing booked origin→destination runs over these same lanes. */
  let router = (boat) => boat.laneIndex;

  // scratch (zero per-frame alloc)
  const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _uv = new THREE.Vector3();

  function update(dt, elapsed, sunRig) {
    const night = sunRig ? sunRig.windowGlow : 0;  // ~1 night, ~0 day (SunRig signal, like the cars)
    const day = 1 - night;

    // --- BOATS: advance along the lane, place + orient, inject the wake at the stern ---
    for (let i = 0; i < NB; i++) {
      const b = BOATS[i];
      const lane = LANES[b.laneIndex], len = LANE_LEN[b.laneIndex];
      // ferry eases off near the harbor mouth (lane 2's u≈0 point) so it "arrives" gently at the docks
      const ease = b.isFerry ? (0.45 + 0.55 * Math.min(1, Math.abs(((b.u + 0.5) % 1) - 0.5) * 3)) : 1;
      const prevU = b.u;
      b.u = (b.u + b.dir * dt * b.speed * ease / len + 1) % 1;
      if (b.dir > 0 ? b.u < prevU : b.u > prevU) b.laneIndex = router(b);   // lap completed → router seam

      lane.getPointAt(b.u, _p);
      lane.getTangentAt(b.u, _t);
      const dirX = _t.x * b.dir, dirZ = _t.z * b.dir;            // travel direction (honour reverse)
      const yaw = Math.atan2(dirX, dirZ);
      const bob = Math.sin(elapsed * 1.1 + b.phase) * 0.025;
      b.mesh.position.set(_p.x, WATER_Y + bob, _p.z);
      b.mesh.rotation.set(Math.sin(elapsed * 0.9 + b.phase) * 0.04, yaw, 0);  // gentle pitch (swell)

      // WAKE: inject one impulse at the stern (behind the hull) each frame → a trailing V-wake.
      const hl = b.mesh.userData.halfLen;
      uvOf(_p.x - dirX * hl, _p.z - dirZ * hl, _uv);
      wakeDrops[i].set(_uv.x, _uv.y, b.wake);

      // NIGHT LIGHTS: warm bow ahead of the boat, red stern behind it; parked off-screen by day.
      const hi = i * 3, ti = (NB + i) * 3;
      if (night > 0.05) {
        const ly = WATER_Y + 0.12;
        lightPos[hi] = _p.x + dirX * (hl + 0.05); lightPos[hi + 1] = ly; lightPos[hi + 2] = _p.z + dirZ * (hl + 0.05);
        lightPos[ti] = _p.x - dirX * (hl + 0.02); lightPos[ti + 1] = ly; lightPos[ti + 2] = _p.z - dirZ * (hl + 0.02);
      } else { lightPos[hi + 1] = -50; lightPos[ti + 1] = -50; }
    }
    b_lightsUpdate();
    lights.material.opacity = THREE.MathUtils.clamp(night * 1.8, 0, 1);

    // --- BREACHERS: arc up through the surface on a schedule; splash a ripple-ring on the way out ---
    for (let i = 0; i < NBREACH; i++) {
      const b = BREACHERS[i];
      b.t += dt;
      const wslot = NB + i;
      const arcDur = b.whale ? 3.2 : 1.3;          // seconds the body is above water
      if (b.t >= b.period) {
        const k = (b.t - b.period) / arcDur;       // 0..1 progress through the breach arc
        if (k >= 1) { b.t = 0; b.splashed = false; b.mesh.position.y = -5; if (b.spout) b.spout.material.opacity = 0; wakeDrops[wslot].set(0, 0, 0); continue; }
        const arc = Math.sin(Math.PI * k);         // 0 → 1 → 0 height profile
        const fwd = (k - 0.5) * b.span;            // glide forward across the breach
        const hx = b.x + Math.sin(b.heading) * fwd, hz = b.z + Math.cos(b.heading) * fwd;
        b.mesh.position.set(hx, WATER_Y - 0.1 + arc * b.arcH, hz);
        b.mesh.rotation.set(Math.cos(Math.PI * k) * 0.9, b.heading, 0);  // nose up out, nose down in
        // splash a ripple-RING as it breaks the surface (start of the arc) and as it re-enters (end)
        const breaking = k < 0.16 || k > 0.84;
        uvOf(hx, hz, _uv);
        wakeDrops[wslot].set(_uv.x, _uv.y, breaking ? (b.whale ? 0.07 : 0.05) : 0);
        if (b.spout) { // whale spout: a spray puff that rises + fades after it surfaces
          const sp = THREE.MathUtils.clamp((k - 0.15) * 3, 0, 1) * (1 - k);
          b.spout.position.set(hx, WATER_Y + 0.5 + sp * 0.6, hz);
          b.spout.material.opacity = sp * 0.9;
        }
      } else {
        b.mesh.position.y = -5; wakeDrops[wslot].set(0, 0, 0);
        if (b.spout) b.spout.material.opacity = 0;
      }
    }

    // --- GULLS: skim circular paths near the coast; fade in by day, roost at night ---
    for (let i = 0; i < GULLS; i++) {
      const g = gulls[i];
      const a = g.phase + elapsed * g.speed * 0.25;
      g.sp.position.set(Math.cos(a) * g.r, g.y + Math.sin(elapsed * 1.4 + g.phase) * 0.12, Math.sin(a) * g.r);
      g.sp.material.opacity = THREE.MathUtils.clamp(day * 0.9 - 0.05, 0, 0.85);
      const fr = gullAnim.step(g.sp.material.map, elapsed, g.phase);   // L43: advance the wing flap, desynced by phase
      if (i === 0 && typeof window !== 'undefined') window.__gullFrame = fr;   // live frame (harness confirms it steps)
    }

    // probe (same convention as window.__city / __fps): lets a capture harness confirm the life is
    // live — how many breachers are above the surface right now, and the current gull visibility.
    if (typeof window !== 'undefined') {
      let breaching = 0;
      for (const b of BREACHERS) if (b.mesh.position.y > WATER_Y) breaching++;
      window.__waterLife = { boats: NB, breaching, gulls: +gulls[0].sp.material.opacity.toFixed(2), lights: +lights.material.opacity.toFixed(2) };
    }
  }

  function b_lightsUpdate() { lightGeo.attributes.position.needsUpdate = true; }

  // how many wake slots the sim should read this frame (boats + breachers; zero-strength ones are
  // harmless but we keep the count honest).
  function wakeCount() { return wakeDrops.length; }

  /* L63 INSPECT — boats, gulls, and breaching fish/whale as followables for the inspection lens.
     STABLE descriptors (positions read live each frame). `active` hides gulls when they roost at
     night and fish while they're below the surface, so the lens only offers what's actually there. */
  const followables = [
    ...BOATS.map((b, i) => ({
      kind: 'boat', label: b.isFerry ? 'ferry' : `boat ${i + 1}`,
      getWorldPos: (o) => o.copy(b.mesh.position),
      info: () => (b.isFerry ? 'boat · harbor ferry → docks' : `boat · open-water lane ${b.laneIndex}`),
    })),
    ...gulls.map((g, i) => ({
      kind: 'gull', label: `gull ${i + 1}`,
      getWorldPos: (o) => o.copy(g.sp.position),
      active: () => g.sp.material.opacity > 0.05,
      info: () => 'gull · circling the coast',
    })),
    ...BREACHERS.map((b, i) => ({
      kind: 'fish', label: b.whale ? 'whale' : `fish ${i + 1}`,
      getWorldPos: (o) => o.copy(b.mesh.position),
      active: () => b.mesh.position.y > WATER_Y - 0.3,            // only while surfaced
      info: () => (b.mesh.position.y > WATER_Y ? (b.whale ? 'whale · breaching!' : 'fish · breaching!') : 'fish · below the surface'),
    })),
  ];
  function getFollowables() { return followables; }

  return {
    group, update, getFollowables,
    wakeDrops,                                     // bound by reference into simMaterial.uniforms
    get wakeCount() { return wakeCount(); },
    lanes: LANES,                                  // exposed for a future sim/visualiser
    setRouter(fn) { router = fn || ((b) => b.laneIndex); },   // sim-ready seam (port schedules later)
  };
}
