/* ============================================================
   moto.js — ARC A-MOTO (2026-08-18): JUMPABLE BY CONSTRUCTION — the terrain half of the dirtbike.
   ------------------------------------------------------------
   The bike MOVEMENT MODEL lives in pilot.js (`createBikeModel`, beside the other six models —
   Rule 11, that file is where every MovementModel lives). THIS module is everything else the moto
   arc needs from the engine, and its whole design is a port of the A-SKYLINE lesson from the swing:

     "The level is part of the mechanic." The swing was broken for days because it was tuned in a
     city whose median tower was a THIRD of the minimum swingable height — and the cure was not
     taller-buildings-by-eye but `swingableHeight`/`swingableRope`: derive the LEVEL from the
     MECHANIC's own arithmetic, in both directions, so the two derivations stay each other's check
     (box-arena.js). Here the mechanic is "ride fast, leave the ground off a crest"; the arithmetic
     is one line of circular motion; and the terrain is generated FROM the bike's numbers so airtime
     is guaranteed BY CONSTRUCTION — never discovered afterwards.

   THE LAUNCH ARITHMETIC (the one line everything derives from):
     A wheel following a hill of shape  h(z) = A·sin(k·z)  (k = 2π/λ) at horizontal speed v needs a
     downward acceleration of  v²·|h''| = v²·A·k²  at the crest to stay on the surface (centripetal
     acceleration on a curve of curvature A·k² — in C++ terms: the second derivative of the path,
     times speed squared). Gravity can supply at most g. So the wheel LEAVES THE GROUND iff
         v² · A · k²  >  g
     Everything here is that inequality solved for a different unknown:
       · jumpableWavelength — solve for λ:  "I ride at v over hills of height A — how tight must
         the hills be so full throttle launches me, with margin?"  (the level's generator input)
       · launchSpeed — solve for v:  "these hills exist — how fast must I go to launch?"  (the
         inverse, and the round-trip through both is EXACT and pinned by a test:
         launchSpeed(jumpableWavelength(v, F)) = v/√F — the margin factor's whole meaning is the
         speed fraction at which the hills stop launching you.)
     The same discipline as swingableHeight/swingableRope: two statements of one rule, one place.

   THE FLIP ARITHMETIC (the big ramp is derived, not sculpted):
     A backflip is 2π of pitch at the profile's own airPitchRate, so it NEEDS
         T = margin · 2π / airPitchRate    seconds of air        (airtimeForFlip)
     A kicker of slope tanθ launches the model with vy₀ = v·tanθ (the grounded integrator moves x/z
     at full speed and y follows the slope, so the slope's vertical RATE is v·tanθ — the derivation
     uses the model's own arithmetic, not the textbook v·sinθ, because the model is the physics
     this level must guarantee against). Falling `drop` below the lip:
         T = ( vy₀ + √(vy₀² + 2·g·drop) ) / g
     flipRampSpec solves that for `drop` given the needed T — so the ramp's basin is exactly deep
     enough that a full-throttle hit buys one backflip plus margin, by construction.

   MOTOCROSS MADNESS 2 (the owner's reference — mechanics only): its physics were praised as
   "crazy enough to be fun but real enough to look right" — a real gravity parabola with generous
   hang-time, where even minor jumps launch you and big hills buy seconds of air; stunts gate on
   HEIGHT (gain air first, then trick); its Baja mode is open rolling wilderness rather than a
   corridor track. That is exactly what this generator emits: an open dune field where full
   throttle launches you off every crest (the arcade-generous launchFactor default), plus one
   derived big ramp for the flip. Stunt SCORING is phase 2 and deliberately absent.

   C++ anchors: the heightfield is a `float` grid sampled bilinearly (a heightmap texture with
   CLAMP_TO_EDGE); the derivations are constexpr-style pure functions; the generator is
   deterministic from its seed (same seed → byte-identical Float32Array, pinned by a test).
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';   // A-MOTO-ASSET: the GLB bike (landmarks.js's in-convention loader)
import { mulberry32 } from './citygen.js';
import { buildTerrainMesh } from './terrain.js';

/* ── THE PAIRED DERIVATIONS (the swingableHeight/swingableRope of this arc) ──────────────────── */

/* jumpableWavelength({ speed, amplitude, g, launchFactor }) → λ (world units).
   The LONGEST hill wavelength that still guarantees a launch at `speed` over hills of half-height
   `amplitude`, with margin. From v²·A·k² = F·g:  λ = 2π·v·√(A / (g·F)).
   `launchFactor` F (>1) is the ENTIRE safety margin and it has one legible meaning, stated rather
   than fudged (the box-arena percentile lesson): the crest curvature exceeds gravity by factor F at
   design speed, so hills keep launching you down to speed v/√F — at the default 1.5 that is 82% of
   design speed. Below that you can cruise the same hills grounded, which is the throttle-as-a-verb
   feel (full send = fly, half throttle = carve). */
