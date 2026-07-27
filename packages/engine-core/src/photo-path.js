/* ============================================================
   @lgr/engine-core — photo-path.js (Lesson Y)
   ------------------------------------------------------------
   The shared plumbing behind every component that puts a CLIENT'S PHOTOGRAPH on the GPU.

   Lesson X solved these four problems inside createBeforeAfter. Lesson Y needs the same four, and the
   choice was: copy them, or lift them. Copying is how the site templates ended up with thirteen drifting
   static servers and five of them silently broken — so they are lifted here, once, and both components
   import them. createBeforeAfter keeps its exact behaviour (its 17-check probe is the guard on that).

   1. LOAD A PHOTO CORRECTLY. The sRGB tag is the whole ballgame; see loadPhoto.
   2. FALL BACK. No WebGL on a paying client's site means the section still shows her work — a plain <img>,
      never a blank rectangle.
   3. RESPECT REDUCED MOTION. Auto-motion is unsolicited motion.
   4. STOP RENDERING OFF-SCREEN. A canvas painting behind the fold is pure battery drain.
   ============================================================ */
import * as THREE from 'three';

/* Is there a GPU to talk to at all? Asked BEFORE anything is built, so the failure path is the cheap one
   rather than a half-constructed engine. */
export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

export function prefersReducedMotion() {
  return (typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/* The never-blank floor: her photograph, as a plain image. */
export function mountImageFallback(container, url, alt) {
  const img = document.createElement('img');
  img.src = url;
  img.alt = alt || '';
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
  container.appendChild(img);
  container.setAttribute('data-photo-path', 'fallback-image');
  return img;
}

/* LOAD A PHOTO, TAGGED CORRECTLY.
   colorSpace = SRGBColorSpace is the line that matters: without it the GPU treats the file's bytes as if
   they were already linear light, and every mid-tone renders too bright — the classic washed-out WebGL
   photo. (Note the OTHER half of this, learned the hard way in L-X and living in image-transition.frag:
   tagging the texture only fixes the DECODE. A custom ShaderMaterial's output is never auto-encoded back
   to sRGB by three, so the shader must encode on the way out or the photo comes out too DARK instead.)
   No mipmaps: a photo shown at roughly 1:1 never minifies enough to need them, and generating them on a
   non-power-of-two image just costs memory we're about to be counting. */
export function loadPhoto(url, loader) {
  const l = loader || new THREE.TextureLoader();
  l.setCrossOrigin('anonymous');
  return new Promise((resolve, reject) => {
    l.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      resolve(tex);
    }, undefined, reject);
  });
}

/* Off-screen → stop rendering. Returns a live flag rather than a callback so the caller's RAF can simply
   ask "am I visible?" each frame. IntersectionObserver may be absent (old browsers, jsdom): then we say
   "always visible", because failing OPEN (render) is a battery cost, and failing CLOSED (never render)
   would be a blank section — the worse of the two. */
export function watchVisibility(el) {
  let visible = true;
  const io = (typeof IntersectionObserver !== 'undefined')
    ? new IntersectionObserver((entries) => { visible = entries.some((e) => e.isIntersecting); })
    : null;
  io?.observe(el);
  return {
    get visible() { return visible; },
    dispose() { io?.disconnect(); },
  };
}

/* The sRGB→linear encode is in the shader; this is its JS twin for anything that needs to reason about the
   same numbers (the probes do). Exported so a test can assert against ONE definition of the curve. */
export function linearToSRGB(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
