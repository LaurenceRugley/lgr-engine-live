/* ============================================================
   pixelate.js — the PixelKit image tool (Lesson 10, page 2 of the MPA build).
   ------------------------------------------------------------
   A focused single-purpose tool: drop an image in, dial an era / grid / dither / palette,
   and export game-ready pixel art. Same PixelKit shader the 3D scene uses — here pointed
   at an uploaded image instead of the rendered frame. This is the John art-makeover
   workflow: arbitrary art in (e.g. an AI concept), consistent pixel asset out.

   TEACHING NOTES inline: reading user files safely (ImageBitmap, no eval/innerHTML),
   the median-cut palette extraction (in pixelkit.js), and exporting at the NATIVE pixel
   grid (one texel = one pixel) rather than the upscaled preview.
   ============================================================ */
import {
  THREE, fullscreenVert, postPixelkitFrag, ERA_PRESETS, LGR_PALETTES, makePaletteTexture, medianCut,
} from '@lgr/engine-core';

/* ---- renderer + a single fullscreen quad running the PixelKit shader -------- */
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);                         // 1:1 so the preview pixels are honest
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const material = new THREE.ShaderMaterial({
  vertexShader: fullscreenVert,
  fragmentShader: postPixelkitFrag,
  uniforms: {
    uScene:       { value: null },
    uResolution:  { value: new THREE.Vector2(1, 1) },
    uGridWidth:   { value: 160 },
    uDither:      { value: 0.55 },
    uPalette:     { value: makePaletteTexture(ERA_PRESETS['8-bit'].palette) },
    uPaletteSize: { value: ERA_PRESETS['8-bit'].palette.length },
    uUsePalette:  { value: 1.0 },
  },
});
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

/* ---- state ----------------------------------------------------------------- */
let imageTexture = null;     // the uploaded image as a GPU texture
let imageAspect = 1;         // w/h of the loaded image
let imagePixels = null;      // a small RGBA sample for median-cut
let dispW = 1, dispH = 1;

const $ = (id) => document.getElementById(id);

/* Fit the canvas to the image aspect within the viewport (so nothing stretches). */
function layout() {
  const maxW = window.innerWidth * 0.96, maxH = window.innerHeight * 0.96;
  let w = maxW, h = w / imageAspect;
  if (h > maxH) { h = maxH; w = h * imageAspect; }
  dispW = Math.max(1, Math.round(w));
  dispH = Math.max(1, Math.round(h));
  renderer.setSize(dispW, dispH);
  material.uniforms.uResolution.value.set(dispW, dispH);
}

function render() {
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);
}

/* ---- palette wiring -------------------------------------------------------- */
function setPalette(hexes) {
  material.uniforms.uPalette.value.dispose?.();
  material.uniforms.uPalette.value = makePaletteTexture(hexes);
  material.uniforms.uPaletteSize.value = hexes.length;
  // swatches
  $('swatches').innerHTML = '';
  for (const h of hexes) { const i = document.createElement('i'); i.style.background = h; $('swatches').appendChild(i); }
}

function applyPaletteSource() {
  const src = $('palette').value;
  const era = ERA_PRESETS[$('era').value];
  if (src === 'era') {
    material.uniforms.uUsePalette.value = era.palette ? 1.0 : 0.0;     // modern = no palette
    if (era.palette) setPalette(era.palette); else $('swatches').innerHTML = '';
  } else if (src === 'extract') {
    material.uniforms.uUsePalette.value = 1.0;
    const n = era.palette ? era.palette.length : 32;                   // match the era's count
    setPalette(imagePixels ? medianCut(imagePixels, n) : ['#000000']);
  } else {                                                             // an LGR preset
    material.uniforms.uUsePalette.value = 1.0;
    setPalette(LGR_PALETTES[src]);
  }
  render();
}

function applyEra() {
  const era = ERA_PRESETS[$('era').value];
  $('grid').value = era.gridWidth;
  $('dither').value = Math.round(era.dither * 100);
  material.uniforms.uGridWidth.value = era.gridWidth;
  material.uniforms.uDither.value = era.dither;
  applyPaletteSource();   // re-derives palette for the new era (incl. extract count)
}

