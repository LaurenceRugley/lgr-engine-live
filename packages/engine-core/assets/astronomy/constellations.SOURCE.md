# constellations.json — source + licence

**Lifted from** `~/dev/lgr-live-sky/src/data/constellations.SOURCE.md` (ARC A20, the real-astronomy
lift). Unmodified below except this provenance line and regeneration path.

Three independently-licensed pieces feed this file. Each is recorded separately because each has a
different licence story — do not assume one covers the others.

## 1. Line topology (which stars connect to which)

**Source:** Stellarium's western sky culture, `constellationship.fab`, pulled from
[github.com/Stellarium/stellarium](https://github.com/Stellarium/stellarium) at commit
`1884599337c376fb85691ce651048f1edebc9277` (2022-04-15, "Fixes various typos in sky cultures") —
the last commit before the 2022-11-09 rename/rewrite into the newer "modern" JSON-based sky-culture
format. Pinned to this specific historical commit deliberately: it keeps the pull inside the exact
scope ("the western sky culture's line definitions") that the licence grant below covers, and
matches the diligence the original requester in that thread used — pin the exact version, state it
in writing.

**Licence:** Stellarium itself is GPLv2+, and has no separate licence for its data files by
default — so this would normally be GPL, incompatible with this project. BUT: the western sky
culture's line-figure author explicitly granted an MIT relicense for exactly this kind of reuse, in
[github.com/Stellarium/stellarium/discussions/790](https://github.com/Stellarium/stellarium/discussions/790)
("Constellationship Licensing", 2019-2022, reaffirmed 2022-02-09 — contemporaneous with the pinned
commit above):
- `xalioth` (the author of the western constellation lines): *"I'm the author of the constellation
  lines for the western sky culture... if I give you my permission to re-licence it under MIT
  (which I happily do!)... Yes I do grant the permission!!"*
- `gzotti` (Stellarium maintainer), reaffirming in 2022: *"the definition of lines (stick figures)
  for the western skyculture can also be used under MIT license."*

**NOT covered by this grant, NOT used here:** the constellation ARTWORK
(`skycultures/western/*.png` in the same directory) is a completely separate licence — the Free Art
License, held by illustrator Johan Meuris (per `gzotti`'s own clarification in the same thread, and
[johanmeuris.eu/work/stellarium-constellation-art](https://johanmeuris.eu/work/stellarium-constellation-art)).
This project uses only the line-segment topology (star-ID pairs), never the artwork.

## 2. Star identity bridge (Hipparcos → Harvard Revised)

Stellarium's `constellationship.fab` identifies stars by **Hipparcos (HIP)** catalog number.
This project's star data (`bsc5.bin`) is indexed by the Yale BSC5 **Harvard Revised (HR)** number.
Neither catalog carries the other's numbering natively — checked first, before reaching for an
external source:
- BSC5's own byte-by-byte fields (`bsc5.SOURCE.md` / the CDS readme) are HR, DM, HD, SAO, FK5 — no
  HIP field.
- Stellarium's own shipped cross-reference (`stars/hip_gaia3/cross-id.cat`) is its modern Gaia
  DR3-cross-matched catalog for millions of stars — an opaque compiled binary of Stellarium's own
  making, not a simple public fact table, and far too large and license-ambiguous to vendor for
  this.

**Bridge used:** a **build-time-only SIMBAD TAP query** (`lgr-live-sky/tools/pack-constellations.mjs`,
`resolveHipToHr`), resolving each HIP number to its cross-linked HR identifier via SIMBAD's `ident`
table. This is the ONLY use of SIMBAD in the source project, and it is scoped deliberately narrowly,
per the owner's explicit ruling on this exact question:

- **Only the resulting HIP↔HR *correspondence* (an integer pair — a fact) is written to
  `constellations.json`.** No SIMBAD coordinate, magnitude, spectral type, or any other measured
  VALUE is persisted anywhere in this repository. The query response is consumed once by the
  packer and discarded.
- 674 of 692 stars resolved via SIMBAD's `ident` table directly. The remaining 18 — mostly bright
  MULTIPLE-star systems (Alnitak, Mizar, Castor, Acrux, etc.) where SIMBAD's `ident` table doesn't
  cross-link HR to the "combined" designation `constellationship.fab` uses — required one extra
  verification step: each was independently confirmed by POSITION (the SIMBAD coordinate for that
  HIP, used transiently at build time for this one cross-check, compared against the matching BSC5
  catalog star — all 18 matched to within 0.2″–3″, easily within confidence). See
  `MANUAL_OVERRIDES` in `lgr-live-sky/tools/pack-constellations.mjs` for the full list and each
  match's distance. Again: only the resulting HR integer is recorded; the coordinates used to
  verify it are not shipped.

**Cheaper alternative checked and ruled out first** (per the owner's steer, before reaching for
SIMBAD): neither BSC5 nor Stellarium's own shipped files carry a ready-made HIP↔HR table — see
above. If one had existed in data already vendored here, it would have been used instead.

**GOTCHA for whoever touches this next** (will recur if the star set expands — more sky cultures,
a deeper catalog): SIMBAD's `ident` table not cross-linking HR is not random noise — every star it
happens to is a bright MULTIPLE-star system, where BSC5's HR sometimes attaches to one component
rather than SIMBAD's "combined" designation. First symptom: a constellation comes back with a GAP
where a famous star belongs. The fix, documented in full with a reproduction recipe right above
`MANUAL_OVERRIDES` in `lgr-live-sky/tools/pack-constellations.mjs`: verify the missing star by
POSITION (SIMBAD coordinate, used transiently, matched against `bsc5.bin`'s own RA/Dec — a match
within a few arcseconds is conclusive), then hardcode the resulting HIP→HR integer with a one-line
citation.

**LICENCE STATUS: clean**, by two independent methods, confirmed at this lift (no re-litigation
needed) —
1. Line topology: explicit MIT relicense grant from the author, in writing (§1 above).
2. Star identity: SIMBAD used ONLY as a build-time identifier-resolution service (18 of those
   confirmed further by an independent position cross-check) — no SIMBAD-sourced value (coordinate,
   magnitude, or anything else) is persisted anywhere in this repository, only the derived HR
   integers. Verified by inspecting `constellations.json` itself: it contains `abbrev`/`name`/
   `segments` (HR-number pairs) and nothing else.

## 3. Constellation names

The standard IAU 88-constellation English names + 3-letter abbreviations
(`IAU_NAMES` in `lgr-live-sky/tools/pack-constellations.mjs`) — not fetched from any source. This is
the internationally standardized scientific nomenclature (the same list every star atlas and
planetarium uses); it is a naming standard, not an independently copyrightable creative work.

## Regenerating

The packer lives in the source repo: `~/dev/lgr-live-sky`, `node tools/pack-constellations.mjs`.
Refetches `constellationship.fab` fresh and re-resolves HIP→HR (SIMBAD + the manual overrides
above). Output: `constellations.json` — `[{ abbrev, name, segments: [[hr, hr], ...] }]`.
Segments are HR numbers, not array indices — resolved against `bsc5.bin`'s live star positions at
runtime, so this file has zero dependency on `bsc5.bin`'s internal ordering.
