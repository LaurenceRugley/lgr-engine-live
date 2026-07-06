/* ============================================================
   @lgr/engine-core — sprite-anim.js (Lesson 43): UV-window stepping over a sprite SHEET.
   ------------------------------------------------------------
   A tiny, generic flip-book animator for billboard sprites. A sprite SHEET is a texture atlas of N
   frames laid out in a horizontal strip; animating = moving a 1/N-wide viewport across it via
   `tex.repeat`/`tex.offset` (no new geometry, no new draw calls — the same sprite, a different UV
   window each frame). One SHARED clock drives everything; a per-instance `phase` (a frame offset)
   desyncs a flock so they don't all flap in unison.

   Per-instance independence: `tex.offset` lives on the TEXTURE, so each animated sprite needs its OWN
   texture object (a clone of the shared sheet — same canvas image, its own offset/repeat). A handful
   of clones of one small canvas is cheap.

   C++ anchors: a sprite sheet = a texture atlas; `offset`/`repeat` = a moving viewport into it (like
   indexing `frames[i]` into one backing buffer in a flipbook); `phase` desync = each instance samples
   one shared clock at its own offset (staggered start times, not N separate timers).

   v2 seam (the diffusion/PixelKit asset-factory rides on THIS): swap the procedural sheet for an
   authored one (detailed flap frames, multi-row sheets, bit-depth tiers) — the animator is unchanged;
   only `frames`/`fps`/the sheet image change. See [[ai-reinterpretation-pipeline]].
   ============================================================ */
import * as THREE from 'three';

/* createSpriteAnim({ frames, fps, cols, rows }) — a flip-book animator over a sprite SHEET.
   - HORIZONTAL STRIP (the L43 default): pass just `{ frames, fps }` → cols=frames, rows=1.
   - 2D GRID (L56, for diffusion-generated sheets that pack frames in a grid): pass `{ cols, rows, fps }`
     (and optionally `frames` if the last row is partial). Frame f maps to cell (col = f%cols, row = f//cols),
     row 0 at the TOP (so an authored sheet reads top-left → right → next row down).
   - makeInstanceTexture(sheetTex): a per-instance clone of the sheet, windowed to one cell.
   - step(tex, elapsed, phase): advance that instance to time `elapsed` (+ a per-instance frame `phase` to
     desync a flock). Returns the frame index. FREEZES on frame 0 under prefers-reduced-motion (WCAG 2.3.1,
     same precedent as the day/night auto-cycle).
   - setFrame(tex, n): jump to a specific frame (used by the preview tool to scrub). */
export function createSpriteAnim({ frames, fps = 8, cols, rows = 1 } = {}) {
  const nCols = cols || frames || 4;                 // strip default: cols = frames
  const nRows = rows || 1;
  const nFrames = frames || (nCols * nRows);          // grid default: every cell is a frame
  // Live reduced-motion query (updates if the OS setting flips). Guarded for SSR / no-matchMedia.
  const RM = (typeof window !== 'undefined' && window.matchMedia) ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function place(tex, f) {                            // window the texture onto cell f (row 0 = TOP)
    const col = f % nCols, row = Math.floor(f / nCols);
    tex.offset.x = col / nCols;
    tex.offset.y = 1 - (row + 1) / nRows;             // V is bottom-up in GL → flip rows for top-left origin
  }
  function makeInstanceTexture(sheetTex) {
    const t = sheetTex.clone();          // same canvas image, but its own offset/repeat
    t.needsUpdate = true;                // upload the clone
    t.repeat.set(1 / nCols, 1 / nRows);  // a one-cell window onto the atlas
    place(t, 0);
    return t;
  }
  function step(tex, elapsed, phase = 0) {
    if (RM && RM.matches) { place(tex, 0); return 0; }                 // reduced-motion: hold frame 0
    // (... + nFrames) % nFrames keeps it non-negative for negative phases.
    const f = ((Math.floor(elapsed * fps + phase) % nFrames) + nFrames) % nFrames;
    place(tex, f);
    return f;
  }
  function setFrame(tex, n) { const f = ((Math.round(n) % nFrames) + nFrames) % nFrames; place(tex, f); return f; }
  return { frames: nFrames, fps, cols: nCols, rows: nRows, makeInstanceTexture, step, setFrame };
}

