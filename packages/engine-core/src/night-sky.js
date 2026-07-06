/* ============================================================
   @lgr/engine-core — night-sky.js (Lesson 57 + L111 dome migration): a procedural NIGHT SKY.
   ------------------------------------------------------------
   Three layers, all on the ONE SunRig clock the sun/moon ride, all fading in at night and out by day
   (gated by `nightK` = how far the sun is below the horizon — the mirror of the moon's visibility):
     1. STARFIELD — a deterministic point-cloud. Per-star size/brightness/twinkle-phase; twinkle freezes
        under prefers-reduced-motion (WCAG 2.3.1, the gull precedent).
     2. CONSTELLATIONS — a few faint connect-the-dots line figures, incl. a signature "LGR".
     3. NEBULA BAND — one soft, low-opacity Milky-Way-ish sprite for depth.
   TIER-AWARE: the starfield switches shape per fidelity tier (realistic soft / vector hard dot / pixel
   square) + sizes up for pixel; the constellations + nebula ride the post style-chain crunch for free.

   L111 DUAL REPRESENTATION (the "stars are a wall" fix — spec docs/nightsky-migration-design-2026-07-02.md):
   The sun/moon migrated to a camera-riding skydome in L98b (celestials.place → cameraPos + dir·R), but the
   star layers stayed a WORLD-FIXED wall at z≈−7.2, so at night the seize-flight parallaxes them like a
   billboard 7 units away. BUT — the wall was CORRECT for the orthographic iso/dimetric framing (parallel
   projection = the framed sky is one view direction + a window; a camera-centred large dome is literally
   unreachable by parallel rays that descend at 26–35°). So the fix is TWO representations under one module:
     • `domeGroup` — full-azimuth star SHELL of unit DIRECTIONS, scaled by R_DOME, its position copied from
       the render camera every frame in place() → translation parallax is exactly zero by construction (the
       same trick the sun/moon use). Shown for PERSPECTIVE cameras (the flight hero).
     • `wallGroup` — the EXISTING wall, byte-identical (own PRNG stream = seed 0x5ED, untouched call order).
       Shown for ORTHOGRAPHIC cameras. Zero regression risk for the composed iso/dimetric night postcard.
   `place(cam)` toggles the two by `cam.isPerspectiveCamera` and rides the dome; it is called from inside
   `celestials.place(cam)`, so the office-window RTT inherits it with ZERO createEngine wiring (compose,
   don't wire). C++ anchor: option (a) is the classic skybox — instead of stripping the view-matrix
   translation (`v[3]=vec4(0,0,0,1)`), we move the object to the eye each frame; same cancellation, CPU side.

   This module is COMPOSED by createCelestials (added to its group, updated from its update()), so every
   consumer that shows the celestials — the city sky AND the office-window RTT — inherits the night sky.

   v2 seam: diffusion-art nebula textures + a richer constellation set (asset-factory). [[ai-reinterpretation-pipeline]]
   ============================================================ */
import * as THREE from 'three';
import { mulberry32 } from './citygen.js';        // reuse the engine's deterministic PRNG (seed → same sky)
import starfieldVert from './shaders/starfield.vert';
import starfieldFrag from './shaders/starfield.frag';

const TIER_MODE = { realistic: 0, charm: 0, pixel: 2, vector: 1 };   // frag uMode per fidelity tier
const TIER_SIZE = { realistic: 1.0, charm: 1.0, pixel: 1.9, vector: 1.2 };   // chunkier points for pixel

