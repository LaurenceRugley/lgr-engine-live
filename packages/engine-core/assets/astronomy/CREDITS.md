# Astronomy data credits

Four independently-licensed sources answer "what is in the sky above this place at this time" —
see each `*.SOURCE.md` in this folder for the full provenance/licence chain. Summary:

| Source | Data | Licence | Attribution required in a SHIPPED app? |
|---|---|---|---|
| Yale/Harvard Bright Star Catalogue (BSC5) | 9,096 real stars (`bsc5.bin`) | Public domain | No (courtesy only) |
| Stellarium western sky culture (`xalioth`, MIT-relicensed) | 88 constellation line figures (`constellations.json`) | MIT (by explicit permission) | Yes, per MIT |
| NASA JPL SSD (Standish & Williams 1992) | 7 planets' orbital elements (`src/planets.js`) | Scientific facts (Feist v. Rural) | No (not copyrightable expression) |
| OpenNGC (Mattia Verga) | 110 Messier objects (`messier.json`) | **CC BY-SA 4.0** | **YES — mandatory, share-alike** |

**The one that matters most: OpenNGC / Messier is CC BY-SA.** That licence requires attribution **in
the distributed work itself** (the deployed site/app an end user sees), not just in this repo's
SOURCE.md files, which a user never opens. `src/astronomy-credits.js` exports `ASTRONOMY_CREDITS`
(the four entries above, each with name/licence/url) and `getAttribution()` (a ready-to-render
formatted string/array) for exactly this reason — **any consumer that renders the Messier catalog
(directly, or via `createMessier`) MUST surface this in its UI.** A consumer must not be able to use
this correctly by accident and incorrectly by default — see that module's own header for the API.

Full chain per source: `bsc5.SOURCE.md` · `constellations.SOURCE.md` · `planets.SOURCE.md` ·
`messier.SOURCE.md` (all in this folder).
