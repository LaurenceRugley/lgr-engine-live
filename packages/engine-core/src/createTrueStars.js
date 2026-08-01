/* ============================================================
   createTrueStars.js — @lgr/engine-core (ARC A20 lift, from lgr-live-sky/src/truestars.js). The
   "true sky": the real Yale BSC5 star catalog (9,096 stars, assets/astronomy/bsc5.bin — source +
   licence in bsc5.SOURCE.md), each placed by the SAME real-location math createCelestial.js already
   uses for the sun and moon (celestial.starAltAz: sidereal time → hour angle → alt/az, precessed
   from J2000, refracted near the horizon — see createCelestial.js's own comment for what's included
   and what is deliberately skipped). The engine's PROCEDURAL night sky (night-sky.js) is seeded
   noise — believable, but invented; this is its real counterpart, an alternative a project opts into.

   WHY RECOMPUTE EVERY FRAME (not "rotate a static dome" the way the procedural field's dome layer
   does): refraction depends on each star's LIVE altitude, which keeps changing as the sky turns —
   it doesn't commute with "bake a direction once, then just rotate it," because the lift itself is
   a nonlinear function of the CURRENT altitude. Recomputing 9,096 alt/az pairs (a few trig calls
   each) is trivial for a CPU — the honest, easy-to-follow approach beats a clever shortcut here.
   The GROUP still rides the camera every frame (position = camera position), exactly like the
   procedural dome, so there's zero translation parallax.

   MAGNITUDE → BRIGHTNESS/SIZE is an ARTISTIC mapping on top of the real physical flux relation
   (flux ∝ 10^(−0.4·mag)) — used as-is, the ~1500× brightness range from Sirius (mag −1.46) to the
   naked-eye limit (mag 6.5) would either blow out the brightest stars or vanish the faintest ones
   on screen. The constants below compress that range for beauty while preserving order (brighter
   real stars stay bigger/brighter); tuned by eye, not photometrically exact. Colour comes from each
   star's B-V index via a simple, standard-shape blue→red approximation (also artistic, not a
   spectrophotometric model).

   ⛔ NO-OP BY CONSTRUCTION: group.visible starts false and nothing is drawn until the catalog fetch
   resolves (`ready`) AND a consumer calls setVisible(true) — a project that doesn't wire this sees
   zero pixels change. BORTLE-GATED: `setBortle(b)` drives the SAME shader mechanism (aMag/uLimitMag/
   uFadeBand in shaders/realstars.vert) that createSolarSystem.js and createMessier.js also use — one
   physical quantity (limiting magnitude), three consumers.

   API: createTrueStars({ celestial }) → { group, ready, update(date,lat,lon,nightK,elapsed,reduced,
   camera), setVisible(v), setBortle(b), hrToIndex, position } — hrToIndex + position are exposed so
   a sibling renderer (createConstellations) can share the SAME live positions, no second alt/az pass.
   ============================================================ */
import * as THREE from 'three';
import bsc5Url from '../assets/astronomy/bsc5.bin?url';
import realstarsVert from './shaders/realstars.vert';
import realstarsFrag from './shaders/realstars.frag';
import { limitingMagnitude, LA_BORTLE } from './bortle.js';

const SHELL_R = 92;              // matches the procedural dome's R_DOME (night-sky.js) — same depth layer

// magnitude → brightness/size tuning (artistic; see file header). t=0 at the naked-eye limit (mag
// 6.5), t=1 at the brightest stars in the catalog (Sirius, mag -1.46).
const MAG_FAINT = 6.5, MAG_BRIGHT = -1.5;
const BRIGHT_FLOOR = 0.30, BRIGHT_GAMMA = 0.45;     // brightness = floor + (1-floor)*t^gamma
const SIZE_MIN = 1.4, SIZE_MAX = 6.4, SIZE_GAMMA = 0.5;
const BV_SENTINEL = -99.99;      // 324 catalog stars have no measured B-V (see bsc5.SOURCE.md) → neutral white

/* B-V colour index → an approximate RGB star colour (blue-white → yellow-white → orange → red).
   Standard shape for this kind of visualization; a handful of control points, linearly interpolated. */
const BV_STOPS = [
  [-0.4, [0.63, 0.69, 1.00]],   // hot blue-white (O/B)
  [0.0, [0.83, 0.87, 1.00]],   // white (A)
  [0.4, [1.00, 0.98, 0.90]],   // yellow-white (F/G, ~the Sun at 0.65)
  [1.0, [1.00, 0.83, 0.63]],   // orange (K)
  [2.0, [1.00, 0.65, 0.45]],   // red (M)
];
function colorFromBV(bv, out) {
  if (bv <= BV_STOPS[0][0]) { const c = BV_STOPS[0][1]; return out.set(c[0], c[1], c[2]); }
  for (let i = 0; i < BV_STOPS.length - 1; i++) {
    const [b0, c0] = BV_STOPS[i], [b1, c1] = BV_STOPS[i + 1];
    if (bv <= b1) {
      const t = (bv - b0) / (b1 - b0);
      return out.set(THREE.MathUtils.lerp(c0[0], c1[0], t), THREE.MathUtils.lerp(c0[1], c1[1], t), THREE.MathUtils.lerp(c0[2], c1[2], t));
    }
  }
  const c = BV_STOPS[BV_STOPS.length - 1][1];
  return out.set(c[0], c[1], c[2]);
}

