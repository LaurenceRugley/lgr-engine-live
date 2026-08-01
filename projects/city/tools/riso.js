/* ============================================================
   riso.js — the RISO image tool (A19 riso lift). Same risograph shader the studio uses, now driven from
   engine-core's lifted `createRiso`. Headless-drivable (mirrors pixelate.js's __crunch): the asset-factory
   drives window.__riso(dataURL, opts) over headless Chrome; window.__risoReady gates it.

   Two render paths on purpose:
     __riso        — via the LIFTED createRiso ability (the real code path the factory + projects use).
     __risoReplica — an INLINE material built exactly as the studio's engine.js did (fullscreenVert + the
                     same uniforms/defaults, no createRiso). The golden harness diffs the two → proves the
                     createRiso abstraction changed nothing (§3.5.1 no-visual-regression, LAB side).
   ============================================================ */
import { THREE, fullscreenVert, createRiso, RISO_INKS } from '@lgr/engine-core';
import risoFrag from '../../../packages/engine-core/src/shaders/riso.frag';

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
document.getElementById('stage').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// THE LIFTED ABILITY under test.
const riso = createRiso();
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), riso.material);
scene.add(quad);

// INLINE studio-exact replica material (byte-for-byte the studio's engine.js riso setup) — golden reference.
const inkVec = (hex) => { const c = new THREE.Color(hex); return new THREE.Vector3(c.r, c.g, c.b); };
const RISO_INK_VECS = RISO_INKS.map(inkVec);
const replicaMat = new THREE.ShaderMaterial({
  vertexShader: fullscreenVert, fragmentShader: risoFrag,
  uniforms: {
    uScene: { value: null }, uResolution: { value: new THREE.Vector2(1, 1) },
    uInks: { value: [RISO_INK_VECS[2].clone(), RISO_INK_VECS[1].clone(), new THREE.Vector3()] },
    uInkCount: { value: 2 }, uDot: { value: 6.0 }, uReg: { value: 3.0 }, uGrain: { value: 0.06 },
    uPaper: { value: inkVec('#F5F1E6') },
  },
});

/* Load a dataURL → a GPU texture (pre-flipped, sRGB), and return its natural dimensions. */
async function loadTexture(dataURL) {
  const blob = await (await fetch(dataURL)).blob();
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY' });
  const tex = new THREE.Texture(bitmap);
  tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { tex, w: bitmap.width, h: bitmap.height };
}

/* Render `material` over the input at its native resolution → an sRGB PNG dataURL (canvas export, matching
   the studio's preserveDrawingBuffer toDataURL path). Deterministic for a fixed input + uniforms. */
function renderToPng(material, w, h) {
  quad.material = material;
  renderer.setSize(w, h, false);
  material.uniforms.uResolution.value.set(w, h);
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/png');
}

/* Set the riso uniforms from a factory sidecar (inks are indices into RISO_INKS, or #hex). grain is the raw
   uniform (a driver that wants the studio 0..14 UI scale divides by 100 itself). */
function applyOpts(setUniforms, o) {
  setUniforms(o);
}

// ---- HEADLESS API ----------------------------------------------------------
window.__riso = async (dataURL, opts = {}) => {
  const { tex, w, h } = await loadTexture(dataURL);
  riso.update({ scene: tex, ...opts });
  const png = renderToPng(riso.material, w, h);
  tex.dispose();
  window.__risoResult = { w, h };
  return png;
};

// the golden reference path — the inline studio-exact material with the SAME opts.
window.__risoReplica = async (dataURL, opts = {}) => {
  const { tex, w, h } = await loadTexture(dataURL);
  const u = replicaMat.uniforms;
  u.uScene.value = tex;
  if (opts.inks) { const n = Math.max(1, Math.min(3, opts.inks.length)); for (let i = 0; i < 3; i++) u.uInks.value[i].copy(i < n ? (typeof opts.inks[i] === 'number' ? RISO_INK_VECS[opts.inks[i]] : inkVec(opts.inks[i])) : new THREE.Vector3()); u.uInkCount.value = n; }
  if (opts.dot != null) u.uDot.value = opts.dot;
  if (opts.reg != null) u.uReg.value = opts.reg;
  if (opts.grain != null) u.uGrain.value = opts.grain;
  if (opts.paper != null) u.uPaper.value = typeof opts.paper === 'string' ? inkVec(opts.paper) : opts.paper;
  const png = renderToPng(replicaMat, w, h);
  tex.dispose();
  return png;
};

window.__loadTexture = (url) => new Promise((resolve, reject) => {
  new THREE.TextureLoader().load(url, (t) => { const w = t.image.width, h = t.image.height; t.dispose(); resolve({ w, h }); }, undefined, () => reject(new Error('texture load failed')));
});

/* Boot with a demo image so the page isn't blank + the harness has something without a file dialog. */
(function demo() {
  const n = 320, c = document.createElement('canvas'); c.width = c.height = n;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, n, n);
  g.addColorStop(0, '#1e6bff'); g.addColorStop(0.5, '#b89968'); g.addColorStop(1, '#d04648');
  x.fillStyle = g; x.fillRect(0, 0, n, n);
  x.fillStyle = '#3cf06a'; x.beginPath(); x.arc(n * 0.5, n * 0.5, n * 0.28, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#16100a'; x.font = 'bold 88px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('LGR', n / 2, n / 2);
  window.__riso(c.toDataURL('image/png'), { inks: [1, 8, 4], dot: 7, reg: 6, grain: 0.12 });
})();

window.__risoReady = true;
