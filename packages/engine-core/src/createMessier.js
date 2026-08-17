/* ============================================================
   createMessier.js — @lgr/engine-core (ARC A20 lift, from lgr-live-sky/src/messier.js). The 110
   Messier deep-sky objects (assets/astronomy/messier.json — source + licence in messier.SOURCE.md),
   rendered HONESTLY: most are invisible to the naked eye and only emerge as the Bortle model
   improves — that IS the teaching moment (these are literally what telescopes get pointed at on a
   Thursday night), so Bortle governs them exactly like it governs the star field (same shader, same
   aMag/uLimitMag/uFadeBand mechanism, reused verbatim — see createTrueStars.js/createSolarSystem.js).

   SUBTLE + SELECTABLE (not "all 110 labels always on," which would clutter every mode): points
   render at real positions always (tiny, Bortle-gated brightness like a faint star), but only the
   SELECTED object gets a label — picked by designation ("M31"), which also aims the camera at it
   (reusing the same dirToLook()/setLook() a consumer would use to find the Moon or a planet by eye).
   Real-location only, like the constellations/planets — a catalog position needs a real place+date
   to mean anything.

   ⛔ NO-OP BY CONSTRUCTION: group.visible starts false; nothing draws until a consumer calls
   setVisible(true) and update() with a real date.

   ⚠️ LICENCE — READ messier.SOURCE.md AND assets/astronomy/CREDITS.md BEFORE SHIPPING: this data
   file is CC BY-SA 4.0 (OpenNGC). Any consumer that ships this catalog to end users MUST display the
   attribution in the distributed work (not just this repo) — see astronomy-credits.js's
   getAttribution()/ASTRONOMY_CREDITS. A consumer must not be able to use this correctly by accident
   and incorrectly by default.
   ============================================================ */
import * as THREE from 'three';
import realstarsVert from './shaders/realstars.vert';
import realstarsFrag from './shaders/realstars.frag';
import messierUrl from '../assets/astronomy/messier.json?url';
import { limitingMagnitude, LA_BORTLE } from './bortle.js';

const SHELL_R = 92;
const MAG_BRIGHT = 1.0, MAG_FAINT = 11.0;   // the Messier catalog's own real range (Pleiades 1.2 .. faintest ~11)
const SIZE_MIN = 1.3, SIZE_MAX = 5.2, SIZE_GAMMA = 0.5;
const BRIGHT_FLOOR = 0.22, BRIGHT_GAMMA = 0.5;
const NO_MAG_DEFAULT = 9.5;   // M102 has no measured magnitude (its identity itself is disputed) — a conservatively faint default, not a claimed measurement

// A simple type-family colour tint (rendering only, like B-V for stars) — not photometric.
const TYPE_COLOR = {
  Galaxy: [0.72, 0.82, 1.0], 'Galaxy Pair': [0.72, 0.82, 1.0], 'Galaxy Triplet': [0.72, 0.82, 1.0], 'Galaxy Group': [0.72, 0.82, 1.0],
  'Galaxy (ID disputed — see notes)': [0.72, 0.82, 1.0],
  'Open Cluster': [1.0, 0.92, 0.72], 'Globular Cluster': [1.0, 0.88, 0.65], 'Star Association': [1.0, 0.92, 0.72],
  'Planetary Nebula': [1.0, 0.62, 0.72], 'HII Region': [1.0, 0.62, 0.72], 'Emission Nebula': [1.0, 0.62, 0.72],
  Nebula: [1.0, 0.62, 0.72], 'Reflection Nebula': [0.75, 0.85, 1.0], 'Supernova Remnant': [1.0, 0.62, 0.72],
  'Cluster + Nebula': [1.0, 0.8, 0.75], Star: [1, 1, 1], 'Double Star': [1, 1, 1],
};
const DEFAULT_COLOR = [0.85, 0.85, 0.85];