export function jumpableWavelength({ speed, amplitude = 0.9, g = 5.4, launchFactor = 1.5 } = {}) {
  return 2 * Math.PI * speed * Math.sqrt(amplitude / (g * launchFactor));
}

/* launchSpeed({ wavelength, amplitude, g }) → the minimum speed at which THESE hills launch you.
   The inverse, from the same inequality: v = (λ/2π)·√(g/A). Round-trip check (pinned):
   launchSpeed(jumpableWavelength(v, F)) = v/√F exactly. */
export function launchSpeed({ wavelength, amplitude = 0.9, g = 5.4 } = {}) {
  return (wavelength / (2 * Math.PI)) * Math.sqrt(g / amplitude);
}

/* airtimeForFlip({ pitchRate, margin }) → seconds of air one full backflip needs.
   2π of rotation at `pitchRate` rad/s, times margin — the margin is TIME TO SPARE at the top, i.e.
   the window in which a player can stop rotating and land clean rather than a frame-perfect trick. */
export function airtimeForFlip({ pitchRate = 3.6, margin = 1.15 } = {}) {
  return (margin * 2 * Math.PI) / pitchRate;
}

/* flipRampSpec({ speed, airtime, g, angle, lipRise }) → the ramp the flip needs, solved not drawn.
     angle    — the kicker's face angle (rad). Fixed at a dirt-kicker 30° by default; the DROP is
                the solved unknown, because a lip you can steepen forever stops reading as terrain.
     lipRise  — how far the kicker climbs above the surrounding field (look + run-up feel).
     drop     — SOLVED: how far below the lip the basin floor must sit so a full-throttle hit is
                airborne ≥ `airtime`.  From T = (vy₀ + √(vy₀² + 2·g·drop))/g with vy₀ = v·tanθ:
                    drop = ((g·T − vy₀)² − vy₀²) / (2g)      (clamped at 0 — a flat landing may
                already suffice at high speed; the clamp is visible in the returned value, not
                silently applied inside the terrain)
     flight   — horizontal distance covered in that air (v·T): how long the basin must be. */
export function flipRampSpec({ speed, airtime, g = 5.4, angle = Math.PI / 6, lipRise = 1.4 } = {}) {
  const tan = Math.tan(angle);
  const vy0 = speed * tan;
  const gT = g * airtime;
  const drop = Math.max(0, ((gT - vy0) * (gT - vy0) - vy0 * vy0) / (2 * g));
  return { angle, tan, vy0, lipRise, drop, flight: speed * airtime, airtime };
}

/* ── createMotoTerrain(opts) — the level, generated FROM the bike's numbers ──────────────────────
   Returns { size, worldSize, cell, height (Float32Array of WORLD Y), heightAt(x,z), group (the
   mesh), stats, ramp, spawn, dispose }.

   THE FIELD. Dune RIDGES run across the riding axis (+z is the ride direction, matching the
   engine's +Z-nose-at-yaw-0 convention), so riding forward crosses a crest every λ:
       h(x,z) = A(x,z) · sin(k·z + φ(x))  +  dressing(x,z)
   · φ(x) wanders the ridge lines (seeded), so the field reads as baja, not corduroy.
   · A(x,z) varies in [Amin, Amax]. THE GUARANTEE IS DERIVED AT Amin: λ = jumpableWavelength at the
     WEAKEST crest, so every crest launches at design speed — stronger crests simply launch at
     lower speed. (Deriving at the mean would leave the shallow half of the field below the line —
     the exact shape of the metropolis mistake, avoided by construction.)
   · dressing is 2 seeded incommensurate sine products at dress·Amin amplitude. Its worst-case
     along-z curvature adds ≈ dress·(0.53² + 0.5·0.41²)·Amin·k² ≈ 0.36·dress·Amin·k² — at the
     default dress 0.25 that is a 9% perturbation on a guarantee carrying a 50% margin. Named here
     so the margin is known to be spent, not assumed intact (the guard-scope lesson).

   THE RAMP (opt-in, default on) is carved into the lane |x| < ramp.half along z: a flat run-up
   (reach full throttle), a linear kicker at spec.angle rising spec.lipRise (linear, NOT smoothstep
   — a smoothstep lip has zero slope at the top and would silently delete the launch angle the flip
   derivation depends on), a sheer face at the lip, a basin carved spec.drop below the lip, then a
   recovery upslope back into the dunes. The lane suppresses dunes+dressing through the ramp span so
   the approach is honest run-up rather than accidental pre-jumps.

   COUNTED OFF THE FINISHED GEOMETRY (the A-SKYLINE discipline — the guarantee is asserted against
   the built Float32Array, never against the formula that built it): stats.crests walks riding
   lines, finds local maxima along z, computes each crest's own launch speed from the grid's second
   difference, and reports what fraction launch at design speed. stats.flip re-measures the BUILT
   lip height, basin floor and lip slope and recomputes the predicted airtime from those. A test
   pins both (and their negative controls — flatten the field and the count must go to zero). */
