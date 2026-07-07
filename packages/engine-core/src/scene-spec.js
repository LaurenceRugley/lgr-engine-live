/* ============================================================
   scene-spec.js — L109: SceneSpec v1, ONE versioned scene document.
   ------------------------------------------------------------
   THE PROBLEM (audit / site-builder panel §2): three parallel, partially-overlapping scene descriptions exist —
   URL params (string-typed, unversioned, parsed slightly differently in three project mains = a drift class),
   `world.serialize()` (versioned but terrain-only), and `createEngine(opts)` (an undocumented boot shape). Nothing
   names "a scene" as ONE document, so the embed SDK, the poster generator, site-gen, and the prompt layer have no
   stable contract to target. This module IS that contract: a small versioned schema + a validating (de)serializer.

   SCOPE SPLIT (the correction that keeps it honest): the URL vocabulary divides into SCENE state (what the world
   LOOKS like — this module's job) and APP/CHROME flags (?preview ?demo ?dev ?ui ?edit ?tool ?capture ?officeskin
   ?officeprops ?hoard ?office …) which stay in the mains as pass-throughs. SceneSpec models scenes, not app modes.

   BUILDER-UI SEED (why the shape is careful): this schema is the seed of the future site-builder cockpit. So it is
   VERSIONED (`v`, validated first), its keys are NAMESPACED (the `world` sub-document; a future SiteSpec adds `pages`
   / `theme` / `hero` top-level sections), and the loader is TOLERANT of unknown top-level sections — a v1 scene
   loader reads its own keys and ignores the rest, so ONE spec file can later describe both a scene AND a site build.
   Grow the schema by VERSION BUMP, never by loosening validation.

   C++ anchor: replacing ad-hoc `argv` parsing scattered across three main()s with one `struct SceneSpec` + a
   validating deserializer — the struct IS the API contract; every downstream layer targets it, not the raw strings.
   ============================================================ */
import { PROFILE_KEYS } from './citygen.js';
import { PRESET_KEYS } from './terrain.js';
import { CAM } from './camera-rig.js';

// v1 vocabularies. Enums are the REAL URL vocabulary (verified against city/main.js:1823-1858).
export const SCENE_SPEC_VERSION = 1;
const ENGINES  = ['city', 'world'];
const POSTS    = ['auto', 'pixel', 'toon', 'none'];            // the post-mode axis (?style)
const CAMERAS  = ['iso', 'dimetric', 'persp'];                 // the ?cam vocabulary (framing numbers are a v2 concern)
const WEATHERS = ['clear', 'rain', 'snow', 'fog'];
const TIME_PRESETS = { dawn: 0.25, noon: 0.5, dusk: 0.75, night: 0.0 };   // ?time=<preset> → SunRig t
// The canonical spec-string → engine mapping (owned here because applySceneSpec applies via engine methods; the
// project's viewerControls duplicate these today — this is the one place they'll consolidate). Mirrors
// city viewerControls.post {auto:3,pixel:7,toon:8,none:1} and CAM {persp:4,iso:5,dimetric:6}.
const POST_MODE = { auto: 3, pixel: 7, toon: 8, none: 1 };
const CAM_MODE  = { iso: CAM.ISOMETRIC, dimetric: CAM.DIMETRIC, persp: CAM.PERSPECTIVE };

// The set of top-level keys THIS version understands — anything else is a tolerated future section (builder-UI seed).
const KNOWN_KEYS = new Set(['v', 'engine', 'seed', 'profile', 'time', 'weather', 'post', 'vector', 'camera', 'quality', 'world']);

/* validateSceneSpec(spec) → { ok, errors[], unknownSections[] }
   Hard-validates types/ranges of the KNOWN keys; TOLERATES unknown top-level sections (returns their names so a
   caller can route them to a future loader). Every field is optional-if-absent but validated-if-present, EXCEPT
   `v` which is required and must equal this version (a v2 doc is out of scope → error, not a silent misparse). */
export function validateSceneSpec(spec) {
  const errors = [];
  if (spec == null || typeof spec !== 'object' || Array.isArray(spec)) return { ok: false, errors: ['spec must be a plain object'], unknownSections: [] };
  const has = (k) => Object.prototype.hasOwnProperty.call(spec, k);

  if (spec.v !== SCENE_SPEC_VERSION) errors.push(`v must be ${SCENE_SPEC_VERSION} (got ${JSON.stringify(spec.v)}) — a different version needs its own loader`);
  if (has('engine')  && !ENGINES.includes(spec.engine))    errors.push(`engine must be one of ${ENGINES.join('|')}`);
  if (has('seed')    && !Number.isInteger(spec.seed))      errors.push('seed must be an integer');
  if (has('profile') && !PROFILE_KEYS.includes(spec.profile)) errors.push(`profile must be one of ${PROFILE_KEYS.join('|')}`);
  if (has('time')    && !Number.isFinite(spec.time))       errors.push('time must be a finite number');   // THE boundary where ?t=Infinity dies (isFinite, not isNaN)
  if (has('weather') && !WEATHERS.includes(spec.weather))  errors.push(`weather must be one of ${WEATHERS.join('|')}`);
  if (has('post')    && !POSTS.includes(spec.post))        errors.push(`post must be one of ${POSTS.join('|')}`);
  if (has('vector')  && typeof spec.vector !== 'boolean')  errors.push('vector must be a boolean');
  if (has('camera')  && !CAMERAS.includes(spec.camera))    errors.push(`camera must be one of ${CAMERAS.join('|')}`);
  if (has('quality') && !(spec.quality === 'auto' || Number.isInteger(spec.quality))) errors.push("quality must be 'auto' or an integer rung");
  if (has('world') && spec.world != null) {
    if (typeof spec.world !== 'object' || Array.isArray(spec.world)) errors.push('world must be an object (a world.serialize() payload)');
    else if (Object.prototype.hasOwnProperty.call(spec.world, 'preset') && !PRESET_KEYS.includes(spec.world.preset)) errors.push(`world.preset must be one of ${PRESET_KEYS.join('|')}`);
  }

  // Unknown top-level sections are TOLERATED (a future SiteSpec's pages/theme/hero). Surface them, don't reject.
  const unknownSections = Object.keys(spec).filter((k) => !KNOWN_KEYS.has(k));
  return { ok: errors.length === 0, errors, unknownSections };
}

