/* ============================================================
   sky-atmosphere.js — Lesson 66: a PREETHAM atmospheric sky (realistic/charm tier).
   ------------------------------------------------------------
   Our sky today is a flat 2-colour gradient (backdrop.frag). This wraps Three's `Sky` (the Preetham
   analytic daylight model — MIT) into a tiny engine-core seam: a real Rayleigh+Mie horizon→zenith
   gradient with a sun-glow halo that REDDENS automatically as the sun drops (golden hour for free,
   because the sky colour and the sun-halo colour are the SAME scattering computation).

   THE PHYSICS (one line each):
   - RAYLEIGH scattering ∝ 1/λ⁴ — short (blue) wavelengths scatter most → the sky is blue, the low sun
     is red (its blue has scattered away over the long horizon path).
   - MIE scattering — big aerosol particles scatter all wavelengths forward → the white/warm HALO around
     the sun; `mieDirectionalG` biases it forward (a tight halo vs a broad glow).
   - TURBIDITY — how hazy the air is (more haze = milkier sky + bigger sun halo).
   We DRIVE it from the existing SunRig — NO second clock: `setSun(sunRig.sunArc)` (the same vector the
   sun disc rides) + `setParams(sunRig.skyParams)` (the 4 params lerped by the day/night keyframes), so
   the sky always agrees with the lighting + the visible sun, and stays art-directed.

   C++ anchor: an analytic function of the view ray + sun direction evaluated per fragment on a big
   inside-out box (BackSide, depthWrite off → always the backmost thing) — no texture, no post pass.
   ============================================================ */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export function createSkyAtmosphere({ scale = 90 } = {}) {
  // scale must keep the box INSIDE the camera far plane (city far = 100, max orbit ~40 → ±45 is safe).
  const mesh = new Sky();
  mesh.scale.setScalar(scale);
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  mesh.visible = false;                       // off until the beauty tier turns it on (tier-gated)
  const u = mesh.material.uniforms;
  u.turbidity.value = 2.2; u.rayleigh.value = 1.3; u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.78;
  // L98c — DISABLE the Preetham `Sky`'s built-in analytic sun-disc. We tried it as the realistic-tier sun (widened to
  // ~2°), but once it runs through the beauty ACES tone-map it reads too faint (lum ~166 vs the designed sprite's ~238).
  // So celestials uses its occlusion-fixed SPRITE sun for every tier (now that the sprite is depth-occluded + co-located,
  // it has the sky-disc's advantages AND reads reliably) — and we turn the Preetham disc OFF here so there's no faint
  // second sun competing with it. The sky still GLOWS around the sun direction (the atmospheric scattering, untouched).
  u.showSunDisc.value = 0;

  /* L-dusk-washout-r3 — LOW-SUN HIGHLIGHT KNEE. Facing the low sun, the Preetham `Sky` legitimately computes
     LINEAR luminance 5–15× over 1.0 across a broad cone. The city beauty pass runs with NoToneMapping and writes to
     an 8-bit `beautyRT`, so that over-1.0 sky CLAMPS to a uniform 1.0 plateau BEFORE the filmic ACES pass ever runs
     → hue + horizon→zenith gradient die → the flat warm wash (workflow-diagnosed 2026-07-07; rounds 1-2 only retuned
     the sky's turbidity/mie/mieG SHAPE, never this MAGNITUDE, so they couldn't fix it). Fix: a luma-preserving
     highlight rolloff INSIDE the sky shader (upstream of the clamp) that pulls luma>0.85 asymptotically under 1.0 —
     scaling RGB by ONE shared luma ratio so warm hue is preserved exactly and the gradient survives the 8-bit write.
     Gated by `uLowSunKnee` (driven per-frame from lowSunWashK): 0 at noon/night → the branch is a pure no-op →
     noon byte-identical; stylized tiers never render the sky (visible=false) → untouched. Applied to the VISIBLE
     `mesh` ONLY — the separate `_envSky` (below) has no knee, so the sky-IBL that lights buildings is unchanged
     (the night-fill win + building brightness are untouched). Anchored on three/addons Sky.js:312 output line. */
  u.uLowSunKnee = { value: 0.0 };
  mesh.material.onBeforeCompile = (shader) => {
    shader.uniforms.uLowSunKnee = u.uLowSunKnee;
    shader.fragmentShader = 'uniform float uLowSunKnee;\n' + shader.fragmentShader.replace(
      'gl_FragColor = vec4( texColor, 1.0 );',
      'if ( uLowSunKnee > 0.0 ) { float _lHi = dot( texColor, vec3( 0.2126, 0.7152, 0.0722 ) ); float _over = max( 0.0, _lHi - 0.45 ); if ( _over > 0.0 ) texColor *= ( 0.45 + ( 1.0 - exp( -_over * ( 1.2 * uLowSunKnee ) ) ) * 0.30 ) / max( _lHi, 1e-4 ); }\n\tgl_FragColor = vec4( texColor, 1.0 );'
    );
  };
  function setLowSunKnee(k) { u.uLowSunKnee.value = k; }        // drive from lowSunWashK(sunRig.sunArc.y) — 0 at noon → no-op

  function setSun(vec) { u.sunPosition.value.copy(vec); }      // drive from sunRig.sunArc — one clock
  function setParams(p) {                                       // drive from sunRig.skyParams — keyframed
    if (!p) return;
    if (p.turbidity != null) u.turbidity.value = p.turbidity;
    if (p.rayleigh != null) u.rayleigh.value = p.rayleigh;
    if (p.mie != null) u.mieCoefficient.value = p.mie;
    if (p.mieG != null) u.mieDirectionalG.value = p.mieG;
  }

  /* L67 SKY-as-IBL — "lit BY the sky". PMREMGenerator pre-integrates the current sky into a mip-chained
     cubemap (an env map). Assigned to `scene.environment`, the low-poly MeshStandard surfaces then sample
     soft sky-coloured ambient + a sun reflection in ONE fetch, auto-matching day/night (the coherence
     multiplier). EXPENSIVE → the caller throttles regen to keyframe boundaries (4×/cycle), never per-frame.
     We PMREM a sky-ONLY scene (a 2nd Sky synced to the visible one) so buildings don't pollute the ambient.
     C++ anchor: bake the hemisphere-light integral into a const lookup the shader reads cheaply. */
  let _pmrem = null, _envScene = null, _envSky = null, _envRT = null;
  function buildEnv(renderer) {
    if (typeof document === 'undefined' || !renderer) return null;
    if (!_pmrem) {
      _pmrem = new THREE.PMREMGenerator(renderer);
      _envScene = new THREE.Scene();
      _envSky = new Sky(); _envSky.scale.setScalar(scale); _envScene.add(_envSky);
    }
    const eu = _envSky.material.uniforms;                       // sync params from the visible sky
    eu.turbidity.value = u.turbidity.value; eu.rayleigh.value = u.rayleigh.value;
    eu.mieCoefficient.value = u.mieCoefficient.value; eu.mieDirectionalG.value = u.mieDirectionalG.value;
    eu.sunPosition.value.copy(u.sunPosition.value);
    if (_envRT) _envRT.dispose();
    _envRT = _pmrem.fromScene(_envScene);                      // render + prefilter the sky → an env map
    return _envRT.texture;
  }
  return { mesh, setSun, setParams, setLowSunKnee, buildEnv, get material() { return mesh.material; } };
}