/* Parse the packed binary (see bsc5.SOURCE.md for the exact byte layout — 14 bytes/star). */
function parseCatalog(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, false) !== 0x42534335) throw new Error('bsc5.bin: bad magic (expected "BSC5")');
  const count = dv.getUint32(4, true);
  const raRad = new Float32Array(count), decRad = new Float32Array(count);
  const vmag = new Float32Array(count), bv = new Float32Array(count);
  const hr = new Uint16Array(count);
  const D2R = Math.PI / 180;
  for (let i = 0; i < count; i++) {
    const o = 8 + i * 14;
    raRad[i] = dv.getFloat32(o, true) * D2R;
    decRad[i] = dv.getFloat32(o + 4, true) * D2R;
    vmag[i] = dv.getInt16(o + 8, true) / 100;
    bv[i] = dv.getInt16(o + 10, true) / 100;
    hr[i] = dv.getUint16(o + 12, true);
  }
  return { count, raRad, decRad, vmag, bv, hr };
}

/* createTrueStars({ celestial }) → { group, ready, update(date, latDeg, lonDeg, nightK, elapsed, reduced) } */
export function createTrueStars({ celestial }) {
  const group = new THREE.Group();
  group.raycast = () => {};
  group.visible = false;

  const geo = new THREE.BufferGeometry();
  const material = new THREE.ShaderMaterial({
    vertexShader: realstarsVert, fragmentShader: realstarsFrag,
    uniforms: {
      uTime: { value: 0 }, uTwinkle: { value: 1 }, uSizeScale: { value: 1 }, uNight: { value: 0 },
      uLimitMag: { value: limitingMagnitude(LA_BORTLE) }, uFadeBand: { value: 0.6 },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
  });
  let points = null;   // THREE.Points, built once the catalog has loaded
  let cat = null;       // { count, raRad, decRad, vmag, bv, hr }
  const hrToIndex = new Map();   // HR catalog number -> index into position[]/cat arrays (built once, on load)
  const _pos = new Float32Array(0);
  let position = _pos;
  const _dir = new THREE.Vector3(), _camPos = new THREE.Vector3();

  const ready = fetch(bsc5Url)
    .then((res) => res.arrayBuffer())
    .then((buf) => {
      cat = parseCatalog(buf);
      const n = cat.count;
      position = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) hrToIndex.set(cat.hr[i], i);
      const aSize = new Float32Array(n), aBright = new Float32Array(n), aPhase = new Float32Array(n);
      const aColor = new Float32Array(n * 3);
      const _c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const t = THREE.MathUtils.clamp((MAG_FAINT - cat.vmag[i]) / (MAG_FAINT - MAG_BRIGHT), 0, 1);
        aBright[i] = BRIGHT_FLOOR + (1 - BRIGHT_FLOOR) * Math.pow(t, BRIGHT_GAMMA);
        aSize[i] = SIZE_MIN + (SIZE_MAX - SIZE_MIN) * Math.pow(t, SIZE_GAMMA);
        aPhase[i] = (i * 2.399963) % (Math.PI * 2);              // deterministic, decorrelated twinkle phase (no PRNG needed)
        const bv = cat.bv[i] <= BV_SENTINEL ? 0 : cat.bv[i];
        colorFromBV(bv, _c);
        aColor[i * 3] = _c.r; aColor[i * 3 + 1] = _c.g; aColor[i * 3 + 2] = _c.b;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
      geo.setAttribute('aBright', new THREE.BufferAttribute(aBright, 1));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
      geo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
      geo.setAttribute('aMag', new THREE.BufferAttribute(cat.vmag, 1));   // Bortle fade reads real magnitude directly
      points = new THREE.Points(geo, material);
      points.raycast = () => {}; points.frustumCulled = false;
      group.add(points);
      return cat.count;
    });

  /* Recompute every star's real alt/az for `date` at (latDeg, lonDeg), and place the group at the
     camera (zero-parallax shell, same trick as the procedural dome). No-op until the catalog has
     loaded (`ready` resolves) or while hidden. */
  function update(date, latDeg, lonDeg, nightK, elapsed, reduced, camera) {
    material.uniforms.uTime.value = elapsed;
    material.uniforms.uTwinkle.value = reduced ? 0 : 1;
    material.uniforms.uNight.value = nightK;
    if (!cat || !points) return;
    for (let i = 0; i < cat.count; i++) {
      const { alt, az } = celestial.starAltAz(cat.raRad[i], cat.decRad[i], date, latDeg, lonDeg);
      celestial.dirFromAltAz(alt, az, _dir);
      const o = i * 3;
      position[o] = _dir.x * SHELL_R; position[o + 1] = _dir.y * SHELL_R; position[o + 2] = _dir.z * SHELL_R;
    }
    geo.attributes.position.needsUpdate = true;
    if (camera) { camera.getWorldPosition(_camPos); group.position.copy(_camPos); }
  }

  return {
    group, ready, update, setVisible: (v) => { group.visible = v; },
    // exposed so a sibling renderer (createConstellations) can share the SAME live positions —
    // one source of truth, no second alt/az computation for the same stars.
    hrToIndex, get position() { return position; },
    // Bortle 1-9 (continuous) -> naked-eye limiting magnitude, smoothly faded in the shader (see
    // shaders/realstars.vert). GPU-side so dragging the slider costs zero CPU work.
    setBortle: (bortle) => { material.uniforms.uLimitMag.value = limitingMagnitude(bortle); },
  };
}
