/* ============================================================
   @lgr/engine-core — createMaterialStudy (Lesson R, scene 7).
   ------------------------------------------------------------
   One solid, three materials: it drifts METAL → GLASS → CERAMIC and back, forever.
   The pitch behind it: a client's product is never "a shader" — it's a MATERIAL, and
   this scene says we can render any of them on the same geometry, live.

   Deliberately a NEW pack, not an edit to createProductMoment (which stays byte-
   identical): same studio-lighting RECIPE (RoomEnvironment → PMREM → scene.environment
   + one key light — createProductMoment.js:52), different subject, camera, backdrop and
   the whole material machine. Copy-and-diverge, per the brief.

   ── THE RECOMPILE TRAP (the thing that makes this scene non-obvious) ──────────
   MeshPhysicalMaterial's optional features are compiled-in DEFINES, not just uniforms:
   three sets USE_CLEARCOAT only when `clearcoat > 0`. So animating clearcoat 0 → 1 → 0
   would CROSS that threshold twice a cycle and force a shader RECOMPILE mid-hero — a
   visible hitch, every loop. The fix is to never touch zero: it stays pinned at a floor of
   1e-4 (visually nil, definitionally non-zero), so the program compiles ONCE with the
   feature on and the morph is pure uniform writes from then on.
   C++ anchor: a template instantiated on a compile-time flag — flipping the flag doesn't
   tweak a value, it swaps the whole specialization. Keep the flag fixed, vary the data.

   ── WHY THE GLASS DOESN'T REFRACT (a real three limitation, measured not assumed) ──
   The obvious way to do glass is `MeshPhysicalMaterial.transmission` — real refraction.
   It is UNSHIPPABLE in a pack that must survive create→dispose, on three r184:

     three.module.js:17915 — currentRenderState.state.transmissionRenderTarget[ camera.id ]
                             = new WebGLRenderTarget(...)

   That target is keyed by CAMERA (inside a render state keyed by SCENE) — and a pack owns
   BOTH. So every pack instance mints a fresh full-screen render target, and three disposes
   it NOWHERE (grep the build: there is no matching dispose/delete). Our dispose() has no
   public handle to free it. Measured: with transmission on, the consumer-probe's dispose
   loop grows GPU textures by exactly one per create (13→21 over ×8); with it off, 12→12.
   A hero page builds a pack once, so this would never bite there — but a site that rebuilds
   scenes leaks a full-screen RT every time, and the probe is right to fail it.

   So glass here is REFLECTIVE + TRANSLUCENT (opacity + clearcoat + a strong env reflection)
   rather than REFRACTIVE. It reads as polished glass/acrylic; what it cannot do is bend the
   background through the knot. That is a deliberate, reported trade — not an oversight.

   Pack contract: { scene, camera, update(dt,elapsed), dispose(), usesBloom:true, tone:'bright' }.
   Reduced motion: the director renders one static frame with elapsed=0 → the metal hold.
   No hot allocation in update(): the colour lerp writes into the material's own THREE.Color.
   ============================================================ */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* L-N re-skin defaults. A COOL studio, deliberately: Product Moment already owns the warm
   sand sweep, and the ring's bright scenes have to stay pairwise-distinct (the probe's
   mean-RGB gate is what enforces "a viewer can tell these apart"). */
const BACKDROP = new THREE.Color('#aebecb');   // cool slate sweep
const METAL    = new THREE.Color('#d8a55e');   // warm bronze
const GLASS    = new THREE.Color('#dff0f4');   // near-clear, faint cool cast
const CERAMIC  = new THREE.Color('#f2ece0');   // warm off-white porcelain

/* The material cycle. Long HOLDS so each material actually gets to be LOOKED at (and so the
   consumer-probe, which samples only once two reads ~4 frames apart agree, can settle —
   under CI's ~1 fps SwiftShader those 4 frames are 4 real seconds). */
