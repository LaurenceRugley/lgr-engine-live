/* ============================================================
   sun-rig.js — Lesson 09: a day/night cycle from ONE number.
   ------------------------------------------------------------
   STANDING LGR INFRASTRUCTURE. Laurence wants a day/night cycle in every project
   (an instant way to see how light reads on any asset). So this is built to be
   PORTABLE — it knows nothing about water, towers, or palettes. It exposes a few
   colours/vectors/scalars; whoever owns the scene wires them into their lights and
   shaders. Drop this file into the site, a customer template, or John's game.

   THE WHOLE IDEA: one scalar `t ∈ [0,1)` is the time of day (0 = midnight, 0.25 =
   dawn, 0.5 = noon, 0.75 = dusk). Everything else is a function of t:

   1. SUN DIRECTION — a tilted circular ARC (NOT real astronomy/ephemeris; 5 lines,
      and art-directable). The sun rides a circle whose plane is tilted ~40° in
      azimuth so shadows always have a sideways component (a sun straight overhead
      casts no readable shadow). When the sun is below the horizon we reuse the SAME
      light as the MOON — flipped to the opposite side, cool and dim — instead of a
      second light. "Day for night": night is BLUE and READABLE, never black.

   2. ENVIRONMENT — four KEYFRAMED "looks" (night / dawn / noon / dusk), each a small
      bundle of colours + intensities. We LERP between the two bracketing keyframes
      by t (the Wind Waker technique: hand-author a few moods, blend between them —
      far more controllable than physically simulating the sky). Authoring beats
      simulating for a stylised look.

   3. UNIFORMS BY REFERENCE — the key integration trick. We expose Color/Vector3
      objects and MUTATE THEM IN PLACE every frame (never reassign). A consumer does
      `material.uniforms.uLightDir.value = rig.sunDir` ONCE at setup; because it now
      holds the very same object the rig edits, it updates for free every frame —
      zero per-frame allocation, every shader phase-locked to the same sun. (Three's
      light OBJECTS aren't uniforms, so those few we .copy() each frame.)

   CONTROLS are the owner's job; this module just offers the verbs: cyclePreset()
   (jump to the next dawn/noon/dusk/night, eased), nudge(hours) (scrub), toggleAuto()
   (a slow ~90 s auto-cycle), setReducedMotion() (freeze the auto-cycle — WCAG 2.3.1:
   never flash/animate the whole screen faster than a few seconds per cycle).
   ============================================================ */
import * as THREE from 'three';

const TWO_PI = Math.PI * 2;
const TILT   = 0.70;   // ~40° tilt of the arc PLANE from vertical → the sun peaks at
                       // ~50° (never the zenith, which would light only flat tops and
                       // leave the side faces we see in dimetric black) and always keeps
                       // a horizontal component, so shadows always have a direction.
const CYCLE_SECONDS = 90;  // a full auto day (WCAG-safe: tens of seconds, never a strobe)
const EASE_K = 6;          // preset/scrub easing rate (~0.8 s to settle)

/* The four KEYFRAMES, at t = 0 / .25 / .5 / .75. Each: the sun/moon colour + intensity,
   the hemisphere sky/ground ambient, the backdrop's horizon+sky tints, post-exposure,
   the toon outline colour (black by day → deep navy at night), windowGlow (emissive
   night-window level), and toonGain (the toon-pass tone lift — higher at night so a dark
   scene still posterizes to a readable blue instead of a black void).
   FIX PASS (L09): noon brightened to read unmistakably as DAYTIME (sun intensity +
   exposure + a lighter sky), dawn/dusk nudged up to sit between night and noon, and the
   night sky lifted to a visible deep blue ("day for night", never black). */
/* L66: each keyframe also carries the PREETHAM ATMOSPHERIC SKY params (turbidity = haze; rayleigh =
   blue-scatter strength; mie = sun-halo size; mieG = halo forward-bias). Noon = clean low-turbidity
   blue; dawn/dusk = hazy, high-Mie → a big red sun halo (golden hour for free). These lerp like the
   colour keyframes, so the sky stays art-directed (the Wind-Waker authoring the rig already uses). */