export function createMessier({ celestial }) {
  const group = new THREE.Group();
  group.raycast = () => {};
  group.visible = false;

  const geo = new THREE.BufferGeometry();
  const material = new THREE.ShaderMaterial({
    vertexShader: realstarsVert, fragmentShader: realstarsFrag,
    uniforms: {
      uTime: { value: 0 }, uTwinkle: { value: 0 }, uSizeScale: { value: 1 }, uNight: { value: 0 },
      uLimitMag: { value: limitingMagnitude(LA_BORTLE) }, uFadeBand: { value: 0.6 },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
  });
  let points = null, cat = null, position = null;
  let selectedIdx = -1;
  const _dir = new THREE.Vector3(), _camPos = new THREE.Vector3(), _world = new THREE.Vector3(), _ndc = new THREE.Vector3();

  const ready = fetch(messierUrl).then((r) => r.json()).then((json) => {
    cat = json;   // [{designation, m, name, raDeg, decDeg, vmag, type, majAxArcmin, minAxArcmin}]
    const n = cat.length;
    position = new Float32Array(n * 3);
    const aSize = new Float32Array(n), aBright = new Float32Array(n), aPhase = new Float32Array(n), aColor = new Float32Array(n * 3), aMag = new Float32Array(n);
    const _c = new THREE.Color();
    cat.forEach((obj, i) => {
      const mag = obj.vmag ?? NO_MAG_DEFAULT;
      const t = THREE.MathUtils.clamp((MAG_FAINT - mag) / (MAG_FAINT - MAG_BRIGHT), 0, 1);
      aBright[i] = BRIGHT_FLOOR + (1 - BRIGHT_FLOOR) * Math.pow(t, BRIGHT_GAMMA);
      aSize[i] = SIZE_MIN + (SIZE_MAX - SIZE_MIN) * Math.pow(t, SIZE_GAMMA);
      aPhase[i] = (i * 2.137) % (Math.PI * 2);
      const col = TYPE_COLOR[obj.type] || DEFAULT_COLOR;
      aColor[i * 3] = col[0]; aColor[i * 3 + 1] = col[1]; aColor[i * 3 + 2] = col[2];
      aMag[i] = mag;
    });
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
    geo.setAttribute('aBright', new THREE.BufferAttribute(aBright, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
    geo.setAttribute('aMag', new THREE.BufferAttribute(aMag, 1));
    points = new THREE.Points(geo, material);
    points.raycast = () => {}; points.frustumCulled = false;
    group.add(points);
    return cat.length;
  }).catch((e) => console.error('Messier catalog failed to load (deep-sky layer stays empty):', e));
  // ^ audit 2026-08-17 R1, the landmarks.js convention: named + loud. update() already gates on
  //   `!cat || !points`, so a failed load leaves this layer inert instead of an unhandled rejection.

  function update(date, latDeg, lonDeg, nightK, elapsed, reduced, camera) {
    material.uniforms.uTime.value = elapsed;
    material.uniforms.uTwinkle.value = reduced ? 0 : 1;
    material.uniforms.uNight.value = nightK;
    if (!cat || !points) return;
    for (let i = 0; i < cat.length; i++) {
      const obj = cat[i];
      const altaz = celestial.starAltAz(obj.raDeg * Math.PI / 180, obj.decDeg * Math.PI / 180, date, latDeg, lonDeg);
      celestial.dirFromAltAz(altaz.alt, altaz.az, _dir);
      position[i * 3] = _dir.x * SHELL_R; position[i * 3 + 1] = _dir.y * SHELL_R; position[i * 3 + 2] = _dir.z * SHELL_R;
    }
    geo.attributes.position.needsUpdate = true;
    if (camera) { camera.getWorldPosition(_camPos); group.position.copy(_camPos); }
  }

  /* Pick one object by designation ("M31") for the label + camera-aim, or null to deselect. */
  function setSelected(designation) {
    selectedIdx = cat ? cat.findIndex((o) => o.designation === designation) : -1;
  }

  /* The look direction {yaw, pitch} to aim the camera at the currently selected object (or null). */
  function getSelectedLookDir() {
    if (selectedIdx < 0 || !position) return null;
    _dir.set(position[selectedIdx * 3], position[selectedIdx * 3 + 1], position[selectedIdx * 3 + 2]).normalize();
    return celestial.dirToLook(_dir);
  }

  /* The selected object's projected screen label, or null if none selected / behind the camera. */
  function getSelectedLabel(camera) {
    if (selectedIdx < 0 || !group.visible || !position) return null;
    camera.getWorldPosition(_camPos);
    _dir.set(position[selectedIdx * 3], position[selectedIdx * 3 + 1], position[selectedIdx * 3 + 2]).normalize();
    _world.copy(_dir).multiplyScalar(SHELL_R * 0.96).add(_camPos);
    _ndc.copy(_world).project(camera);
    if (_ndc.z > 1) return null;
    const obj = cat[selectedIdx];
    const sizeStr = obj.majAxArcmin ? `${obj.majAxArcmin}${obj.minAxArcmin ? '×' + obj.minAxArcmin : ''}′` : '—';
    const magStr = obj.vmag != null ? `mag ${obj.vmag.toFixed(1)}` : 'mag ?';
    return {
      name: `${obj.designation}${obj.name ? ' — ' + obj.name : ''}`,
      x: _ndc.x * 0.5 + 0.5, y: 1 - (_ndc.y * 0.5 + 0.5),
      detail: `${obj.type} · ${magStr} · ${sizeStr}`,
    };
  }

  function getObjectList() {
    return cat ? cat.map((o) => ({ designation: o.designation, name: o.name, label: `${o.designation}${o.name ? ' — ' + o.name : ''}` })) : [];
  }

  /* A-REVENDOR (2026-08-06): upstreamed from lgr-live-sky's trajectory-arc feature — the catalog's
     fixed J2000 RA/Dec (radians) for an object, by designation, for a sibling renderer that samples
     a whole day, not just this frame's position. Null-safe before the catalog loads. */
  function getRaDecByDesignation(designation) {
    const obj = cat && cat.find((o) => o.designation === designation);
    return obj ? { raRad: obj.raDeg * Math.PI / 180, decRad: obj.decDeg * Math.PI / 180 } : null;
  }

  return {
    group, ready, update, setSelected, getSelectedLookDir, getSelectedLabel, getObjectList, getRaDecByDesignation,
    setVisible: (v) => { group.visible = v; },
    setBortle: (bortle) => { material.uniforms.uLimitMag.value = limitingMagnitude(bortle); },
  };
}