export function createMotoTerrain({
  seed = 7,
  size = 256,                 // grid resolution per side
  worldSize = 120,            // world units per side
  speed = 7.5,                // the bike's design speed — BIKE_PROFILE.maxSpeed, passed by reference at the call site
  g = 5.4,                    // gravity — must be the PROFILE's own (one fact, two readers)
  pitchRate = 3.6,            // air pitch authority — BIKE_PROFILE.airPitchRate
  amplitude = 0.9,            // Amax: the tallest dunes' half-height
  ampVary = 0.35,             // A(x,z) ∈ [Amax·(1−ampVary), Amax] — Amin is the guarantee's input
  launchFactor = 1.5,
  wavelengthScale = 1,        // multiplies the DERIVED λ — the dial that breaks the guarantee on purpose.
                              // 1 = jumpable by construction. The derivation is otherwise self-correcting
                              // (λ ∝ √A, so shrinking the hills re-derives tighter ones that launch anyway
                              // — a negative control through `amplitude` alone CANNOT fail, measured); this
                              // is the one knob that decouples the level from the bike, for labs and tests.
  dress = 0.25,               // dressing amplitude as a fraction of Amin (see the curvature note)
  flipMargin = 1.15,
  ramp = {},                  // { on = true, half = 6, angle, lipRise } — the derived big ramp
  mesh = true,                // false → data only (node tests, probes)
} = {}) {
  const rng = mulberry32((seed * 2654435761) >>> 0);
  const Amin = amplitude * (1 - ampVary);
  const wavelength = jumpableWavelength({ speed, amplitude: Amin, g, launchFactor }) * wavelengthScale;
  const k = (2 * Math.PI) / wavelength;

  // seeded phases/frequencies for the ridge wander + amplitude field + dressing (deterministic).
  const p1 = rng() * Math.PI * 2, p2 = rng() * Math.PI * 2, p3 = rng() * Math.PI * 2;
  const s1 = rng() * Math.PI * 2, s2 = rng() * Math.PI * 2, s3 = rng() * Math.PI * 2, s4 = rng() * Math.PI * 2;
  const kWander = k * 0.13;                       // ridge wander is LOW-frequency across x
  const wanderAmp = wavelength * 0.35;            // …and bounded, so ridges never fold back
  const kAmp = k * 0.21;

  const spec = flipRampSpec({ speed, airtime: airtimeForFlip({ pitchRate, margin: flipMargin }), g, angle: ramp.angle, lipRise: ramp.lipRise });
  const half = worldSize / 2;
  /* THE RAMP SPAN along the centre lane, laid out back-to-front (all in world z):
     run-up (reach vMax from a dune exit: v²/(2·a_eff) with the profile's accel ≈ 8 gives ~7 u at
     a_eff≈4 once drag has its half; 20 u is that with a comfortable factor, stated not hidden) →
     kicker → lip → basin (flight + margin) → recovery. */
  const R = {
    on: ramp.on !== false,
    half: ramp.half ?? 6,
    runUp: 20,
    z0: 2,                                        // where the flat run-up begins (the default span must
    kickLen: spec.lipRise / spec.tan,             //  end INSIDE the rim — checked below, not hoped)
    basinLen: spec.flight * 1.15 + 4,
    recovLen: 10,
  };
  R.zKick = R.z0 + R.runUp;                       // kicker foot
  R.zLip = R.zKick + R.kickLen;                   // the lip (launch edge)
  R.zBasinEnd = R.zLip + R.basinLen;
  R.lipY = spec.lipRise;
  /* THE QUANTIZATION GUARD, carved not hoped: the guarantee is judged against the FINISHED grid
     (measureFlip below), and the grid's lip cell sits up to one cell short of the analytic lip —
     losing up to cell·tanθ of lip height. A derivation that ignores its own discretization ships a
     ramp that measures 1.99 s against a 2.01 s need (that exact red is what added this line). The
     basin is deepened by the worst-case loss, so the BUILT geometry carries the guarantee. */
  const cellW = worldSize / (size - 1);
  R.quantGuard = cellW * spec.tan + 0.05;
  R.basinY = spec.lipRise - (spec.drop + R.quantGuard);   // may be below field 0 — that is the carve

  const smooth = (a, b, t) => { t = Math.max(0, Math.min(1, (t - a) / (b - a))); return t * t * (3 - 2 * t); };

  /* the analytic field, evaluated both into the grid (render + physics) and by stats. */
  const fieldAt = (x, z) => {
    const A = Amin + (amplitude - Amin) * (0.5 + 0.5 * Math.sin(kAmp * x + p2) * Math.sin(kAmp * 0.7 * z + p3));
    const phase = wanderAmp * k * Math.sin(kWander * x + p1);
    const dune = A * Math.sin(k * z + phase);
    const d = dress * Amin * (Math.sin(0.71 * k * x + s1) * Math.sin(0.53 * k * z + s2)
      + 0.5 * Math.sin(0.37 * k * x + s3) * Math.sin(0.41 * k * z + s4));
    let h = dune + d;
    if (R.on) {
      // lane mask: 1 inside the ramp lane, easing to 0 across 3 u; span mask covers run-up→recovery
      const lane = 1 - smooth(R.half - 3, R.half, Math.abs(x));
      const span = smooth(R.z0 - 6, R.z0, z) * (1 - smooth(R.zBasinEnd + R.recovLen - 4, R.zBasinEnd + R.recovLen, z));
      const m = lane * span;
      if (m > 0) {
        let rh = 0;                                                       // flat run-up at field zero
        if (z >= R.zKick && z < R.zLip) {
          const t = (z - R.zKick) / R.kickLen;                            // linear face — the slope IS the launch angle
          const ease = t < 0.2 ? (t / 0.2) * (t / 0.2) : 1;               // ease the FOOT only; the lip stays sharp
          rh = R.lipY * t * ease;
        } else if (z >= R.zLip && z < R.zBasinEnd) {
          rh = R.basinY + (R.lipY - R.basinY) * 0.02 * smooth(R.zBasinEnd - 6, R.zBasinEnd, z); // basin floor (tiny pre-rise)
        } else if (z >= R.zBasinEnd) {
          rh = R.basinY + (0 - R.basinY) * smooth(R.zBasinEnd, R.zBasinEnd + R.recovLen, z);    // recover to field
        }
        h = h * (1 - m) + rh * m;
      }
    }
    return h;
  };

  /* ── the grid (the CPU-authoritative buffer — terrain.js's own guiding rule; render and
     physics both read THIS, so what you see is what the wheel stands on). ── */
  const height = new Float32Array(size * size);
  let minY = Infinity, maxY = -Infinity;
  const cell = worldSize / (size - 1);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const h = fieldAt(i * cell - half, j * cell - half);
      height[j * size + i] = h;
      if (h < minY) minY = h; if (h > maxY) maxY = h;
    }
  }

  /* heightAt(x,z) — BILINEAR over the same grid the mesh is built from, clamped at the rim (the
     world continues flat beyond the edge rather than cliffing). The mesh triangulates each cell, so
     mid-cell render vs bilinear physics differ by ≤ κ·cell²/8 ≈ 3 mm at these numbers — two orders
     below the collision skin, stated rather than discovered. */
  const heightAt = (x, z) => {
    const fx = Math.min(size - 1, Math.max(0, (x + half) / cell));
    const fz = Math.min(size - 1, Math.max(0, (z + half) / cell));
    let i = Math.floor(fx), j = Math.floor(fz);
    let u = fx - i, v = fz - j;
    if (i >= size - 1) { i = size - 2; u = 1; }   // the LAST vertex is exact, not an epsilon inside the last cell
    if (j >= size - 1) { j = size - 2; v = 1; }
    const h00 = height[j * size + i], h10 = height[j * size + i + 1];
    const h01 = height[(j + 1) * size + i], h11 = height[(j + 1) * size + i + 1];
    return h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v;
  };

  /* ── THE GUARANTEE, COUNTED OFF THE FINISHED GRID (never off the formula). ──
     Walk riding lines (constant x), find local maxima along z, and compute each crest's own launch
     speed from the grid's SECOND DIFFERENCE:  κ = −h''  (discrete: −(h[j−1] − 2h[j] + h[j+1])/cell²),
     launchable iff √(g/κ) ≤ design speed. The ramp lane is excluded — its run-up is flat by design. */
  function countCrests() {
    const lines = 9;
    let crests = 0, launchable = 0;
    const speeds = [];
    for (let L = 0; L < lines; L++) {
      const x = -half + worldSize * (L + 0.5) / lines;
      if (R.on && Math.abs(x) < R.half + 3) continue;          // skip the ramp lane
      const i = Math.round((x + half) / cell);
      for (let j = 2; j < size - 2; j++) {
        const h0 = height[(j - 1) * size + i], h1 = height[j * size + i], h2 = height[(j + 1) * size + i];
        if (!(h1 > h0 && h1 >= h2)) continue;                  // a crest along the riding axis
        const kap = -(h0 - 2 * h1 + h2) / (cell * cell);
        if (kap <= 1e-6) continue;
        crests++;
        const vNeed = Math.sqrt(g / kap);
        speeds.push(vNeed);
        if (vNeed <= speed) launchable++;
      }
    }
    speeds.sort((a, b) => a - b);
    return { crests, launchable, frac: crests ? launchable / crests : 0, vNeedMedian: speeds.length ? speeds[Math.floor(speeds.length / 2)] : 0 };
  }

  /* the flip guarantee, re-measured off the BUILT lane: lip height, basin floor, lip slope.
     All j indices are CLAMPED to the grid — a variant whose solved basin runs past the rim (a
     half-rate flip asks for a ~26 u canyon) must measure the clipped geometry it actually built,
     not read NaN off the end of the buffer. */
  function measureFlip() {
    if (!R.on) return null;
    const cj = (z) => Math.max(1, Math.min(size - 2, Math.round((z + half) / cell)));
    const i = Math.round(half / cell);                          // the x=0 lane
    const jLip = cj(R.zLip) - 1;                                // last kicker cell
    let lipY = -Infinity, jAtLip = jLip;
    for (let j = Math.max(2, jLip - 3); j <= jLip + 1; j++) { const h = height[j * size + i]; if (h > lipY) { lipY = h; jAtLip = j; } }
    let basinY = Infinity;
    const j0 = cj(R.zLip + 2), j1 = cj(R.zBasinEnd - 2);
    for (let j = j0; j <= j1; j++) basinY = Math.min(basinY, height[j * size + i]);
    const slope = (height[jAtLip * size + i] - height[(jAtLip - 2) * size + i]) / (2 * cell);   // the built face slope
    const vy0 = speed * slope;
    const drop = lipY - basinY;
    const predictedAir = (vy0 + Math.sqrt(vy0 * vy0 + 2 * g * drop)) / g;
    return { lipY, basinY, drop, slope, predictedAir, need: airtimeForFlip({ pitchRate, margin: flipMargin }) };
  }

  const stats = {
    wavelength, amplitude, Amin, launchFactor,
    launchSpeedDesign: launchSpeed({ wavelength, amplitude: Amin, g }),   // = speed/√F, the closed loop
    crests: countCrests(),
    flip: measureFlip(),
    minY, maxY, seed, size, worldSize,
  };

  /* ── the MESH — buildTerrainMesh REUSED verbatim (chunked, flat-shaded, vertex-coloured, baked
     AO). It expects a normalised [0,1] field + a (sea, relief, baseY) mapping; we adapt so its
     world Y equals our world Y exactly: h = (F−minY)/range, relief = range, baseY = minY + sea·range
     ⇒ wy(h) = F. The biome buffer is OURS (height+slope → grassland/hills/rock/beach indices into
     the shared BIOMES palette) — moto ground is a dirt/scrub read, not an island. ── */
  let group = null, terrainData = null;
  if (mesh) {
    const range = Math.max(1e-6, maxY - minY);
    const sea = 0.03;
    const norm = new Float32Array(size * size);
    const biome = new Uint8Array(size * size);
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const idx = j * size + i;
        norm[idx] = (height[idx] - minY) / range;
        const i0 = Math.max(1, Math.min(size - 2, i)), j0 = Math.max(1, Math.min(size - 2, j));
        const sl = Math.hypot(
          (height[j0 * size + i0 + 1] - height[j0 * size + i0 - 1]) / (2 * cell),
          (height[(j0 + 1) * size + i0] - height[(j0 - 1) * size + i0]) / (2 * cell));
        // beach=sand (the carved basin floor), rock on steep faces, hills mid, grassland low
        biome[idx] = sl > 0.55 ? 5 : norm[idx] > 0.72 ? 4 : norm[idx] < 0.25 ? 1 : 2;
      }
    }
    terrainData = { size, height: norm, biome, sea, relief: range, minH: 0, maxH: 1, baseY: minY + sea * range };
    group = buildTerrainMesh(terrainData, { worldSize, baseY: terrainData.baseY, chunks: 6 });
  }

  const spawnZ = -half + 8;
  return {
    size, worldSize, cell, height, heightAt, group, stats,
    /* the normalised (size/height/biome/sea/relief) view of this same grid, in the exact shape
       `generateScatter` reads — so the ORPHANED scatter ability (rejected by the streets arcs for
       being terrain-shaped) finally has the terrain it was shaped for. null when mesh:false. */
    terrainData,
    ramp: R.on ? { x: 0, half: R.half, zRunUp: R.z0, zKick: R.zKick, zLip: R.zLip, zBasinEnd: R.zBasinEnd, spec } : null,
    /* two spawns: the open dunes (default ride) and the ramp approach (?ramp=1 / the flip probe). */
    spawn: { x: -worldSize * 0.22, z: spawnZ, yaw: 0 },
    spawnRamp: R.on ? { x: 0, z: R.z0 + 1.5, yaw: 0 } : null,
    dispose() { if (group && group.userData.dispose) group.userData.dispose(); },
  };
}

