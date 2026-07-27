/* ============================================================
   graph-ambient.js — VIZ SLICE 15: AMBIENT EVENTS — rare background flybys (a comet, a tiny ship).
   ------------------------------------------------------------
   The sky's delight beat. Every few minutes, at most ONE thing crosses the far background: a comet
   streaking a shallow diagonal (~4-7s), or — rarer — a tiny procedural pixel spaceship puttering by.
   It should make someone smile and be GONE.

   THE RESTRAINT CONTRACT (as binding as any gate):
     · ONE event airborne at a time — enforced by the scheduler (graph-ambient-core.js), not by hope.
     · LONG, JITTERED intervals — comets ~minutes apart, the ship rarer still. Whimsy, never traffic.
     · BEHIND THE GRAPH — everything here lives BELOW the graph plane (y < 0) and draws at a negative
       renderOrder, between the star slab and the graph. A flyby can add light under a node; it can
       never occlude, dim, or outshine one.
     · REDUCED MOTION = NO EVENTS AT ALL — a thing that moves across the screen is exactly what
       prefers-reduced-motion asks not to see. The consumer calls setEnabled(false); nothing spawns.

   DETERMINISM: the schedule AND every trajectory come from the seeded scheduler's LCG (advanced by the
   loop clock) — no Math.random(), no Date.now() (repo invariant). Same seed, same session length →
   the same comet at the same second on every machine.

   NO HOT ALLOC: both event meshes are built ONCE here and recycled per flight (visible flips, position
   writes). update(dt) allocates nothing — the same discipline as the sim/render paths.

   C++ anchor: a tiny object pool with capacity 1 per effect — spawn() checks out the preallocated
   mesh, despawn checks it back in; the update loop is a plain fixed-dt state machine over POD structs.
   ============================================================ */
import * as THREE from 'three';
import { createAmbientScheduler } from './graph-ambient-core.js';
import cometVert from './shaders/graph-comet.vert';
import cometFrag from './shaders/graph-comet.frag';

/* --- the SHIP TEXTURE: first-party procedural pixel art, drawn in code to an offscreen canvas ---
   A cute saucer in DB32-friendly colors (the pixel look's quantizer maps these to themselves, so the
   sprite arrives crisp instead of getting re-rounded): steel hull, cyan dome, gold running lights,
   orange thruster. TWO frames side-by-side on one canvas (thruster flicker); the texture's repeat/
   offset window flips between them — one texture, zero per-frame uploads.
   NearestFilter everywhere: this is pixel art; a linear filter would smear it into mush BEFORE the
   quantizer ever saw it. */