/* ---- load an image (drop or pick) — ImageBitmap is the safe, fast path ------ */
async function loadImage(file) {
  if (!file || !file.type.startsWith('image/')) return;
  // FIX(L11): pre-flip the bitmap and disable Three's flipY. Three's UNPACK_FLIP_Y has
  // no effect on an ImageBitmap source (it warns), so the image rendered UPSIDE-DOWN.
  // imageOrientation:'flipY' bakes the flip into the bitmap; flipY=false then matches.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'flipY' });
  imageAspect = bitmap.width / bitmap.height;
  if (imageTexture) imageTexture.dispose();
  imageTexture = new THREE.Texture(bitmap);
  imageTexture.flipY = false;
  imageTexture.colorSpace = THREE.SRGBColorSpace;
  imageTexture.minFilter = THREE.LinearFilter;
  imageTexture.magFilter = THREE.LinearFilter;
  imageTexture.generateMipmaps = false;
  imageTexture.needsUpdate = true;
  material.uniforms.uScene.value = imageTexture;

  // grab a small RGBA sample for median-cut (downscale for speed; ~160px wide)
  const sw = Math.min(160, bitmap.width), sh = Math.max(1, Math.round(sw / imageAspect));
  const c = document.createElement('canvas'); c.width = sw; c.height = sh;
  const cx = c.getContext('2d'); cx.drawImage(bitmap, 0, 0, sw, sh);
  imagePixels = cx.getImageData(0, 0, sw, sh).data;   // Uint8ClampedArray RGBA

  $('drop').classList.add('hide');
  layout();
  applyPaletteSource();   // 'extract' depends on the freshly loaded pixels
  render();
}

/* ---- export PNG at the NATIVE grid resolution (one texel = one pixel) ------- */
function linToSrgb(v) {                              // RT pixels are LINEAR; PNGs are sRGB
  v /= 255;
  v = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}
/* Render the crunched image at its NATIVE grid (one texel = one output pixel) into a 2D canvas —
   the shared core of both the interactive export and the headless asset-factory batch (so the batch
   is pixel-FAITHFUL to the live shader, no CPU reimplementation / drift). */
function crunchToCanvas(gw) {
  const gh = Math.max(1, Math.round(gw / imageAspect));
  const rt = new THREE.WebGLRenderTarget(gw, gh, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const savedRes = material.uniforms.uResolution.value.clone();
  material.uniforms.uResolution.value.set(gw, gh);   // cells map 1:1 to output pixels
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  const buf = new Uint8Array(gw * gh * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, gw, gh, buf);
  renderer.setRenderTarget(null);
  material.uniforms.uResolution.value.copy(savedRes);
  rt.dispose();

  // copy into a 2D canvas (flip Y — WebGL is bottom-up; convert linear→sRGB)
  const out = document.createElement('canvas'); out.width = gw; out.height = gh;
  const octx = out.getContext('2d');
  const img = octx.createImageData(gw, gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const s = ((gh - 1 - y) * gw + x) * 4, d = (y * gw + x) * 4;
      img.data[d] = linToSrgb(buf[s]); img.data[d + 1] = linToSrgb(buf[s + 1]);
      img.data[d + 2] = linToSrgb(buf[s + 2]); img.data[d + 3] = buf[s + 3];
    }
  }
  octx.putImageData(img, 0, 0);
  return { out, gw, gh };
}
function exportPNG() {
  if (!imageTexture) return;
  const { out, gw, gh } = crunchToCanvas(Math.round(material.uniforms.uGridWidth.value));
  out.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pixelkit-${$('era').value}-${gw}x${gh}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  window.__lastExport = { w: gw, h: gh };             // for the verification harness
}

/* ---- HEADLESS BATCH API (L44 asset-factory, stage 3) -----------------------------------------
   __crunch(dataURL, { grid, palette, dither }) → out PNG data-URL. Runs the REAL pixelkit shader
   off-screen (same material + export math as the interactive tool → faithful, no drift), so the
   asset-factory Node batch drives this via headless Chrome. `palette`:
     • 'lgr-charm'            → the house warm ink-gold (back-compat alias)
     • an LGR_PALETTES key    → that named palette (e.g. 'cool (noir)', 'warm (sunset)')
     • 'auto'                 → medianCut a palette FROM this image (its own colour identity)
     • null / 'none'          → no palette quantization, grid-crunch only (keep colours)
   `paletteSize` (default 16) sets N for 'auto'. Deterministic: same input + params → identical
   output (the median-cut sample is a fixed downscale, the algorithm sorts deterministically). */