/* ── createBikeMesh — the rideable silhouette (procedural primitives; the art pass is later) ─────
   A box-bike with two real wheels reads fine at speed (the brief's own words). Origin at the GROUND
   CONTACT point (wheel bottoms at local y=0) so group.position.y = the model's state.y directly.
   update(state, dt) spins the wheels at speed/r — the single cheapest "it is rolling" cue there is. */
export function createBikeMesh({ color = '#c33b2e', rider = '#2a2d33' } = {}) {
  const group = new THREE.Group();
  const mat = (c, r = 0.7) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0.1, flatShading: true });
  const wheelR = 0.16;
  const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, 0.07, 12);
  wheelGeo.rotateZ(Math.PI / 2);                       // axis → local X, so rotation.x spins it
  const wheelMat = mat('#17181c', 0.9);
  const front = new THREE.Mesh(wheelGeo, wheelMat); front.position.set(0, wheelR, 0.31);
  const rear = new THREE.Mesh(wheelGeo, wheelMat); rear.position.set(0, wheelR, -0.31);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.13, 0.52), mat(color, 0.55));
  frame.position.set(0, 0.28, -0.01);
  const tank = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.09, 0.2), mat(color, 0.5));
  tank.position.set(0, 0.37, 0.08);
  const fork = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.05), mat('#8b909a', 0.4));
  fork.position.set(0, 0.3, 0.29); fork.rotation.x = -0.42;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.035), mat('#23252b', 0.6));
  bar.position.set(0, 0.46, 0.22);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.045, 0.24), mat('#17181c', 0.95));
  seat.position.set(0, 0.42, -0.14);
  // the rider — a leaning capsule torso + head; a stated placeholder (hero body = later art pass)
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.2, 3, 8), mat(rider, 0.8));
  torso.position.set(0, 0.6, -0.06); torso.rotation.x = 0.5;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), mat('#c9c4ba', 0.6));
  head.position.set(0, 0.74, 0.05);
  for (const m of [front, rear, frame, tank, fork, bar, seat, torso, head]) { m.castShadow = true; m.receiveShadow = false; group.add(m); }
  return {
    group,
    update(state, dt) {
      group.position.set(state.x, state.y, state.z);
      group.quaternion.copy(state.quat);
      const w = (state.speed / wheelR) * dt;
      front.rotation.x += w; rear.rotation.x += w;
    },
    dispose() { for (const m of group.children) { m.geometry.dispose(); m.material.dispose(); } },
  };
}

