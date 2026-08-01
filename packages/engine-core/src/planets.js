/* ============================================================
   planets.js — @lgr/engine-core (ARC A20 lift, from lgr-live-sky). Real planetary positions via
   Keplerian orbital elements.
   ------------------------------------------------------------
   Source + licence: assets/astronomy/planets.SOURCE.md (read that first — the licence story here is
   more nuanced than BSC5's clean public domain, and was verified live before use, not assumed).

   METHOD (NASA JPL SSD's own documented formulae, "Approximate Positions of the Planets," Standish
   & Williams 1992 — Table 1, valid 1800-2050 AD, ample for this app):
     1. Each planet's six orbital elements (semi-major axis, eccentricity, inclination, mean
        longitude, longitude of perihelion, longitude of ascending node) at a given date = the J2000
        value + its rate × centuries-since-J2000.
     2. Mean anomaly M = L − longPeri, wrapped to [−π, π].
     3. Solve Kepler's equation M = E − e·sin(E) for the eccentric anomaly E (Newton's method,
        JPL's own iteration, done in radians — mathematically identical to their degree-based
        version, just avoiding a deg/rad transcription step).
     4. Heliocentric position in the orbital plane, then rotated into the J2000 ecliptic frame via
        the argument of perihelion / inclination / ascending node, then into the J2000 EQUATORIAL
        frame via a fixed obliquity rotation (ε = 23.43928°, JPL's own stated constant).
     5. Geocentric = target planet's heliocentric vector − Earth's own (using the "EM Bary"
        element row as Earth's proxy — the Earth/EM-Bary offset is ~4,600 km, utterly negligible
        here). RA/Dec fall out of that geocentric vector directly.

   The result is hand off to celestial.js's EXISTING pipeline exactly like a catalog star's fixed
   RA/Dec — `celestial.starAltAz(raJ2000, decJ2000, date, lat, lon)` does the precession + sidereal
   time + alt/az + refraction, unchanged. The only new math here is the orbital mechanics that
   produces a moving RA/Dec in the first place; no second coordinate-transform pipeline.

   VSOP87 (sub-arcsecond accuracy) is explicitly NOT used — over-engineering for a visual app per
   the sourcing doc; JPL's own stated nominal errors here (10″–600″ depending on planet) are already
   below what a rendered point can show.

   MAGNITUDE is a deliberately SIMPLE model: V = absoluteMag + 5·log10(helioDist × geoDist), using
   commonly-tabulated (Harris 1961-derived) absolute-magnitude constants. Phase-angle brightness
   correction (a further refinement real photometric models include) is NOT modeled — another
   explicit scope decision, not an oversight, matching the same "don't chase precision the eye
   can't use" ethos as skipping nutation/aberration/parallax for stars. PHASE (illuminated fraction)
   itself, which is what actually matters visually for Mercury/Venus, IS modeled exactly (a pure
   geometric quantity, same Sun-Planet-Earth angle shape as the Moon's existing phase calc).
   ============================================================ */
import * as THREE from 'three';

const D2R = Math.PI / 180;

// JPL SSD Table 1 ("Keplerian elements and their rates... valid 1800 AD - 2050 AD"), fetched and
// transcribed verbatim from https://ssd.jpl.nasa.gov/planets/approx_pos.html on 2026-07-31 — see
// planets.SOURCE.md. [value_at_J2000, rate_per_century]. a: AU. e: unitless. I/L/peri/node: degrees.
const ELEMENTS = {
  mercury: { a: [0.38709927, 0.00000037], e: [0.20563593, 0.00001906], I: [7.00497902, -0.00594749], L: [252.25032350, 149472.67411175], peri: [77.45779628, 0.16047689], node: [48.33076593, -0.12534081] },
  venus: { a: [0.72333566, 0.00000390], e: [0.00677672, -0.00004107], I: [3.39467605, -0.00078890], L: [181.97909950, 58517.81538729], peri: [131.60246718, 0.00268329], node: [76.67984255, -0.27769418] },
  earth: { a: [1.00000261, 0.00000562], e: [0.01671123, -0.00004392], I: [-0.00001531, -0.01294668], L: [100.46457166, 35999.37244981], peri: [102.93768193, 0.32327364], node: [0.0, 0.0] },   // EM Bary row
  mars: { a: [1.52371034, 0.00001847], e: [0.09339410, 0.00007882], I: [1.84969142, -0.00813131], L: [-4.55343205, 19140.30268499], peri: [-23.94362959, 0.44441088], node: [49.55953891, -0.29257343] },
  jupiter: { a: [5.20288700, -0.00011607], e: [0.04838624, -0.00013253], I: [1.30439695, -0.00183714], L: [34.39644051, 3034.74612775], peri: [14.72847983, 0.21252668], node: [100.47390909, 0.20469106] },
  saturn: { a: [9.53667594, -0.00125060], e: [0.05386179, -0.00050991], I: [2.48599187, 0.00193609], L: [49.95424423, 1222.49362201], peri: [92.59887831, -0.41897216], node: [113.66242448, -0.28867794] },
  uranus: { a: [19.18916464, -0.00196176], e: [0.04725744, -0.00004397], I: [0.77263783, -0.00242939], L: [313.23810451, 428.48202785], peri: [170.95427630, 0.40805281], node: [74.01692503, 0.04240589] },
  neptune: { a: [30.06992276, 0.00026291], e: [0.00859048, 0.00005105], I: [1.77004347, 0.00035372], L: [-55.12002969, 218.45945325], peri: [44.96476227, -0.32241464], node: [131.78422574, -0.00508664] },
};

