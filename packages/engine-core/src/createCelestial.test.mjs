/* ============================================================
   createCelestial.test.mjs — SKY LIFT #2 (Rule 9: intent). Pins the celestial-coordinate MATH the
   real-location client capability rests on. These are not "does it run" checks — each asserts a physical
   fact the code MUST reproduce, so if the Meeus/NOAA math is broken the sky would place the sun in the
   wrong spot and the test fails:
     • the celestial pole sits at altitude = latitude (why the stars wheel around the right point);
     • the sun climbs to the correct NOON ALTITUDE at the solstices/equinox (90−|lat−decl|) and is due
       south at noon for a northern observer — the load-bearing "is the sun in the right place" check;
     • the frame conventions (−Z North, +Y up, +X East) round-trip through dirFromAltAz/dirToLook;
     • the moon's illuminated fraction tracks the synodic phase.
   Pure math (THREE only for the value types) — no GPU, node-testable.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCelestial } from './createCelestial.js';

const R2D = 180 / Math.PI, D2R = Math.PI / 180;

// Max solar altitude (deg) over a full day at (lat,lon), sampled every 10 min — i.e. the noon altitude.
function maxNoonAlt(cel, isoDay, lat, lon) {
  let max = -90;
  const base = Date.parse(isoDay + 'T00:00:00Z');
  for (let m = 0; m < 1440; m += 10) {
    const { alt } = cel.sunPosition(new Date(base + m * 60000), lat, lon);
    max = Math.max(max, alt * R2D);
  }
  return max;
}
// Azimuth (deg from North, +East) at the instant of the day's peak altitude.
function noonAzimuth(cel, isoDay, lat, lon) {
  let best = { alt: -9, az: 0 };
  const base = Date.parse(isoDay + 'T00:00:00Z');
  for (let m = 0; m < 1440; m += 10) {
    const p = cel.sunPosition(new Date(base + m * 60000), lat, lon);
    if (p.alt > best.alt) best = p;
  }
  let az = best.az * R2D; if (az < 0) az += 360;
  return az;
}

test('the celestial pole sits due north at altitude = latitude', () => {
  const cel = createCelestial({ latitudeDeg: 40 });
  const p = cel.poleAxis();
  assert.ok(Math.abs(p.length() - 1) < 1e-6, 'unit length');
  assert.ok(Math.abs(p.y - Math.sin(40 / R2D)) < 1e-6, 'y = sin(latitude)');
  assert.ok(p.z < 0 && Math.abs(p.x) < 1e-6, 'points due north (−Z), no east/west lean');
});

test('frame conventions round-trip: −Z is North, +Y up, +X East', () => {
  const cel = createCelestial({});
  // dirToLook: looking due North (−Z) is yaw 0; straight up is pitch +90°.
  assert.ok(Math.abs(cel.dirToLook({ x: 0, y: 0, z: -1 }).yaw) < 1e-9, 'North → yaw 0');
  assert.ok(Math.abs(cel.dirToLook({ x: 0, y: 1, z: 0 }).pitch - Math.PI / 2) < 1e-9, 'up → pitch +90°');
  // dirFromAltAz: zenith → +Y; (alt 0, az 0) → North (−Z); (alt 0, az +90°=East) → +X.
  const zen = cel.dirFromAltAz(Math.PI / 2, 0);
  assert.ok(zen.y > 0.999, 'zenith → +Y');
  const north = cel.dirFromAltAz(0, 0);
  assert.ok(north.z < -0.999, 'north horizon → −Z');
  const east = cel.dirFromAltAz(0, Math.PI / 2);
  assert.ok(east.x > 0.999, 'east horizon → +X');
});

test('star sphere makes one sidereal turn per day about the pole', () => {
  const cel = createCelestial({ latitudeDeg: 0 });   // pole on the horizon (−Z) at the equator
  const q0 = cel.starSpin(0).clone();
  assert.ok(Math.abs(q0.w - 1) < 1e-9, 't=0 → identity (no spin)');
  // half a day = a half-turn (π) about the pole: the rotation angle from the quaternion is 2·acos(|w|).
  const qh = cel.starSpin(0.5);
  const ang = 2 * Math.acos(Math.min(1, Math.abs(qh.w)));
  assert.ok(Math.abs(ang - Math.PI) < 1e-6, 't=0.5 → half turn (π)');
});

test('EPHEMERIS — the sun reaches the correct noon altitude at the solstices & equinox (lat 40°N)', () => {
  const cel = createCelestial({});
  // Identity: noon altitude = 90 − |lat − declination|. decl ≈ +23.44 (Jun), −23.44 (Dec), 0 (equinox).
  const summer = maxNoonAlt(cel, '2024-06-20', 40, 0);   // ≈ 90 − (40 − 23.44) = 73.44°
  const winter = maxNoonAlt(cel, '2024-12-21', 40, 0);   // ≈ 90 − (40 + 23.44) = 26.56°
  const equinox = maxNoonAlt(cel, '2024-03-20', 40, 0);  // ≈ 90 − 40 = 50°
  assert.ok(Math.abs(summer - 73.44) < 1.5, `summer noon alt ${summer.toFixed(2)}° ≈ 73.44°`);
  assert.ok(Math.abs(winter - 26.56) < 1.5, `winter noon alt ${winter.toFixed(2)}° ≈ 26.56°`);
  assert.ok(Math.abs(equinox - 50.0) < 1.5, `equinox noon alt ${equinox.toFixed(2)}° ≈ 50°`);
  // and at noon a northern-hemisphere sun is due SOUTH (azimuth ≈ 180°).
  const az = noonAzimuth(cel, '2024-06-20', 40, 0);
  assert.ok(Math.abs(az - 180) < 3, `noon azimuth ${az.toFixed(1)}° ≈ due south (180°)`);
});

test("EPHEMERIS — the southern hemisphere flips: noon sun is due NORTH, and higher in the local summer", () => {
  const cel = createCelestial({});
  const decJan = maxNoonAlt(cel, '2024-12-21', -40, 0);   // S-hemisphere summer solstice → high
  const junJul = maxNoonAlt(cel, '2024-06-20', -40, 0);   // S-hemisphere winter → low
  assert.ok(decJan > junJul + 30, `S-summer (${decJan.toFixed(1)}°) is well above S-winter (${junJul.toFixed(1)}°)`);
  const az = noonAzimuth(cel, '2024-12-21', -40, 0);
  assert.ok(az < 3 || az > 357, `S-hemisphere noon azimuth ${az.toFixed(1)}° ≈ due north (0°)`);
});

test('the moon phase tracks the synodic month (illuminated fraction sweeps new→full)', () => {
  const cel = createCelestial({});
  let lo = 1, hi = 0;
  const base = Date.parse('2024-01-01T00:00:00Z');
  for (let d = 0; d < 30; d++) {
    const { illum } = cel.moonPosition(new Date(base + d * 86400000), 40, 0);
    assert.ok(illum >= 0 && illum <= 1, 'illuminated fraction stays in [0,1]');
    lo = Math.min(lo, illum); hi = Math.max(hi, illum);
  }
  assert.ok(lo < 0.1, `reaches near-new within a month (min illum ${lo.toFixed(2)})`);
  assert.ok(hi > 0.9, `reaches near-full within a month (max illum ${hi.toFixed(2)})`);
});

/* ============================================================
   ARC A20 — REAL STARS (lifted from lgr-live-sky's celestial.test.mjs). Same bar as the ephemeris
   tests above: physical facts, stated tolerances, not self-referential. Star RA/Dec below are copied
   straight from the ybsc5 catalog lines (HR numbers cited), the same ones manually verified against
   tdc-www.harvard.edu before the packer was trusted (see bsc5.SOURCE.md in assets/astronomy/).
   NOT tested (a recorded decision, see this module's header): nutation, aberration, parallax — all
   below the ~1′ naked-eye resolution this pipeline targets.
   ============================================================ */