/* ── createMotoChaseCam — third/first person for a terrain vehicle, GROUND-CLAMPED. ──────────────
   The swing camera's whole containment saga was about walls; a terrain world has none, but the
   GROUND clamp is the half that matters here and it has bitten before (the ledger's refuted list:
   the chase eye went 0.30 u under the floor because segmentHit sweeps buildings and the ground is a
   heightfield no sweep can see). So the eye — BOTH views — is clamped against the same heightAt the
   wheel stands on, every frame: on a downslope the camera slides along the hill instead of sinking
   into it. Azimuth is damped (a chase that hard-snaps to yaw jitters at 120 Hz); position is exact.
   Returns { pose(state, view, dt, heightAt, outPos, outDir), reset(yaw) } — the caller hands the
   pose straight to rig.setEye, which is the documented camera-ownership route (camera-rig.js). */
export function createMotoChaseCam({
  dist = 2.8, height = 1.05, aheadUp = 0.45,      // third person: behind + above, looking a touch above the bike
  eyeH = 0.62, eyeFwd = 0.06,                     // first person: the rider's head
  groundClear = 0.14,                             // the clamp: eye ≥ ground + this, both views
  azTau = 0.22, pitchTau = 0.12,                  // damp time constants (s)
} = {}) {
  let az = 0, fpPitch = 0, seeded = false;
  const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
  // shortest-arc angle damp (yaw wraps; a naive damp spins the long way round at ±π)
  const dampAngle = (a, b, lambda, dt) => {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return a + d * (1 - Math.exp(-lambda * dt));
  };
  return {
    reset(yaw = 0) { az = yaw; fpPitch = 0; seeded = true; },
    pose(state, view, dt, heightAt, outPos, outDir) {
      if (!seeded) { az = state.yaw; seeded = true; }
      az = dampAngle(az, state.yaw, 1 / azTau, dt);
      const H = heightAt || (() => 0);
      if (view === 'first') {
        /* the head, looking along the bike's own pitch — downhill the view tips into the descent,
           mid-air it rotates with the flip (that IS the first-person flip read). */
        fpPitch = damp(fpPitch, state.pitch || 0, 1 / pitchTau, dt);
        const s = Math.sin(state.yaw), c = Math.cos(state.yaw);
        const ex = state.x + s * eyeFwd, ez = state.z + c * eyeFwd;
        let ey = state.y + eyeH;
        ey = Math.max(ey, H(ex, ez) + groundClear);
        outPos.set(ex, ey, ez);
        const cp = Math.cos(fpPitch);
        outDir.set(s * cp, Math.sin(fpPitch), c * cp).normalize();
      } else {
        const s = Math.sin(az), c = Math.cos(az);
        const ex = state.x - s * dist, ez = state.z - c * dist;
        let ey = state.y + height;
        ey = Math.max(ey, H(ex, ez) + groundClear);       // THE clamp — the downslope lesson
        outPos.set(ex, ey, ez);
        outDir.set(state.x - ex, state.y + aheadUp - ey, state.z - ez).normalize();
      }
      return outPos;
    },
  };
}

