/* ============================================================
   celestials.js — Lessons 52→53: a visible, PROMINENT, tier-aware SUN + MOON on the SunRig arc.
   ------------------------------------------------------------
   L52 added the bodies (SunRig-driven sprites, auto-styled by the post chain, in city + office window).
   L53 makes them READ: (1) bigger + a near-WHITE HOT CORE so they pop against ANY sky — including the
   orange dusk sky where an orange-on-orange disc vanished (luminance beats hue for contrast); the apparent
   arc is COMPRESSED so the sun/moon sit in the normal camera framing (not above the frame at noon); and
   (2) a TIER-AWARE look — the base art switches with the scene's fidelity tier (the same realistic/charm/
   pixel signal the style-LOD uses, passed in from updateWorld), each clearly visible:
     • REALISTIC → a soft glowing ORB + bloom.
     • CHARM     → a CHARACTERFUL sun (hot core + soft rays), a friendly MOON (bold craters).
     • PIXEL     → a BOLD chunky pixel-art disc (low-res grid + nearest filter — deliberate, beyond the
                   auto-crunch the post pass would do anyway).
   The hot core stays near-white in every tier (so it reads on any sky); the GLOW carries the warm/cool hue.

   WHY STILL CHEAP + EVERYWHERE: billboard SPRITES in the city scene → face any camera (city view AND the
   office window RTT for free, like the clouds), and the post/PixelKit chain still styles them on top. No
   bloom passes — the "glow" is a soft additive sprite. Placement: the sky is a flat backdrop (z≈-8), so a
   body is a billboard just in front of it, x = east↔west, y = elevation, both read off `sunRig.sunArc`.
   ============================================================ */
import * as THREE from 'three';
import { createNightSky } from './night-sky.js';   // L57: stars + constellations + nebula, composed below
import { lowSunWashK } from './sun-rig.js';         // L-dusk-washout: corona damper (sun-rig owns the single source of truth)

const TAU = Math.PI * 2;

/* ---- REALISTIC: a smooth ORB with a near-white hot core fading to a tinted edge. ---- */
function realisticDisc(coreEdge) {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.0, '#ffffff'); g.addColorStop(0.34, '#fffaf0');   // white-hot core
  g.addColorStop(0.66, coreEdge); g.addColorStop(0.86, coreEdge); g.addColorStop(1.0, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.beginPath(); x.arc(S / 2, S / 2, S / 2, 0, TAU); x.fill();
  return canvasTex(c, true);
}
function realisticMoon() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.0, '#ffffff'); g.addColorStop(0.4, '#eef3ff'); g.addColorStop(0.82, '#c4cee6'); g.addColorStop(1.0, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.beginPath(); x.arc(S / 2, S / 2, S / 2, 0, TAU); x.fill();
  x.globalAlpha = 0.14; x.fillStyle = '#8b97b4';
  for (const [cx, cy, r] of [[54, 50, 9], [78, 66, 7], [60, 82, 5]]) { x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill(); }
  return canvasTex(c, true);
}

/* ---- CHARM: a characterful sun (hot core + soft triangular RAYS); a friendly moon with bold craters. ---- */
function charmSun() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  x.translate(S / 2, S / 2);
  x.fillStyle = 'rgba(255,210,120,0.9)';                          // soft rays
  for (let i = 0; i < 12; i++) { x.rotate(TAU / 12); x.beginPath(); x.moveTo(0, -28); x.lineTo(7, -54); x.lineTo(-7, -54); x.closePath(); x.fill(); }
  const g = x.createRadialGradient(0, 0, 0, 0, 0, 32);
  g.addColorStop(0.0, '#ffffff'); g.addColorStop(0.4, '#fff1c8'); g.addColorStop(0.8, '#ffb24a'); g.addColorStop(1.0, '#ff8a2a');
  x.fillStyle = g; x.beginPath(); x.arc(0, 0, 32, 0, TAU); x.fill();
  return canvasTex(c, true);
}
function charmMoon() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, 46);
  g.addColorStop(0.0, '#ffffff'); g.addColorStop(0.5, '#e6ecfb'); g.addColorStop(1.0, '#c2cce4');
  x.fillStyle = g; x.beginPath(); x.arc(S / 2, S / 2, 46, 0, TAU); x.fill();
  x.fillStyle = '#aab6d2';                                        // bold, friendly craters
  for (const [cx, cy, r] of [[52, 48, 11], [80, 62, 8], [58, 82, 7], [40, 66, 5]]) { x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill(); }
  return canvasTex(c, true);
}

