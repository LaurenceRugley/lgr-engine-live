/* ============================================================
   bortle.js — @lgr/engine-core (ARC A20 lift, from lgr-live-sky). The Bortle Dark-Sky Scale →
   naked-eye limiting magnitude — the ONE model that governs star/planet/Messier visibility, via the
   shared aMag/uLimitMag/uFadeBand mechanism in shaders/realstars.vert (see createTrueStars.js,
   createSolarSystem.js, createMessier.js — all three feed it the SAME limitingMagnitude()).

   2026-08-02 lift-back (docs/engine-inventory-2026-08-02.md List C #2): skyBrightnessSQM() and
   skyGlowIntensity() below were added in lgr-live-sky on 2026-08-01 and never lifted here — an
   invisible fork the engine-inventory audit found. Lifted now as pure ADDITIONS; no existing export
   changed.
   ------------------------------------------------------------
   Table per the sourcing doc (~/lgr-business/research/sky-data-sources-2026-07-31.md §4, itself
   quoting Wikipedia's Bortle scale article "as stated, not re-derived"). Each class there is a
   NELM (naked-eye limiting magnitude) RANGE; TABLE below uses each range's midpoint as a single
   representative value.

   CONTINUOUS, not stepped: the slider interpolates smoothly between class midpoints (limitingMagnitude
   is piecewise-linear) so dragging toward a dark site makes the sky visibly fill in — stars fade in
   BY MAGNITUDE as the limit rises, never a jump cut. This is the whole point of treating Bortle as
   a real number 1..9 rather than nine discrete buttons.

   Per the doc's own recommendation: a user-selected slider, not a light-pollution raster — "zero
   licence risk, near-zero payload, and... more honest than a static map, real sky brightness varies
   night to night in ways no fixed dataset captures."
   ============================================================ */

// [bortleClass, NELM midpoint] — from the doc's table (classes 1-9, with the extra 4.5 half-step
// the Bortle scale itself defines between 4 and 5).
const TABLE = [
  [1, 7.8], [2, 7.3], [3, 6.8], [4, 6.4], [4.5, 6.2], [5, 5.8], [6, 5.3], [7, 4.8], [8, 4.3], [9, 3.8],
];

export const BORTLE_MIN = 1, BORTLE_MAX = 9;
// LA's real class (documented approximation): the app's default "Los Angeles" preset (34.05,-118.24)
// sits in the dense urban core, which widely-published light-pollution classifications place at
// Bortle 8-9. Not a per-site measurement — real sky brightness varies night to night — but honest
// as a default: the app boots showing what the sky over LA actually looks like, not a flattering one.
export const LA_BORTLE = 9;

/* Bortle class (1..9, continuous) -> naked-eye limiting magnitude (piecewise-linear interpolation
   across TABLE's class midpoints). */
export function limitingMagnitude(bortle) {
  const b = Math.max(BORTLE_MIN, Math.min(BORTLE_MAX, bortle));
  for (let i = 0; i < TABLE.length - 1; i++) {
    const [b0, m0] = TABLE[i], [b1, m1] = TABLE[i + 1];
    if (b <= b1) { const t = (b - b0) / (b1 - b0); return m0 + (m1 - m0) * t; }
  }
  return TABLE[TABLE.length - 1][1];
}

const MAG_BEST = TABLE[0][1], MAG_WORST = TABLE[TABLE.length - 1][1];
/* 0..1 "how good is the sky" — same normalization the Milky Way pass's reveal uses, so the point
   stars fading in and the Milky Way band brightening are driven by the SAME underlying number
   (the limiting magnitude), not two independently-tuned curves that could drift apart. */
export function skyGlow(bortle) {
  const m = limitingMagnitude(bortle);
  return Math.max(0, Math.min(1, (m - MAG_WORST) / (MAG_BEST - MAG_WORST)));
}