const hms = (h, m, s) => 15 * (h + m / 60 + s / 3600);            // RA sexagesimal (hours) → degrees
const dms = (sign, d, m, s) => sign * (d + m / 60 + s / 3600);     // Dec sexagesimal → degrees

const POLARIS = { hr: 424, raDeg: hms(2, 31, 48.7), decDeg: dms(1, 89, 15, 51), vmag: 2.02 };      // Alp UMi
const BETELGEUSE = { hr: 2061, raDeg: hms(5, 55, 10.3), decDeg: dms(1, 7, 24, 25), vmag: 0.50 };   // Alp Ori
const ALNILAM = { hr: 1903, raDeg: hms(5, 36, 12.8), decDeg: dms(-1, 1, 12, 7) };                  // Eps Ori, Orion's belt
const DUBHE = { hr: 4301, raDeg: hms(11, 3, 43.7), decDeg: dms(1, 61, 45, 3) };                    // Alp UMa
const MERAK = { hr: 4295, raDeg: hms(11, 1, 50.5), decDeg: dms(1, 56, 22, 57) };                   // Bet UMa

const LA = { lat: 34.05, lon: -118.24 };   // matches the sky example's "Los Angeles" real-sky preset

test('DATA INTEGRITY — bsc5.bin decodes to 9,096 stars, Polaris + Betelgeuse round-trip', () => {
  const path = fileURLToPath(new URL('../assets/astronomy/bsc5.bin', import.meta.url));
  const buf = readFileSync(path);
  assert.equal(buf.toString('ascii', 0, 4), 'BSC5');
  const count = buf.readUInt32LE(4);
  assert.equal(count, 9096, '9,110 catalog lines minus the 14 blank-position (novae/extragalactic) entries');

  let foundPolaris = false, foundBetelgeuse = false;
  for (let i = 0; i < count; i++) {
    const o = 8 + i * 14;   // 14 bytes/star since the HR field was added (constellations arc)
    const raDeg = buf.readFloatLE(o), decDeg = buf.readFloatLE(o + 4), vmag = buf.readInt16LE(o + 8) / 100;
    const hr = buf.readUInt16LE(o + 12);
    if (Math.abs(raDeg - POLARIS.raDeg) < 0.01 && Math.abs(decDeg - POLARIS.decDeg) < 0.01) {
      assert.ok(Math.abs(vmag - POLARIS.vmag) < 0.01, 'Polaris Vmag matches the catalog');
      assert.equal(hr, POLARIS.hr, 'Polaris HR field matches');
      foundPolaris = true;
    }
    if (Math.abs(raDeg - BETELGEUSE.raDeg) < 0.01 && Math.abs(decDeg - BETELGEUSE.decDeg) < 0.01) {
      assert.ok(Math.abs(vmag - BETELGEUSE.vmag) < 0.01, 'Betelgeuse Vmag matches the catalog');
      assert.equal(hr, BETELGEUSE.hr, 'Betelgeuse HR field matches');
      foundBetelgeuse = true;
    }
  }
  assert.ok(foundPolaris, 'Polaris (HR424) present in the packed binary');
  assert.ok(foundBetelgeuse, 'Betelgeuse (HR2061) present in the packed binary');
});