/* ── createBikeGlbMesh — the REAL bike (A-MOTO-ASSET, 2026-08-19): the Blender-pipeline dirtbike,
   articulated, with the box bike as the load-failure fallback. ───────────────────────────────────
   The asset is `moto_bike.glb`, generated by `tools/blender/build_moto_bike.py` through
   pipeline_lib's vehicle-kit v2 (wedge/cyl part kinds, material slots, baked vertex AO — research
   item 5's named gaps, closed for this model). SAME CONTRACT as createBikeMesh — { group,
   update(state, dt), dispose } with the origin at the ground-contact point — because the VISUAL is
   a pure consumer of `createBikeModel`'s state: swapping meshes must not (and cannot) move the
   physics; the moto-probe's 16 checks are the proof that holds.

   WHAT ARTICULATES (named nodes the generator guarantees — see its RECEIPT lines):
     bike_wheel_f / bike_wheel_r — spin at speed/wheelR (the box bike's own rolling cue)
     bike_forks (bike_wheel_f is its CHILD, so the wheel steers along) — yaws about the RAKED
       steer axis by `steerGain · state.bank`: bank is the model's damped lean, so the bars turn
       with the carve and re-centre in the air exactly as the lean does. The axis constant is the
       generator's printed receipt (STEER_AXIS_THREE), not a guess.
   Static: everything on bike_body (frame, tank, shrouds, seat, fenders, exhaust, pegs).

   THE URL IS THE CONSUMER'S (pedestrians.js's rule, same reason): a `?url` import inside this
   module would base64-inline ~80 KB into every lib bundle. The project imports
   '@lgr/engine-core/assets/models/moto_bike.glb?url' and passes it in.

   FALLBACK, loudly (the createCrowdTiers.js:116 convention): a failed fetch/parse logs and swaps
   in createBikeMesh — the ride degrades to the box bike, never to an invisible rider. `mode`
   ('loading' → 'glb' | 'box') and `ready` are probe receipts, not control flow.

   THE RIDER SEAM — setRider(handle, opts): mounts a character-rig HANDLE (the project owns the
   rig + its GLB URLs) as a child of the bike group, so pitch/lean/flip carry the body exactly
   the way the box bike's capsule rider tilts — parenting IS the lean wiring. Each frame the bike
   re-asserts `poseHold` (idempotent for the same clip/time pair) on a 'ride' state the consumer
   maps to the AUTHORED seated clip (tools/blender/build_ride_clip.py via extraClips — the (B)
   path, because NO shipped survivor clip contains a straddle: the Jump-frame attempt floated the
   body 0.8 u on the clip's own hips-rise, measured). A held pose, not an animation (Rule 12);
   a breathing ride loop is the stated upgrade path (same script, u-dependent tracks).
   C++ anchor: the GLB is a serialized scene subtree; find-by-name returns node pointers we keep —
   no per-frame lookups, no allocation in update(). */
