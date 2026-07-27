/* ============================================================
   @lgr/engine-core — createBeforeAfter (Lesson X)
   ------------------------------------------------------------
   A before/after reveal where the boundary is a LIQUID FRONT rather than a clip-path line: drag, and the
   old photograph melts into the new one, its pixels dragged along by the front. The shader
   (image-transition.frag) explains the melt; this file is the component around it.

   The engine's first PHOTOGRAPH path. Every scene before this was procedural — this one's subject is the
   client's own work, which is the entire point: for a stylist, the photos ARE the product, and this makes
   her photos move in a way nobody else's do.

   ENGINE-FIRST: the capability lives here, parameterised. A template passes two URLs and wires a pointer;
   it does not own any WebGL. Nothing in this file knows what a hairstylist is.

   ── THE THREE THINGS THAT ARE EASY TO GET WRONG, AND WHAT WE DO ABOUT THEM ────
   1. COLOUR. A photo is stored in sRGB. If you hand it to the GPU untagged, it is treated as linear, and
      every mid-tone comes out wrong — washed and flat, in a way that looks like "the WebGL version is a
      bit off" rather than an obvious bug. So each texture is tagged SRGBColorSpace, the GPU decodes it to
      linear on sample, and three re-encodes on output. AND we render this component STRAIGHT TO THE
      CANVAS — never through the engine's filmic/ACES/grade post chain, which is tuned for HDR scenes and
      would tint a photograph. A photo must come out as the photo.
   2. FALLBACK. This runs on a paying client's site. If WebGL is unavailable, the section must still show
      her work: we drop in a plain <img> of the AFTER image and never blank. That path is load-bearing,
      not a courtesy.
   3. ACCESS. A drag-only control is invisible to a keyboard and to a screen reader. So the mount is a
      role="slider" with aria-valuenow, arrow keys step it, Home/End jump to the ends, and it is
      focusable. The pointer is the delight; the keyboard is the guarantee.

   RAF: createEngineCore owns no loop, so this component owns its own — and pauses it when the section is
   off-screen (the same battery bug that bit the site templates: a WebGL canvas rendering at full rate
   behind the fold is pure drain).

   createBeforeAfter(container, { before, after, ... })
     → { setProgress, getProgress, update, dispose, canvas }
   ============================================================ */
import * as THREE from 'three';
import { createEngineCore } from './createEngineCore.js';
import fullscreenVert from './shaders/fullscreen.vert';
import imageTransitionFrag from './shaders/image-transition.frag';
/* L-Y: the photo plumbing (sRGB load · WebGL check · fallback <img> · reduced-motion · off-screen pause)
   was lifted out of this file into photo-path.js so createLookReel could REUSE it rather than copy it —
   copying is how the site templates ended up with 13 drifting static servers. Behaviour here is unchanged;
   the 17-check before-after-probe is the guard that says so. */
import { hasWebGL, prefersReducedMotion, mountImageFallback, loadPhoto, watchVisibility } from './photo-path.js';

/* The WebGL-off fallback: her work, still on the page. */
function mountFallback(container, afterUrl, alt) {
  const img = mountImageFallback(container, afterUrl, alt);
  container.setAttribute('data-before-after', 'fallback-image');
  return {
    setProgress() {}, getProgress() { return 1; }, update() {},
    dispose() { img.remove(); },
    canvas: null,
    fallback: true,
  };
}

