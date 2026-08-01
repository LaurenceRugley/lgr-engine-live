/* ============================================================
   @lgr/engine-core — createCelestial (SKY LIFT #2, manifest §8): the celestial-coordinate foundation.
   ------------------------------------------------------------
   Lifted FIRST-PARTY from lgr-live-sky/src/celestial.js (manifest §8 names it "lift this FIRST, the rest
   wire it"). ONE source of truth for "where are the sky's bodies, and how is the star sphere oriented" —
   so several features share the same math instead of each reinventing it:
     1. CAMERA LOCK-ON — point the camera at the sun/moon and keep it centred  (dirToLook).
     2. ROTATING STARS — the whole star sphere wheels about the celestial pole as the day advances, the
        way the real night sky turns around Polaris                            (starSpin → a quaternion).
     3. REAL-LOCATION MODE — feed a true latitude + date + longitude and the artistic scrub becomes a
        PHYSICALLY-CORRECT sky (sun/moon position + sidereal star spin)         (sunPosition / moonPosition).

   Real-location mode is a genuine CLIENT-SITE capability, not just a game one — "the sky over <this place>
   right now" is the kind of hero moment a studio site sells — so it is lifted as a core seam even though
   hoard2 does not (yet) use it. It is pure math: THREE only for the Vector3/Quaternion/Matrix4 value types.

   ARC A20 (real-astronomy lift, from lgr-live-sky) added a 4th consumer of this same foundation:
     4. REAL STARS — a catalog star's fixed J2000 (RA, Dec) → apparent {alt, az} for an observer + instant
        (starAltAz), sharing localSiderealTime with sunPosition/moonPosition, plus two corrections a
        date-of-observation ephemeris doesn't need but a catalog fixed at the J2000 epoch does: PRECESSION
        (precessFromJ2000 — Earth's rotation axis slowly cones, ~50.3″/yr, a few arcmin/decade, above naked-eye
        resolution over a catalog now ~26yr old) and REFRACTION (refractionRad — the atmosphere lifts starlight
        near the horizon, ~34′ at the horizon, Bennett 1982). DELIBERATELY SKIPPED (below the ~1′ naked-eye
        resolution this pipeline targets, a recorded decision not an omission): nutation (±9.2″), aberration
        (~20.5″), stellar parallax (sub-arcsecond). See createTrueStars.js/planets.js/createMessier.js — they
        all resolve through this SAME starAltAz, a catalog star and a planet and a Messier object being, for
        this pipeline's purposes, just three ways to hand it a (RA, Dec).

   THE MODEL (artistic mode). Our world is +Y up and −Z = North (engine heading convention). The NORTH
   CELESTIAL POLE sits due north at an altitude equal to the observer's latitude — so at latitude φ the pole
   direction is (0, sinφ, −cosφ). The celestial sphere makes one full turn about that axis per day; the
   turn is driven straight off the day-fraction t∈[0,1) so the stars stay locked to the sun's own clock.

   REAL-LOCATION mode uses a low-precision NOAA/Meeus solar+lunar algorithm (good to ~0.1° for the sun,
   a few arcmin for the moon — ample for a sky), verified against known ephemeris values in the sibling test.

   NO-OP BY CONSTRUCTION: this module computes positions/orientations only — it renders nothing and touches
   no render state, so merely importing/constructing it changes zero pixels. A consumer chooses to feed the
   sun direction / star rotation it returns into its own sky rig; until it does, everything is byte-identical.

   C++ anchor: a unit quaternion here is exactly a normalized rotation you'd hand to a matrix-free transform
   — 4 floats encoding "spin θ about axis n", composed by multiplication, no gimbal lock. `starRotMatrix`
   just bakes that quaternion into a mat4 the way you'd expand a rotor into a 3×3 before uploading it.
   ============================================================ */
import * as THREE from 'three';

