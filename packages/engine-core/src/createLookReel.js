/* ============================================================
   @lgr/engine-core — createLookReel (Lesson Y)
   ------------------------------------------------------------
   A carousel of photographs where each one MELTS into the next: the same liquid front as
   createBeforeAfter, but running on its own clock through N images instead of being dragged between two.
   The stylist's reel of her best work, ambient, on a loop.

   REUSE, NOT COPY. This shares:
     • image-transition.frag  — the melt itself, verbatim. A reel transition IS a before/after: "current"
       into the uBefore slot, "next" into uAfter, and drive uProgress 0→1. Nothing new was needed.
     • photo-path.js          — sRGB-correct loading, the WebGL check, the never-blank <img> fallback,
       reduced-motion, off-screen pause. All four were solved in L-X; L-Y lifted them into a module and
       imports them. createBeforeAfter still passes its 17-check probe unchanged.
   The only genuinely new logic is in this file: the RING, the CLOCK, and the PRELOAD.

   ── THE PRELOAD RULE (the one that decides whether this is shippable) ─────────
   NEVER MELT TO AN IMAGE THAT ISN'T ON THE GPU YET. Melting to a texture that hasn't decoded gives you a
   beautiful liquid dissolve into a black rectangle, on a client's website, on the slow connection where it
   matters most. So the reel only advances when the NEXT texture is resident; if it isn't ready when the
   hold expires, the current image simply holds for longer — a photo lingering a beat too long is invisible;
   a melt into black is not.
   And if an image 404s, it is REMOVED from the ring, not melted to. A broken URL should cost her one photo,
   not the whole section.

   VRAM: N resident textures ≈ Σ w·h·4 bytes. Six 1200×800 photos ≈ 23 MB — fine. Twenty full-res 4000px
   ones would be ~1.3 GB and would kill a phone, so `maxResident` caps how many stay decoded, and images
   beyond it are loaded on approach and disposed behind us. The cap is a real dial, not a comment.

   Accessibility: the reel is AMBIENT DECORATION — it is not a control and there is nothing to operate, so
   the canvas is aria-hidden and the images must ALSO exist somewhere a screen reader can reach (a gallery
   list, alt text). Announcing "image 3 of 7" from a background slideshow just makes noise. That is a
   deliberate call; the alternative (making it a live region) is worse for the same reason a marquee is.

   createLookReel(container, { images, holdMs?, meltMs?, ... })
     → { update, dispose, pause, resume, index, count, vram }
   ============================================================ */
import * as THREE from 'three';
import { createEngineCore } from './createEngineCore.js';
import fullscreenVert from './shaders/fullscreen.vert';
import imageTransitionFrag from './shaders/image-transition.frag';   // the SAME melt — not a copy
import { hasWebGL, prefersReducedMotion, mountImageFallback, loadPhoto, watchVisibility } from './photo-path.js';

const smoothstep = (t) => t * t * (3 - 2 * t);