/* fromURLParams(params) → spec — the SCENE subset of the ?param vocabulary → a v1 spec. `params` is a
   URLSearchParams (or anything with .get). App/chrome flags are NOT read here (they stay in the mains). Mirrors
   city/main.js:1823-1858 exactly, including ?time overriding ?t (city applies ?t then ?time). */
export function fromURLParams(params) {
  const g = (k) => params.get(k);
  const spec = { v: SCENE_SPEC_VERSION, engine: g('world') === '1' ? 'world' : 'city' };

  const seed = g('city'); if (seed != null && seed !== '') { const n = Number(seed); if (Number.isInteger(n)) spec.seed = n; }
  const profile = g('profile'); if (profile && PROFILE_KEYS.includes(profile)) spec.profile = profile;

  const t = g('t'); if (t != null && t !== '') { const tv = parseFloat(t); if (Number.isFinite(tv)) spec.time = tv; }   // isFinite: ?t=Infinity is dropped, never becomes goalT
  const tp = g('time'); if (tp && tp in TIME_PRESETS) spec.time = TIME_PRESETS[tp];   // ?time OVERRIDES ?t (matches city's apply order)

  const w = g('weather'); if (w && WEATHERS.includes(w)) spec.weather = w;
  const style = g('style'); if (style && POSTS.includes(style)) spec.post = style;
  if (style === 'vector' || g('vector') === '1') spec.vector = true;   // ?style=vector (legacy) OR ?vector=1 — the ORTHOGONAL material axis
  const cam = g('cam'); if (cam && CAMERAS.includes(cam)) spec.camera = cam;

  const preset = g('preset'); if (spec.engine === 'world' && preset && PRESET_KEYS.includes(preset)) spec.world = { preset };
  return spec;
}

/* toURLParams(spec) → string — emit the URL-expressible subset. LOSSY by design where the URL vocabulary is
   poorer than the spec: ?time presets normalise to ?t (the numeric form); ?style=vector legacy normalises to
   ?vector=1. Stable where it isn't → toURLParams(fromURLParams(x)) re-parses to the same spec (round-trip). */
export function toURLParams(spec) {
  if (spec == null || typeof spec !== 'object') return '';   // hardened: an SDK caller may hand us null/undefined
  const p = new URLSearchParams();
  if (spec.engine === 'world') p.set('world', '1');
  if (Number.isInteger(spec.seed)) p.set('city', String(spec.seed));
  if (spec.profile) p.set('profile', spec.profile);
  if (Number.isFinite(spec.time)) p.set('t', String(spec.time));   // always the numeric form (?time presets are lossy)
  if (spec.weather) p.set('weather', spec.weather);
  if (spec.post) p.set('style', spec.post);
  if (spec.vector) p.set('vector', '1');   // canonical (not the legacy ?style=vector)
  if (spec.camera) p.set('cam', spec.camera);
  if (spec.world && spec.world.preset) p.set('preset', spec.world.preset);
  return p.toString();
}

/* applySceneSpec(engine, spec) → { ok, errors, applied[], deferred } — applies the POST-BOOT-settable fields via
   ENGINE methods (for the future embed `mount(el, spec)`; a project WITH a viewer UI can instead feed
   fromURLParams into its own control bus so the UI stays in sync — see the city wiring). SCOPE HONESTY: `seed`,
   `profile`, `engine` are consumed at createEngine() construction (re-applying them = a heavy city.generate() +
   main-owned state), so they are NOT applied here — they're returned in `deferred` for the caller to decide. */
export function applySceneSpec(engine, spec) {
  const { ok, errors } = validateSceneSpec(spec);
  if (!ok) return { ok: false, errors, applied: [], deferred: {} };
  const applied = [];
  if (Number.isFinite(spec.time) && engine.sunRig) { engine.sunRig.goTo(spec.time); applied.push('time'); }
  if (spec.weather && engine.weatherRig) { engine.weatherRig.setKind(spec.weather); applied.push('weather'); }
  if (spec.post && POST_MODE[spec.post] != null && engine.setPostMode) { engine.setPostMode(POST_MODE[spec.post]); applied.push('post'); }
  if (spec.vector === true && engine.setVector && !engine.vector) { engine.setVector(true); applied.push('vector'); }
  if (spec.camera && CAM_MODE[spec.camera] != null && engine.rig) { engine.rig.setMode(CAM_MODE[spec.camera]); applied.push('camera'); }
  if (spec.world && engine.world && engine.world.setPreset && spec.world.preset) { engine.world.setPreset(spec.world.preset); applied.push('world.preset'); }

  const deferred = {};
  for (const k of ['seed', 'profile', 'engine']) if (Object.prototype.hasOwnProperty.call(spec, k)) deferred[k] = spec[k];
  return { ok: true, errors: [], applied, deferred };
}