// Absolute (H) visual magnitudes: the star each planet would show at 1 AU from both the Sun and
// the observer, zero phase angle. Commonly-tabulated constants (Harris 1961-derived) — see the
// file header for what this magnitude model deliberately does and doesn't capture.
const ABS_MAG = { mercury: -0.42, venus: -4.40, mars: -1.52, jupiter: -9.40, saturn: -8.88, uranus: -7.19, neptune: -6.87 };

// A simple representative colour tint per planet (rendering only — not a photometric model).
const COLOR = {
  mercury: [0.78, 0.76, 0.72], venus: [0.96, 0.92, 0.80], mars: [0.90, 0.55, 0.40],
  jupiter: [0.88, 0.78, 0.62], saturn: [0.90, 0.82, 0.60], uranus: [0.65, 0.87, 0.90], neptune: [0.45, 0.55, 0.95],
};

export const PLANET_KEYS = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

const EPS_J2000 = 23.43928 * D2R;   // fixed J2000 mean obliquity, per JPL's own stated formula

function centuriesSinceJ2000(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  return (jd - 2451545.0) / 36525;
}

function wrapPi(rad) {
  let r = rad % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  if (r < -Math.PI) r += 2 * Math.PI;
  return r;
}

/* Solve Kepler's equation M = E - e·sin(E) for E (radians), Newton's method — JPL's own iteration
   scheme, tolerance 1e-9 rad (~2e-7 deg, well past their own stated 1e-6 deg target). */
function solveKepler(M, e) {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 12; i++) {
    const dM = M - (E - e * Math.sin(E));
    const dE = dM / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-9) break;
  }
  return E;
}

/* A planet's (or Earth's, via key 'earth') heliocentric J2000-ECLIPTIC position, in AU. */
function heliocentricEcliptic(key, date) {
  const el = ELEMENTS[key];
  const T = centuriesSinceJ2000(date);
  const a = el.a[0] + el.a[1] * T;
  const e = el.e[0] + el.e[1] * T;
  const I = (el.I[0] + el.I[1] * T) * D2R;
  const L = (el.L[0] + el.L[1] * T) * D2R;
  const longPeri = (el.peri[0] + el.peri[1] * T) * D2R;
  const longNode = (el.node[0] + el.node[1] * T) * D2R;
  const w = longPeri - longNode;             // argument of perihelion
  const M = wrapPi(L - longPeri);            // mean anomaly
  const E = solveKepler(M, e);

  const xOrb = a * (Math.cos(E) - e);
  const yOrb = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const cw = Math.cos(w), sw = Math.sin(w), co = Math.cos(longNode), so = Math.sin(longNode), ci = Math.cos(I), si = Math.sin(I);
  const x = (cw * co - sw * so * ci) * xOrb + (-sw * co - cw * so * ci) * yOrb;
  const y = (cw * so + sw * co * ci) * xOrb + (-sw * so + cw * co * ci) * yOrb;
  const z = (sw * si) * xOrb + (cw * si) * yOrb;
  return new THREE.Vector3(x, y, z);
}

function eclipticToEquatorialJ2000(v) {
  const y = v.y * Math.cos(EPS_J2000) - v.z * Math.sin(EPS_J2000);
  const z = v.y * Math.sin(EPS_J2000) + v.z * Math.cos(EPS_J2000);
  return new THREE.Vector3(v.x, y, z);
}

/* A planet's real position + phase + brightness for `date`, in the J2000 equatorial frame — hand
   raJ2000Rad/decJ2000Rad straight to celestial.starAltAz(ra, dec, date, lat, lon) exactly like a
   catalog star's fixed RA/Dec; its own precession+sidereal+alt/az+refraction pipeline is unchanged. */
export function planetPosition(key, date) {
  const helio = heliocentricEcliptic(key, date);
  const earthHelio = heliocentricEcliptic('earth', date);
  const geoEcliptic = helio.clone().sub(earthHelio);
  const geoEquatorial = eclipticToEquatorialJ2000(geoEcliptic);

  const geoDist = geoEquatorial.length();
  const raJ2000Rad = Math.atan2(geoEquatorial.y, geoEquatorial.x);
  const decJ2000Rad = Math.asin(geoEquatorial.z / geoDist);

  const helioDist = helio.length();
  // phase angle at the planet, between the directions to the Sun and to Earth
  const toSun = helio.clone().negate();
  const toEarth = geoEcliptic.clone().negate();
  const cosPhase = toSun.dot(toEarth) / (toSun.length() * toEarth.length());
  const illum = (1 + THREE.MathUtils.clamp(cosPhase, -1, 1)) / 2;

  const magnitude = ABS_MAG[key] + 5 * Math.log10(helioDist * geoDist);

  return { raJ2000Rad, decJ2000Rad, geoDistAU: geoDist, helioDistAU: helioDist, illum, magnitude, color: COLOR[key] };
}
