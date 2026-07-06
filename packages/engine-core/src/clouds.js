/* ============================================================
   clouds.js — Lesson 21: charming drifting clouds + mist (atmosphere).
   ------------------------------------------------------------
   Soft clouds that DRIFT across the sky, "appear" as they enter and dissolve as they leave, with
   VARIED transparency (some thick + bright, some wispy + barely-there). It's the same atmosphere
   muscle as L18 weather / L20 fog, just the SKY half — and it's weather-driven:
     • clear  → a FEW puffy bright clouds, high + sparse
     • rain   → MORE, heavier + darker + lower, dense cover (sells the storm)
     • fog    → low, ULTRA-transparent MIST hugging the city (layered under the L20 fog)

   HOW (the cheap, robust way): each cloud is a THREE.Sprite — a quad that AUTO-FACES whatever
   camera renders it. That single property is why clouds work in the city view AND through the
   office RTT window with zero extra code: a sprite billboards toward the office camera just as
   happily as the city camera. (C++ analogy: a billboard is a quad whose model matrix is rebuilt
   each frame from the view's right/up vectors so it always faces the eye — Three does that for us.)

   THE CHARM: all sprites share ONE soft puff texture whose alpha is ORDERED-DITHERED (a Bayer
   threshold), so the edges band/stipple like the L20 fog instead of being a smooth airbrush — the
   32/64-bit character. That texture is a single swappable sprite (setTexture), so the planned
   diffusion-generated "cute pixel cloud" art can drop in later without touching this system.

   Transparency + draw order: sprites are alpha-blended with depthWrite off; Three sorts transparent
   objects back-to-front by distance automatically, so overlapping clouds composite correctly without
   us hand-sorting. (C++ analogy: sort the translucent draws by depth, or use premultiplied alpha.)
   ============================================================ */
import * as THREE from 'three';

/* ---- the shared CLOUD SPRITE TEXTURE: a few soft white blobs, then the alpha is ordered-dithered
        into bands so the edge stipples (charm), matching the L20 fog dither. One texture, swappable. */