test('POLARIS sits at altitude ≈ observer latitude (it is ~0.7-0.8° from the true pole, not exactly on it)', () => {
  const cel = createCelestial({});
  const cases = [
    { lat: 34.05, lon: -118.24, iso: '2026-07-31T09:00:00Z' },   // Los Angeles
    { lat: 51.50, lon: 0, iso: '2026-01-15T22:00:00Z' },          // London, different season+hour
    { lat: -10, lon: 30, iso: '2026-03-01T03:00:00Z' },           // southern hemisphere: below the horizon (Polaris invisible there — altitude still equals latitude, just negative)
  ];
  for (const c of cases) {
    const { alt } = cel.starAltAz(POLARIS.raDeg * D2R, POLARIS.decDeg * D2R, new Date(c.iso), c.lat, c.lon);
    const diff = Math.abs(alt * R2D - c.lat);
    assert.ok(diff < 1.0, `Polaris alt ${(alt * R2D).toFixed(2)}° within 1° of latitude ${c.lat}° (diff ${diff.toFixed(2)}°)`);
  }
});

test("ORION'S BELT (Alnilam) transits from Los Angeles at the textbook altitude, due south", () => {
  const cel = createCelestial({});
  let best = { alt: -Math.PI };
  const base = Date.parse('2026-01-15T00:00:00Z');
  for (let m = 0; m < 1440; m += 2) {
    const r = cel.starAltAz(ALNILAM.raDeg * D2R, ALNILAM.decDeg * D2R, new Date(base + m * 60000), LA.lat, LA.lon);
    if (r.altTrue > best.alt) best = { alt: r.altTrue, az: r.az };
  }
  const expectAlt = 90 - Math.abs(LA.lat - ALNILAM.decDeg);   // the same "90 − |lat − dec|" identity the sun test above uses
  assert.ok(Math.abs(best.alt * R2D - expectAlt) < 0.5,
    `Alnilam transit alt ${(best.alt * R2D).toFixed(2)}° ≈ ${expectAlt.toFixed(2)}° (90 − |lat − dec|)`);
  let az = best.az * R2D; if (az < 0) az += 360;
  assert.ok(Math.abs(az - 180) < 1.0, `transits due south (azimuth ${az.toFixed(2)}° ≈ 180°) — Alnilam's declination is south of LA's latitude`);
});