const HOLD = 5.0, RAMP = 3.0;
const LEG = HOLD + RAMP;      // one material's dwell + its dissolve into the next
const CYCLE = LEG * 3;        // 24 s: metal → glass → ceramic → metal

const smoothstep = (t) => t * t * (3 - 2 * t);

/* The three material states. `clearcoat` never reaches 0 — see the recompile trap above.
   `opacity` is what carries the glass leg (transmission is off — see the header). */
const EPS = 1e-4;
const STATES = [
  /* METAL   — a mirror-ish bronze: all reflection, no transparency. */
  { metalness: 1.0, roughness: 0.24, opacity: 1.00, clearcoat: EPS,  ior: 1.5, env: 1.0 },
  /* GLASS   — barely rough, mostly see-through, a hard clearcoat sheen on top. */
  { metalness: 0.0, roughness: 0.06, opacity: 0.34, clearcoat: 1.0,  ior: 1.5, env: 1.7 },
  /* CERAMIC — matte body, glazed shell: high roughness UNDER a strong clearcoat. */
  { metalness: 0.0, roughness: 0.62, opacity: 1.00, clearcoat: 0.85, ior: 1.4, env: 0.9 },
];

/* L-V — OWNER TASTE CALL (eyes-on): warm this scene up, and specifically make it warm DIFFERENTLY from
   Product Moment, which the owner found too similar to it (both were inheriting the ring's cool NOON gain
   — see createHeroDirector invariant 3 — and both are bright, adjacent-ish scenes with a knot on a sweep).

   ROSE-COPPER, against Product Moment's YELLOW-GOLD. The distinction is a HUE DIRECTION, not a dose:
     Product   tint (1.00, 0.92, 0.78)  — green held high, blue cut hardest → golden
     this one  tint (1.00, 0.84, 0.80)  — green cut, blue held             → rose/terracotta
   Two scenes warmed by the same amount but along the same axis would have stayed twins. Warming them along
   different axes is what keeps them apart to the eye AND under the probe's pairwise mean-RGB gate.

   The cool SLATE sweep stays — it's what the copper reflects, and killing it would flatten the metal leg.
   The grade warms the light, not the set. Linear values (see Product Moment's note on the steep sRGB curve). */
/* Same calibration lesson as Product Moment (see its note): the first cut was far too strong. But this
   scene starts from a COOL slate sweep, so it can take a little more warm than Product can before it
   tips — the tint has a cool set to fight, not a warm one to compound with. Still rose, still not gold. */
const FILMIC = {
  tint:     new THREE.Color(1.00, 0.88, 0.85),   // rose-copper: green cut, blue held (vs Product's gold)
  lift:     new THREE.Color(0.012, 0.006, 0.006),
  sat:      1.06,
  contrast: 1.05,
};