export async function createBeforeAfter(container, {
  before,                    // URL of the "before" photo
  after,                     // URL of the "after" photo
  melt      = 1.0,           // 0 = a clean (still wobbly) wipe · 1 = full liquid drag
  width     = 0.18,          // the melting band's width, in UV
  progress  = 0,             // starting progress
  mode      = 'pointer',     // 'pointer' (drag to reveal) | 'auto' (cycles on its own)
  autoMs    = 4200,          // 'auto': ms per leg
  holdMs    = 1400,          // 'auto': ms held at each end
  label     = 'Before and after',
  alt       = '',            // alt text for the fallback <img>
  step      = 0.05,          // keyboard arrow step
} = {}) {
  if (!container) throw new Error('createBeforeAfter: container is required');
  if (!before || !after) throw new Error('createBeforeAfter: before and after image URLs are required');

  /* ── FALLBACK FIRST. If there is no WebGL we must still show her work. Checking BEFORE we build
     anything means the failure path is the cheap one, not a half-constructed engine. ─────────── */
  let core;
  try {
    if (!hasWebGL()) return mountFallback(container, after, alt);
    core = await createEngineCore({ container, lean: true });
  } catch (err) {
    console.warn('[createBeforeAfter] WebGL unavailable — showing the after image.', err);
    return mountFallback(container, after, alt);
  }

  const { renderer, drawBuffer } = core;

  /* Straight to the canvas: no post chain (see note 1 in the header). */
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);   // fullscreen.vert ignores it

  const material = new THREE.ShaderMaterial({
    vertexShader:   fullscreenVert,
    fragmentShader: imageTransitionFrag,
    uniforms: {
      uBefore:    { value: null },
      uAfter:     { value: null },
      uProgress:  { value: progress },
      uTime:      { value: 0 },
      uQuadRes:   { value: new THREE.Vector2(drawBuffer.x, drawBuffer.y) },
      uBeforeRes: { value: new THREE.Vector2(1, 1) },
      uAfterRes:  { value: new THREE.Vector2(1, 1) },
      uMelt:      { value: melt },
      uWidth:     { value: width },
      /* uMeltAmp — the shared frag gained a master "how liquid" scalar in Lesson Z (for createLookReel's
         crossfade mode). before/after is ALWAYS a full liquid melt, so we pin it at 1.0. This line is not
         optional: a uniform the shader DECLARES but the material never SETS defaults to 0.0 in GL, which
         would silently turn every before/after slider into a crossfade. Pinning it 1.0 keeps this
         component byte-identical — the 17-check probe is the guard that proves it. */
      uMeltAmp:   { value: 1.0 },
    },
    depthTest: false, depthWrite: false,
  });
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(quadGeo, material);
  quad.frustumCulled = false;
  scene.add(quad);

  /* ── Load the photographs ─────────────────────────────────────────────────────
     colorSpace = SRGBColorSpace is THE line. Without it the photo is decoded as if its bytes were
     already linear light, and every mid-tone lands too bright — the classic washed-out WebGL photo. */
  const loader = new THREE.TextureLoader();

  let texBefore, texAfter;
  try {
    [texBefore, texAfter] = await Promise.all([loadPhoto(before, loader), loadPhoto(after, loader)]);
  } catch (err) {
    console.warn('[createBeforeAfter] an image failed to load — showing the after image.', err);
    core.dispose?.();
    container.innerHTML = '';
    return mountFallback(container, after, alt);
  }

  /* loadPhoto already tagged them SRGBColorSpace + set the filters (photo-path.js) — that IS the gotcha,
     handled once for every photo component in the engine. */
  material.uniforms.uBefore.value = texBefore;
  material.uniforms.uAfter.value  = texAfter;
  material.uniforms.uBeforeRes.value.set(texBefore.image.width, texBefore.image.height);
  material.uniforms.uAfterRes.value.set(texAfter.image.width,  texAfter.image.height);

  /* ── A11y: the mount IS the slider ───────────────────────────────────────────── */
  container.setAttribute('role', 'slider');
  container.setAttribute('tabindex', '0');
  container.setAttribute('aria-label', label);
  container.setAttribute('aria-valuemin', '0');
  container.setAttribute('aria-valuemax', '100');
  container.setAttribute('data-before-after', 'webgl');
  container.style.touchAction = 'pan-y';   // let the page scroll vertically; we own horizontal drags

  let _p = Math.min(1, Math.max(0, progress));
  function setProgress(t, fromUser) {
    _p = Math.min(1, Math.max(0, t));
    material.uniforms.uProgress.value = _p;
    container.setAttribute('aria-valuenow', String(Math.round(_p * 100)));
    if (fromUser) auto = false;   // a user touching it ends any auto-play, permanently
  }
  setProgress(_p);

  /* ── POINTER DRIVE — instant, no damping ──────────────────────────────────────
     The brief is explicit and it's the right call: the melt must track the finger. Any smoothing here
     reads as lag, and lag on a direct-manipulation control feels broken rather than smooth. So the
     pointer position maps STRAIGHT to progress. Pointer Events cover mouse + touch + pen in one path. */
  const xToProgress = (clientX) => {
    const r = container.getBoundingClientRect();
    return (clientX - r.left) / Math.max(r.width, 1);
  };
  let dragging = false;
  const onDown = (e) => { dragging = true; container.setPointerCapture?.(e.pointerId);
                          setProgress(xToProgress(e.clientX), true); };
  const onMove = (e) => { if (dragging) setProgress(xToProgress(e.clientX), true); };
  const onUp   = (e) => { dragging = false; container.releasePointerCapture?.(e.pointerId); };
  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onUp);

  /* Keyboard — the guarantee. */
  const onKey = (e) => {
    let t = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp')   t = _p + step;
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowDown') t = _p - step;
    if (e.key === 'Home') t = 0;
    if (e.key === 'End')  t = 1;
    if (t === null) return;
    e.preventDefault();
    setProgress(t, true);
  };
  container.addEventListener('keydown', onKey);

  /* ── AUTO mode (the stretch) — and reduced-motion kills it ────────────────────
     Reduced motion means "do not move things at me". An auto-cycling image transition is precisely
     that, so it is disabled outright — but the POINTER still works, because a user-initiated change is
     not unsolicited motion. That distinction is the whole point of the WCAG rule. */
  const reduced = prefersReducedMotion();
  let auto = mode === 'auto' && !reduced;
  const CYCLE = (autoMs + holdMs) * 2;

  function autoProgress(elapsedMs) {
    const t = elapsedMs % CYCLE;
    if (t < holdMs) return 0;                                   // hold at 'before'
    if (t < holdMs + autoMs) return (t - holdMs) / autoMs;      // melt across
    if (t < holdMs * 2 + autoMs) return 1;                      // hold at 'after'
    return 1 - (t - holdMs * 2 - autoMs) / autoMs;              // melt back
  }

  /* ── Loop. Pauses off-screen: a canvas rendering behind the fold is pure battery drain (the bug we
     just fixed across the site templates — do not re-introduce it in the engine's own component). ── */
  let raf = null, disposed = false, t0 = null;
  const vis = watchVisibility(container);

  function update(nowMs) {
    if (t0 === null) t0 = nowMs;
    const elapsed = nowMs - t0;
    material.uniforms.uTime.value = elapsed * 0.001;
    if (auto && !dragging) setProgress(autoProgress(elapsed));
    /* Cover-fit box guard (Lesson Z2b). A degenerate box — a 0-width cold init (an embedded pane mid-
       layout, where clientWidth AND innerWidth momentarily read 0), or a container that GREW via layout
       without firing a window 'resize' — must never reach uQuadRes, or coverUv's x-scale collapses to 0
       and the photo renders as a sticky horizontal-streak smear. So: if the box is degenerate AND the
       container now actually HAS a real size to adopt, re-sync via core.resize() (which now updates the
       shared drawBuffer); then never write a <1 dimension. The `container.client*` gate is load-bearing:
       resize() allocates a Vector2, so calling it unconditionally every frame while a box stays 0-width
       would be a per-frame hot alloc — the gate makes the re-sync fire once, at the heal frame. */
    if ((drawBuffer.x < 1 || drawBuffer.y < 1) && container.clientWidth >= 1 && container.clientHeight >= 1) core.resize();
    if (drawBuffer.x >= 1 && drawBuffer.y >= 1) material.uniforms.uQuadRes.value.set(drawBuffer.x, drawBuffer.y);
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);          // straight to the canvas — no post, true colour
  }

  function tick(now) {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    if (!vis.visible) return;                // off-screen → stop rendering (battery)
    core.frameStart();
    update(now);
    core.frameEnd();                         // increments window.__frames — the honest render counter
  }
  raf = requestAnimationFrame(tick);

  const onResize = () => core.resize();
  window.addEventListener('resize', onResize, { passive: true });

  function dispose() {
    disposed = true;
    if (raf !== null) cancelAnimationFrame(raf);
    vis.dispose();
    window.removeEventListener('resize', onResize);
    container.removeEventListener('pointerdown', onDown);
    container.removeEventListener('pointermove', onMove);
    container.removeEventListener('pointerup', onUp);
    container.removeEventListener('pointercancel', onUp);
    container.removeEventListener('keydown', onKey);
    texBefore.dispose();
    texAfter.dispose();
    material.dispose();
    quadGeo.dispose();
    scene.remove(quad);
    core.dispose?.();
  }

  /* setAuto — the stretch mode, exposed as a verb rather than a boot-time-only flag so a section can
     start cycling and stop the moment the visitor grabs it. Reduced motion vetoes it unconditionally:
     asking for auto-play does not override a user who has asked the OS for less motion. */
  function setAuto(on) {
    if (reduced) { auto = false; return false; }
    auto = !!on;
    if (auto) t0 = null;        // restart the cycle from the current frame, not mid-melt
    return auto;
  }

  return {
    setProgress: (t) => setProgress(t, true),
    getProgress: () => _p,
    setAuto,
    isReducedMotion: () => reduced,
    update, dispose,
    canvas: renderer.domElement,
    fallback: false,
  };
}