test("THE BIG DIPPER'S POINTER STARS (Merak → Dubhe) point close to Polaris, at an arbitrary hour", () => {
  const cel = createCelestial({});
  const when = new Date('2026-04-15T05:00:00Z');   // any hour works — this is a whole-sky-rigidity fact
  const dirOf = (s) => { const r = cel.starAltAz(s.raDeg * D2R, s.decDeg * D2R, when, 40, -100); return cel.dirFromAltAz(r.altTrue, r.az); };
  const dPolaris = dirOf(POLARIS), dDubhe = dirOf(DUBHE), dMerak = dirOf(MERAK);
  const normal = dMerak.clone().cross(dDubhe).normalize();
  const distFromLine = 90 - Math.acos(Math.min(1, Math.abs(normal.dot(dPolaris)))) * R2D;
  assert.ok(distFromLine < 5, `Polaris is ${distFromLine.toFixed(2)}° from the Merak-Dubhe great circle (published pointer alignment: a few degrees)`);
  const separation = dMerak.angleTo(dDubhe) * R2D;
  assert.ok(Math.abs(separation - 5.4) < 1.0, `Merak-Dubhe separation ${separation.toFixed(2)}° ≈ the commonly-cited 5.4°`);
});

test('REFRACTION at the true horizon lifts a star by ≈34′ (USNO / Bennett 1982)', () => {
  const cel = createCelestial({});
  const liftArcmin = cel.refractionRad(0) * R2D * 60;
  assert.ok(Math.abs(liftArcmin - 34) < 3, `horizon refraction ${liftArcmin.toFixed(1)}′ ≈ 34′ (USNO)`);
  const zenithLift = cel.refractionRad(Math.PI / 2) * R2D * 3600;
  assert.ok(zenithLift < 1, `refraction at the zenith is negligible (${zenithLift.toFixed(3)}″)`);
});

test('PRECESSION magnitude tracks the published rate (50.3″/yr ≈ 1° per 71.6 yr)', () => {
  const cel = createCelestial({});
  const ra0 = 10 * D2R, dec0 = 20 * D2R;
  const now = new Date('2026-07-31T00:00:00Z');
  const years = (now.getTime() / 86400000 + 2440587.5 - 2451545.0) / 365.25;
  const { ra, dec } = cel.precessFromJ2000(ra0, dec0, now);
  const shiftArcsec = Math.hypot(ra - ra0, dec - dec0) * R2D * 3600;
  const expectArcsec = years * (3600 / 71.6);   // "1° per 71.6yr" → 3600″/71.6yr ≈ 50.3″/yr, × years elapsed
  assert.ok(Math.abs(shiftArcsec - expectArcsec) / expectArcsec < 0.1,
    `precession shift ${shiftArcsec.toFixed(0)}″ over ${years.toFixed(1)}yr ≈ ${expectArcsec.toFixed(0)}″ (50.3″/yr)`);
});
