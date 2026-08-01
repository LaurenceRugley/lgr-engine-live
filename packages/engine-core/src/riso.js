/* ============================================================
   @lgr/engine-core — riso (A19 RISO LIFT): the Risograph print effect, as a core ability.
   ------------------------------------------------------------
   THE ABILITY: turn any rendered frame or image into a RISOGRAPH print — spot inks screened as halftone
   dots at per-ink angles, each layer misregistered a hair, translucent inks multiplied over cream paper,
   with grain. Every trait mirrors a physical constraint of a stencil duplicator, which is why it reads as a
   print, not a filter. LIFTED verbatim from `lgr-image-studio` (where it lived project-local) into the core
   so every project — the studio, Live Sky, the city, the asset-factory — inherits ONE source of truth
   instead of forking. Engine-first (CLAUDE.md): an ability that emerged in a project becomes a core seam.

   The fragment shader (`shaders/riso.frag`) is a byte-for-byte copy of the studio's (the one exception:
   two backticks in a COMMENT were removed — the LGR backtick-build gotcha; comments don't compile, so the
   output is pixel-identical). `createRiso` reproduces the studio's exact ShaderMaterial + uniform defaults,
   so the lift changes nothing visually (proven by the golden-image check, tools/riso-golden.mjs).

   ── CONTRACT ──────────────────────────────────────────────────
   createRiso({ inks, dot, reg, grain, paper }) → {
     material,                      // a THREE.ShaderMaterial for a fullscreen quad (uScene = the input tex)
     update({ inks, dot, reg, grain, paper, scene, resolution }),   // set any subset of uniforms
     get uniforms(),                // the live uniform object (for a driver that pokes uScene per frame)
     dispose(),
   }
     inks   — 1..3 entries, each an INDEX into RISO_INKS, a '#hex' string, or a THREE.Vector3 (sRGB 0..1).
     dot    — halftone cell size in px.   reg — registration offset in px.   grain — 0..~0.14 (uniform value).
     paper  — '#hex' or Vector3 (cream default). (The studio UI passes grain on a 0..14 scale and /100s it;
              here `grain` is the raw uniform — a driver scales as it likes.)

   ── C++ anchor ────────────────────────────────────────────────
   A ShaderMaterial is a GPU kernel + its constant inputs (uniforms); `createRiso` is a factory that wires
   that kernel with sensible defaults and hands you setters — like a small class wrapping a shader program.
   ============================================================ */
import * as THREE from 'three';
import risoFrag from './shaders/riso.frag';
import fullscreenVert from './shaders/fullscreen.vert';

// The real Riso spot-ink library (sRGB hex). Order is the URL bit-mask order — do NOT reorder (a saved
// share-state or a factory sidecar references inks by INDEX). Verbatim from the studio (engine.js RISO_INKS).
export const RISO_INKS = [
  '#000000', '#FF48B0', '#0078BF', '#00A95C', '#FFE800', '#FF665E',
  '#765BA7', '#00838A', '#FF6C2F', '#5EC8E5', '#914E72', '#44D62C',
];

// hex → Vector3 of THREE.Color channels (sRGB 0..1) — the exact conversion the studio used (inkVec).
const inkVec = (hex) => { const c = new THREE.Color(hex); return new THREE.Vector3(c.r, c.g, c.b); };
// resolve an ink spec (index | '#hex' | Vector3) → a Vector3.
function resolveInk(v) {
  if (typeof v === 'number') return inkVec(RISO_INKS[v] || RISO_INKS[0]);
  if (typeof v === 'string') return inkVec(v);
  return v;   // assume a Vector3-like
}

export function createRiso({ inks = [2, 1], dot = 6, reg = 3, grain = 0.06, paper = '#F5F1E6' } = {}) {
  const material = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert,
    fragmentShader: risoFrag,
    uniforms: {
      uScene:     { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uInks:      { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
      uInkCount:  { value: 2 },
      uDot:       { value: 6.0 },
      uReg:       { value: 3.0 },
      uGrain:     { value: 0.06 },
      uPaper:     { value: inkVec('#F5F1E6') },
    },
  });

  function update(o = {}) {
    const u = material.uniforms;
    if (o.inks) {
      const arr = u.uInks.value;
      const n = Math.max(1, Math.min(3, o.inks.length));
      for (let i = 0; i < 3; i++) arr[i].copy(resolveInk(i < n ? o.inks[i] : 0));
      u.uInkCount.value = n;
    }
    if (o.dot != null) u.uDot.value = o.dot;
    if (o.reg != null) u.uReg.value = o.reg;
    if (o.grain != null) u.uGrain.value = o.grain;
    if (o.paper != null) u.uPaper.value = typeof o.paper === 'string' ? inkVec(o.paper) : o.paper;
    if (o.scene !== undefined) u.uScene.value = o.scene;
    if (o.resolution) u.uResolution.value.copy(o.resolution);
    return api;
  }

  const api = {
    material,
    update,
    get uniforms() { return material.uniforms; },
    dispose() { material.dispose(); },
  };
  update({ inks, dot, reg, grain, paper });   // apply the constructor options
  return api;
}
