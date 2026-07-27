/* ============================================================
   @lgr/engine-core — createDuskSilk (Lesson K1) + Lesson SHADOWS (self-shadowing silk).
   ------------------------------------------------------------
   K1 hero scene pack: a flowing silk/wave surface — the 3D evolution of the site's hero-gradient.
   Vertex-displaced by layered noise/sine fields, fragment-shaded ink→gold→cream from dusk-harbor
   tokens, bloom on the crests.

   ── Lesson SHADOWS: the silk now SELF-SHADOWS under a low, sweeping golden-hour sun ──
   The obvious win the shadow lesson was after: under a raking sun the wave CRESTS throw long
   shadows down their lee slopes and into the troughs, and those shadows MOVE as the sun sweeps —
   which is what makes a flat gradient read as real, lit fabric. It is wired through the reusable
   createShadowRig (the engine-first ability): the rig owns a shadow-casting DirectionalLight +
   fitted shadow camera + the governor/dirty-flag plumbing; this pack just points the sun and
   makes the silk cast + receive.

   Two things this pack must get right for the cast shadow to match the surface (the shadow lesson's
   traps), both handled here:
     • customDepthMaterial — the shadow is cast by re-rendering the silk from the sun's view. The
       default depth material would cast the FLAT plane. So we hand the mesh a custom depth material
       (silk-depth.*) that applies the SAME wave displacement, sharing the exact displacement code
       via the silk-displace.glsl include. Its uTime is driven in lockstep with the render material.
     • animatedCaster — the wave flows every frame, so the shadow map is re-rendered every frame
       (a static-caster scene would only re-render when the sun moved; the rig supports both).

   `shadows` defaults ON (this is the wired scene). Pass `shadows:false` for the pre-shadows look:
   uShadow=0 makes the frag's shadow term an identity, i.e. byte-for-byte the original K1 silk.
   No other hero scene is touched, so their present output is unchanged (present-parity holds).

   Pack contract:
     create(core, opts) → { scene, camera, update(dt,elapsed), dispose(), usesBloom, tone }
     update: no hot alloc — sets uTime uniforms + sweeps the sun (cached vectors) + ticks the rig.
     dispose: geometry + material + depth material + the shadow rig.
     usesBloom: true — crest brightness 2.4× in HalfFloat beautyRT triggers the filmic bloom pass.

   Beauty guards (invariant): no GL_LINES (triangle mesh); additive capped BRIGHT_HIGH=2.4×;
   linear-sRGB HDR gradient + dither in filmic; ACES compresses HalfFloat→SDR.
   ============================================================ */
import * as THREE from 'three';
import silkVert from '../shaders/silk.vert';
import silkFrag from '../shaders/silk.frag';
import silkDepthVert from '../shaders/silk-depth.vert';
import silkDepthFrag from '../shaders/silk-depth.frag';
import { createShadowRig } from './createShadowRig.js';

/* L-N re-skin defaults — the dusk-harbor gradient, linear sRGB (matches silk.frag's old consts
   exactly, so a default build is byte-identical WHEN shadows are off). A client build passes its own. */
const DEFAULT_INK   = new THREE.Color(0.009, 0.004, 0.001);
const DEFAULT_GOLD  = new THREE.Color(1.000, 0.258, 0.101);
const DEFAULT_CREAM = new THREE.Color(0.650, 0.563, 0.474);

