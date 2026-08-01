/* ============================================================
   astronomy-credits.js — @lgr/engine-core (ARC A20). The licence surface for the real-astronomy
   ability (createTrueStars/createConstellations/createSolarSystem/createMessier + createCelestial's
   starAltAz/precession/refraction), exposed as DATA + a formatter, not left to live only in
   assets/astronomy/*.SOURCE.md files a consumer would never read.
   ------------------------------------------------------------
   WHY THIS FILE EXISTS: one of the four sources — OpenNGC (the Messier catalog) — is CC BY-SA 4.0,
   which requires attribution IN THE DISTRIBUTED WORK an end user sees, not just in this repo. This
   ability will propagate into other projects, INCLUDING CLIENT-FACING ones, via the normal
   engine-first lift path — so "read the SOURCE.md" cannot be the only way a consumer finds out it
   owes a credit. A consumer must not be able to use this correctly by accident and incorrectly by
   default: any project that renders the Messier catalog (directly, or via createMessier) MUST
   surface this. See assets/astronomy/CREDITS.md for the full per-source chain and reasoning.

   USE: render getAttribution() (or map over ASTRONOMY_CREDITS) into a footer/credits panel/about
   dialog — one click's reach is enough (see assets/astronomy/CREDITS.md's own "©" button precedent).
   ============================================================ */

export const ASTRONOMY_CREDITS = [
  {
    key: 'bsc5', name: 'Yale/Harvard Bright Star Catalogue (BSC5)', author: 'Hoffleit & Warren / Yale · CDS · NASA ADC-HEASARC',
    used: '9,096 real stars (RA/Dec/magnitude/B-V)', license: 'Public domain', required: false,
    url: 'http://tdc-www.harvard.edu/catalogs/bsc5.html',
  },
  {
    key: 'constellations', name: "Stellarium's western sky culture (constellation lines)", author: 'xalioth (line topology), by explicit MIT relicense grant',
    used: '88 constellation stick-figure line segments', license: 'MIT (by permission)', required: true,
    url: 'https://github.com/Stellarium/stellarium/discussions/790',
  },
  {
    key: 'planets', name: 'NASA JPL SSD — Approximate Positions of the Planets', author: 'E.M. Standish & J.G. Williams (1992)',
    used: "7 planets' Keplerian orbital elements", license: 'Scientific facts (not independently copyrightable — Feist v. Rural, 499 U.S. 340)', required: false,
    url: 'https://ssd.jpl.nasa.gov/planets/approx_pos.html',
  },
  {
    key: 'messier', name: 'OpenNGC', author: 'Mattia Verga',
    used: 'All 110 Messier deep-sky objects (designation/name/position/magnitude/type/size)', license: 'CC BY-SA 4.0', required: true,
    url: 'https://github.com/mattiaverga/OpenNGC',
  },
];

/* A ready-to-render attribution block. `format: 'lines'` (default) → an array of plain strings, one
   per source, for a footer/list; `format: 'text'` → one joined string; `format: 'html'` → an array of
   `{ text, url }` objects for a consumer to render as links. Always includes ALL four sources (not
   just the ones with `required: true`) — crediting the non-mandatory sources too is the honest,
   commons-feeding norm this data already follows (see assets/models/CREDITS.md's own precedent). */
export function getAttribution(format = 'lines') {
  const line = (c) => `${c.name} — ${c.author} — ${c.license}`;
  if (format === 'text') return ASTRONOMY_CREDITS.map(line).join(' · ');
  if (format === 'html') return ASTRONOMY_CREDITS.map((c) => ({ text: line(c), url: c.url }));
  return ASTRONOMY_CREDITS.map(line);
}
