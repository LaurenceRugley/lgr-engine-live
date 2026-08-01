/* ============================================================
   createSolarSystem.js — @lgr/engine-core (ARC A20 lift, from lgr-live-sky/src/solarsystem.js).
   Renders the 7 planets (planets.js) as real, moving points.
   ------------------------------------------------------------
   Reuses shaders/realstars.vert/frag verbatim (same point-sprite recipe: colour, twinkle, Bortle
   fade) — a planet is rendered exactly like a star with a magnitude that happens to change every
   frame instead of coming from a static catalog. Only 7 vertices, so this is its own tiny
   THREE.Points object rather than sharing createTrueStars.js's 9,096-star buffer.

   PHASE HONESTY: real planets subtend far too few arcseconds on screen to show a visible crescent/
   gibbous shape at any sane camera FOV (Venus is at most ~1 arcminute — a point, not a disc, unlike
   the Moon which the engine already renders as a lit sphere because it genuinely subtends ~0.5°).
   So "show phase where it matters" here means the DATA is right and exposed (illuminated fraction,
   in the projected label), not a fake rendered crescent on a few-pixel sprite — showing a shape
   the eye couldn't actually resolve would be LESS honest, not more.

   Real-location only (planets need a real date to have a real position) — same convention as
   createTrueStars.js/createConstellations.js.

   ⛔ NO-OP BY CONSTRUCTION: group.visible starts false; nothing draws until a consumer calls
   setVisible(true) and update() with a real date. BORTLE-GATED via the same shared shader mechanism
   createTrueStars.js/createMessier.js use (limitingMagnitude → uLimitMag).
   ============================================================ */
import * as THREE from 'three';
import realstarsVert from './shaders/realstars.vert';
import realstarsFrag from './shaders/realstars.frag';
import { planetPosition, PLANET_KEYS } from './planets.js';
import { limitingMagnitude, LA_BORTLE } from './bortle.js';

const SHELL_R = 92;   // matches createTrueStars.js's star shell — planets sit in the same depth layer
const NAME = { mercury: 'Mercury', venus: 'Venus', mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune' };

// magnitude -> size/brightness: planets run far brighter than the star field (Venus ~-4.9 to
// Neptune ~+7.9), so this range is tuned separately from createTrueStars.js's star mapping.
const MAG_BRIGHT = -4.9, MAG_FAINT = 8.0;
const SIZE_MIN = 2.2, SIZE_MAX = 7.5, SIZE_GAMMA = 0.5;
const BRIGHT_FLOOR = 0.35, BRIGHT_GAMMA = 0.5;

export function createSolarSystem({ celestial }) {
  const n = PLANET_KEYS.length;
  const group = new THREE.Group();
  group.raycast = () => {};
  group.visible = false;

  const position = new Float32Array(n * 3);
  const aSize = new Float32Array(n), aBright = new Float32Array(n), aPhase = new Float32Array(n);
  const aColor = new Float32Array(n * 3), aMag = new Float32Array(n);
  PLANET_KEYS.forEach((_, i) => { aPhase[i] = i * 1.79; });   // deterministic, decorrelated twinkle phase

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
  geo.setAttribute('aBright', new THREE.BufferAttribute(aBright, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
  geo.setAttribute('aMag', new THREE.BufferAttribute(aMag, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: realstarsVert, fragmentShader: realstarsFrag,
    uniforms: {
      uTime: { value: 0 }, uTwinkle: { value: 0 }, uSizeScale: { value: 1 }, uNight: { value: 0 },
      uLimitMag: { value: limitingMagnitude(LA_BORTLE) }, uFadeBand: { value: 0.6 },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
  });
  const points = new THREE.Points(geo, material);
  points.raycast = () => {}; points.frustumCulled = false;
  group.add(points);

  const _dir = new THREE.Vector3(), _camPos = new THREE.Vector3(), _world = new THREE.Vector3(), _ndc = new THREE.Vector3();
  let info = PLANET_KEYS.map((key) => ({ key, name: NAME[key] }));

  function update(date, latDeg, lonDeg, nightK, elapsed, reduced, camera) {
    material.uniforms.uTime.value = elapsed;
    material.uniforms.uTwinkle.value = reduced ? 0 : 1;
    material.uniforms.uNight.value = nightK;
    PLANET_KEYS.forEach((key, i) => {
      const p = planetPosition(key, date);
      const altaz = celestial.starAltAz(p.raJ2000Rad, p.decJ2000Rad, date, latDeg, lonDeg);
      celestial.dirFromAltAz(altaz.alt, altaz.az, _dir);
      position[i * 3] = _dir.x * SHELL_R; position[i * 3 + 1] = _dir.y * SHELL_R; position[i * 3 + 2] = _dir.z * SHELL_R;

      const t = THREE.MathUtils.clamp((MAG_FAINT - p.magnitude) / (MAG_FAINT - MAG_BRIGHT), 0, 1);
      aBright[i] = BRIGHT_FLOOR + (1 - BRIGHT_FLOOR) * Math.pow(t, BRIGHT_GAMMA);
      aSize[i] = SIZE_MIN + (SIZE_MAX - SIZE_MIN) * Math.pow(t, SIZE_GAMMA);
      aColor[i * 3] = p.color[0]; aColor[i * 3 + 1] = p.color[1]; aColor[i * 3 + 2] = p.color[2];
      aMag[i] = p.magnitude;

      info[i] = { key, name: NAME[key], magnitude: p.magnitude, illum: p.illum, distAU: p.geoDistAU, altTrue: altaz.altTrue };
    });
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aBright.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aMag.needsUpdate = true;
    if (camera) { camera.getWorldPosition(_camPos); group.position.copy(_camPos); }
  }

  /* Projected name+info labels for a consumer's DOM overlay — same technique as
     createConstellations.js's labels. Only above the horizon (altTrue > 0) and in front of the camera. */
  function getLabels(camera) {
    if (!group.visible) return [];
    camera.getWorldPosition(_camPos);
    const labels = [];
    for (let i = 0; i < n; i++) {
      if (info[i].altTrue == null || info[i].altTrue < 0) continue;
      _dir.set(position[i * 3], position[i * 3 + 1], position[i * 3 + 2]).normalize();
      _world.copy(_dir).multiplyScalar(SHELL_R * 0.96).add(_camPos);
      _ndc.copy(_world).project(camera);
      if (_ndc.z > 1) continue;
      const { name, magnitude, illum, distAU } = info[i];
      labels.push({
        name, x: _ndc.x * 0.5 + 0.5, y: 1 - (_ndc.y * 0.5 + 0.5),
        detail: `mag ${magnitude.toFixed(1)} · ${Math.round(illum * 100)}% lit · ${distAU.toFixed(2)} AU`,
      });
    }
    return labels;
  }

  return {
    group, update, getLabels,
    setVisible: (v) => { group.visible = v; },
    setBortle: (bortle) => { material.uniforms.uLimitMag.value = limitingMagnitude(bortle); },
  };
}