export function createBikeGlbMesh({ url, tint = null, steerGain = 0.9, wheelR = 0.16, leanPoseSpan = 0.42 } = {}) {
  if (!url) throw new Error('createBikeGlbMesh: `url` is required — import it from \'@lgr/engine-core/assets/models/moto_bike.glb?url\' (kept out of the module so the lib build does not inline it; see pedestrians.js)');
  const group = new THREE.Group();
  let mode = 'loading';
  let inner = null;                       // the box-bike fallback delegate (mode 'box')
  let forks = null, wheelF = null, wheelR_ = null;
  let rider = null, riderPose = null;
  let sockets = null;                     // A-WHIP: { handL, handR, footL, footR } grip/peg nodes from the GLB
  // the raked steer axis, fork-local, from the generator's STEER_AXIS_THREE receipt (0, 0.8944,
  // −0.4472): up and leaned back — head sits behind the front axle, as built.
  const STEER_AXIS = new THREE.Vector3(0, 0.8944, -0.4472).normalize();

  const applyRider = () => {
    if (!rider || mode !== 'glb') return;
    if (rider.object.parent !== group) group.add(rider.object);
    /* A-WHIP MOUNT-IK: pin hands to the grip sockets and feet to the pegs — the sockets are
       NODES of the bike GLB (grips are children of bike_forks, so steering carries the hands by
       scene-graph parenting; build_moto_bike.py's RECEIPT sockets line is the guarantee). Both
       halves optional and loud-degrading: an old GLB without sockets, or a handle without the
       ability, keeps the plain held pose — mounted, just not pinned. */
    if (sockets && rider.setMountIK) rider.setMountIK(sockets);
  };

  const ready = new Promise((res) => {
    new GLTFLoader().loadAsync(url).then((gltf) => {
      const root = gltf.scene;
      forks = root.getObjectByName('bike_forks');
      wheelF = root.getObjectByName('bike_wheel_f');
      wheelR_ = root.getObjectByName('bike_wheel_r');
      if (!forks || !wheelF || !wheelR_) throw new Error('moto_bike.glb is missing a named node (bike_forks/bike_wheel_f/bike_wheel_r) — re-run tools/blender/build_moto_bike.py and read its RECEIPT lines');
      /* A-WHIP rider sockets (empties in the GLB). All four or none — a partial set means a
         broken regeneration, and pinning two limbs while two float reads worse than the plain
         pose; degrade whole, loudly (the createCrowdTiers.js:116 convention). */
      const gL = root.getObjectByName('bike_grip_l'), gR = root.getObjectByName('bike_grip_r');
      const pL = root.getObjectByName('bike_peg_l'), pR = root.getObjectByName('bike_peg_r');
      if (gL && gR && pL && pR) sockets = { handL: gL, handR: gR, footL: pL, footR: pR };
      else console.warn('moto bike GLB has no rider sockets (bike_grip_*/bike_peg_*) — the rider keeps the plain held pose; re-run tools/blender/build_moto_bike.py for mount-IK');
      root.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = false;
          // per-instance tint — the material-slot contract: every colourable panel is on a
          // material named *_body (the bounded proof's colour-variety gap, closed at the consumer)
          if (tint && o.material) {
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
              if (m.name && m.name.endsWith('_body')) m.color.set(tint);
            }
          }
        }
      });
      group.add(root);
      mode = 'glb';
      applyRider();
      res(mode);
    }).catch((e) => {
      console.error('moto bike GLB failed to load (falling back to the box bike):', e);
      inner = createBikeMesh({});
      group.add(inner.group);
      mode = 'box';
      res(mode);
    });
  });

  return {
    group,
    ready,
    get mode() { return mode; },
    get rider() { return rider; },          // the mounted handle (probe receipts: mountReport lives on it)
    get hasSockets() { return !!sockets; }, // A-WHIP: whether the GLB carried grip/peg nodes (probe receipt)
    /* Mount a character-rig handle on the seat. pos is the hip anchor over the seat (the
       generator's MOUNT_SEAT_THREE receipt); rot pitches the torso toward the bars. The pose is
       re-asserted every update — poseHold is a pure function of (clip, t01), so this is state-free. */
    setRider(handle, { pos = [0, 0.02, 0.02], rot = [-0.06, 0, 0], scale = 0.155,
                       pose = { name: 'ride', t01: 0.5, weight: 1 } } = {}) {
      rider = handle;
      riderPose = pose;
      handle.object.position.set(pos[0], pos[1], pos[2]);
      handle.object.rotation.set(rot[0], rot[1], rot[2]);
      handle.object.scale.setScalar(scale);
      applyRider();
    },
    /* re-aim the held pose without re-mounting (tuning, and future pose states — standing on the
       pegs, a whip — are one call). The mount transform can ride along for poses whose hip
       translation differs (the Jump clip MOVES the hips through its timeline — measured: t01 0.30
       floats the body 0.8 u; the seated frame lives earlier in the clip). */
    setRiderPose(pose, pos = null) {
      riderPose = pose;
      if (pos && rider) rider.object.position.set(pos[0], pos[1], pos[2]);
    },
    update(state, dt) {
      if (inner) { inner.update(state, dt); return; }
      group.position.set(state.x, state.y, state.z);
      group.quaternion.copy(state.quat);
      if (mode !== 'glb') return;
      const w = (state.speed / wheelR) * dt;
      wheelF.rotation.x += w;
      wheelR_.rotation.x += w;
      // bars follow the damped lean; in the air the bank now follows the WHIP (A-WHIP), so the
      // bars lay into a spin exactly as they carve a corner — one lean, one read
      forks.quaternion.setFromAxisAngle(STEER_AXIS, steerGain * (state.bank || 0));
      if (rider && riderPose) {
        /* A-WHIP: the held pose becomes a LEAN DIAL. The Ride clip is authored as a lean-blend
           (u=0 full LEFT lean → 0.5 neutral → 1 full RIGHT; build_ride_clip.py), and poseHold's
           t01 is a pure function of its argument — so scrubbing it by the model's own damped
           bank IS the body language: carve right, the torso hangs right; whip left, it throws
           left, eased exactly as the bank eases (no second smoothing). bank>0 = bike rolls
           LEFT (the model's +roll about forward), so t01 runs opposite: 0.5 − 0.5·bank/span.
           On the old static clip this scrub is a byte-exact no-op (all frames one pose). */
        const lean = Math.max(-1, Math.min(1, (state.bank || 0) / leanPoseSpan));
        const t01 = Math.max(0, Math.min(1, riderPose.t01 - 0.5 * lean));
        rider.poseHold(riderPose.name, t01, riderPose.weight);
      }
    },
    dispose() {
      if (inner) { inner.dispose(); return; }
      group.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
        }
      });
    },
  };
}