/* L67: + a COLOUR-GRADE MOOD per keyframe (gradeTint = a subtle gain multiply toward a hue; gradeSat =
   saturation; gradeLift = a tiny shadow tint) so the whole beauty frame reads as ONE graded film —
   warm at dawn/dusk, clean-punchy at noon, cool-desaturated at night. Applied AFTER ACES, beauty-tier only. */
const KEYFRAMES = [
  { name: 'night', // t = 0.00 — moonlit, deep blue, readable
    sun: '#4a6f9e', intensity: 0.35, hemiSky: '#26344f', hemiGround: '#0c1018',
    horizon: '#1e2942', sky: '#36486e', exposure: 0.95, outline: '#101a30', window: 1.00, toonGain: 2.6,
    turbidity: 3.0, rayleigh: 1.0, mie: 0.004, mieG: 0.75,
    gradeTint: '#cfd8ec', gradeSat: 0.84, gradeLift: '#05070e', gradeContrast: 1.0 },
  { name: 'dawn',  // t = 0.25 — warm low sun, between night and day
    sun: '#ff9e54', intensity: 2.4, hemiSky: '#8a7686', hemiGround: '#2a1f1a',
    horizon: '#b8512c', sky: '#ffb070', exposure: 1.05, outline: '#241826', window: 0.30, toonGain: 2.0,
    turbidity: 6.0, rayleigh: 3.0, mie: 0.025, mieG: 0.86,
    gradeTint: '#ffe6cf', gradeSat: 1.05, gradeLift: '#0a0603', gradeContrast: 1.04 },
  { name: 'noon',  // t = 0.50 — FULL key, clearly daytime, lighter steel sky
    sun: '#fff4e0', intensity: 4.6, hemiSky: '#9cb8cc', hemiGround: '#33302a',
    horizon: '#5e7689', sky: '#aacadd', exposure: 1.18, outline: '#0b0a08', window: 0.00, toonGain: 1.7,
    // L68/L69 item 0 — NOON BEAUTY CRISPNESS. NB: the levers that ALSO drive the pixel tier (exposure, sun
    // intensity, the backdrop sky/horizon hexes, scene.fog) are LEFT ALONE — touching them shifts the pixel
    // maxLuma off 88 and breaks byte-identical. (And the FogExp2 fog is 0 in clear weather anyway — DESIGN's
    // "fog melts the city" premise was wrong; the real cause is LOW CONTRAST + bloom haze on the pale buildings.)
    // So the fix is BEAUTY-GATED only: a deeper-blue sky (rayleigh↑/turbidity↓ → blue, not white) + a brighter,
    // more SATURATED + higher-CONTRAST grade (separates buildings from the sky → crisp, legible) + the bloom
    // eased down at high sun (less haze; see bloomPass). Dawn/dusk/night untouched.
    turbidity: 1.3, rayleigh: 3.6, mie: 0.005, mieG: 0.78,   // L108 sky-sun (Lever 1a): deeper Rayleigh blue so the noon sky STOPS being a flat pale gray-green (separates from the city). BEAUTY-ONLY — skyParams drives only the Preetham mesh (visible on beauty) + the beauty IBL; stylized tiers show the flat backdrop from horizon/sky HEXES → byte-identical. Live-tune.
    gradeTint: '#d6e6f4', gradeSat: 1.34, gradeLift: '#000000', gradeContrast: 1.26 },
  { name: 'dusk',  // t = 0.75 — redder than dawn, between day and night
    sun: '#ff6b35', intensity: 2.0, hemiSky: '#7a566a', hemiGround: '#281a18',
    horizon: '#b0432a', sky: '#ff8a5a', exposure: 1.05, outline: '#1f1420', window: 0.72, toonGain: 2.0,   // L93: city IGNITES at dusk (was 0.40) — the hero beat
    turbidity: 7.0, rayleigh: 3.2, mie: 0.028, mieG: 0.87,
    gradeTint: '#ffdcc0', gradeSat: 1.06, gradeLift: '#0c0604', gradeContrast: 1.05 },
];