/* ---- PIXEL: a bold, chunky pixel-art disc — rasterised on a low-res grid (nearest filter = crisp blocks). */
function pixelDisc(coreA, coreB, rim) {
  const N = 18, S = 144, px = S / N;            // 18×18 logical grid → chunky cells
  const c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  const cc = (N - 1) / 2, R = N / 2 - 0.5;
  for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) {
    const d = Math.hypot(gx - cc, gy - cc);
    if (d > R) continue;
    x.fillStyle = d < R * 0.45 ? coreA : d < R * 0.78 ? coreB : rim;   // hot core → body → rim
    x.fillRect(Math.round(gx * px), Math.round(gy * px), Math.ceil(px), Math.ceil(px));
  }
  return canvasTex(c, false);                  // nearest filter → blocky
}

/* ---- VECTOR: a flat, graphic disc — a SOLID fill + a crisp flat RIM RING, zero gradient. Matches the
        flat-vector city (pure per-face fills, hard edges, no specular): the charm sun's soft rays/gradient
        looked out of place under the flat look, so the vector tier gets its own body. Sun = warm fill +
        deeper rim; moon = cool fill + soft rim + a couple of flat craters. Smooth filter keeps the circle
        edge clean (flat-vector is crisp-but-AA, not pixel-art — the pixel tier owns the chunky disc). */
function vectorDisc(fill, rim, craters = false) {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  const cc = S / 2, R = S / 2 - 6;
  x.fillStyle = rim;  x.beginPath(); x.arc(cc, cc, R, 0, TAU); x.fill();             // flat rim ring
  x.fillStyle = fill; x.beginPath(); x.arc(cc, cc, R - 8, 0, TAU); x.fill();         // solid inner fill
  if (craters) {                                                                     // moon: a few flat craters
    x.globalAlpha = 0.5; x.fillStyle = rim;
    for (const [dx, dy, r] of [[10, -12, 10], [-16, 6, 7], [4, 18, 5]]) { x.beginPath(); x.arc(cc + dx, cc + dy, r, 0, TAU); x.fill(); }
  }
  return canvasTex(c, true);                                                          // smooth → clean flat edge
}

function softGlow() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.38, 'rgba(255,255,255,0.3)'); g.addColorStop(1.0, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.beginPath(); x.arc(S / 2, S / 2, S / 2, 0, TAU); x.fill();
  return canvasTex(c, true);
}

/* L55 DAYTIME CONTRAST HALO — a soft DARK ring (NORMAL alpha blend, not additive) drawn behind the sun. At
   noon the white-hot core was low-contrast against the bright-blue sky; darkening a ring of sky right around
   the disc makes it separate + pop (the classic "the sky is darker next to the sun" read). Clear in the
   CENTRE so it never dims the disc itself; only the surrounding sky. Modulated to FADE OUT as the sun lowers
   (at dusk the orange sky + L53 hot core already give contrast, and a dark ring there would read as grime). */
function darkHalo() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  const D = '20,30,48';                                   // cool slate (sky-shadow, not black)
  g.addColorStop(0.00, `rgba(${D},0)`); g.addColorStop(0.42, `rgba(${D},0)`);   // clear where the disc sits
  g.addColorStop(0.60, `rgba(${D},0.6)`);                                       // peak darkening ring
  g.addColorStop(1.00, `rgba(${D},0)`);                                         // fade back to open sky
  x.fillStyle = g; x.beginPath(); x.arc(S / 2, S / 2, S / 2, 0, TAU); x.fill();
  return canvasTex(c, true);
}

function canvasTex(canvas, smooth) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  if (!smooth) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; }
  return t;
}

