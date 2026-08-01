/* ============================================================
   bortle.js — @lgr/engine-core (ARC A20 lift, from lgr-live-sky). The Bortle Dark-Sky Scale →
   naked-eye limiting magnitude — the ONE model that governs star/planet/Messier visibility, via the
   shared aMag/uLimitMag/uFadeBand mechanism in shaders/realstars.vert (see createTrueStars.js,
   createSolarSystem.js, createMessier.js — all three feed it the SAME limitingMagnitude()).
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