export function createMaterialStudy(core, {
  backdrop = BACKDROP,   // L-N re-skin: studio sweep
  metal    = METAL,      // L-N re-skin: the metal leg's tint
  glass    = GLASS,      // L-N re-skin: the glass leg's tint
  ceramic  = CERAMIC,    // L-N re-skin: the ceramic leg's tint
  envIntensity = 1.0,
  filmic   = FILMIC,     // L-V: per-scene grade (the L-S seam). Pass null to take the ring's noon grade.
} = {}) {
  const { renderer } = core;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color().copy(backdrop);   // clone: never capture the caller's ref

  const { x: w, y: h } = core.drawBuffer;
  const camera = new THREE.PerspectiveCamera(40, w / h, 0.05, 100);
  camera.position.set(0, 0.5, 7.0);
  camera.lookAt(0, 0, 0);

  /* STUDIO IBL — the product-stage recipe (shared RECIPE, not a shared module): bake
     RoomEnvironment through PMREM once, keep the RT to dispose later. Glass and metal are
     almost entirely REFLECTIONS of their environment, so without an env map this scene
     would render as a dull silhouette — the IBL IS the material. */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room  = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = envIntensity;
  pmrem.dispose();
  /* Free the room's baked boxes — this pack is created/disposed in a loop by the probe. */
  room.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose?.(); });

  const key = new THREE.DirectionalLight(0xfff4e8, 2.0);
  key.position.set(2.2, 3.8, 3.0);
  scene.add(key);

  /* A DIFFERENT knot from Product Moment's (p=2,q=3): this is p=3,q=5 — denser, more
     self-occluding, which is what sells glass (you want the object to refract THROUGH
     itself). Different subject + different sweep = a scene that can't be mistaken for it. */
  const geo = new THREE.TorusKnotGeometry(1.05, 0.32, 240, 40, 3, 5);
  const material = new THREE.MeshPhysicalMaterial({
    color:       new THREE.Color().copy(metal),
    metalness:   STATES[0].metalness,
    roughness:   STATES[0].roughness,
    clearcoat:   STATES[0].clearcoat,   // pinned >0 forever — see the recompile trap
    ior:         STATES[0].ior,
    envMapIntensity: STATES[0].env,
    /* `transparent` is a FLAG, not a uniform — flipping it mid-cycle would re-sort the
       object between render passes. So it's true for the whole life of the pack and the
       morph only moves `opacity` (metal/ceramic sit at 1.0 and simply read as solid).
       depthWrite stays TRUE: at 0.34 the knot's far coils hide behind its near ones, which
       is what a thick glass shell actually does — turning it off would show every coil at
       once and read as a hologram. */
    transparent: true,
    opacity:     STATES[0].opacity,
    depthWrite:  true,
  });
  const mesh = new THREE.Mesh(geo, material);
  scene.add(mesh);

  /* Pre-built colour handles so the per-frame lerp allocates nothing. */
  const TINTS = [new THREE.Color().copy(metal), new THREE.Color().copy(glass), new THREE.Color().copy(ceramic)];

  /* ── update — turntable + the material morph. Uniform writes only. ────────────── */
  function update(dt, elapsed) {
    mesh.rotation.y = elapsed * 0.30;
    mesh.rotation.x = Math.sin(elapsed * 0.22) * 0.14;

    /* Where in the cycle: which leg, and how far through its dissolve. */
    const t = ((elapsed % CYCLE) + CYCLE) % CYCLE;   // guard: elapsed can be 0 (reduced motion)
    const leg = Math.floor(t / LEG);                  // 0 metal · 1 glass · 2 ceramic
    const local = t - leg * LEG;
    const k = local <= HOLD ? 0 : smoothstep((local - HOLD) / RAMP);   // 0 = hold, →1 across the ramp

    const A = STATES[leg], B = STATES[(leg + 1) % 3];
    material.metalness = A.metalness + (B.metalness - A.metalness) * k;
    material.roughness = A.roughness + (B.roughness - A.roughness) * k;
    material.opacity   = A.opacity   + (B.opacity   - A.opacity)   * k;
    material.clearcoat = A.clearcoat + (B.clearcoat - A.clearcoat) * k;
    material.ior       = A.ior       + (B.ior       - A.ior)       * k;
    material.envMapIntensity = A.env + (B.env       - A.env)       * k;
    material.color.copy(TINTS[leg]).lerp(TINTS[(leg + 1) % 3], k);   // writes in place: no alloc
  }

  /* ── dispose — owns geometry + material + the PMREM env target. ───────────────── */
  function dispose() {
    geo.dispose();
    material.dispose();
    envRT.dispose();
    scene.environment = null;
    scene.remove(mesh, key);
  }

  /* build-in casting (createBuildIn opt-in): the single hero sphere. update() writes the sphere's
     ROTATION + MATERIAL (not its position/scale), so a position+scale build-in composes cleanly — the
     sphere presses down and squashes while it keeps turning + morphing. */
  return { scene, camera, update, dispose, usesBloom: true, tone: 'bright', filmic,
           buildGroups: [{ object: mesh, role: 'hero' }] };
}
