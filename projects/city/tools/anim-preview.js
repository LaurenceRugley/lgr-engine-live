/* ============================================================
   anim-preview.js — L56 dev tool: preview the engine-core sprite-sheet animator.
   ------------------------------------------------------------
   The "generate → drop → poke" loop Laurence wants: load a sprite SHEET (PNG, horizontal strip OR
   2D grid) + frame params (cols/rows/fps), and watch it animate on a billboard via the SAME
   `createSpriteAnim` the city gulls use (no duplicate animator → the preview tests the real module).
   Dev-only (a second Vite page, sibling of tools/pixelate.html); not part of the live demo flow.

   Teaching: reads user files SAFELY (ImageBitmap, no eval/innerHTML); a sprite sheet = a texture
   atlas; the animator windows it with offset/repeat (see sprite-anim.js).
   ============================================================ */
import { THREE, createSpriteAnim } from '@lgr/engine-core';

const $ = (id) => document.getElementById(id);
const errEl = $('err');
const setErr = (m) => { errEl.textContent = m || ''; };

/* --- a tiny three stage: an orthographic camera + one billboard sprite filling the view. --- */
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const SIZE = 420;
renderer.setSize(SIZE, SIZE);
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
camera.position.z = 2;
const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }));
sprite.scale.set(1.6, 1.6, 1);
scene.add(sprite);

/* --- state: the SHEET texture (shared image), the per-instance windowed texture, and the animator. --- */
let sheetTex = null;       // THREE.Texture of the full sheet
let anim = null;           // createSpriteAnim(...)
let frameTex = null;       // anim.makeInstanceTexture(sheetTex) — what the sprite samples
let playing = true;

/* Rebuild the animator + windowed texture from the current cols/rows/fps + sheet. Called on any change. */
function rebuild() {
  if (!sheetTex) return;
  const cols = Math.max(1, parseInt($('cols').value, 10) || 1);
  const rows = Math.max(1, parseInt($('rows').value, 10) || 1);
  const fps = Math.max(1, parseInt($('fps').value, 10) || 1);
  try {
    anim = createSpriteAnim({ cols, rows, fps });
    frameTex = anim.makeInstanceTexture(sheetTex);
    frameTex.magFilter = THREE.NearestFilter;       // crisp cell edges, no bleed between frames
    frameTex.minFilter = THREE.NearestFilter;
    frameTex.needsUpdate = true;
    sprite.material.map = frameTex; sprite.material.needsUpdate = true;
    $('scrub').max = String(anim.frames - 1);
    setErr('');
  } catch (e) { setErr('animator error: ' + e.message); }
}

/* Adopt a loaded image (ImageBitmap or HTMLCanvas/Image) as the sheet, then rebuild. */
function useSheetImage(img) {
  sheetTex = new THREE.CanvasTexture(toCanvas(img));
  sheetTex.colorSpace = THREE.SRGBColorSpace;
  $('drop').style.display = 'none';
  rebuild();
}
function toCanvas(img) {
  const w = img.width, h = img.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

/* A procedural test sheet so there's always something to poke without a file: cols×rows numbered,
   distinctly-tinted cells → the frame-stepping is unmistakable. */
function generateTestSheet() {
  const cols = Math.max(1, parseInt($('cols').value, 10) || 4);
  const rows = Math.max(1, parseInt($('rows').value, 10) || 1);
  const cell = 64, c = document.createElement('canvas');
  c.width = cols * cell; c.height = rows * cell;
  const x = c.getContext('2d');
  let n = 0;
  for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++, n++) {
    const hue = (n / (cols * rows)) * 360;
    x.fillStyle = `hsl(${hue},70%,52%)`;
    x.fillRect(col * cell + 2, r * cell + 2, cell - 4, cell - 4);
    x.fillStyle = '#0e0b07'; x.font = 'bold 26px ui-monospace, monospace';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(String(n), col * cell + cell / 2, r * cell + cell / 2);
  }
  useSheetImage(c);
}

/* --- file load (safe: ImageBitmap, never eval/innerHTML) + drag-drop --- */
async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) { setErr('not an image file'); return; }
  try { useSheetImage(await createImageBitmap(file)); }
  catch (e) { setErr('could not decode image: ' + e.message); }
}
$('load').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => loadFile(e.target.files[0]));
$('test').addEventListener('click', generateTestSheet);
['cols', 'rows', 'fps'].forEach((id) => $(id).addEventListener('input', rebuild));
$('play').addEventListener('click', () => { playing = !playing; $('play').textContent = playing ? '⏸ pause' : '▶ play'; });
$('scrub').addEventListener('input', () => {
  if (!anim || !frameTex) return;
  playing = false; $('play').textContent = '▶ play';
  const f = anim.setFrame(frameTex, parseInt($('scrub').value, 10));
  $('frameLbl').textContent = String(f);
});
window.addEventListener('dragover', (e) => { e.preventDefault(); $('drop').classList.add('over'); });
window.addEventListener('dragleave', () => $('drop').classList.remove('over'));
window.addEventListener('drop', (e) => { e.preventDefault(); $('drop').classList.remove('over'); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });

/* --- the loop: advance the animator (when playing) and render. Harness probes mirror the gulls'. --- */
const clock = new THREE.Clock();
function tick() {
  const t = clock.getElapsedTime();
  if (anim && frameTex && playing) {
    const f = anim.step(frameTex, t, 0);
    $('frameLbl').textContent = String(f);
    $('scrub').value = String(f);
    if (typeof window !== 'undefined') window.__previewFrame = f;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
generateTestSheet();   // boot with a test sheet so the page is alive immediately
tick();
