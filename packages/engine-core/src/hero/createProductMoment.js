/* ============================================================
   @lgr/engine-core — createProductMoment (Lesson K4) + Lesson SHADOWS (the contact shadow).
   ------------------------------------------------------------
   K4 hero scene pack: a floating PROCEDURAL object under studio lighting — the
   "product moment" that says "we build real things," with ZERO GLB. A brushed
   warm-metal torus-knot on a soft studio sweep, slow turntable + gentle float.

   Reuses the product-stage LIGHTING RECIPE (RoomEnvironment → PMREM → scene
   .environment studio IBL + one key DirectionalLight) — the same indoor env
   source createProductStage introduced — but as a hero PACK: it exposes only
   { scene, camera, update, dispose, usesBloom } and lets the director's
   presentBeauty own tone-mapping. Renderer default is NoToneMapping, so the
   MeshPhysicalMaterial writes LINEAR HDR into beautyRT and the filmic pass ACES-
   compresses it exactly once (no double tone-map). NO own render(), NO orbit —
   just turntable + float.

   ── Lesson SHADOWS: the SECOND consumer of createShadowRig — the CONTACT SHADOW ──
   Dusk-Silk proved the rig on its HARDEST case (a heightfield self-shadowing through a
   custom ShaderMaterial). Product Moment proves it on the EASY, DIFFERENT case that a
   studio product shot actually needs: a solid, LIT object dropping a soft contact shadow
   onto a ground. That "second consumer" is the no-pretending test — a shadow ability wired
   into ONE scene is PARTIAL; wired into a second, unlike scene it graduates to LIBRARY.

   Why this consumer is EASY where dusk-silk was hard: the knot is a `MeshPhysicalMaterial`,
   so three's own lighting model casts + receives shadows for free — no shader surgery, no
   customDepthMaterial (a rigid mesh's default depth material already casts its true shape).
   The only new geometry is a matte studio FLOOR (a plane) for the shadow to land on.

   The ONE subtlety, and why we don't just bolt a rig beside the existing key light: this
   material is LIT BY LIGHTS (unlike the silk, whose colour ignores the light and reads the
   shadow only through a mask). A shadow on a lit surface is that surface losing a light it
   was receiving — so the shadow-caster must BE a light that actually illuminates the floor.
   Adding a second directional (rig) next to the plain key would DOUBLE the key contribution
   and brighten the whole scene. Instead, when shadows are on, the rig's DirectionalLight
   REPLACES the plain key — same colour, intensity, and direction — so the knot's shading is
   unchanged and it simply gains a contact shadow. `shadows:false` restores the exact old
   look (plain key, no floor, no casting) → byte-for-byte the original K4 Product Moment.

   Pack contract: { scene, camera, update(dt,elapsed), dispose(), usesBloom:true }.
   Dispose owns: geometry + material + the PMREM env render target + (when on) the floor +
   the shadow rig.
   ============================================================ */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createShadowRig } from './createShadowRig.js';

/* Warm brushed-metal tint (on-token: a gold/bronze in the dusk-harbor family). */
const METAL = new THREE.Color('#d8a55e');
/* Soft studio sweep — warm sand, brighter than the 3 dark scenes so the product
   moment reads distinct in the ring. Pushed warm to survive the director's dusk
   grade (which cools a neutral toward blue-grey). */
const BACKDROP = new THREE.Color('#d8b98a');

/* L-V — OWNER TASTE CALL (eyes-on): warm this scene up.
   It had no grade override, so it inherited the ring's default — which is NOT the "warm dusk" the
   director's header claimed for seven lessons but the core's boot grade, NOON: gradeTint #d6e6f4, a
   COOL BLUE gain (see createHeroDirector invariant 3, corrected in L-U). That cool gain is what the
   owner was reacting to. The L-S `filmic` seam lets this scene opt out of it without touching the
   grade for anyone else.

   GOLDEN, and deliberately not the same warm as Material Study — the owner flagged those two as
   reading too alike, and they sit close in the ring. This one goes YELLOW-GOLD (green held high, blue
   cut hardest); Material Study goes ROSE-COPPER (green cut, blue held). Two different hue directions,
   not two strengths of one — that's what keeps them apart to the eye AND to the probe's mean-RGB gate.

   Authored in LINEAR, not hex: `uGradeTint` is a GAIN multiplied over the image, and the sRGB→linear
   curve is steep — a "gentle" warm hex like #ffe2c4 lands at (1.00, 0.76, 0.56) linear, which is a 44%
   blue cut, i.e. a sunset, not a nudge. THREE.Color(r,g,b) with numbers is already linear (the engine's
   working space), so these values ARE the gain. */