// L111 dome constants (tunable — verify by screenshot; documented back in the report):
const R_DOME = 92;            // shell radius: beyond celestial R=88 (moon reads in front via renderOrder) + inside far=100
const DOME_SEED = 0x5EED;     // the dome's OWN PRNG stream — MUST differ from the wall's 0x5ED + nebula's 0x4EB1 (byte-identity, spec C3)
const DOME_COUNT = 2200;      // hold ~233 stars/sr (the wall's density) over the ~9.4 sr band below
// L111 finding: the perspective cameras LOOK DOWN (default city cam view cone ≈ −54°→−6° elevation; the chase cam is
// horizontal), so a stars-above-the-horizon dome (2°→85°) fell entirely OUT of frame → stars vanished. Extend the band
// BELOW the horizon (−30°) so stars fill the framed sky strip in the down-looking views; depthTest occludes the ones
// behind buildings/ground (they show only in the sky gaps, exactly like the old wall's "starfield behind the city"),
// while zenith coverage (→85°) still serves a look-up in flight. Zero parallax is unchanged (the dome still rides the eye).
const DOME_EL_LO = -30 * Math.PI / 180, DOME_EL_HI = 85 * Math.PI / 180;

// The "LGR" signature constellation — authored letter strokes in a local 2D grid (x right, y up).
const LGR = [
  // L
  [[0, 2], [0, 0]], [[0, 0], [0.7, 0]],
  // G
  [[2.1, 2], [1.4, 2]], [[1.4, 2], [1.4, 0]], [[1.4, 0], [2.1, 0]], [[2.1, 0], [2.1, 1]], [[2.1, 1], [1.7, 1]],
  // R
  [[2.8, 0], [2.8, 2]], [[2.8, 2], [3.5, 2]], [[3.5, 2], [3.5, 1]], [[3.5, 1], [2.8, 1]], [[2.8, 1], [3.6, 0]],
];

