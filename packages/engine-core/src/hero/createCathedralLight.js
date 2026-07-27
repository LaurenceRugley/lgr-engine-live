/* ============================================================
   @lgr/engine-core — createCathedralLight (Lesson AB, "Cathedral Light").
   ------------------------------------------------------------
   The ring's most dramatic scene: warm god-ray shafts pouring from a high window down into a dark nave,
   dust drifting in the beams. The deep-dark counterweight to Letterpress's bright paper — maximum drama.

   ── PACK-OWNED RAYS (the architecture note the menu flagged) ──
   The engine's godraysPass projects the sun through the CITY camera + SunRig, so the hero director skips it
   (createHeroDirector invariant 2 — a hero pack has neither). Instead of un-leaning that city-coupled pass,
   this scene OWNS its light: cathedral-light.frag scatters shafts from a fixed source point in the pack's own
   screen space, single pass, no render targets, nothing reading the wrong camera. See that shader's header.

   Pack contract: { scene, camera, update(dt,elapsed), dispose(), usesBloom:true, tone:'dark', filmic }.
   usesBloom is TRUE on purpose (opposite of the paper scenes): the shafts and window are emissive warm
   light authored past 1.0 in linear, so the director's bloom makes them bleed — that glow IS the drama.
   Reduced motion: every animated term is f(elapsed) → the director's static frame (elapsed=0) is a full,
   lit still. No hot allocation in update().
   ============================================================ */
import * as THREE from 'three';
import fullscreenVert from '../shaders/fullscreen.vert';
import cathedralFrag from '../shaders/cathedral-light.frag';

/* Colours in LINEAR (hero packs are tonemapped/graded downstream — the createLivingInk convention). */
const SHADOW = new THREE.Color(0.006, 0.008, 0.013);   // near-black nave, a faint cool cast so the dark owns a hue
const LIGHT  = new THREE.Color(1.00, 0.66, 0.34);      // warm amber shaft light (scaled >1 in-shader for bloom)

/* A warm, punchy grade — escapes the ring's cool NOON slate (createHeroDirector invariant 3) and leans into
   the drama: contrast deepens the nave against the shafts, a touch of saturation warms the light. */
const CATHEDRAL_FILMIC = {
  tint:     new THREE.Color(1.0, 0.90, 0.74),
  lift:     new THREE.Color(0, 0, 0),
  sat:      1.08,
  contrast: 1.15,
};

export function createCathedralLight(core, {
  shadow    = SHADOW,                         // LINEAR dark ground
  light     = LIGHT,                          // LINEAR warm shaft colour
  source    = new THREE.Vector2(0.42, 1.34),  // where the light comes FROM (well above the frame → shafts pour down)
  windowPos = new THREE.Vector2(0.44, 1.02),  // the visible warm glow, at the top edge (light entering high)
  rayFreq   = 7.0,                            // how many shafts fan out
  density   = 1.0,                            // overall shaft intensity
  falloff   = 1.2,                            // how fast the shafts fade into the dark (lower = beams reach deeper)
  dust      = 1.0,                            // dust-mote amount
  filmic    = CATHEDRAL_FILMIC,               // pass null to take the ring's cool noon grade
} = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);  // fullscreen quad; see fullscreen.vert

  const uniforms = {
    uTime:       { value: 0 },
    uResolution: { value: new THREE.Vector2(core.drawBuffer.x, core.drawBuffer.y) },
    uSource:     { value: source.clone() },       // clone: never capture the caller's ref
    uWindow:     { value: windowPos.clone() },
    uShadow:     { value: new THREE.Color().copy(shadow) },
    uLight:      { value: new THREE.Color().copy(light) },
    uRayFreq:    { value: rayFreq },
    uDensity:    { value: density },
    uFalloff:    { value: falloff },
    uDust:       { value: dust },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader:   fullscreenVert,
    fragmentShader: cathedralFrag,
    uniforms,
    depthTest:  false,
    depthWrite: false,
  });
  const geo = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(geo, material);
  quad.frustumCulled = false;
  scene.add(quad);

  /* update — advance the shaft/dust clock, keep the box aspect current. Mutates cached objects only. */
  function update(dt, elapsed) {
    uniforms.uTime.value = elapsed;
    uniforms.uResolution.value.set(core.drawBuffer.x, core.drawBuffer.y);
  }

  function dispose() {
    geo.dispose();
    material.dispose();
    scene.remove(quad);
  }

  return { scene, camera, update, dispose, usesBloom: true, tone: 'dark', filmic };
}
