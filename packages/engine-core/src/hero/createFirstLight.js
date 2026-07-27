/* ============================================================
   @lgr/engine-core — createFirstLight (Lesson AC, "First Light").
   ------------------------------------------------------------
   "The minute before sunrise." The ring's quiet, hopeful, cool-toned complement to Cathedral Light's warm
   dark. A big pre-dawn sky is the subject; a low minimal hill SILHOUETTE sits on the horizon; the atmospheric
   gradient does the work. Restraint is the aesthetic — this scene whispers, then gives one gold moment when
   the sun's limb breaks, and recedes. See first-light.frag for the single-scalar (sun-height) sweep that runs
   the whole mood on the canonical SunRig one-scalar-t pattern (docs day/night standard).

   WHY A PROCEDURAL SILHOUETTE, NOT generateTerrain: the brief frames the terrain as a minimal SILHOUETTE with
   "the atmospheric gradient doing the work" — so a 1-D procedural horizon (gentle sine swells + a little
   noise, rolling hills not dunes) is the right tool, not a 3-D heightfield mesh. The sky, not the land, is the
   subject. (If a literal 3-D terrain is ever wanted, that is a heavier follow-up.)

   Pack contract: { scene, camera, update(dt,elapsed), dispose(), usesBloom:true, tone:'dark', filmic }.
   usesBloom TRUE so the sun's core (authored >1 linear) gets its one soft flare. tone 'dark': the scene is
   predominantly cool/dark with a dark foreground silhouette where copy sits — the gold is a brief peak.
   Reduced motion: uTime=0 → the still is deep blue hour (stars out, sun below the horizon) — a valid frame.
   Colours LINEAR (graded downstream). No hot allocation in update().
   ============================================================ */
import * as THREE from 'three';
import fullscreenVert from '../shaders/fullscreen.vert';
import firstLightFrag from '../shaders/first-light.frag';

/* Restrained palette, LINEAR. Saturation stays low until the limb breaks; the gold is the one warm note. */
const NIGHT_ZENITH  = new THREE.Color(0.025, 0.045, 0.120);  // deep but PRESENT indigo, top of sky
const NIGHT_HORIZON = new THREE.Color(0.090, 0.150, 0.300);  // luminous slate-blue at the horizon (blue hour)
const ROSE          = new THREE.Color(0.320, 0.140, 0.150);  // dusty rose — the first warming, muted
const GOLD          = new THREE.Color(0.900, 0.520, 0.210);  // pale honey — the limb-break bloom
const DAY_ZENITH    = new THREE.Color(0.140, 0.220, 0.360);  // kept a cool pale slate even at peak (restraint)
const LAND          = new THREE.Color(0.008, 0.012, 0.022);  // near-black cool hill silhouette

/* Near-neutral, faintly warm grade — escapes the ring's cool NOON slate (createHeroDirector invariant 3) so
   the gold reads true, without warming the blue hour away. Gentle contrast; saturation held (restraint). */
const FIRST_LIGHT_FILMIC = {
  tint:     new THREE.Color(1.0, 0.98, 0.95),
  lift:     new THREE.Color(0, 0, 0),
  sat:      1.0,
  contrast: 1.06,
};

export function createFirstLight(core, {
  speed        = 0.02,          // loop speed — small = slow (a ~50 s dawn that keeps almost arriving)
  horizon      = 0.30,          // horizon height (low → big sky as the subject)
  starBrightness = 0.85,        // star-field intensity. A taste knob, exposed the HOUSE way (a pack option, not
                                // a fork) so a consumer can dial the twinkle without editing the shader. Default
                                // 0.85 (was a hard-coded 0.6) — the owner asked for "a little more prominent,
                                // nothing crazy". In C++ terms: a const the caller can override at construction,
                                // handed straight to the GPU kernel as the uStarBright uniform.
  nightZenith  = NIGHT_ZENITH,
  nightHorizon = NIGHT_HORIZON,
  rose         = ROSE,
  gold         = GOLD,
  dayZenith    = DAY_ZENITH,
  land         = LAND,
  filmic       = FIRST_LIGHT_FILMIC,   // pass null to take the ring's cool noon grade
} = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);   // fullscreen quad (fullscreen.vert)

  const uniforms = {
    uTime:         { value: 0 },
    uResolution:   { value: new THREE.Vector2(core.drawBuffer.x, core.drawBuffer.y) },
    uSpeed:        { value: speed },
    uHorizon:      { value: horizon },
    uNightZenith:  { value: new THREE.Color().copy(nightZenith) },   // clone: never capture caller refs
    uNightHorizon: { value: new THREE.Color().copy(nightHorizon) },
    uRose:         { value: new THREE.Color().copy(rose) },
    uGold:         { value: new THREE.Color().copy(gold) },
    uDayZenith:    { value: new THREE.Color().copy(dayZenith) },
    uLand:         { value: new THREE.Color().copy(land) },
    uStarBright:   { value: starBrightness },   // scalar taste knob (see option above); no clone needed — number
  };

  const material = new THREE.ShaderMaterial({
    vertexShader:   fullscreenVert,
    fragmentShader: firstLightFrag,
    uniforms,
    depthTest:  false,
    depthWrite: false,
  });
  const geo = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(geo, material);
  quad.frustumCulled = false;
  scene.add(quad);

  /* update — advance the one scalar (via uTime) + keep the box aspect current. Cached mutation only. */
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
