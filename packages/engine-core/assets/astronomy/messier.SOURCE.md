# messier.json — source + licence

**Lifted from** `~/dev/lgr-live-sky/src/data/messier.SOURCE.md` (ARC A20, the real-astronomy lift).
Unmodified below except this provenance line.

**Catalog:** all 110 Messier objects (designation, common name, RA/Dec J2000, visual magnitude,
object type, apparent angular size).

## Source

[OpenNGC](https://github.com/mattiaverga/OpenNGC) (Mattia Verga) — "A license friendly NGC/IC
objects database." Pulled from `database_files/NGC.csv` + `database_files/addendum.csv`, pinned to
commit `da90466031b0372c896588b85be6016c617e205b` (2026-07-26), fetched 2026-07-31.

## Licence — verified live, not assumed (per the owner's explicit caution this round)

**CC BY-SA 4.0**, stated explicitly and unambiguously — the repo ships a `LICENSES/CC-BY-SA-4.0.txt`
file and its README states outright: *"Unlike other similar databases which are released with
license limitations, OpenNGC is released under CC-BY-SA-4.0 license, which allows the use for a
wider range of cases."* This is an explicit, deliberate licensing choice by the compiler — not an
assumption based on the underlying astronomical facts being old (the same standard already applied
to BSC5, the Stellarium constellation lines, and the JPL planetary elements).

**Why this is NOT the `hip_gaia3` mistake:** the caution this round was specifically "do NOT
re-import a Gaia-derived or ambiguous source." OpenNGC is neither:
- **Not Gaia-derived.** Its own README lists its actual sources: NASA/IPAC Extragalactic Database
  (NED), HyperLEDA, SIMBAD, HEASARC, and Harold Corwin's NGC/IC positions/notes — decades-old,
  purpose-built positional astronomy databases, not Gaia.
- **Not ambiguous.** A named maintainer, an explicit licence file, a DOI, and README language that
  directly addresses licensing as the project's stated purpose ("license friendly").

**⛔ SHARE-ALIKE OBLIGATION — READ BEFORE SHIPPING (this is what makes this data file different
from the other three catalogs here):** CC BY-SA requires (a) attribution AND (b) that this data
file, if redistributed, stays under the same licence. `messier.json` (the derived subset — just
designation/name/RA/Dec/mag/type/size for the 110 Messier objects, not OpenNGC's full ~14,000-object
database or its extra columns) is itself CC BY-SA 4.0 for that reason. **This applies to the DATA
FILE only, not the surrounding application code** (the same handling already established for HYG:
"share-alike is fine on a data file, just keep it out of proprietary code"). **Any consumer that
ships this file to end users (a deployed site, a built app) MUST display the attribution in the
distributed work — not just this repo** — see `src/astronomy-credits.js`'s `getAttribution()` /
`ASTRONOMY_CREDITS`, and the "attribution in the app, not just the repo" note this arc's manifest
records. A licence-clean repo is not the same claim as a licence-clean SHIPPED app.

**Attribution:** OpenNGC, © Mattia Verga, CC BY-SA 4.0, https://github.com/mattiaverga/OpenNGC.

## A data gotcha worth recording

Three Messier objects aren't NGC/IC objects at all, so they don't appear via the ordinary "M"
cross-reference column in `NGC.csv` — they live in `addendum.csv` instead: M40 (a double star,
Winnecke 4), M45 (the Pleiades, catalogued as `Mel022`), and M102 (a duplicate observation of M101 —
a genuine, long-standing astronomical controversy; OpenNGC's own note says *"Identification is
controversial, here we take NED assumption"*).

**A second, sharper gotcha inside that:** M102's own row uses OpenNGC's `M` column as a
CROSS-REFERENCE to flag "this duplicates M101" (`M=101`), not as its own designation. Read naively,
that makes M102 disappear from the catalog and produces a phantom second M101. The source-repo
packer (`lgr-live-sky/tools/pack-messier.mjs`) handles this by preferring the Messier number
embedded in the row's own `Name` field (`"M102"`, `"M040"` — the addendum's convention for objects
that aren't NGC/IC entries) over the cross-reference column, but only for rows where `Name`
actually matches that pattern — it falls back to the `M` column for every ordinary NGC-catalogued
object (e.g. M31 is stored as `NGC0224` with `M=031`).

## Not used

- Any Gaia-derived source, or Stellarium's own `stars/hip_gaia3` catalog — the exact ambiguity this
  arc was explicitly told to avoid repeating.
- Wikipedia's "List of Messier objects" — plausible and commonly cited, but not independently
  verified once OpenNGC's explicit, purpose-built licence was found.

## Regenerating

The packer lives in the source repo: `~/dev/lgr-live-sky`, `node tools/pack-messier.mjs`.