const smoothstep = (v, a, b) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// L98b SKYDOME CELESTIALS — the PROPER, foundation-correct placement (replaces the L52–L98 flat-backdrop arc geometry
// `skyW/skyY0/skyH/biasX/z`, which only APPROXIMATELY lined up with the atmospheric sky's sun-glow). How real engines
// do it: the sun/moon are points at INFINITY in a fixed DIRECTION, so we render the disc at `cameraPos + dir·R`
// (camera-relative → never parallaxes, like a skybox), where `dir = sunRig.sunArc` (the SAME unit vector that drives
// the DirectionalLight AND the Preetham scattering). The disc therefore sits EXACTLY where the sky-glow peaks → the
// lighting, the atmospheric glow, and the visible disc are ONE coherent sun, correct from ANY camera/orbit (the disc
// can't slide off the glow on a backdrop). R is inside the sky sphere (radius 90) so the disc renders in front of it.
// Because the placement is camera-relative, the bodies are RE-PLACED per render camera (the main view AND the
// office-window RTT) via `place(cam)`. C++ anchor: a directional light has no position — only a direction; the visible
// sun is that direction projected onto the skydome at a large radius.
export function createCelestials({ R = 88, sunSize = 6.0, moonSize = 5.5 } = {}) {
  const group = new THREE.Group();
  group.raycast = () => {};

  // L98c OCCLUSION — every celestial sprite is DEPTH-OCCLUDED by scene geometry (the Unreal/Unity skybox model):
  // depthTest TRUE (hidden behind nearer opaque buildings/trees) + depthWrite FALSE (never z-fights, never blocks
  // anything). Combined with R pushed to the far sky radius (88, just inside the sky box / far-plane 100, BEHIND all
  // city geometry), a building between the camera and the sun now HIDES it — the disc only shows against open sky.
  // (The old bug: R=40 sat NEARER than far buildings + negative renderOrder painted the glow/halo BEFORE opaque →
  // they drew on top = the "plastered overlay" look. Both are gone.)
  const sprite = (tex, additive) => {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: true, depthWrite: false, fog: false, toneMapped: false,
      ...(additive ? { blending: THREE.AdditiveBlending } : {}),
    }));
    m.raycast = () => {};
    return m;
  };

  // per-tier textures (built once)
  const SUN = {
    realistic: realisticDisc('#ffcf8a'),
    charm: charmSun(),
    pixel: pixelDisc('#fff6e0', '#ffc24a', '#ff8a2a'),
    vector: vectorDisc('#ffd24a', '#ff9a2e'),                 // L89: flat warm disc + deeper rim
  };
  const MOON = {
    realistic: realisticMoon(),
    charm: charmMoon(),
    pixel: pixelDisc('#ffffff', '#cdd6ee', '#9aa6c6'),
    vector: vectorDisc('#e8eefc', '#b9c6e4', true),           // L89: flat cool disc + rim + flat craters
  };
  const glowTex = softGlow();
  const haloTex = darkHalo();

  const sunHalo = sprite(haloTex, false);   // L55: NORMAL blend (darkens sky) — daytime contrast ring
  const sunCorona = sprite(glowTex, true);  // L108 (Deliverable B): a wide, faint atmospheric corona — realistic-tier ONLY (0 opacity elsewhere → stylized byte-identical); the empty beauty sky gets a focal point
  const sunGlow = sprite(glowTex, true);
  const sun = sprite(SUN.realistic);
  const moonCorona = sprite(glowTex, true);  // L112 B: cool atmospheric corona — realistic-tier ONLY (.visible=false elsewhere → OUT of the stylized draw list → provably byte-identical, same trick as sunCorona)
  const moonGlow = sprite(glowTex, true);
  const moon = sprite(MOON.realistic);
  // L98c: NO negative renderOrder — the celestials render in the normal transparent pass (AFTER opaque), so the
  // depth buffer holds the buildings and occlusion works. (The intra-group layering halo→glow→disc still holds
  // because they're added in that order at the same depth/renderOrder.)
  group.add(sunHalo, sunCorona, sunGlow, sun, moonCorona, moonGlow, moon);   // each corona BEHIND its glow+disc (additive, order-independent, but visually under)

  // L57 NIGHT SKY — stars + constellations + nebula, composed here so every celestials consumer (the
  // city sky AND the office-window RTT) inherits it. Driven below by the same SunRig clock.
  // L98c: stars are also depth-occluded (no negative renderOrder) → buildings hide the stars too, like real sky.
  const nightSky = createNightSky({});
  group.add(nightSky.group);
  const RM = (typeof window !== 'undefined' && window.matchMedia) ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  // per-tier presentation knobs (the hot CORE stays near-white everywhere; the GLOW carries the hue).
  const TIER = {
    realistic: { sunGlow: 3.0, sunGlowOp: 0.7, moonGlow: 2.6, moonGlowOp: 0.5, sizeMul: 1.0, sunHaloOp: 0.85 },
    charm: { sunGlow: 2.2, sunGlowOp: 0.55, moonGlow: 2.1, moonGlowOp: 0.42, sizeMul: 1.08, sunHaloOp: 0.7 },
    pixel: { sunGlow: 1.7, sunGlowOp: 0.4, moonGlow: 1.7, moonGlowOp: 0.32, sizeMul: 1.0, sunHaloOp: 0.6 },
    // L89 VECTOR — flat aesthetic: a SMALL, restrained glow (a soft halo would fight the flat look) + a
    // crisp body. Keep the daytime contrast halo modest so the disc still separates from a bright flat sky.
    vector: { sunGlow: 1.4, sunGlowOp: 0.28, moonGlow: 1.4, moonGlowOp: 0.22, sizeMul: 1.0, sunHaloOp: 0.5 },
  };
  let curTier = 'realistic';
  function setTier(tier) {
    if (tier === curTier || !TIER[tier]) return;
    curTier = tier;
    sun.material.map = SUN[tier]; sun.material.needsUpdate = true;
    moon.material.map = MOON[tier]; moon.material.needsUpdate = true;
  }

  const _c = new THREE.Color();

  /* L98 — the L89 FRAME-SAFE CLAMP is REMOVED (deliberately, per Laurence). It projected each body to the active
     camera's NDC and nudged a HIGH body back inside a ±0.80 inset — which is exactly what "plastered the sun in the
     corner": a high sun never left the frame and never read as traversing. The L52–L89 lineage feared the sun
     CLIPPING off-frame; that fear is now reversed — off-frame is NATURAL (the real sun does it). The body simply
     sits at its true arc position `f(sunArc)`; the lighting + shadows (which read `sunRig.sunDir`, never the sprite)
     carry day-night exactly as before. C++ anchor: we were post-correcting a value (`pos`) that was already correct —
     deleting the override is the fix, not adding more correction. */

  const SUN_CORE = new THREE.Color('#fff3df');   // near-white hot core tint (NOT the sky-blending orange)
  const GLOW_WARM = new THREE.Color('#ffb060');
  const GLOW_LOW = new THREE.Color('#ff6a2a');   // hotter orange glow low on the horizon
  const MOON_CORE = new THREE.Color('#eef2ff');
  const GLOW_COOL = new THREE.Color('#9fbcff');
  const MOON_CORONA_COOL = new THREE.Color('#b9c9ff');   // L112 B: the moon's cool atmospheric corona (mirror of the sun's warm one)

  // L98b — current world DIRECTIONS of the bodies (unit), stored each update(); place(cam) projects them onto the
  // skydome at `cam.position + dir·R`. Split this way so a body can be RE-PLACED per render camera (main + RTT)
  // without recomputing its look (size/colour/opacity, which are camera-independent).
  const _sunDir = new THREE.Vector3(0, 1, 0);
  const _moonDir = new THREE.Vector3(0, -1, 0);
  const _cp = new THREE.Vector3();

  function update(dt, elapsed, sunRig, weatherRig, tier = 'realistic', cam = null) {
    setTier(tier);
    const cfg = TIER[curTier];
    const arc = sunRig.sunArc;
    const cover = weatherRig ? Math.min(1, (weatherRig.cloud || 0) * 0.85 + (weatherRig.fog || 0) * 0.7) : 0;

    // SUN — hot near-white core (reads on any sky); bigger + warmer GLOW low on the horizon. The disc rides the
    // TRUE sun direction (sunArc) — the same vector the DirectionalLight + the Preetham sky use → co-located glow.
    const sUp = arc.y;
    const sVis = smoothstep(sUp, -0.04, 0.1) * (1 - 0.7 * cover);
    const horizonK = 1 - smoothstep(Math.abs(sUp), 0.02, 0.5);          // 1 at the horizon → 0 high up
    const ss = sunSize * cfg.sizeMul * (1 + 0.55 * horizonK);          // grow the disc a touch at the horizon (golden hour)
    _sunDir.copy(arc);                                                 // L98b: world direction of the sun
    // L98c — ALL tiers use the occlusion-fixed SPRITE sun (sub-commit 1 made it depth-occluded + L98b co-located, so it
    // already reads beautifully; the analytic Preetham sky-disc came out too faint once ACES-tone-mapped — lum 166 vs the
    // sprite's 238 — so we fall back to the designed sprite everywhere + disable the Preetham disc; stated in the report).
    // BUT on REALISTIC we DROP the sprite GLOW + HALO: the Preetham sky already glows around the sun there, so a sprite
    // glow would DOUBLE it (the brief's double-glow fix). The stylized tiers (flat backdrop, no Preetham glow) keep both.
    const realisticTier = (curTier === 'realistic');
    // L108 (Deliverable B 4b): a BIGGER hero sun on realistic (×1.8) so the beauty sky has a real focal point.
    // bScale=1 on stylized → sun/glow/halo scales unchanged there → byte-identical.
    const bScale = realisticTier ? 1.8 : 1.0;
    sun.scale.setScalar(ss * bScale); sunGlow.scale.setScalar(ss * bScale * cfg.sunGlow);
    sun.material.color.copy(SUN_CORE);                                  // core stays hot/white-ish
    // L98c TONE-MAP CONSISTENCY (brief #4): the sprite is `toneMapped:false`, but the REALISTIC beauty pass ACES-tone-maps
    // the whole frame → a plain-white sprite reads DIM there (lum ~164) vs the stylized tiers' un-tone-mapped sprite (~238).
    // So on realistic we push the core to HDR (>1) so ACES rolls it back UP to a hot sun → consistent brightness across the
    // tier morph (no jump). The stylized tiers keep the LDR core (no ACES there).
    if (realisticTier) sun.material.color.multiplyScalar(3.0 * (1 - 0.55 * lowSunWashK(arc.y)));   // L-dusk-washout-r2: damp HDR at low sun (3.0→1.35× at peak t≈0.72; noon lowSunWashK=0 → 3.0× unchanged)
    sunGlow.material.color.copy(GLOW_WARM).lerp(GLOW_LOW, horizonK);    // the hue lives in the glow
    sun.material.opacity = sVis;                                        // sprite sun ON for every tier (occlusion-fixed)
    // L108 (Deliverable B 4c): RESTORE the realistic sprite-glow toward full (was ×0.5 on the "Preetham double-glow"
    // theory — but §1b proved the noon Preetham glow is weak, so the sun read dim). ×0.9 keeps a hair under full so
    // the corona (below) carries the broad halo without over-blooming. Stylized tiers keep full (×1.0) → unchanged.
    sunGlow.material.opacity = sVis * cfg.sunGlowOp * (0.7 + 0.5 * horizonK) * (realisticTier ? 0.9 : 1.0);
    // L108 (Deliverable B 4c): the ATMOSPHERIC CORONA — a wide (×3), faint, warm soft-glow that gives the empty beauty
    // sky its focal point. REALISTIC ONLY (0 elsewhere → stylized byte-identical). Warms toward the horizon (golden) via
    // the same GLOW_WARM→GLOW_LOW lerp (no new colour uniform, Rule 2). Fatter + a touch stronger low, as real coronas are.
    sunCorona.visible = realisticTier;   // fully EXCLUDE it from the stylized draw list (not just opacity 0) → provably byte-identical: same transparent draw order as before B on pixel/toon/vector
    sunCorona.scale.setScalar(ss * bScale * 3.0);
    sunCorona.material.color.copy(GLOW_WARM).lerp(GLOW_LOW, horizonK);
    // L-dusk-washout Lever 2: damp the corona at its source — the dominant "red blob" culprit. lowSunWashK peaks
    // at the exact washout window (t=0.70 opacity 0.200→0.080; t=0.72 0.237→0.095), self-zeroes by t≈0.76.
    // Realistic-only (sunCorona.visible=realisticTier above) → stylized byte-identical. lw(noon)=0 → anchor safe.
    sunCorona.material.opacity = sVis * 0.20 * (0.6 + 0.7 * horizonK) * (1 - 0.6 * lowSunWashK(arc.y));
    // L55 daytime contrast halo: track the disc, sit ~1.7× its size, ramp with HEIGHT (full high, gone at horizon).
    sunHalo.scale.setScalar(ss * bScale * 1.7);
    sunHalo.material.opacity = realisticTier ? 0 : sVis * (1 - horizonK) * cfg.sunHaloOp;   // L98c: no sprite halo on realistic (the corona replaces it)

    // MOON — the OPPOSITE direction; cool, bright core, soft cool glow.
    const mUp = -arc.y;
    const mVis = smoothstep(mUp, -0.04, 0.1) * (1 - 0.65 * cover);
    const ms = moonSize * cfg.sizeMul;
    _moonDir.copy(arc).negate();                                       // L98b: opposite the sun
    // L112 B — mirror the sun's hero pass onto the moon, realistic-only + COOL. Bigger disc (×1.6; a touch under the
    // sun's ×1.8 so the sun stays dominant) + an HDR core push (×2.4, mirror of the sun's ×3.0 ACES-comp: the beauty
    // frame ACES-tone-maps everything, dimming a plain toneMapped:false sprite → push it >1 so ACES rolls it back to a
    // bright moon). Stylized keeps ms×1 + the plain LDR core → byte-identical.
    const bMoon = realisticTier ? 1.6 : 1.0;
    moon.scale.setScalar(ms * bMoon); moonGlow.scale.setScalar(ms * bMoon * cfg.moonGlow);
    moon.material.color.copy(MOON_CORE);
    if (realisticTier) moon.material.color.multiplyScalar(2.4);
    moonGlow.material.color.copy(GLOW_COOL);
    moon.material.opacity = mVis;
    moonGlow.material.opacity = mVis * cfg.moonGlowOp;
    // L112 B-ii: the cool corona — wide (×2.6), faint, FLAT cool (no horizon-warm logic, unlike the sun). Realistic
    // ONLY (visible=false elsewhere → excluded from the stylized draw list = provably byte-identical).
    moonCorona.visible = realisticTier;
    moonCorona.scale.setScalar(ms * bMoon * 2.6);
    moonCorona.material.color.copy(MOON_CORONA_COOL);
    moonCorona.material.opacity = mVis * 0.16;

    // L98b POSITION — project onto the skydome relative to the MAIN camera (the office-window RTT re-calls place()).
    place(cam);

    // L57 NIGHT SKY — fade in when the sun is below the horizon (mirror of the moon's gate), and dim under
    // heavy weather (clouds wash out stars). `tier` is the SAME fidelity signal the sun/moon use.
    const nightK = smoothstep(-arc.y, -0.05, 0.18) * (1 - 0.85 * cover);
    nightSky.update(nightK, tier, elapsed, !!(RM && RM.matches));

    // L98b debug/harness probe — the visible sun's world position + direction + visibility.
    if (typeof window !== 'undefined') window.__celestial = { sun: sun.position.toArray(), moon: moon.position.toArray(), dir: _sunDir.toArray().map((v) => +v.toFixed(3)), sunVis: +sVis.toFixed(3), moonVis: +mVis.toFixed(3) };
  }

  /* L98b — place the bodies on the skydome at `cam.position + dir·R` (camera-relative, so the disc never parallaxes
     and always sits exactly in the sky-glow's screen direction). Called by update() for the MAIN camera, and AGAIN by
     the engine before the office-window RTT render with that camera (then restored), so both views are 3D-correct. */
  function place(cam) {
    if (!cam) return;
    cam.getWorldPosition(_cp);
    sun.position.copy(_cp).addScaledVector(_sunDir, R);
    sunGlow.position.copy(sun.position);
    sunCorona.position.copy(sun.position);   // L108: the corona rides the disc
    sunHalo.position.copy(sun.position);
    moon.position.copy(_cp).addScaledVector(_moonDir, R);
    moonGlow.position.copy(moon.position);
    moonCorona.position.copy(moon.position);   // L112 B: the corona rides the moon (miss this → it renders at the origin)
    nightSky.place(cam);   // L111: the star dome rides THIS render camera too (compose, don't wire → the office-window RTT inherits it via the two existing place() call sites)
  }

  return { group, update, place };
}