/* ============================================================
   SKY-DOME GLOW — a DIFFERENT quantity from skyGlow() above. Lift-back 2026-08-02 (engine-inventory
   audit, docs/engine-inventory-2026-08-02.md List C #2): born in lgr-live-sky 2026-08-01 (found while
   shooting REEL #1: a Bortle 9 city sky was rendering DARK-with-fewer-dots instead of BRIGHT-with-
   drowned-stars, which is backwards from reality), stranded there ever since. skyGlow()/
   limitingMagnitude() answer "how many stars are visible" (NELM — a star-count threshold). This
   answers "how bright is the sky itself" (SQM — an actual background-luminance measurement,
   mag/arcsec², a smaller number = a BRIGHTER sky). Real light pollution does BOTH at once — raises
   the background AND drowns faint stars — so this composes with, not replaces, the existing density
   gate. NO EXISTING EXPORT is touched by this addition — purely new functions, so every current
   consumer of limitingMagnitude()/skyGlow() is byte-identical before and after.

   [bortleClass, SQM midpoint mag/arcsec²] — same sourcing doc (§4), the table's SQM column, this
   time. Classes 1-7 are the doc's own CLOSED ranges' midpoints — directly sourced, same discipline
   as TABLE above. Classes 8 and 9 are NOT closed ranges in Wikipedia's own table (checked directly,
   not assumed — 2026-08-01: class 8 is "<18.0" with no lower bound; class 9 has no SQM entry at
   all) — so these two are EXTRAPOLATED, flagged as such rather than presented as sourced:
     · class 8 continues class 7's own range WIDTH (0.5 mag/arcsec²) below the 18.0 boundary
       Wikipedia does give → representative 17.75.
     · class 9's floor uses the SQM instrument SCALE's own commonly-cited practical bound (16 =
       "the brightest sky you can possibly have," independent of any Bortle-specific number) as an
       anchor, giving a representative midpoint of (17.5 + 16) / 2 = 16.75.
   If a better-sourced number for classes 8/9 turns up, replace these two rows only — 1-7 don't need
   to move. */
const SQM_TABLE = [
  [1, 21.88], [2, 21.675], [3, 21.45], [4, 21.05], [4.5, 20.55], [5, 19.775], [6, 18.875],
  [7, 18.25], [8, 17.75], [9, 16.75],
];

/* Bortle class -> sky background brightness (mag/arcsec², piecewise-linear across SQM_TABLE). Lower
   number = brighter sky (SQM is a magnitude scale — smaller/dimmer-sounding numbers mean MORE light,
   the same inverted-scale convention astronomy uses for star magnitudes). */
export function skyBrightnessSQM(bortle) {
  const b = Math.max(BORTLE_MIN, Math.min(BORTLE_MAX, bortle));
  for (let i = 0; i < SQM_TABLE.length - 1; i++) {
    const [b0, m0] = SQM_TABLE[i], [b1, m1] = SQM_TABLE[i + 1];
    if (b <= b1) { const t = (b - b0) / (b1 - b0); return m0 + (m1 - m0) * t; }
  }
  return SQM_TABLE[SQM_TABLE.length - 1][1];
}

const SQM_BEST = SQM_TABLE[0][1], SQM_WORST = SQM_TABLE[SQM_TABLE.length - 1][1];
/* 0..1 "how much does light pollution light up the sky itself" — 0 at Bortle 1 EXACTLY (by
   construction: SQM_BEST is SQM_TABLE's own first entry, so this evaluates to (SQM_BEST-SQM_BEST)/
   range = 0.0, not just "small" — the physical-sanity gate: a dark site must render with the glow
   term provably inert), rising toward 1 at Bortle 9. Feeds a Milky Way pass's uGlowIntensity — the
   shader applies the horizon-strongest falloff, the sodium-orange colour, and the night/day gate;
   this function only answers "how much," grounded in the real SQM numbers above. */
export function skyGlowIntensity(bortle) {
  const sqm = skyBrightnessSQM(bortle);
  return Math.max(0, Math.min(1, (SQM_BEST - sqm) / (SQM_BEST - SQM_WORST)));
}