function makeCloudTexture() {
  const S = 128;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  // build a puffy alpha shape from a handful of overlapping soft radial blobs
  const blob = (cx, cy, r) => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
  };
  blob(S * 0.42, S * 0.56, S * 0.26); blob(S * 0.60, S * 0.50, S * 0.30);
  blob(S * 0.50, S * 0.46, S * 0.22); blob(S * 0.34, S * 0.54, S * 0.18);
  blob(S * 0.70, S * 0.58, S * 0.18);
  // ORDERED-DITHER the alpha into ~5 bands (4x4 Bayer) → stippled soft edge, the charm look.
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const img = x.getImageData(0, 0, S, S); const d = img.data;
  const L = 5;
  for (let y = 0; y < S; y++) for (let px = 0; px < S; px++) {
    const i = (y * S + px) * 4;
    const a = d[i + 3] / 255;
    const t = (BAYER[(y % 4) * 4 + (px % 4)] + 0.5) / 16 - 0.5;   // centred ordered threshold
    d[i + 3] = Math.max(0, Math.min(1, Math.floor(a * L + 0.5 + t) / L)) * 255;
  }
  x.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCloudField({ extent = 8, count = 16 } = {}) {
  const group = new THREE.Group();
  group.raycast = () => {};

  let texture = makeCloudTexture();
  const SPAN = extent + 6;                 // half-width of the drift band (covers + overhangs the city)
  const rnd = (a, b) => a + Math.random() * (b - a);

  // per-cloud fixed traits (set once; the hot loop only moves + fades them — no alloc).
  const clouds = [];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0, fog: true });
    const sp = new THREE.Sprite(mat);
    const wisp = Math.random();            // 0 = thick/bright … 1 = wispy/ultra-transparent
    const c = {
      sp, mat, wisp,
      x: rnd(-SPAN, SPAN), z: rnd(-SPAN, SPAN),
      hiY: rnd(4.0, 6.8),                  // clear/rain band — low enough to sit in the dimetric frame
      loY: rnd(0.6, 2.2),                  // fog MIST band (low, hugging the city + water)
      w: rnd(3.0, 5.6), h: rnd(1.7, 3.0),  // sprite size (wispy ones spread wider below)
      speed: rnd(0.25, 0.7),
      op: rnd(0.6, 1.0),                   // this cloud's personal opacity ceiling
    };
    sp.raycast = () => {};
    clouds.push(c); group.add(sp);
  }

  const _tint = new THREE.Color();
  const WHITE = new THREE.Color('#ffffff');
  const DARK = new THREE.Color('#5b626e');   // rain greys the clouds toward this

  function update(dt, elapsed, sunRig, weatherRig) {
    const rain = weatherRig ? weatherRig.cloud : 0;   // heavy cover driver (rain/snow), 0 in clear/fog
    const fog  = weatherRig ? weatherRig.fog : 0;     // mist driver
    // how much of the pool is visible: a sparse baseline always, fuller in rain, broad low veil in fog.
    const visibleFrac = Math.min(1, 0.4 + 0.6 * rain + 0.5 * fog);
    // SunRig sky tint (bright white-ish by day, warm at golden hour, blue/violet at night). We start
    // from the sky colour and lift it toward white so midday clouds read bright, then rain greys it.
    _tint.copy(sunRig.sky).lerp(WHITE, 0.62);
    _tint.lerp(DARK, 0.6 * rain);                     // storm clouds darken

    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      const active = i / clouds.length < visibleFrac;
      // DRIFT + wrap (wind blows +x); recycle off the right edge back to the left with a fresh z.
      c.x += c.speed * dt * (0.6 + 0.8 * rain);        // wind picks up in the storm
      if (c.x > SPAN) { c.x = -SPAN; c.z = rnd(-SPAN, SPAN); }
      // ENTER/EXIT fade — soft at both edges of the band so clouds "appear" and dissolve, not pop.
      const edge = Math.min(smooth(c.x, -SPAN, -SPAN + 3), 1 - smooth(c.x, SPAN - 3, SPAN));
      // altitude: high by default, sinks to the MIST band as fog rises.
      const y = c.hiY * (1 - fog) + c.loY * fog;
      // per-weather opacity: fog = ultra-transparent mist; rain = heavier; clear = medium. The
      // cloud's personal ceiling (op) + wisp factor give the VARIED transparency Laurence asked for.
      const wispFade = 1 - 0.5 * c.wisp;               // wispy clouds are fainter (but not invisible)
      const weatherOp = 0.72 * Math.max(0, 1 - fog - rain) + 1.0 * rain + 0.42 * fog;
      const targetOp = active ? Math.max(0, weatherOp) * c.op * wispFade * edge : 0;
      c.mat.opacity += (targetOp - c.mat.opacity) * Math.min(1, dt * 2.5);   // ease so changes glide
      c.mat.color.copy(_tint);
      // mist clouds spread wider + flatter; a slow vertical bob adds life.
      const wScale = c.w * (1 + 0.6 * fog) * (1 + 0.4 * c.wisp);
      const hScale = c.h * (1 - 0.35 * fog);
      c.sp.scale.set(wScale, hScale, 1);
      c.sp.position.set(c.x, y + Math.sin(elapsed * 0.3 + i) * 0.15, c.z);
    }
  }

  function setTexture(tex) {                 // swap the art (e.g. a diffusion-generated pixel cloud) later
    texture = tex;
    for (const c of clouds) { c.mat.map = tex; c.mat.needsUpdate = true; }
  }

  /* L63 INSPECT — expose each cloud as a followable so the inspection lens can lock onto it and
     watch it drift. STABLE descriptors (built once, positions read live), `active` gates out the
     faded/recycled ones so we never follow an invisible puff. */
  const followables = clouds.map((c, i) => ({
    kind: 'cloud', label: `cloud ${i + 1}`,
    getWorldPos: (o) => o.copy(c.sp.position),
    active: () => c.mat.opacity > 0.06,
    info: () => `cloud · ${c.wisp > 0.6 ? 'wispy' : 'puffy'} · drifting east${c.sp.position.y < 3 ? ' (low mist)' : ''}`,
  }));
  function getFollowables() { return followables; }

  return { group, update, setTexture, getFollowables, get count() { return clouds.length; } };
}

function smooth(v, a, b) { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); }