export async function createLookReel(container, {
  images   = [],       // the reel, in order
  holdMs   = 2600,     // how long each photo sits before it starts to go
  meltMs   = 1600,     // how long the melt takes
  melt     = 1.0,      // 0 = a clean (still wobbly) wipe · 1 = full liquid drag (only relevant to 'melt')
  width    = 0.18,     // the melting band's width
  transition = 'melt', // 'melt' (DEFAULT, the liquid drag) | 'crossfade' (a calm opacity dissolve)
  maxResident = 6,     // VRAM cap: how many decoded textures may live on the GPU at once
  alt      = '',       // alt text for the fallback <img>
  ariaHidden = true,   // see the accessibility note in the header
} = {}) {
  if (!container) throw new Error('createLookReel: container is required');
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('createLookReel: images must be a non-empty array of URLs');
  }

  /* The transition mode is one number to the shader: uMeltAmp. 'melt' = 1.0 (the liquid drag, the default,
     byte-identical to Lesson Y); 'crossfade' = 0.0 (a flat opacity dissolve — no wobbly front, no sideways
     smear, no wet seam). Crossfade is the CALM option, added because the melt streaks on light, high-
     contrast photos (an elegant salon reel); on dark/moody sets the melt still reads best. See the shader. */
  const meltAmp = transition === 'crossfade' ? 0.0 : 1.0;

  /* ── Fallbacks first, before anything is built ─────────────────────────────── */
  if (!hasWebGL()) {
    const img = mountImageFallback(container, images[0], alt);
    container.setAttribute('data-look-reel', 'fallback-image');
    return { update() {}, pause() {}, resume() {}, dispose() { img.remove(); },
             get index() { return 0; }, get count() { return images.length; },
             vram: () => 0, fallback: true };
  }

  let core;
  try {
    core = await createEngineCore({ container, lean: true });
  } catch (err) {
    console.warn('[createLookReel] WebGL unavailable — showing the first image.', err);
    const img = mountImageFallback(container, images[0], alt);
    container.setAttribute('data-look-reel', 'fallback-image');
    return { update() {}, pause() {}, resume() {}, dispose() { img.remove(); },
             get index() { return 0; }, get count() { return images.length; },
             vram: () => 0, fallback: true };
  }

  const { renderer, drawBuffer } = core;
  const loader = new THREE.TextureLoader();

  /* ── The ring of photos. A 404 removes its entry rather than poisoning the reel. ── */
  const urls = images.slice();
  const cache = new Map();     // url → texture (the resident set)
  const dead = new Set();      // url → known-bad (404 / decode failure)

  async function ensure(url) {
    if (dead.has(url)) return null;
    if (cache.has(url)) return cache.get(url);
    try {
      const tex = await loadPhoto(url, loader);
      cache.set(url, tex);
      evict();
      return tex;
    } catch {
      /* A broken URL costs her ONE photo, not the section. */
      console.warn('[createLookReel] image failed to load; skipping it:', url);
      dead.add(url);
      const i = urls.indexOf(url);
      if (i >= 0) urls.splice(i, 1);
      return null;
    }
  }

  /* VRAM cap: keep the resident set bounded. We never evict what is on screen right now or what we are
     melting into — those two are pinned by `keep`. */
  let keep = new Set();
  function evict() {
    if (cache.size <= maxResident) return;
    for (const [url, tex] of cache) {
      if (cache.size <= maxResident) break;
      if (keep.has(url)) continue;
      tex.dispose();
      cache.delete(url);
    }
  }

  /* ── The first photo must be on the GPU before we show anything. If EVERY url is dead we have no reel
     at all — fall back rather than render a black box. ─────────────────────────── */
  let cur = 0;
  let texCur = null;
  while (texCur === null && urls.length) {
    texCur = await ensure(urls[0]);
    if (!texCur) continue;      // ensure() already spliced the dead url out
  }
  if (!texCur) {
    console.warn('[createLookReel] no image could be loaded — falling back.');
    core.dispose?.();
    container.innerHTML = '';
    const img = mountImageFallback(container, images[0], alt);
    return { update() {}, pause() {}, resume() {}, dispose() { img.remove(); },
             get index() { return 0; }, get count() { return 0; }, vram: () => 0, fallback: true };
  }

  /* ── The quad: the SAME melt shader createBeforeAfter uses ─────────────────── */
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const material = new THREE.ShaderMaterial({
    vertexShader:   fullscreenVert,
    fragmentShader: imageTransitionFrag,
    uniforms: {
      uBefore:    { value: texCur },
      uAfter:     { value: texCur },     // until a next image is resident, we melt to OURSELVES = a no-op
      uProgress:  { value: 0 },
      uTime:      { value: 0 },
      uQuadRes:   { value: new THREE.Vector2(drawBuffer.x, drawBuffer.y) },
      uBeforeRes: { value: new THREE.Vector2(texCur.image.width, texCur.image.height) },
      uAfterRes:  { value: new THREE.Vector2(texCur.image.width, texCur.image.height) },
      uMelt:      { value: melt },
      uWidth:     { value: width },
      uMeltAmp:   { value: meltAmp },    // 1.0 = liquid melt (default) · 0.0 = crossfade
    },
    depthTest: false, depthWrite: false,
  });
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(quadGeo, material);
  quad.frustumCulled = false;
  scene.add(quad);

  if (ariaHidden) container.setAttribute('aria-hidden', 'true');
  container.setAttribute('data-look-reel', 'webgl');

  /* ── Reduced motion: NO auto-advance. The reel is unsolicited motion by definition, so it becomes a
     single still photograph. Not "slower" — off. ─────────────────────────────── */
  const reduced = prefersReducedMotion();

  /* ── The clock ─────────────────────────────────────────────────────────────── */
  let phase = 'hold';      // 'hold' → 'melt' → 'hold' → …
  let phaseT = 0;          // ms elapsed in this phase
  let nextIdx = -1;
  let texNext = null;
  let pending = false;     // a preload is in flight

  function beginPreload() {
    if (pending || reduced || urls.length < 2) return;
    const n = (cur + 1) % urls.length;
    const url = urls[n];
    pending = true;
    ensure(url).then((tex) => {
      pending = false;
      if (!tex) return;                 // dead url — it was spliced; we'll pick a new next on the next tick
      nextIdx = urls.indexOf(url);
      texNext = tex;
    }).catch(() => { pending = false; });
  }
  beginPreload();

  const vis = watchVisibility(container);
  let raf = null, disposed = false, paused = false, prev = null;

  function step(dtMs) {
    phaseT += dtMs;

    if (phase === 'hold') {
      if (reduced || urls.length < 2) return;              // a still photograph, forever
      if (phaseT < holdMs) return;
      /* THE PRELOAD RULE: only leave the hold if the next photo is actually on the GPU. If it isn't, we
         keep holding — a beat too long on a good photo is invisible; a melt into black is not. */
      if (!texNext) { beginPreload(); return; }
      keep = new Set([urls[cur], urls[nextIdx]]);          // pin both ends of the melt against eviction
      material.uniforms.uAfter.value = texNext;
      material.uniforms.uAfterRes.value.set(texNext.image.width, texNext.image.height);
      phase = 'melt';
      phaseT = 0;
      return;
    }

    /* melt */
    const t = Math.min(1, phaseT / meltMs);
    material.uniforms.uProgress.value = smoothstep(t);
    if (t < 1) return;

    /* Landed. The "next" is now the "current": no copy, just a re-pointing of the uniforms. */
    cur = nextIdx;
    texCur = texNext;
    texNext = null;
    nextIdx = -1;
    material.uniforms.uBefore.value = texCur;
    material.uniforms.uBeforeRes.value.set(texCur.image.width, texCur.image.height);
    material.uniforms.uProgress.value = 0;
    keep = new Set([urls[cur]]);
    evict();
    phase = 'hold';
    phaseT = 0;
    beginPreload();                                        // start fetching the one after this
  }

  function update(nowMs) {
    const dt = prev === null ? 0 : nowMs - prev;
    prev = nowMs;
    material.uniforms.uTime.value = nowMs * 0.001;
    /* Cover-fit box guard (Lesson Z2b). A degenerate box — a 0-width cold init (an embedded pane mid-
       layout, where clientWidth AND innerWidth momentarily read 0), or a container that GREW via layout
       without firing a window 'resize' — must never reach uQuadRes, or coverUv's x-scale collapses to 0
       and every photo renders as a sticky horizontal-streak smear. So: if the box is degenerate AND the
       container now actually HAS a real size to adopt, re-sync via core.resize() (which now updates the
       shared drawBuffer); then never write a <1 dimension. The `container.client*` gate is load-bearing:
       resize() allocates a Vector2, so calling it unconditionally every frame while a box stays 0-width
       (e.g. a collapsed container on a browser with no IntersectionObserver, where the render loop never
       pauses) would be a per-frame hot alloc — the gate makes the re-sync fire once, at the heal frame. */
    if ((drawBuffer.x < 1 || drawBuffer.y < 1) && container.clientWidth >= 1 && container.clientHeight >= 1) core.resize();
    if (drawBuffer.x >= 1 && drawBuffer.y >= 1) material.uniforms.uQuadRes.value.set(drawBuffer.x, drawBuffer.y);
    if (!paused) step(dt);
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);      // straight to the canvas — no post chain, true colour
  }

  function tick(now) {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    if (!vis.visible) { prev = null; return; }   // off-screen → don't render, and don't bank the time
    core.frameStart();
    update(now);
    core.frameEnd();
  }
  raf = requestAnimationFrame(tick);

  const onResize = () => core.resize();
  window.addEventListener('resize', onResize, { passive: true });

  /* Rough VRAM of the resident set, in bytes: w·h·4 per decoded photo. Rough is the honest word —
     drivers pad and align — but it is the right ORDER, which is what a cap decision needs. */
  function vram() {
    let bytes = 0;
    for (const tex of cache.values()) {
      const im = tex.image;
      if (im && im.width) bytes += im.width * im.height * 4;
    }
    return bytes;
  }

  function dispose() {
    disposed = true;
    if (raf !== null) cancelAnimationFrame(raf);
    vis.dispose();
    window.removeEventListener('resize', onResize);
    for (const tex of cache.values()) tex.dispose();
    cache.clear();
    material.dispose();
    quadGeo.dispose();
    scene.remove(quad);
    core.dispose?.();
  }

  return {
    update, dispose,
    pause()  { paused = true; },
    resume() { paused = false; },
    get index() { return cur; },
    get count() { return urls.length; },
    get progress() { return material.uniforms.uProgress.value; },
    get transition() { return meltAmp === 0 ? 'crossfade' : 'melt'; },
    isReducedMotion: () => reduced,
    residentCount: () => cache.size,
    vram,
    canvas: renderer.domElement,
    fallback: false,
  };
}