const CHARM_PALETTES = { 'lgr-charm': LGR_PALETTES['ink-gold (day)'] };
window.__crunch = async (dataURL, opts = {}) => {
  const { grid = 160, palette = 'lgr-charm', dither = 0.5, paletteSize = 16 } = opts;
  const blob = await (await fetch(dataURL)).blob();
  await loadImage(new File([blob], 'in.png', { type: blob.type || 'image/png' }));   // populates imagePixels
  material.uniforms.uGridWidth.value = grid;
  material.uniforms.uDither.value = dither;
  if (palette === null || palette === 'none') {
    material.uniforms.uUsePalette.value = 0.0;                                        // colour-preserving
  } else if (palette === 'auto') {
    material.uniforms.uUsePalette.value = 1.0;
    setPalette(imagePixels ? medianCut(imagePixels, paletteSize) : ['#000000']);      // per-image LUT
  } else {
    material.uniforms.uUsePalette.value = 1.0;
    setPalette(CHARM_PALETTES[palette] || LGR_PALETTES[palette] || ERA_PRESETS['8-bit'].palette);
  }
  render();
  const { out, gw, gh } = crunchToCanvas(grid);
  window.__crunchResult = { w: gw, h: gh };
  return out.toDataURL('image/png');
};

/* ---- DOM wiring ------------------------------------------------------------ */
/* L47: surface EVERY LGR_PALETTES key in the tool dropdown, built from the library so adding a
   palette in pixelkit.js auto-appears here (no stale hardcoded <option> list). The static 'era'
   default + 'extract from image' (= the per-image auto-palette) stay in the HTML. */
for (const key of Object.keys(LGR_PALETTES)) {
  const o = document.createElement('option'); o.value = key; o.textContent = key;
  $('palette').appendChild(o);
}
$('era').addEventListener('change', applyEra);
$('palette').addEventListener('change', applyPaletteSource);
$('grid').addEventListener('input', (e) => { material.uniforms.uGridWidth.value = +e.target.value; render(); });
$('dither').addEventListener('input', (e) => { material.uniforms.uDither.value = +e.target.value / 100; render(); });
$('export').addEventListener('click', exportPNG);
$('pick').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => loadImage(e.target.files[0]));

const drop = $('drop');
window.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
window.addEventListener('dragleave', () => drop.classList.remove('over'));
window.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); loadImage(e.dataTransfer.files[0]); });
window.addEventListener('resize', () => { layout(); render(); });

/* Boot with a generated demo image so the page isn't blank before a drop (and so the
   verification harness has something to pixelate without a file dialog). */
(function demo() {
  const n = 256, c = document.createElement('canvas'); c.width = c.height = n;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, n, n);
  g.addColorStop(0, '#1e6bff'); g.addColorStop(0.5, '#b89968'); g.addColorStop(1, '#d04648');
  x.fillStyle = g; x.fillRect(0, 0, n, n);
  x.fillStyle = '#3cf06a'; x.beginPath(); x.arc(n * 0.5, n * 0.5, n * 0.28, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#16100a'; x.font = 'bold 64px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('LGR', n / 2, n / 2);
  c.toBlob((b) => loadImage(new File([b], 'demo.png', { type: 'image/png' })));
})();

/* L44: prove a packed asset loads on the engine's TEXTURE path (THREE.TextureLoader, the same loader
   the scene/office use) — the asset-factory batch calls this to verify the out PNG is engine-ready,
   WITHOUT mutating any live default. Resolves {w,h} or rejects on a decode error. */
window.__loadTexture = (url) => new Promise((resolve, reject) => {
  new THREE.TextureLoader().load(
    url,
    (t) => { const w = t.image.width, h = t.image.height; t.dispose(); resolve({ w, h }); },
    undefined,
    () => reject(new Error('texture load failed')),
  );
});

applyEra();
window.__pixelkitReady = true;
