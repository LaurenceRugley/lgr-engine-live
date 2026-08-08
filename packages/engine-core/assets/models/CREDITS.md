# Model credits

All models here are **CC0 1.0 (public domain)** — free to use, no attribution required.
We credit anyway, because crediting good free work is how the commons stays fed.

## Source
- **Kenney — City Kit (Commercial), v2.1** — https://kenney.nl/assets/city-kit-commercial
- **License:** CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/)
- **Author:** Kenney (https://kenney.nl)
- Downloaded 2026-06-12 from the official kenney.nl zip; we kept only the three GLBs below
  (out of 41) and deleted the rest. Format: **GLB** (binary glTF 2.0).

## Files kept (Lesson 12 landmarks — picked for distinct silhouettes)
| File | Silhouette | ~Footprint (glTF metres, x·y·z) |
|---|---|---|
| `building-skyscraper-d.glb` | tall banded glass tower (the hero) | 1.28 · 5.47 · 1.39 |
| `building-g.glb` | stepped setback tower | 0.97 · 1.69 · 0.92 |
| `building-n.glb` | chunky mid-rise with rooftop HVAC box | 2.32 · 2.48 · 1.82 |

These feed `src/landmarks.js`, which normalizes each to our world units (`Box3`) and makes
them adopt our art direction (vector tiers / day-night / windows / palettes) — see Lesson 12.

## survivor.glb (A-PEDS, 2026-08-06 — the engine's generic human)
- **Author:** Quaternius (https://quaternius.com), via the poly.pizza mirror
- **License:** CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/)
- Same file, byte-identical, as `projects/hoard/public/models/survivor.glb` and
  `projects/hoard2/public/models/survivor.glb` (their LICENSES.md carry the original
  citation). Promoted into the LIBRARY home so `createPedestrians` — an engine ability —
  ships with its own asset instead of reaching into a project's public dir.
- Skinned, 8 clips incl. `Human Armature|Walk` (the one pedestrians use).