/* createNightSky({ seed, count, spreadX, yLo, yHi, zBase }) → { group, update(nightK,tier,elapsed,reduced), place(cam) } */
export function createNightSky({ seed = 0x5ED, count = 340, spreadX = 21, yLo = 3, yHi = 18, zBase = 7.2 } = {}) {
  const group = new THREE.Group();
  group.raycast = () => {};

  // ── SHARED materials (both representations use the same look; only geometry + parent differ) ──
  const starMat = new THREE.ShaderMaterial({
    vertexShader: starfieldVert, fragmentShader: starfieldFrag,
    uniforms: {
      uTime: { value: 0 }, uTwinkle: { value: 1 }, uSizeScale: { value: 1 },
      uColor: { value: new THREE.Color('#eaf0ff') }, uNight: { value: 0 }, uMode: { value: 0 },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
  });
  const conMat = new THREE.LineBasicMaterial({ color: '#9fb6e8', transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false });
  const nebMat = new THREE.SpriteMaterial({ map: makeNebulaTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
  nebMat.rotation = -0.5;   // tilt the band diagonally for a Milky-Way feel (shared by both reps, spec §2)

  /* Build ONE star Points layer. posFn(rng) → [x,y,z] and MUST make exactly the same rng calls in the
     same order as the wall did (x, y, z) so the wall stream stays byte-identical; the dome uses its OWN
     rng so its call count is free. Returns the geometry + the bright-star list (for constellations). */
  function buildStarLayer(rng, n, posFn) {
    const pos = new Float32Array(n * 3), aSize = new Float32Array(n), aBright = new Float32Array(n), aPhase = new Float32Array(n);
    const bright = [];
    for (let i = 0; i < n; i++) {
      const p = posFn(rng);
      pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2];
      const b = 0.35 + rng() * 0.65;                          // base brightness
      aBright[i] = b;
      aSize[i] = 1.6 + rng() * 2.8 + (b > 0.85 ? 2.2 : 0);    // a few notably bigger
      aPhase[i] = rng() * Math.PI * 2;
      if (b > 0.82) bright.push([p[0], p[1], p[2]]);           // remember bright ones so constellations link real stars
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
    g.setAttribute('aBright', new THREE.BufferAttribute(aBright, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
    return { geo: g, bright };
  }

  /* Build a whole representation (stars + constellations + nebula) into a fresh sub-group. `sigProject(ax,ay)→[x,y,z]`
     places an LGR letter-stroke endpoint; `placeNebula(sprite)` positions/sizes the band; `starRO`/`conRO` set the
     dome's explicit renderOrder (null on the wall = keep today's default 0). Same code for wall + dome; only the
     position math + PRNG stream differ. */
  function buildRep(rng, n, posFn, sigProject, placeNebula, starRO, conRO) {
    const sub = new THREE.Group(); sub.raycast = () => {};
    // 1) STARFIELD
    const { geo, bright } = buildStarLayer(rng, n, posFn);
    const stars = new THREE.Points(geo, starMat);
    stars.raycast = () => {}; stars.frustumCulled = false; if (starRO != null) stars.renderOrder = starRO;
    sub.add(stars);
    // 2) CONSTELLATIONS — the SAME nearest-ish-neighbour walk over the bright list (position-agnostic → works on directions)
    const segPts = [];
    if (bright.length > 6) {
      for (let c = 0; c < 3; c++) {
        let idx = Math.floor(rng() * bright.length);
        for (let s = 0; s < 3; s++) {
          const a = bright[idx];
          const b = bright[(idx + 1 + Math.floor(rng() * 2)) % bright.length];
          segPts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
          idx = (idx + 1) % bright.length;
        }
      }
    }
    for (const [[ax, ay], [bx, by]] of LGR) { const a = sigProject(ax, ay), b = sigProject(bx, by); segPts.push(a[0], a[1], a[2], b[0], b[1], b[2]); }
    const conGeo = new THREE.BufferGeometry();
    conGeo.setAttribute('position', new THREE.Float32BufferAttribute(segPts, 3));
    const constellations = new THREE.LineSegments(conGeo, conMat);
    constellations.raycast = () => {}; constellations.frustumCulled = false; if (conRO != null) constellations.renderOrder = conRO;
    sub.add(constellations);
    // 3) NEBULA
    const isDome = starRO != null;                              // the dome passes explicit renderOrders; the wall passes null
    const nebula = new THREE.Sprite(nebMat);
    nebula.raycast = () => {}; nebula.renderOrder = -3;
    if (isDome) nebula.frustumCulled = false;                   // C2: ONLY the dome adds this — the wall nebula kept the default (byte-identity)
    placeNebula(nebula);
    sub.add(nebula);
    return sub;
  }

  // ── WALL (existing, BYTE-IDENTICAL) — the correct representation for orthographic iso/dimetric ──
  // positions on the wide gently-curved wall behind the city (z ≈ −zBase..−zBase−0.7, in the sun/moon plane).
  const wallPos = (rng) => { const x = (rng() * 2 - 1) * spreadX, y = yLo + rng() * (yHi - yLo), z = -zBase - rng() * 0.7; return [x, y, z]; };
  const SIG_OX = -3.0, SIG_OY = 12.0, SIG_Z = -zBase - 0.4, SIG_S = 0.62;   // LGR placed high on the wall (front of the backdrop)
  const wallSig = (ax, ay) => [SIG_OX + ax * SIG_S, SIG_OY + ay * SIG_S, SIG_Z];
  const wallNebula = (n) => { n.scale.set(spreadX * 2.4, spreadX * 0.95, 1); n.position.set(2, 12, -zBase - 0.7); };
  const wallGroup = buildRep(mulberry32(seed >>> 0), count, wallPos, wallSig, wallNebula, null, null);   // null RO = keep today's default draw order
  group.add(wallGroup);

  // ── DOME (new) — full-azimuth unit-direction shell, ridden by the camera in place(). Perspective only. ──
  const domeGroup = new THREE.Group(); domeGroup.raycast = () => {};
  domeGroup.scale.setScalar(R_DOME);                                        // unit directions × R_DOME = the shell radius
  const domePos = (rng) => {                                               // a unit DIRECTION on the upper-hemisphere band
    const az = rng() * Math.PI * 2;
    const el = DOME_EL_LO + rng() * (DOME_EL_HI - DOME_EL_LO);
    const ce = Math.cos(el);
    return [ce * Math.sin(az), Math.sin(el), ce * Math.cos(az)];
  };
  // LGR onto a dome patch via a tangent frame at dSig (matches today's up-left framing); centred on the letter block.
  const dSig = new THREE.Vector3(-3, 12, -7.6).normalize();
  const sigRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dSig).normalize();
  const sigUpT = new THREE.Vector3().crossVectors(dSig, sigRight).normalize();
  const _sv = new THREE.Vector3();
  const DSIG_S = 0.082, DSIG_CX = 1.8, DSIG_CY = 1.0;                       // ~9° tall on the unit dome; centre the L-G-R block on dSig
  const domeSig = (ax, ay) => { _sv.copy(dSig).addScaledVector(sigRight, (ax - DSIG_CX) * DSIG_S).addScaledVector(sigUpT, (ay - DSIG_CY) * DSIG_S); return [_sv.x, _sv.y, _sv.z]; };
  const nebDir = new THREE.Vector3(2, 12, -7.9).normalize();               // the band's centre direction (matches the wall nebula's bearing)
  const domeNebula = (n) => { n.scale.set(0.7, 0.28, 1); n.position.copy(nebDir); };   // unit scale × R_DOME → ~38° band; inherits R via parent scale
  const domeContent = buildRep(mulberry32(DOME_SEED), DOME_COUNT, domePos, domeSig, domeNebula, -2, -2);
  domeGroup.add(domeContent);
  group.add(domeGroup);

  // ── day-gate (unchanged): the whole night sky is skipped by day ──
  let curMode = -1;
  const _camPos = new THREE.Vector3();
  let _proj = 'wall';
  function update(nightK, tier = 'realistic', elapsed = 0, reduced = false) {
    starMat.uniforms.uTime.value = elapsed;
    starMat.uniforms.uTwinkle.value = reduced ? 0 : 1;
    starMat.uniforms.uNight.value = nightK;
    const m = TIER_MODE[tier] ?? 0;
    if (m !== curMode) { starMat.uniforms.uMode.value = m; curMode = m; }
    starMat.uniforms.uSizeScale.value = TIER_SIZE[tier] ?? 1;
    conMat.opacity = nightK * 0.5;      // faint — reads on a look, never dominates (shared → covers both reps)
    nebMat.opacity = nightK * 0.32;
    group.visible = nightK > 0.001;     // skip the draw entirely by day
    if (typeof window !== 'undefined') window.__nightSky = { nightK: +nightK.toFixed(3), proj: _proj, vis: group.visible };
  }

  // L111 — projection-aware placement: DOME for perspective (ride the camera → zero parallax), WALL for ortho.
  // Called from celestials.place(cam) for the main view AND the office-window RTT camera (compose, don't wire).
  function place(cam) {
    if (!cam) return;
    const persp = !!cam.isPerspectiveCamera;
    wallGroup.visible = !persp;
    domeGroup.visible = persp;
    if (persp) { cam.getWorldPosition(_camPos); domeGroup.position.copy(_camPos); }   // ride the eye → position−cameraPos is constant → parallax = 0
    _proj = persp ? 'dome' : 'wall';
  }

  // debug handle for the night-sky parallax probe (like window.__rig): the two sub-groups' world transforms.
  if (typeof window !== 'undefined') window.__nightSkyDbg = { dome: domeGroup, wall: wallGroup, group };

  return { group, update, place };
}

/* A soft, faintly-mottled cool band — a radial gradient with a few low-opacity blobs (procedural depth).
   Additive + low opacity → it never looks like a hard sprite; the post style-chain crunches it per tier. */
function makeNebulaTexture() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.0, 'rgba(150,170,230,0.5)'); g.addColorStop(0.4, 'rgba(120,130,200,0.22)');
  g.addColorStop(1.0, 'rgba(90,100,160,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  // a few brighter knots so the band isn't a featureless blob
  const rng = mulberry32(0x4EB1);
  for (let i = 0; i < 7; i++) {
    const bx = 40 + rng() * (S - 80), by = 70 + rng() * (S - 140), r = 14 + rng() * 30;
    const gg = x.createRadialGradient(bx, by, 0, bx, by, r);
    gg.addColorStop(0, 'rgba(200,210,255,0.18)'); gg.addColorStop(1, 'rgba(200,210,255,0)');
    x.fillStyle = gg; x.beginPath(); x.arc(bx, by, r, 0, Math.PI * 2); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