/* CALIBRATED BY EYE, and the first cut was wrong in an instructive way. A tint of (1.00, 0.92, 0.78)
   turned the whole frame into orange juice: the sweep went solid amber and the bronze lost the neutral
   highlights that make it read as METAL. Two effects compounded — the sweep is ALREADY warm sand
   (#d8b98a), and the ring's cool noon gain had been quietly NEUTRALISING it. Dropping the cool and
   adding warm shifts twice. So the correct move here is a near-neutral gain with a whisper of warm:
   most of the warming is simply the cool tint going away. */
const FILMIC = {
  tint:     new THREE.Color(1.00, 0.985, 0.96),  // barely a tint at all — see above
  lift:     new THREE.Color(0.010, 0.006, 0.003),
  sat:      0.96,                                // PULLS the gold back: the sweep is intrinsically amber
  contrast: 1.05,
};

export function createProductMoment(core, {
  envIntensity = 1.0,
  metal    = METAL,      // L-N re-skin: brushed-metal tint; default byte-identical (#d8a55e)
  backdrop = BACKDROP,   // L-N re-skin: studio sweep background; default byte-identical (#d8b98a)
  filmic   = FILMIC,     // L-V: per-scene grade (the L-S seam). Pass null to take the ring's noon grade.
  shadows  = true,       // Lesson SHADOWS: drop a contact shadow onto a studio floor (this is the wired scene).
                         //   false = the pre-shadows K4 look (plain key, no floor) → byte-identical original.
} = {}) {
  const { renderer } = core;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color().copy(backdrop);   // clone: don't capture caller's ref

  const { x: w, y: h } = core.drawBuffer;
  const camera = new THREE.PerspectiveCamera(38, w / h, 0.05, 100);
  camera.position.set(0, 0.9, 7.6);   // pulled back so the whole knot frames with margin
  camera.lookAt(0, 0, 0);

  /* STUDIO IBL — RoomEnvironment → PMREM → scene.environment (the product-stage
     recipe). PMREM borrows the shared renderer once at build; we keep the env RT
     to dispose on teardown (the env texture must outlive the generator). */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room  = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = envIntensity;
  pmrem.dispose();
  /* The room's boxes were GPU-uploaded during baking but are no longer needed —
     free them now so a create→dispose loop doesn't accumulate their geometry/
     materials (product-stage skips this because it builds once; the hero pack is
     created + disposed repeatedly). */
  room.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose?.(); });

  /* One warm key light for a directional highlight the IBL alone won't give. Its colour, intensity,
     and direction are SHARED with the shadow path below: when shadows are on, the rig's light IS this
     key (a shadow-casting version of it), so the knot's shading is identical either way — it just gains
     a cast shadow. `KEY_POS` is where the light sits; the shading DIRECTION is that vector normalised
     (a directional light only cares about direction, not position — position only sites its shadow cam). */
  const KEY_COLOR = 0xfff2e2, KEY_INTENSITY = 2.2;
  const KEY_POS = new THREE.Vector3(2.6, 4.2, 2.4);

  /* shadows OFF → the original plain (non-casting) key, added straight to the scene → byte-identical K4.
     shadows ON  → no plain key here; the rig below adds the casting key instead (see the SHADOWS block). */
  let key = null;
  if (!shadows) {
    key = new THREE.DirectionalLight(KEY_COLOR, KEY_INTENSITY);
    key.position.copy(KEY_POS);
    scene.add(key);
  }

  /* The object: a procedural torus-knot in brushed warm metal. Anisotropy gives
     the brushed-metal streak; high metalness + satin roughness catch the IBL
     softly — higher roughness spreads the highlight so it never clips to a hard
     white zebra (the beauty guard: no clipped highlights). */
  const geo = new THREE.TorusKnotGeometry(1.0, 0.30, 220, 32);
  const material = new THREE.MeshPhysicalMaterial({
    color:      new THREE.Color().copy(metal),
    metalness:  1.0,
    roughness:  0.42,          // satin, not mirror — softens the highlight
    anisotropy: 0.40,          // brushed streak, restrained
    anisotropyRotation: Math.PI * 0.25,
    envMapIntensity: 1.0,
    clearcoat:  0.0,
  });
  const mesh = new THREE.Mesh(geo, material);
  scene.add(mesh);

  /* ── SHADOWS wiring — the contact shadow (the EASY, second consumer of createShadowRig) ──────── */
  const FLOOR_Y = -2.15;                        // the studio table, below the knot's low bob (~-1.44) so the
                                                //   knot FLOATS above it — a product-shot gap + a soft cast shadow.
                                                //   Set low enough that the floor's horizon sits in the lower
                                                //   third (a calm sweep, not a seam bisecting the hero).
  let rig = null, floor = null;
  if (shadows) {
    /* The knot CASTS (it blocks the key) and RECEIVES (its own lobes shadow each other — a solid metal
       object self-occludes, and that reads as real weight). Built-in MeshPhysical does both for free. */
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    /* A matte studio FLOOR to catch the shadow. It must land close to the background gold so floor +
       background read as ONE seamless sweep (an infinity-cove studio table) — the only thing that
       should break the sweep is the shadow the knot drops. Two corrections make that happen (the
       naive "floor colour = backdrop" over-brightens into a pale grey seam, because the background is
       UNLIT emissive colour while a lit MeshStandard floor also picks up the whole studio IBL + the
       2.2 key):
         • base colour DARKENED (× 0.62) so that once lit it climbs back to roughly the backdrop tone
           rather than overshooting it;
         • envMapIntensity DROPPED to 0.35 so the neutral RoomEnvironment IBL doesn't wash the warm
           gold toward grey — the warm key light stays dominant, keeping the floor on-hue with the bg.
       Receiving is just receiveShadow:true — three's own lighting darkens the floor where the key is
       occluded, no shader work. Non-metal + very rough → a soft, quiet ground (a glossy floor would
       mirror the hero and fight it). */
    const floorGeo = new THREE.PlaneGeometry(60, 60);
    floorGeo.rotateX(-Math.PI / 2);             // lay flat in the XZ plane
    const floorMat = new THREE.MeshStandardMaterial({
      color:           new THREE.Color().copy(backdrop).multiplyScalar(0.62),
      roughness:       0.95,
      metalness:       0.0,
      envMapIntensity: 0.35,
    });
    floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    scene.add(floor);

    /* The rig IS the key now: same colour / intensity / direction as the plain key above, but shadow-
       casting. It fits an orthographic shadow camera to a SMALL sphere around the knot + its contact
       patch — a tight frustum spends the shadow map's texels where they show (crisp contact), not on
       acres of empty floor. animatedCaster: the knot turns + bobs every frame, so its cast shadow is
       new each frame — re-render the shadow map each frame (a static prop would only re-render when the
       sun moved; the sun here is fixed studio lighting, so the caster's motion is the only thing moving). */
    rig = createShadowRig(core, {
      scene,
      color:      KEY_COLOR,
      intensity:  KEY_INTENSITY,
      center:     [0, FLOOR_Y * 0.5, 0],        // midway between the floating knot and the floor
      radius:     4.0,                          // covers the knot (~1.3) + the shadow it throws
      distance:   24,
      mapSize:    2048,
      bias:       -0.0006,                      // just past the acne threshold for this rounded caster/receiver
      normalBias: 0.03,                         // MeshPhysical HAS normals → a normal-offset trims curved-surface acne
      softness:   4.0,                          // soft studio penumbra (a broad softbox, not a hard point source)
      animatedCaster: true,
    });
    rig.setSunDir(KEY_POS);                     // aim the shadow sun where the key was → the shadow agrees
                                                //   with the specular highlight (both cast by the same light)
  }

  /* update — turntable + gentle float. Scalars only, no hot alloc. */
  function update(dt, elapsed) {
    mesh.rotation.y = elapsed * 0.35;              // slow turntable
    mesh.rotation.x = Math.sin(elapsed * 0.25) * 0.12;
    mesh.position.y = Math.sin(elapsed * 0.6) * 0.14;  // gentle bob
    /* Tick the rig: with a fixed sun + animatedCaster this re-renders the shadow map every frame (the
       knot moved). When the QualityGovernor sheds shadows on a weak GPU, the rig freezes the map (costs
       nothing) — the contact shadow then holds its last soft shape under the slowly-turning knot rather
       than tracking it; acceptable, since it stays a soft centred blob and only happens on the low rungs. */
    if (rig) rig.update();
  }

  /* dispose — owns geometry + material + the PMREM env target + (when on) the floor + the shadow rig. */
  function dispose() {
    geo.dispose();
    material.dispose();
    envRT.dispose();
    scene.environment = null;
    scene.remove(mesh);
    if (key) scene.remove(key);
    if (floor) { floor.geometry.dispose(); floor.material.dispose(); scene.remove(floor); }
    if (rig) rig.dispose();
  }

  return {
    scene, camera, update, dispose, usesBloom: true, tone: 'bright', filmic,
    /* Vertical (9:16) safe-area hint (Lesson PIPELINE-MULTIPLIERS): the subject is the torus-knot
       (bounding radius ~1.3 + tube) plus a touch of its contact shadow below — centre a hair low so the
       shadow reads. createCameraDirector's vertical reframe fits THIS sphere to the portrait frame. */
    framing: { center: [0, -0.2, 0], radius: 1.7 },
  };
}
