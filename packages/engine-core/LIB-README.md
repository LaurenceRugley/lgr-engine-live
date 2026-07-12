# @lgr/engine-core — Library Distribution

`dist-lib/` is a pre-built ES module distribution that plain static pages import without a bundler, package.json, or node_modules.

Two entry points (J3):
- **`lgr-engine.es.js`** — full distribution (city content + all engine tools, shiki-excised)
- **`lgr-engine-core.es.js`** — slim core (THREE + renderer/rig/post/sun + general tools; no city GLBs)

## Quick start (no-build static page)

### Core only

```html
<script type="module">
  import { createEngineCore, THREE }
    from './path/to/dist-lib/lgr-engine-core.es.js';

  const core = await createEngineCore({ container: document.getElementById('mount') });
  // core.scene, core.renderer, core.rig, core.sunRig all ready

  const geo  = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ wireframe: true }));
  core.scene.add(mesh);
  core.renderer.setAnimationLoop(() => core.renderer.render(core.scene, core.rig.camera));
</script>
```

### With the city content pack

```html
<script type="module">
  import { createEngineCore, createCityWorld, THREE }
    from './path/to/dist-lib/lgr-engine.es.js';

  const core = await createEngineCore({ container: mount });
  const city = createCityWorld(core);

  // window.__landmarksReady is set when GLBs finish loading (data URIs — no external fetch).
</script>
```

### Hero scenes (the director + bespoke scene packs)

A drop-in **hero carousel** for a site's above-the-fold: a director owns the RAF loop and
crossfades between bespoke shader "scene packs", all rendered through the engine's filmic
beauty pipeline (HDR `beautyRT` → bloom → ACES + dither). Four packs ship in the lib:
**`createDuskSilk`** (flowing silk/wave), **`createConstellation`** (glowing node field +
flowing edges), **`createAurora`** (slow light ribbons), **`createProductMoment`** (a floating
brushed-metal object under studio IBL — zero GLB).

```html
<script type="module">
  import {
    createEngineCore, createHeroDirector,
    createDuskSilk, createConstellation, createAurora, createProductMoment,
  } from './path/to/dist-lib/lgr-engine-core.es.js';

  const core = await createEngineCore({ container: mount });
  core.setPostMode(2);   // beauty mode (filmic + ACES + bloom)

  const director = createHeroDirector(core, {
    scenes: [ createDuskSilk(core), createConstellation(core),
              createAurora(core),   createProductMoment(core) ],
    dwell: 18_000,        // ms a scene shows before auto-advancing
    transitionMs: 1_200,  // crossfade duration
  });
  // director.next() / .prev() / .goTo(i) drive it; director.dispose() tears it all down.
  // Honors prefers-reduced-motion (static first scene, no auto-advance) automatically.
</script>
```

**Scene-pack contract** (write your own): `{ scene, camera, update(dt, elapsed), dispose(), usesBloom? }`.
Render into the HDR `beautyRT` (never the 8-bit `sceneRT`); the director sets every filmic uniform each
frame. `dispose()` must free the pack's own geometries + materials + uniform textures + owned RTs.

**`createEdgeField`** — the flowing-edge glow-ribbon seam behind Constellation is **scene-agnostic**
(`{ positions, pairs, color, width?, speed?, dash? } → { mesh, update(elapsed), dispose() }`) and shared
with Mission Control's graph viz: node positions + index pairs in, feathered flowing-glow ribbons out (no
1px GL_LINES). Exported from both lib barrels.

**Ship one file:** the whole hero (director + all 4 scenes + edge-field) lives in the single slim-core
`lgr-engine-core.es.js` — no city content, no extra fetches. Drop the one file on a page and import.

### Re-skinning for a client brand (L-N — no core edits)

Every client-facing colour + the sun grade + the day/night environment sets are **injectable options**.
Every default is byte-identical to the LGR dusk-harbor look, so a default build is unchanged.

- **Per-scene palettes** — `createDuskSilk(core, { ink, gold, cream })`,
  `createConstellation(core, { gold, backdrop })`, `createAurora(core, { gold, cream, backdrop })`,
  `createProductMoment(core, { metal, backdrop })`. All colours are `THREE.Color` in **linear sRGB**.
- **Director sun grade** — `createHeroDirector(core, { …, sunT })` picks the grade point the whole ring is
  lit at (default `0.75` dusk; pass `0.5` for a bright product ring, `0.0` for night/noir). Each scene pack
  also declares `tone: 'dark' | 'bright'` in its contract, and the director exposes **`director.currentTone`**
  so a site can drive per-scene chrome off the scene, not a hard-coded index.
- **Custom SunRig keyframes** — `createEngineCore({ sunKeyframes })` forwards a client environment set to the
  rig (also injectable at the camera scale via `createEngineCore({ cameraRig: { distMin, distMax, … } })`).

A worked example lives at **`examples/hero-reskin/`** (a cool "Midnight Teal" brand — different palettes,
custom noir keyframes, same geometry, zero engine-core edits).

**SunRig keyframe schema** (`validateSunKeyframes` fails loud at construction on a malformed set):
an array of **EXACTLY 4** keyframes in **`night → dawn → noon → dusk`** order (the rig indexes `% 4`),
each an object with these fields:

| field | type | meaning |
|---|---|---|
| `name` | string | label ('night' … 'dusk') |
| `sun`, `hemiSky`, `hemiGround`, `horizon`, `sky`, `outline` | colour (hex string / number) | light + backdrop |
| `gradeTint`, `gradeLift` | colour | post-ACES grade tint / shadow lift |
| `intensity`, `exposure`, `window`, `toonGain` | number | key light, exposure, window-glow, toon gain |
| `turbidity`, `rayleigh`, `mie`, `mieG` | number | Preetham atmospheric sky params |
| `gradeSat`, `gradeContrast` | number | grade saturation + contrast |

Colours lerp between adjacent keyframes; scalars lerp too. A missing field or a non-finite number throws
a named error at `createSunRig`/`createEngineCore` construction — a client build crashes at boot, never
renders wrong.

## The ONE-THREE rule

`THREE` is bundled **inside** both lib files. Always import it from the lib:

```js
import { THREE } from './dist-lib/lgr-engine-core.es.js';  // ✓
```

Never import Three.js from a CDN or a second copy:

```js
import * as THREE from 'https://cdn.skypack.dev/three';  // ✗ — breaks by-ref uniforms
```

Two copies of Three.js means two incompatible class hierarchies — `instanceof` checks fail silently and by-reference uniform bindings (SunRig colour → shader) stop working.

An importmap is an advanced option only if you can guarantee exactly one `three` module in the full app.

## Sizes (K build — two-entry lib, measured)

| Variant | Raw | gz | Δ gz vs J3 |
|---|---|---|---|
| `lgr-engine-core.es.js` (slim core, no city) | 1,210 KB | ~300 KB | +~6.5 KB |
| `lgr-engine.es.js` (full, city + all tools)  | 2,243 KB | ~467 KB | +~6.5 KB |

The core variant (300 KB gz) is ~36% smaller than the full (467 KB gz). The difference is the city content pack: GLBs inlined as base64 (~900 KB raw) + city generation, agents, weather, and landmark modules.

The **hero system** (Lesson K: director + ring + 4 scene packs + `createEdgeField` + 8 shaders) added **~+6.5 KB gz** to each entry over the J3 baseline (slim ~294 → ~300 gz; full ~461 → ~467 gz). KB-scale, as expected for shader-driven scenes with no new assets.

**Why 294 KB gz for core (not smaller)?** THREE.js alone accounts for ~170 KB gz. The remaining 124 KB gz covers the engine modules: createEngineCore, SunRig, CameraRig, post-chain, audio, terrain, scatter, pixelkit/ERA shaders, pilot, cockpit, and other general tools. No city GLBs are included.

**Shiki (code-panel):** excised from both lib entries — `dist-lib/` contains exactly 2 files, no grammar chunks. `createCodePanel` is a built-project feature (tracer lesson); workspace projects access it via `index.js` (unchanged). No-build consumers never load it.

**`assetsInlineLimit:0`:** attempted for an emitted-assets variant. Rolldown-vite lib mode ignores this flag and inlines `?url` assets (GLBs, colormap, gull sprite) as base64 data URIs regardless. The bundle is fully self-contained.

## Relocatability

Both lib files are fully self-contained. Assets (GLBs, gull sprite, colormap atlas) are inlined as base64 data URIs — no separate `assets/` folder needed. The files can be placed at any path depth and imported from any page depth (verified: consumer HTML at `/examples/`, lib at `/packages/engine-core/dist-lib/`).

## Site-etiquette patterns

**Lazy-mount (IntersectionObserver)**

```js
const obs = new IntersectionObserver(([e]) => {
  if (e.isIntersecting) { createEngineCore({ container: e.target }); obs.disconnect(); }
}, { threshold: 0.1 });
obs.observe(document.getElementById('mount'));
```

**Poster fallback (prefers-reduced-motion / no WebGL)**

```html
<div id="mount" style="background-image: url(poster.jpg)">
  <!-- engine replaces this once it boots -->
</div>
```

**`prefers-reduced-motion`**

```js
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// pass to createEngineCore opts, skip animation tick, show static frame
```

## Building the lib

```bash
npm run build:lib           # builds both entries into packages/engine-core/dist-lib/
```

Two separate Vite configs run sequentially (single entry each):
- `vite.lib.config.js` → `lgr-engine.es.js`
- `vite.lib.core.config.js` → `lgr-engine-core.es.js` (appends, does not wipe)

The workspace `npm run build` (6 project builds) is unaffected — `build:lib` is standalone.

## The TWO edge-flow renderers (documented convergence point, 2026-07-10)

`createEdgeField` (hero: static per-edge quads, one color, comet flow — K2 Constellation) and
`createGraphView`'s internal edge layer (Mission Control: INSTANCED tessellated 24-segment strips —
curved arcs, per-edge gradient/width/dim, physics-driven per-frame endpoints, pixel-look mitigations
uRest/uMinWidth) share the same shader LINEAGE (MC's slice-3 edge-flow) but different geometry
strategies, each right for its consumer. TRUE unification = rewriting createEdgeField on the instanced
strategy with the hero material injected (proposed API: `createEdgeField({ …, segments, dynamic,
material })`, defaults preserving today's behavior) — a deliberate JOINT refactor for a clean baton
point, not a unilateral edit while either lane is hot. Until then: this note is the guard against a
third implementation appearing.
