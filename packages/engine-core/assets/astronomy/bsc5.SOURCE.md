# bsc5.bin — source + licence

**Lifted from** `~/dev/lgr-live-sky/src/data/bsc5.SOURCE.md` (ARC A20, the real-astronomy lift —
`docs/real-astronomy-lift-manifest.md` there). Unmodified below except this provenance line.

**Catalog:** Yale/Harvard Bright Star Catalogue, 5th Revised Edition (Hoffleit & Warren, 1991
preliminary version; CDS designation V/50). 9,110 objects (9,096 stars + 14 novae/extragalactic
entries retained only to preserve historical numbering), complete to visual magnitude 6.5 — the
naked-eye limit.

**Licence: Public domain.** The original 1908 Harvard compilation is >95 years old; the catalogue
has been maintained and redistributed without restriction by Yale, the CDS (Strasbourg), and NASA's
ADC/HEASARC ever since. Unambiguous for commercial use — see the decision doc this arc worked from:
`~/lgr-business/research/sky-data-sources-2026-07-31.md` §1, which surveyed and ruled OUT Gaia
(CC BY-NC — non-commercial only) and raw ESA Hipparcos/Tycho redistribution (ambiguous commercial
rights) before landing on BSC5 as "zero legal judgment call."

**Retrieved:** 2026-07-31, via `lgr-live-sky/tools/pack-bsc5.mjs`, from the canonical Harvard host:
- Catalog data: http://tdc-www.harvard.edu/catalogs/ybsc5.gz (gzipped ASCII, CDS V/50 format)
- Format description: http://tdc-www.harvard.edu/catalogs/ybsc5.readme
- Catalog homepage: http://tdc-www.harvard.edu/catalogs/bsc5.html

**Processing:** the packer parses the fixed-column ASCII (columns verified against known
stars — HR 424 = Polaris, HR 2061 = Betelgeuse — before trusting the byte offsets), drops the 14
blank-position entries, and packs the remaining 9,096 stars' J2000 RA/Dec + Vmag/B-V + HR (the
catalog's own star number, added when constellations landed) into a 14 bytes/star binary.

**The raw catalog itself is not vendored here** — only the ~127 KB packed result
(`assets/astronomy/bsc5.bin`) is committed. Regenerate via `~/dev/lgr-live-sky`'s
`node tools/pack-bsc5.mjs` (the source repo owns the packer; this repo only carries the output).

**Not used, and why (per the decision doc):**
- Gaia DR3 — CC BY-NC 3.0 IGO, explicitly non-commercial.
- Hipparcos/Tycho-2 direct redistribution — ESA/CDS commercial-reuse rights unclear.
- HYG v4.2 (CC BY-SA) — fine for a future deep-zoom mode with credit, not needed at naked-eye depth.
