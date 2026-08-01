/* ============================================================
   planets.test.mjs — THE ACCEPTANCE GATE for planetary positions. Same bar as
   Polaris-altitude-equals-latitude: real facts, stated tolerances, not self-referential.

   GROUND TRUTH: live NASA JPL HORIZONS queries (the same organization's HIGH-precision system —
   integrated numerical ephemeris, not the low-precision Keplerian approximation this module uses),
   run 2026-07-31 for 2026-01-15 00:00 UT, geocentric, from Earth. Independent of this module's own
   math — Horizons doesn't use Standish's Table 1 at all. Exact commands (reproducible):
     curl "https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='499'&OBJ_DATA='NO'
       &MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&CENTER='500@399'&START_TIME='2026-01-15'
       &STOP_TIME='2026-01-16'&STEP_SIZE='1d'&QUANTITIES='1,10,20'"
     (COMMAND '499'=Mars, '299'=Venus, '599'=Jupiter; QUANTITIES 1=RA/Dec, 10=illuminated %, 20=range)

   Tolerance: 2 arcmin (120″) on RA/Dec — generous relative to this module's actual agreement
   (all three matched Horizons to within ~30″ when this was built) and relative to JPL's OWN stated
   nominal errors for the Standish/Williams approximation (10″–600″ depending on planet, Table 1's
   own accuracy table) — a real bar, not a rubber stamp.

   Second check: two GEOMETRIC IDENTITIES (Mercury/Venus can never appear far from the Sun — a
   fact directly derivable from their own orbital radii, the same "distance from a great circle"
   style of check the Big Dipper pointer-star test already used) — these don't depend on any
   external ephemeris, just internal consistency of the orbital mechanics.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { planetPosition } from './planets.js';
import { createCelestial } from './createCelestial.js';

const R2D = 180 / Math.PI;
const hms = (h, m, s) => 15 * (h + m / 60 + s / 3600);
const dms = (sign, d, m, s) => sign * (d + m / 60 + s / 3600);
const arcsecBetween = (ra1Deg, dec1Deg, ra2Deg, dec2Deg) => {
  const dRa = (ra1Deg - ra2Deg) * Math.cos(dec1Deg * Math.PI / 180);
  const dDec = dec1Deg - dec2Deg;
  return Math.hypot(dRa, dDec) * 3600;
};

// JPL Horizons ground truth, 2026-01-15 00:00 UT, geocentric (fetched 2026-07-31 — see file header).
const HORIZONS = {
  mars: { raDeg: hms(19, 40, 31.45), decDeg: dms(-1, 22, 24, 44.3), illumPct: 99.99, distAU: 2.39805 },
  venus: { raDeg: hms(19, 54, 42.34), decDeg: dms(-1, 21, 49, 11.0), illumPct: 99.93, distAU: 1.71008 },
  jupiter: { raDeg: hms(7, 22, 55.63), decDeg: dms(1, 22, 20, 33.9), illumPct: 99.99, distAU: 4.23679 },
};
const WHEN = new Date('2026-01-15T00:00:00Z');
const TOLERANCE_ARCSEC = 120;   // 2 arcmin

for (const [key, truth] of Object.entries(HORIZONS)) {
  test(`${key.toUpperCase()} matches live JPL Horizons (2026-01-15) within ${TOLERANCE_ARCSEC}″`, () => {
    const p = planetPosition(key, WHEN);
    const raDeg = ((p.raJ2000Rad * R2D) + 360) % 360;
    const decDeg = p.decJ2000Rad * R2D;
    const sep = arcsecBetween(raDeg, decDeg, truth.raDeg, truth.decDeg);
    assert.ok(sep < TOLERANCE_ARCSEC, `${key} separation from Horizons: ${sep.toFixed(1)}″ (limit ${TOLERANCE_ARCSEC}″)`);

    const illumPct = p.illum * 100;
    assert.ok(Math.abs(illumPct - truth.illumPct) < 2, `${key} illuminated ${illumPct.toFixed(2)}% vs Horizons ${truth.illumPct}%`);

    const distErrPct = Math.abs(p.geoDistAU - truth.distAU) / truth.distAU * 100;
    assert.ok(distErrPct < 1, `${key} geocentric distance ${p.geoDistAU.toFixed(5)} AU vs Horizons ${truth.distAU} AU (${distErrPct.toFixed(3)}% off)`);
  });
}

test('MERCURY never strays far from the Sun — max elongation bound derived from its own orbit', () => {
  const cel = createCelestial({});
  const LA = { lat: 34.05, lon: -118.24 };
  // arcsin(a_mercury / a_earth) ≈ 22.8° for circular orbits; eccentricity pushes the real bound to
  // ~28°. Scan a year and confirm the Sun-Mercury elongation never exceeds a generous 30° allowance.
  let maxElong = 0;
  const base = Date.parse('2026-01-01T00:00:00Z');
  for (let d = 0; d < 365; d += 3) {
    const when = new Date(base + d * 86400000);
    const merc = planetPosition('mercury', when);
    const sun = cel.sunPosition(when, LA.lat, LA.lon);   // reuses the existing, already-tested sun ephemeris
    // Elongation = angular separation between Mercury and the Sun as seen from Earth. Both bodies'
    // alt/az->direction vectors live in the SAME observer-frame regardless of RA/Dec vs alt/az
    // origin, so comparing their scene-frame unit directions gives the true angular separation.
    const sunDir = cel.dirFromAltAz(sun.alt, sun.az);
    const mercAltAz = cel.starAltAz(merc.raJ2000Rad, merc.decJ2000Rad, when, LA.lat, LA.lon);
    const mercDir = cel.dirFromAltAz(mercAltAz.altTrue, mercAltAz.az);
    const elongDeg = Math.acos(Math.max(-1, Math.min(1, sunDir.dot(mercDir)))) * R2D;
    if (elongDeg > maxElong) maxElong = elongDeg;
  }
  assert.ok(maxElong < 30, `Mercury's max elongation over a year (${maxElong.toFixed(1)}°) stays under 30° (real bound ~28°)`);
  assert.ok(maxElong > 15, `Mercury's max elongation (${maxElong.toFixed(1)}°) is not suspiciously small (real bound ~18-28°)`);
});

test('VENUS never strays far from the Sun either, and reaches a wider bound than Mercury', () => {
  const cel = createCelestial({});
  const LA = { lat: 34.05, lon: -118.24 };
  let maxElong = 0;
  const base = Date.parse('2026-01-01T00:00:00Z');
  for (let d = 0; d < 365; d += 3) {
    const when = new Date(base + d * 86400000);
    const ven = planetPosition('venus', when);
    const sun = cel.sunPosition(when, LA.lat, LA.lon);
    const sunDir = cel.dirFromAltAz(sun.alt, sun.az);
    const venAltAz = cel.starAltAz(ven.raJ2000Rad, ven.decJ2000Rad, when, LA.lat, LA.lon);
    const venDir = cel.dirFromAltAz(venAltAz.altTrue, venAltAz.az);
    const elongDeg = Math.acos(Math.max(-1, Math.min(1, sunDir.dot(venDir)))) * R2D;
    if (elongDeg > maxElong) maxElong = elongDeg;
  }
  assert.ok(maxElong < 50, `Venus's max elongation over a year (${maxElong.toFixed(1)}°) stays under 50° (real bound ~47°)`);
  assert.ok(maxElong > 35, `Venus's max elongation (${maxElong.toFixed(1)}°) is not suspiciously small (real bound ~45-47°)`);
});
