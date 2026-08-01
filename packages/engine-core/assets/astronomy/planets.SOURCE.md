# planets.js — source + licence

**Lifted from** `~/dev/lgr-live-sky/src/data/planets.SOURCE.md` (ARC A20, the real-astronomy lift).
Unmodified below except this provenance line. The data itself is inline in `src/planets.js`
(a small fixed table of orbital elements, not a separate binary/JSON asset) — this SOURCE.md is
carried alongside the other three catalogs' SOURCE.md files so the full licence surface reads as
one place.

**Method:** NASA JPL Solar System Dynamics group's "Approximate Positions of the Planets"
(Standish & Williams, 1992), Table 1 — Keplerian elements + rates, valid 1800–2050 AD.
https://ssd.jpl.nasa.gov/planets/approx_pos.html · fetched + transcribed 2026-07-31.

## Licence — verified live, NOT assumed (this is more nuanced than BSC5)

An earlier pass at the sourcing doc characterized this as "public domain under 17 U.S.C. §105."
**That characterization does not hold up under direct verification and is not what this repo
relies on.** The JPL page itself states: *"This content is from an article written by E.M.
Standish and J.G. Williams in 1992. It has been published here with permission from the author."*
That is JPL/Caltech hosting a named authors' article with permission — not a work prepared by a
federal employee as part of official duties (the actual 17 U.S.C. §105 test). JPL is operated by
Caltech (a private university) under contract to NASA; JPL's own site-wide policy is explicit that
Caltech does **not** claim blanket public domain (*"Caltech makes no representations or warranties
with respect to ownership of copyrights..."*). This was checked directly (the actual page + JPL's
policy text) before writing anything below — not inferred from the source page's framing.

**What this repo actually relies on instead: the six orbital elements + six rates per planet are
treated as scientific FACTS, not copyrighted expression.** Semi-major axis, eccentricity,
inclination, mean longitude, longitude of perihelion, and longitude of the ascending node are
measured/fitted physical parameters of solar-system geometry — under *Feist Publications v. Rural
Telephone Service*, 499 U.S. 340 (1991), facts are not independently copyrightable; only an
original *selection, coordination, or arrangement* of facts can be, and even then only thinly. This
is the exact same footing BSC5's own RA/Dec/magnitude values already rest on in this repo (also
measured facts, also freely reused), and it's how every planetarium program that uses this dataset
already treats it — this table is about as close to "universally treated as reusable scientific
constant" as exists in amateur astronomy software.

**What is NOT taken from the JPL page:** its prose, formatting, worked examples, or HTML
presentation — only the 48 numbers (6 elements × 2 [value, rate] × 8 planets) in Table 1, plus the
published fixed obliquity constant (ε = 23.43928°) used in its own stated conversion formula.

**Owner-approved resolution (2026-07-31):** given a choice between pausing for an unambiguous
source or proceeding on the facts-not-expression framing above (industry standard for this exact
data), the owner chose to proceed on the facts framing, explicitly.

## Absolute magnitude constants

`ABS_MAG` in `planets.js` uses commonly-tabulated (Harris 1961-derived) absolute-magnitude
constants — the same standard values reproduced across planetary-science references for decades.
Sanity-checked against Wikipedia's cited real apparent-magnitude *ranges* for Venus (−4.92 to
−2.98) and Jupiter (−2.94 to −1.66): this repo's simple `V = H + 5·log10(r·Δ)` model (no phase-angle
term — a deliberate scope decision, see `planets.js`'s header) reproduces both ranges to the right
order, confirming the constants are sound for a rendering-oriented brightness value. Not claimed as
a precision photometric source.

## Not used

- **VSOP87** — sub-arcsecond accuracy, but far more data/parsing than a visual app needs; the
  sourcing doc explicitly calls it over-engineering here.
- **Paul Schlyter's "How to compute planetary positions"** — a well-known, commonly-cited page, but
  it states no license at all; not used even though its method is standard textbook celestial
  mechanics (the sourcing doc flagged this explicitly).

## Verification

`src/planets.test.mjs` checks this module's output against live NASA JPL **Horizons** ephemeris
(the same organization's *high*-precision system, queried 2026-07-31 for 2026-01-15 00:00 UT) for
Mars, Venus, and Jupiter — independent ground truth, not self-referential. See that file for exact
values and tolerances (matched against JPL's own stated nominal-error table on the approx_pos
page).