const wrap = (x) => x - Math.floor(x);                       // → [0,1)
const lerp = (a, b, f) => a + (b - a) * f;
const damp = (curr, goal, dt) => curr + (goal - curr) * (1 - Math.exp(-EASE_K * dt));

export function createSunRig({ t = 0.5 } = {}) {              // boot at noon
  let currT = t, goalT = t;
  let auto = false, reducedMotion = false;

  /* Parse the keyframe hexes into Color objects ONCE (no per-frame string parsing). */
  const KF = KEYFRAMES.map((k) => ({
    name: k.name,
    sun: new THREE.Color(k.sun), hemiSky: new THREE.Color(k.hemiSky),
    hemiGround: new THREE.Color(k.hemiGround), horizon: new THREE.Color(k.horizon),
    sky: new THREE.Color(k.sky), outline: new THREE.Color(k.outline),
    intensity: k.intensity, exposure: k.exposure, window: k.window, toonGain: k.toonGain,
    turbidity: k.turbidity, rayleigh: k.rayleigh, mie: k.mie, mieG: k.mieG,   // L66 Preetham sky params
    gradeTint: new THREE.Color(k.gradeTint), gradeLift: new THREE.Color(k.gradeLift), gradeSat: k.gradeSat, gradeContrast: k.gradeContrast,  // L67/L69 grade
  }));

  /* The EXPOSED state — mutated in place every update(); consumers bind these by
     reference. Scalars are read through getters (numbers can't be shared by ref). */
  const sunDir     = new THREE.Vector3(0, 1, 0);
  const sunColor   = new THREE.Color('#fff4e0');
  const hemiSky    = new THREE.Color('#6f97b3');
  const hemiGround = new THREE.Color('#2a2620');
  const horizon    = new THREE.Color('#3a4a57');
  const sky        = new THREE.Color('#7da3bd');
  const outline    = new THREE.Color('#0b0a08');
  const toonFloor  = new THREE.Color('#000000');   // night ambient floor for the toon pass
  let sunIntensity = 3.0, exposure = 1.0, windowGlow = 0.0, toonGain = 1.7;
  const skyParams = { turbidity: 2.2, rayleigh: 1.3, mie: 0.005, mieG: 0.78 };   // L66: lerped Preetham params
  const grade = { tint: new THREE.Color('#fafdff'), lift: new THREE.Color('#000000'), sat: 1.08, contrast: 1.0 };   // L67/L69: lerped grade mood

  const sunArc = new THREE.Vector3();

  function applyEnvironment(time) {
    /* Find the two bracketing keyframes and the blend fraction f between them. */
    const seg = wrap(time) * 4.0;       // 0..4 across night→dawn→noon→dusk→(night)
    const i   = Math.floor(seg) % 4;
    const j   = (i + 1) % 4;
    const f   = seg - Math.floor(seg);
    const a = KF[i], b = KF[j];

    sunColor.lerpColors(a.sun, b.sun, f);
    hemiSky.lerpColors(a.hemiSky, b.hemiSky, f);
    hemiGround.lerpColors(a.hemiGround, b.hemiGround, f);
    horizon.lerpColors(a.horizon, b.horizon, f);
    sky.lerpColors(a.sky, b.sky, f);
    outline.lerpColors(a.outline, b.outline, f);
    sunIntensity = lerp(a.intensity, b.intensity, f);
    exposure     = lerp(a.exposure, b.exposure, f);
    windowGlow   = lerp(a.window, b.window, f);
    toonGain     = lerp(a.toonGain, b.toonGain, f);
    skyParams.turbidity = lerp(a.turbidity, b.turbidity, f);   // L66: Preetham sky params drift with the day
    skyParams.rayleigh  = lerp(a.rayleigh, b.rayleigh, f);
    skyParams.mie       = lerp(a.mie, b.mie, f);
    skyParams.mieG      = lerp(a.mieG, b.mieG, f);
    grade.tint.lerpColors(a.gradeTint, b.gradeTint, f);        // L67: colour-grade mood drifts with the day
    grade.lift.lerpColors(a.gradeLift, b.gradeLift, f);
    grade.sat = lerp(a.gradeSat, b.gradeSat, f);
    grade.contrast = lerp(a.gradeContrast, b.gradeContrast, f); // L69: noon contrast push (crisp city)
    // Night floor scales with night-ness (windowGlow is ~1 at night, 0 at noon): a deep
    // blue the toon pass can't go below, so night reads as blue rather than black.
    toonFloor.setRGB(0.045 * windowGlow, 0.075 * windowGlow, 0.14 * windowGlow);

    /* SUN ARC — a circle whose PLANE is tilted back from vertical by TILT. θ sweeps a
       full turn; −π/2 phase puts midnight (t=0) at the bottom. cos θ is the east–west
       sweep (x: rises in the +X "east", sets in −X "west" — so the specular glint
       travels across the day); sin θ is the up axis, split between y (height) and z
       (a forward lean) by the tilt, so noon lands at ~50° elevation leaning +Z rather
       than dead overhead. */
    const theta = wrap(time) * TWO_PI - Math.PI / 2;
    const ct = Math.cos(theta), st = Math.sin(theta);
    sunArc.set(ct, st * Math.cos(TILT), st * Math.sin(TILT));
    /* Whichever body is UP lights the scene: the sun by day, or the MOON (the same
       arc flipped through the origin) by night. The colour/intensity keyframes
       already carry the moon's cool dim look at t≈0, so here we only pick the
       direction. (At the horizon crossing the two are nearly equal and the light is
       dim, so the swap is invisible.) */
    if (sunArc.y >= 0) sunDir.copy(sunArc);          // sun is up → light from the sun
    else               sunDir.copy(sunArc).negate(); // sun is down → moon, opposite side
  }

  applyEnvironment(currT); // seed so consumers reading at setup get sane values

  return {
    /* by-reference outputs (mutated in place) */
    sunDir, sunColor, hemiSky, hemiGround, horizon, sky, outline, toonFloor, skyParams,   // L66: Preetham params (by-ref)
    grade,                                                                                 // L67: colour-grade mood (by-ref)
    // L52: the RAW sun position on the arc (NOT flipped to the moon like sunDir). The VISIBLE sun disc
    // rides this; the moon disc rides its negation. One source of truth — celestials read it, no 2nd clock.
    sunArc,
    /* scalar outputs */
    get sunIntensity() { return sunIntensity; },
    get exposure()     { return exposure; },
    get windowGlow()   { return windowGlow; },
    get toonGain()     { return toonGain; },   // toon tone-lift; higher at night (readability)
    get t()            { return wrap(currT); },
    get auto()         { return auto; },
    /* HH:MM clock for the hint bar — t is fraction of a 24 h day. */
    get clock() {
      const mins = Math.round(wrap(currT) * 24 * 60) % (24 * 60);
      const hh = String(Math.floor(mins / 60)).padStart(2, '0');
      const mm = String(mins % 60).padStart(2, '0');
      return `${hh}:${mm}`;
    },

    /* verbs (the owner binds these to keys) */
    cyclePreset() { goalT = (Math.floor(currT * 4 + 1e-4) + 1) / 4; }, // next quarter
    // L110 (audit P0-8): reject non-finite input at the seam. A non-finite goalT propagates through damp()→wrap()
    // (Infinity - floor(Infinity) = NaN) into the KF[NaN] keyframe lookup, which throws inside update() — called from
    // the render loop, so the exception escapes before the trailing requestAnimationFrame and the loop dies on frame 1.
    // Guarding here means EVERY consumer (the ?t= boot param, the capture director, viewerControls.time) inherits it.
    nudge(hours)  { if (Number.isFinite(hours)) goalT += hours / 24; },  // scrub ± time
    goTo(t)       { if (Number.isFinite(t)) goalT = t; },                // L15: ease to an absolute time (director verb)
    toggleAuto()  { auto = !auto; },
    setReducedMotion(v) { reducedMotion = v; },

    update(dt) {
      if (auto && !reducedMotion) goalT += dt / CYCLE_SECONDS;  // creep the day forward
      currT = damp(currT, goalT, dt);                           // ease toward goal/auto
      applyEnvironment(currT);
    },
  };
}