export function createCelestial({ latitudeDeg = 40 } = {}) {
  let lat = THREE.MathUtils.degToRad(latitudeDeg);
  const _pole = new THREE.Vector3();
  const _spin = new THREE.Quaternion();
  const _mat = new THREE.Matrix4();

  /* North celestial pole (unit, world): due north (−Z), lifted to altitude = latitude. */
  function poleAxis() { return _pole.set(0, Math.sin(lat), -Math.cos(lat)).normalize(); }

  /* Orientation of the star sphere for day-fraction t (0..1): one sidereal turn per day about the pole.
     Sign chosen so the stars rise in the east and set in the west, matching the sun's travel. */
  function starSpin(t) { return _spin.setFromAxisAngle(poleAxis(), -t * Math.PI * 2.0); }

  /* Same rotation as a mat4 — the screen-space Milky-Way pass rotates its sample ray by this. */
  function starRotMatrix(t) { return _mat.makeRotationFromQuaternion(starSpin(t)); }

  /* A world-space unit direction → the camera's { yaw, pitch }. yaw=0 looks −Z (North); pitch=asin(y).
     Matches a forward of (cosP·sinY, sinP, −cosP·cosY), so a lock-on frames the body dead-centre. */
  function dirToLook(dir) {
    return {
      yaw: Math.atan2(dir.x, -dir.z),
      pitch: Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)),
    };
  }

  /* ---- REAL-LOCATION MODE ----------------------------------------------------------------------
     The physically-correct sun for a place + instant. Low-precision NOAA/Meeus algorithm (good to
     ~0.1°, ample for a sky): mean sun → ecliptic longitude → right ascension α + declination δ,
     Greenwich sidereal time → local hour angle H → altitude + azimuth. Then dirFromAltAz builds the
     scene-frame sun direction (+Y up, −Z North, +X East). The artistic scrub and this share
     starSpinFromAngle()/dirFromAltAz() — one code path, two clocks. */
  const D2R = Math.PI / 180;
  /* Julian Day from a JS Date (UTC ms) — shared by every real-location calc below. */
  function julianDate(date) { return date.getTime() / 86400000 + 2440587.5; }
  /* Greenwich Mean Sidereal Time + observer longitude = Local Sidereal Time (radians). Shared by the
     sun, moon, AND star/planet/Messier pipelines — one formula, one source of truth for "what time
     is it, sky-wise." */
  function localSiderealTime(date, lonDeg) {
    const n = julianDate(date) - 2451545.0;                          // days since the J2000 epoch
    const gmst = (280.46061837 + 360.98564736629 * n) * D2R;         // Greenwich mean sidereal time
    return gmst + lonDeg * D2R;
  }
  function sunPosition(date, latDeg, lonDeg) {
    const n = julianDate(date) - 2451545.0;                // days since the J2000 epoch
    const L = (280.460 + 0.9856474 * n) * D2R;             // mean longitude
    const g = (357.528 + 0.9856003 * n) * D2R;             // mean anomaly
    const lam = L + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;   // ecliptic longitude
    const eps = (23.439 - 0.0000004 * n) * D2R;            // obliquity of the ecliptic
    const alpha = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));  // right ascension
    const delta = Math.asin(Math.sin(eps) * Math.sin(lam));                  // declination
    const lst = localSiderealTime(date, lonDeg);           // Local Sidereal Time
    const H = lst - alpha;                                 // hour angle
    const phi = latDeg * D2R;
    const alt = Math.asin(Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(H));
    const az = Math.atan2(-Math.sin(H), Math.tan(delta) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));  // from North, +East
    return { alt, az, lst };
  }
  /* (altitude, azimuth-from-North-toward-East) → a unit direction in the scene frame (−Z = North). */
  function dirFromAltAz(alt, az, out = new THREE.Vector3()) {
    const ca = Math.cos(alt);
    return out.set(Math.sin(az) * ca, Math.sin(alt), -Math.cos(az) * ca);
  }
  /* Explicit star-sphere spin about the pole by a given angle (real mode feeds Local Sidereal Time). */
  function starSpinFromAngle(angleRad) { return _spin.setFromAxisAngle(poleAxis(), angleRad); }

  /* THE MOON — low-precision lunar ephemeris (Meeus, good to ~a few arcmin: ample here). Mean longitude +
     the biggest evection/anomaly term → ecliptic (λ,β) → equatorial (RA,Dec) → alt/az for the observer.
     Also the PHASE: the elongation from the sun's ecliptic longitude gives the illuminated fraction
     (0 = new … 1 = full) and whether it's waxing — why the moon trails the sun differently through the
     month and shows the correct crescent/gibbous. */
  function moonPosition(date, latDeg, lonDeg) {
    const d = julianDate(date) - 2451545.0;                            // days since J2000
    const Lm = (218.316 + 13.176396 * d) * D2R;                        // moon mean longitude
    const Mm = (134.963 + 13.064993 * d) * D2R;                        // moon mean anomaly
    const Fm = (93.272 + 13.229350 * d) * D2R;                         // argument of latitude
    const lamM = Lm + 6.289 * D2R * Math.sin(Mm);                      // ecliptic longitude
    const betM = 5.128 * D2R * Math.sin(Fm);                           // ecliptic latitude
    const eps = (23.439 - 0.0000004 * d) * D2R;
    const dec = Math.asin(Math.sin(betM) * Math.cos(eps) + Math.cos(betM) * Math.sin(eps) * Math.sin(lamM));
    const ra = Math.atan2(Math.sin(lamM) * Math.cos(eps) - Math.tan(betM) * Math.sin(eps), Math.cos(lamM));
    const H = localSiderealTime(date, lonDeg) - ra;                    // local hour angle
    const phi = latDeg * D2R;
    const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
    const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
    // phase from the moon–sun ecliptic-longitude elongation
    const lamS = (280.460 + 0.9856474 * d) * D2R + (1.915 * Math.sin((357.528 + 0.9856003 * d) * D2R)) * D2R;
    const elong = lamM - lamS;
    return { alt, az, illum: (1 - Math.cos(elong)) / 2, waxing: Math.sin(elong) > 0 };
  }

  /* ---- REAL STARS (Arc A20, lifted from lgr-live-sky's celestial.js) --------------------------
     Extends real-location mode from the sun/moon to a full star catalog (and, by the same path, to
     planets and Messier objects — see planets.js/createMessier.js): the SAME sidereal pipeline above
     (localSiderealTime → hour angle → alt/az spherical transform), plus two corrections the sun/moon
     ephemerides don't need (theirs already return a date-of-observation position) but a catalog
     fixed at the J2000 EPOCH does — see this module's header for what's included and deliberately
     skipped (nutation/aberration/parallax — all sub-arcminute). */
  const ARCSEC = D2R / 3600;
  const PRECESS_M = 3.07496 * 15 * ARCSEC;    // RA secular term (Meeus 21.2), time-sec/yr·15 → rad/yr
  const PRECESS_N = 20.0431 * ARCSEC;         // Dec term (and RA's latitude-dependent part), arcsec/yr → rad/yr

  /* A J2000 (RA, Dec) in radians → the same, precessed to `date`'s epoch. Low-precision annual-rate
     approximation (Meeus ch. 21) — good to a few arcminutes over a CENTURY, ample for a catalog only
     a few decades past J2000, not the full rigorous 3-angle (ζ, z, θ) rotation. */
  function precessFromJ2000(raRad, decRad, date) {
    const years = (julianDate(date) - 2451545.0) / 365.25;             // years since J2000 (Julian year is ample here)
    const dRA = (PRECESS_M + PRECESS_N * Math.sin(raRad) * Math.tan(decRad)) * years;
    const dDec = (PRECESS_N * Math.cos(raRad)) * years;
    return { ra: raRad + dRA, dec: decRad + dDec };
  }

  /* Bennett (1982): how many radians of upward lift a TRUE altitude (radians) gets from atmospheric
     refraction. ~0 at the zenith, ~34′ (≈0.0099 rad) at the horizon. The formula diverges below the
     horizon, so clamp there — moot anyway, since nothing below the horizon is drawn. */
  function refractionRad(trueAltRad) {
    const altDeg = trueAltRad / D2R;
    if (altDeg < -1) return 0;
    const liftArcmin = 1 / Math.tan((altDeg + 7.31 / (altDeg + 4.4)) * D2R);
    return (liftArcmin / 60) * D2R;
  }

  /* A catalog star (J2000 RA/Dec, radians) → apparent {alt, az} for an observer + instant: precess to
     the observation epoch, then the identical hour-angle/alt-az transform sunPosition uses, then lift
     by refraction. `altTrue` (pre-refraction) is also returned — tests + planets/Messier both use it
     (elongation checks, "above the horizon" gates). A planet or Messier object is, for this transform,
     just a (RA, Dec) with a different source — same call, same physics. */
  function starAltAz(raJ2000Rad, decJ2000Rad, date, latDeg, lonDeg) {
    const { ra, dec } = precessFromJ2000(raJ2000Rad, decJ2000Rad, date);
    const H = localSiderealTime(date, lonDeg) - ra;
    const phi = latDeg * D2R;
    const altTrue = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
    const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
    return { alt: altTrue + refractionRad(altTrue), az, altTrue };
  }

  return {
    poleAxis, starSpin, starRotMatrix, dirToLook,
    starAltAz, precessFromJ2000, refractionRad,
    sunPosition, moonPosition, dirFromAltAz, starSpinFromAngle,
    setLatitude: (dg) => { lat = THREE.MathUtils.degToRad(dg); },
    get latitudeDeg() { return THREE.MathUtils.radToDeg(lat); },
  };
}
