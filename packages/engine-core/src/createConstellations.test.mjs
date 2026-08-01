/* ============================================================
   createConstellations.test.mjs — @lgr/engine-core (ARC A20 lift, from lgr-live-sky's
   constellations.test.mjs). THE ACCEPTANCE GATE for constellation lines. Two distinct claims, two
   distinct kinds of check:

     1. DATA — does constellations.json actually connect the RIGHT stars? (a topology check: the
        packed HR-number segments, independent of any projection.)
     2. SHAPE — after running those same stars through the full real-location pipeline (precession
        + sidereal time + alt/az + refraction — createCelestial.js, unchanged from the star arc) at a
        known time/place, does the PROJECTED figure still look like Orion's belt? Orion's belt is
        famous for being a short, nearly-perfectly-straight, evenly-spaced line of three stars —
        a genuine, checkable geometric fact, not a vibe.

   Pure math (THREE only for the value types) — no GPU, node-testable.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCelestial } from './createCelestial.js';

const R2D = 180 / Math.PI, D2R = Math.PI / 180;
const hms = (h, m, s) => 15 * (h + m / 60 + s / 3600);
const dms = (sign, d, m, s) => sign * (d + m / 60 + s / 3600);

// Orion's belt, J2000 (same catalog lines cited in createCelestial.test.mjs).
const MINTAKA = { hr: 1852, ra: hms(5, 32, 0.4) * D2R, dec: dms(-1, 0, 17, 57) * D2R };   // Del Ori
const ALNILAM = { hr: 1903, ra: hms(5, 36, 12.8) * D2R, dec: dms(-1, 1, 12, 7) * D2R };   // Eps Ori
const ALNITAK = { hr: 1948, ra: hms(5, 40, 45.5) * D2R, dec: dms(-1, 1, 56, 34) * D2R };  // Zet Ori
const LA = { lat: 34.05, lon: -118.24 };

function loadConstellations() {
  const path = fileURLToPath(new URL('../assets/astronomy/constellations.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('DATA — Orion (constellations.json) connects the correct HR numbers', () => {
  const data = loadConstellations();
  const ori = data.find((c) => c.abbrev === 'Ori');
  assert.ok(ori, 'Orion is present');
  assert.equal(ori.name, 'Orion');

  const has = (a, b) => ori.segments.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  assert.ok(has(MINTAKA.hr, ALNILAM.hr), 'belt: Mintaka-Alnilam connected');
  assert.ok(has(ALNILAM.hr, ALNITAK.hr), 'belt: Alnilam-Alnitak connected');
  assert.ok(!has(MINTAKA.hr, ALNITAK.hr), 'belt is a CHAIN through Alnilam, not a direct Mintaka-Alnitak shortcut');

  const members = new Set(ori.segments.flat());
  for (const [hr, name] of [[1713, 'Rigel'], [2061, 'Betelgeuse'], [1790, 'Bellatrix'], [2004, 'Saiph']]) {
    assert.ok(members.has(hr), `${name} (HR${hr}) is a member of Orion's figure`);
  }
  assert.ok(ori.segments.length >= 20, `Orion has a real multi-star figure, not just the belt (${ori.segments.length} segments)`);
});

test("SHAPE — Orion's belt projects as a short, straight, evenly-spaced line from Los Angeles", () => {
  const cel = createCelestial({});
  const when = new Date('2026-01-15T05:00:00Z');   // ~9pm local, mid-January — Orion is up and well-placed from LA
  const dirOf = (s) => { const r = cel.starAltAz(s.ra, s.dec, when, LA.lat, LA.lon); return cel.dirFromAltAz(r.altTrue, r.az); };
  const dMintaka = dirOf(MINTAKA), dAlnilam = dirOf(ALNILAM), dAlnitak = dirOf(ALNITAK);

  // STRAIGHT: Alnilam should sit almost exactly on the great circle through Mintaka and Alnitak
  // (the real belt's famous near-perfect alignment — not "some stars near each other").
  const normal = dMintaka.clone().cross(dAlnitak).normalize();
  const distFromLine = 90 - Math.acos(Math.min(1, Math.abs(normal.dot(dAlnilam)))) * R2D;
  assert.ok(distFromLine < 0.5, `Alnilam is ${distFromLine.toFixed(3)}° off the Mintaka-Alnitak line (real belt: ~0.09°, essentially straight)`);

  // EVENLY SPACED: the two half-spans should be close to equal (real belt: ~1.36° and ~1.39°).
  const spanA = dMintaka.angleTo(dAlnilam) * R2D, spanB = dAlnilam.angleTo(dAlnitak) * R2D;
  assert.ok(Math.abs(spanA - spanB) < 0.3, `belt half-spans ${spanA.toFixed(2)}°/${spanB.toFixed(2)}° are close to equal (real belt is evenly spaced)`);

  // COMPACT: total span should match the belt's known ~2.5-3° length — not a wildly wrong scale.
  const totalSpan = dMintaka.angleTo(dAlnitak) * R2D;
  assert.ok(totalSpan > 2.0 && totalSpan < 3.5, `total belt span ${totalSpan.toFixed(2)}° matches the real ~2.7°`);

  // BETWEEN: Alnilam sits BETWEEN the other two, not beyond either end (spanA+spanB ≈ totalSpan).
  assert.ok(Math.abs((spanA + spanB) - totalSpan) < 0.05, 'Alnilam sits between Mintaka and Alnitak, not off one end');
});