/* ------------------------------------------------------------------------------------------------
   L61 v2 — piece #1: LUMINANCE × TINT (so a SHADED sheet recolours cleanly into N variants).
   ------------------------------------------------------------------------------------------------
   The L43 gulls were a flat WHITE strip tinted by a per-instance `material.color`: white(1)×color =
   color, so a flat multiply gave clean variants. But an AUTHORED diffusion sheet carries real shading
   (lit top, shadowed underside) — and if that shading is stored as RGB, a flat `material.color`
   multiply would tint the shading too (muddy), while if the sheet had its own hue the multiply would
   stack hues. The fix is the classic 8-bit palette-swap: collapse the sheet to LUMINANCE (a grayscale
   mask, L = 0.299r+0.587g+0.114b — Rec.601 NTSC luma) ONCE, then the per-instance multiply becomes
   exactly `tint = lum × color` — the shading (carried by L) survives, the hue comes wholly from the
   instance colour. One sheet → many skins, the cheap way (a constant-colour multiply per instance, no
   per-instance shader). ALPHA is left untouched so the cutout/anti-aliased edges are preserved.

   C++ anchor: precompute a single grayscale mask buffer, then `out.rgb = mask * constColor` per draw —
   a palette-swap over one shared bitmap, not N recoloured copies. */
export function toLuminanceTexture(srcTex) {
  // SSR / no-DOM guard: nothing to rasterise, hand the source straight back.
  if (typeof document === 'undefined' || !srcTex || !srcTex.image) return srcTex;
  const img = srcTex.image;
  const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h), p = id.data;
  for (let i = 0; i < p.length; i += 4) {
    const L = (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) | 0;  // perceptual grayscale
    p[i] = p[i + 1] = p[i + 2] = L;                                      // RGB → (L,L,L); A untouched
  }
  ctx.putImageData(id, 0, 0);
  const out = new THREE.CanvasTexture(cv);
  out.colorSpace = srcTex.colorSpace || THREE.SRGBColorSpace;
  return out;
}

/* ------------------------------------------------------------------------------------------------
   L61 v2 — piece #2: the SWAPPABLE-SHEET SEAM (drop in a real diffusion sheet, procedural fallback).
   ------------------------------------------------------------------------------------------------
   The whole point of the asset-factory ([[ai-reinterpretation-pipeline]]) is "generate → drop →
   animate": author a sheet in ComfyUI, drop the PNG in, and the creature upgrades with no code change.
   This is the dependency-injection seam for that drop-in. It returns a usable sheet SYNCHRONOUSLY (the
   procedural `fallback`, so the caller can build its instances immediately and the lesson is
   self-contained even with no asset), and — if a `url` is supplied — async-loads the authored PNG grid
   and hands the real sheet to `onReady(tex)` so the caller can swap it onto its live instances. If the
   load fails (missing file / 404) it simply keeps the fallback already returned.

   `luminance: true` runs both the fallback AND the loaded sheet through `toLuminanceTexture` so the
   per-instance `material.color` tint is a clean `lum × color` (piece #1) — the richer path the L43
   flat-white gulls now ride on too.

   Expected sheet format (the documented contract, mirrored in the .json sidecar an authored sheet
   ships with): a PNG GRID of `cols × rows` equal cells, frame order left→right then top→down, the
   subject drawn in LUMINANCE (grayscale, or white-on-transparent) on a transparent cutout so the tint
   applies; `fps`/`cols`/`rows` are the caller's (they must match the sheet's layout).

   C++ anchor: inject the sheet behind one interface (`asset ?? procedural`) — the animator neither
   knows nor cares which it got, like a strategy/factory handed a concrete backing buffer at runtime. */
export function loadSpriteSheet({ url, fallback, luminance = false, onReady } = {}) {
  const sheet = luminance ? toLuminanceTexture(fallback) : fallback;   // usable NOW (procedural)
  if (url && typeof window !== 'undefined') {
    new THREE.TextureLoader().load(
      url,
      (tex) => {                                   // authored sheet arrived → upgrade
        tex.colorSpace = THREE.SRGBColorSpace;
        if (onReady) onReady(luminance ? toLuminanceTexture(tex) : tex);
      },
      undefined,
      () => {/* load failed → keep the procedural fallback already returned (fail soft, not loud-crash) */},
    );
  }
  return sheet;
}