export function createDuskSilk(core, {
  ink     = DEFAULT_INK,
  gold    = DEFAULT_GOLD,
  cream   = DEFAULT_CREAM,
  shadows = true,          // Lesson SHADOWS: self-shadow the silk (this is the wired scene). false = pre-shadows look.
} = {}) {
  /* Own scene — isolated from core.scene (godrays skip by design: wrong camera). */
  const scene = new THREE.Scene();

  /* Own camera. Aspect set at create time from renderer drawBuffer; updated by the director's
     registerContentResizer when the window resizes. */
  const { x: w, y: h } = core.drawBuffer;
  const camera = new THREE.PerspectiveCamera(52, w / h, 0.1, 500);
  /* Oblique aerial view: looking across the silk from a low angle — a silken sea from a low cliff. */
  camera.position.set(0, 5.5, 13);
  camera.lookAt(0, 0.5, 0);

  /* Silk geometry — wide plane, x/z aligned, many segments for smooth waves.
     120 × 80 = 9 600 quads → 19 200 triangles. */
  const geo = new THREE.PlaneGeometry(40, 24, 120, 80);
  geo.rotateX(-Math.PI / 2);  // lay flat in the XZ plane

  /* lights:true so three injects the shadow uniforms/defines (directionalShadowMap, the matrices,
     USE_SHADOWMAP…) our silk.frag samples via getShadowMask(). We merge UniformsLib.lights (those
     shadow uniforms) with our own. The silk's COLOUR is not light-driven — the light exists to cast
     shadows; it reaches the fabric only through the shadow mask. */
  const material = new THREE.ShaderMaterial({
    vertexShader:   silkVert,
    fragmentShader: silkFrag,
    lights: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.lights,
      {
        uTime:   { value: 0 },
        uInk:    { value: new THREE.Color().copy(ink) },    // clone so the caller's Color isn't captured by ref
        uGold:   { value: new THREE.Color().copy(gold) },
        uCream:  { value: new THREE.Color().copy(cream) },
        uShadow: { value: shadows ? 1 : 0 },                // self-shadow strength (0 = pre-shadows byte-identical)
      },
    ]),
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geo, material);
  scene.add(mesh);

  /* ── SHADOWS wiring ──────────────────────────────────────────────────────────────────────── */
  let rig = null;
  if (shadows) {
    /* The silk both CASTS (crests occlude the sun) and RECEIVES (troughs go dark) — self-shadowing. */
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    /* customDepthMaterial: cast the WAVE, not the flat plane. Shares the displacement include; its
       uTime is advanced with the render material's every frame (see update). */
    mesh.customDepthMaterial = new THREE.ShaderMaterial({
      vertexShader:   silkDepthVert,
      fragmentShader: silkDepthFrag,
      uniforms: { uTime: { value: 0 } },
    });

    /* The rig: a shadow-casting sun fitted to the silk's bounds. The plane is 40×24 with waves
       ~±3.7, so a bounding sphere of ~24 covers it at any sun angle. bias tuned for a smooth
       heightfield (a blockier scene would want less) — the acne↔peter-pan tradeoff, in one number.
       animatedCaster: the wave is new each frame → re-render the shadow map each frame. */
    rig = createShadowRig(core, {
      scene,
      center: [0, 0, 0],
      radius: 24,
      distance: 46,
      mapSize: 2048,
      bias: -0.0016,     // tuned to sit just past the acne threshold on this smooth heightfield
      softness: 3.5,     // wide PCF → a soft golden-hour penumbra (the sun is a disc, not a point);
                         // also dissolves the shadow-map texel stair-stepping a crisp edge would show
      animatedCaster: true,
    });
  }

  /* Golden-hour sun: a LOW elevation (long shadows) whose azimuth slowly sweeps side to side, so
     the shadows visibly travel — a shadow is a time behaviour. Cached vector, no per-frame alloc. */
  const SUN_ELEV = 0.20;                                  // ~11.5° above the horizon — raking, golden
  const SUN_AZ_BASE = -0.55;                              // light from screen-ish left
  const SUN_AZ_SWING = 0.75;                              // radians the azimuth sweeps
  const SUN_SWEEP_RATE = 0.05;                            // slow — a calm, confident travel
  const _sun = new THREE.Vector3();
  const cosE = Math.cos(SUN_ELEV), sinE = Math.sin(SUN_ELEV);

  function aimSun(elapsed) {
    const az = SUN_AZ_BASE + Math.sin(elapsed * SUN_SWEEP_RATE) * SUN_AZ_SWING;
    _sun.set(Math.cos(az) * cosE, sinE, Math.sin(az) * cosE);
    rig.setSunDir(_sun);
  }
  if (rig) aimSun(0);   // seed a sane sun before the first frame

  /* update — advance the wave clock (both render + depth materials, in lockstep so the cast shadow
     matches the surface), sweep the sun, tick the rig (governor + dirty-flag), and track the
     governor's shadow strength into uShadow so shadows fade out when the GPU sheds them. */
  function update(dt, elapsed) {
    material.uniforms.uTime.value = elapsed;
    if (rig) {
      mesh.customDepthMaterial.uniforms.uTime.value = elapsed;   // MUST match the render clock
      aimSun(elapsed);
      rig.update();
      material.uniforms.uShadow.value = rig.strength;            // 1 normally, 0 when shadows shed
    }
  }

  /* dispose — owns geometry + material + depth material + the shadow rig. */
  function dispose() {
    geo.dispose();
    material.dispose();
    if (rig) { mesh.customDepthMaterial.dispose(); rig.dispose(); }
    scene.remove(mesh);
  }

  return { scene, camera, update, dispose, usesBloom: true, tone: 'dark' };
}