const SHIP_W = 24, SHIP_H = 16;   // art resolution per frame, in art pixels
function buildShipTexture() {
  const cv = document.createElement('canvas');
  cv.width = SHIP_W * 2; cv.height = SHIP_H;
  const g = cv.getContext('2d');
  const px = (f, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(f * SHIP_W + x, y, w, h); };
  for (let f = 0; f < 2; f++) {
    // hull — a fat lozenge (rows stepped like classic sprite art), facing +X
    px(f, 4, 8, 16, 3, '#847e87');            // DB32 steel
    px(f, 6, 7, 12, 1, '#9badb7');            // top highlight
    px(f, 6, 11, 12, 1, '#696a6a');           // keel shadow
    px(f, 2, 9, 2, 1, '#696a6a');             // tail fin nub
    px(f, 20, 9, 2, 1, '#9badb7');            // nose tip
    // dome
    px(f, 10, 4, 5, 3, '#5fcde4');            // DB32 cyan
    px(f, 11, 4, 2, 1, '#cbdbfc');            // dome glint
    // running lights along the keel — gold, the engine's brand accent
    px(f, 7, 12, 1, 1, '#fbf236');
    px(f, 11, 12, 1, 1, '#fbf236');
    px(f, 15, 12, 1, 1, '#fbf236');
    // thruster — the 2-frame flicker: long orange plume vs short red sputter (putt... putt...)
    if (f === 0) { px(f, 0, 9, 3, 1, '#df7126'); px(f, 1, 8, 1, 3, '#df7126'); }
    else { px(f, 1, 9, 2, 1, '#d95763'); }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.repeat.set(0.5, 1);   // window one frame; update() flips offset.x between 0 and 0.5
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* createGraphAmbient(opts) → { group, update(dt), setEnabled, debugSpawn, meshes, dispose, … }
     seed     scheduler + trajectory determinism (opts, never a clock)
     radius   the spawn ring, world units — flights cross the whole field and fade at the rim
     depth    how far BELOW the graph plane the flyby lane sits (behind the graph, above the star slab)
     camera   optional: the ship billboards toward it (a flat sprite under an oblique iso camera
              foreshortens; the comet WANTS that — see graph-comet.vert — the ship does not)
     comet/ship: { meanInterval, durationMin, durationMax } seconds — the cadence knobs */
export function createGraphAmbient(opts = {}) {
  const {
    seed = 0xa3b1e47,
    radius = 11,
    depth = 3.2,
    camera = null,
    comet = {},
    ship = {},
  } = opts;
  /* Cadence + look knobs, per event. intensity/width exist because of the DB32 lesson (found by
     LOOKING at the diag captures): a comet tuned for harbor's photographic sky QUANTIZES TO NOTHING —
     its 20-40% gray-blue tail rounds below the palette's first blue step and only a 1-vpx head
     survives. The consumer bringing the quantizer brings the boost. */
  const COMET = { meanInterval: 75, durationMin: 4.5, durationMax: 7, intensity: 1.15, width: 1.0, length: 1.0, ...comet };
  const SHIP = { meanInterval: 210, durationMin: 9, durationMax: 13, ...ship };

  const scheduler = createAmbientScheduler({
    seed,
    events: [
      { kind: 'comet', meanInterval: COMET.meanInterval, jitter: 0.45, durationMin: COMET.durationMin, durationMax: COMET.durationMax },
      { kind: 'ship', meanInterval: SHIP.meanInterval, jitter: 0.45, durationMin: SHIP.durationMin, durationMax: SHIP.durationMax },
    ],
  });

  const group = new THREE.Group();

  // ---- COMET: one preallocated flat ribbon (see graph-comet.vert/frag for the look) ----
  const COMET_LEN = 2.8 * COMET.length, COMET_W = 0.22 * COMET.width;   // world units; width holds ≥ ~2 virtual px through the quantizer
  const cometGeo = new THREE.PlaneGeometry(COMET_LEN, COMET_W);
  cometGeo.rotateX(-Math.PI / 2);          // bake it flat into the XZ plane; +X stays the head axis
  const cometMat = new THREE.ShaderMaterial({
    vertexShader: cometVert,
    fragmentShader: cometFrag,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor:     { value: new THREE.Color('#cbdbfc') },   // ice-blue white (DB32's star-white family)
      uIntensity: { value: COMET.intensity },
      uFade:      { value: 0 },
    },
  });
  const cometMesh = new THREE.Mesh(cometGeo, cometMat);
  cometMesh.visible = false;
  cometMesh.frustumCulled = false;   // it spends its life near the rim; culling a 2-draw layer buys nothing
  cometMesh.renderOrder = -8;        // stars -9 < flybys -8 < the graph (0): behind, always
  group.add(cometMesh);

  // ---- SHIP: one preallocated sprite quad with the 2-frame canvas texture ----
  const SHIP_WORLD_LEN = 1.5;        // ~16 virtual px long at the pixel look's default grid — tiny, deliberate
  const shipTex = buildShipTexture();
  const shipMat = new THREE.MeshBasicMaterial({
    map: shipTex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // NORMAL blending, not additive: the hull is DARKER than its lights, and additive would bleach it
    // into a ghost. Behind-the-graph ordering keeps normal blending honest (it can never darken a node —
    // the graph draws after and adds on top).
  });
  const shipMesh = new THREE.Mesh(new THREE.PlaneGeometry(SHIP_WORLD_LEN, SHIP_WORLD_LEN * (SHIP_H / SHIP_W)), shipMat);
  shipMesh.visible = false;
  shipMesh.frustumCulled = false;
  shipMesh.renderOrder = -8;
  group.add(shipMesh);

  // ---- the flight state machine (preallocated vectors; update() never allocates) ----
  let enabled = true;
  let flight = null;   // { kind, mesh, from:V3, dir:V3, dist, event }
  const _from = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _pos = new THREE.Vector3();

  /* Map the scheduler's seeded uniforms u[0..2] to a chord across the field:
       u0 → entry angle on the spawn ring
       u1 → chord skew: aim at the centre ± ~26° so flights CROSS the field but rarely dead-centre
       u2 → (already spent by the scheduler on duration; kept for future flavor)
     The path is a straight line at y = -depth: shallow-diagonal by construction under the iso camera. */
  function beginFlight(ev) {
    const a = ev.u[0] * Math.PI * 2;
    const skew = (ev.u[1] - 0.5) * 0.9;
    _from.set(Math.cos(a) * radius, -depth, Math.sin(a) * radius);
    _dir.set(Math.cos(a + Math.PI + skew), 0, Math.sin(a + Math.PI + skew)).normalize();
    const mesh = ev.kind === 'comet' ? cometMesh : shipMesh;
    // Yaw the mesh so its +X (comet head / ship nose) points along the travel direction.
    mesh.rotation.set(0, Math.atan2(-_dir.z, _dir.x), 0);
    mesh.visible = true;
    flight = { kind: ev.kind, mesh, dist: radius * 2, event: ev };
    flight.from = _from.clone();   // one small alloc per SPAWN (once a minute), never per frame
    flight.dir = _dir.clone();
  }

  function endFlight() {
    if (flight) flight.mesh.visible = false;
    flight = null;
  }

  function update(dt) {
    if (!enabled) return;
    const { spawned, done } = scheduler.advance(dt);
    if (done) endFlight();
    if (spawned) beginFlight(spawned);
    if (!flight) return;

    const ev = flight.event;
    const t = Math.min(ev.t / ev.duration, 1);
    _pos.copy(flight.dir).multiplyScalar(t * flight.dist).add(flight.from);
    flight.mesh.position.copy(_pos);

    if (flight.kind === 'comet') {
      // Ignite entering, die leaving — no pop-in rectangle at the spawn ring.
      cometMat.uniforms.uFade.value = Math.min(t * 6, 1) * Math.min((1 - t) * 6, 1);
    } else {
      // The putt-putt: thruster frame flips at 4Hz of EVENT time (deterministic — ev.t is loop time).
      shipTex.offset.x = Math.floor(ev.t * 4) % 2 === 0 ? 0 : 0.5;
      // Billboard toward the camera if one was given; re-apply travel yaw as a spin around the view axis
      // is not worth the math — the sprite simply faces the camera and FLIPS to match travel direction.
      if (camera) {
        flight.mesh.quaternion.copy(camera.quaternion);
        flight.mesh.scale.x = flight.dir.x < 0 ? -1 : 1;   // nose points the way it flies
      }
    }
  }

  /* setEnabled(false) — the look switcher's + reduced-motion's off switch. Everything freezes AND hides:
     no timer advances, nothing spawns, an in-flight event pauses hidden (it resumes if re-enabled —
     acceptable for a look toggle; reduced-motion sessions simply never re-enable). */
  function setEnabled(on) {
    enabled = !!on;
    group.visible = enabled;
  }

  /* debugSpawn(kind) — the probe's seam (gate AF): forces a flight NOW, refused while one is airborne
     (returns null — the refusal itself is under test). Uses the same scheduler path as nature. */
  function debugSpawn(kind) {
    if (!enabled) return null;
    const ev = scheduler.spawn(kind);
    if (ev) beginFlight(ev);
    return ev;
  }

  /* debugAdvance(seconds) — fast-forward the whole state machine in fixed chunks WITHOUT waiting wall
     clock (gate AG proves "zero spawns over N simulated seconds under reduced motion" in milliseconds). */
  function debugAdvance(seconds) {
    const STEP = 1 / 60;
    for (let t = 0; t < seconds; t += STEP) update(STEP);
  }

  function dispose() {
    cometGeo.dispose(); cometMat.dispose();
    shipMesh.geometry.dispose(); shipMat.dispose(); shipTex.dispose();
  }

  return {
    group, update, setEnabled, debugSpawn, debugAdvance, dispose,
    meshes: { comet: cometMesh, ship: shipMesh },   // probe seam: renderOrder / y / visibility assertions
    get enabled() { return enabled; },
    get active() { return flight ? flight.kind : null; },
    get spawnCount() { return scheduler.spawnCount; },
  };
}
