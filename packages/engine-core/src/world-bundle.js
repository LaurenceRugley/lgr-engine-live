/* ============================================================
   @lgr/engine-core — world-bundle (A18 PORTABLE EXPERIENCE FORMAT): the manifest schema + validator.
   ------------------------------------------------------------
   THE ABILITY: describe a whole playable experience as a PORTABLE BUNDLE — a manifest plus a handful of
   plain data + asset files — so a SECOND runtime (an iOS/Metal/RealityKit app) can load and play the same
   world by re-implementing ONLY its renderer, never the world. The strategic bet (A18): our portable asset
   is the DATA and the ALGORITHMS, not the GLSL. The world recipe (world-recipe.js), the seeded RNG
   (mulberry32 + fork), the sim/behaviour params, and the baked data are all language-agnostic; the shaders,
   the EffectComposer, and the DOM are not. This module is the canonical, PURE definition of the format:
   the manifest shape, a version check, and a validator. No THREE, no fs — so it is node-testable and is
   itself the spec's reference implementation. The exporter/validator CLIs (tools/) supply the fs glue.

   See docs/portable-experience-format.md for the full spec + the renderer contract a second runtime honours.

   ── C++ anchor ────────────────────────────────────────────────
   Think of a bundle as a small package with a header (`manifest.json`) that lists its sections and their
   files, like an asset pack's TOC. `validateManifest` is a linter over that header — it takes an injected
   `fileExists(path)` predicate (dependency injection) so the pure core never touches the filesystem, exactly
   like passing a `std::function<bool(string)>` so the checker can be unit-tested with a fake.
   ============================================================ */

// The format tag every manifest must carry (so a loader can refuse a foreign file fast) and the current
// spec version. SemVer: a loader accepts a bundle whose MAJOR matches — minor/patch bumps are additive.
export const BUNDLE_FORMAT = 'lgr-experience';
export const BUNDLE_VERSION = '1.1.0';

// The world-entry files a bundle MUST contain (the data half — all plain JSON). Keys are manifest.world.*.
export const REQUIRED_WORLD_FILES = ['recipe', 'config', 'simParams'];

// Parse "MAJOR.MINOR.PATCH" → [maj,min,patch] ints (NaN-safe). Non-strings / malformed → nulls.
export function parseVersion(v) {
  if (typeof v !== 'string') return [null, null, null];
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  return m ? [+m[1], +m[2], +m[3]] : [null, null, null];
}

// A loader at spec version `have` can load a bundle authored at `want` iff same MAJOR and the bundle's
// (minor,patch) is ≤ the loader's — a newer-minor bundle may use fields this loader doesn't know. Same major
// + older-or-equal minor is always safe.
export function isVersionCompatible(want, have = BUNDLE_VERSION) {
  const [wMaj, wMin, wPat] = parseVersion(want);
  const [hMaj, hMin, hPat] = parseVersion(have);
  if (wMaj == null || hMaj == null) return false;
  if (wMaj !== hMaj) return false;
  if (wMin > hMin) return false;
  if (wMin === hMin && wPat > hPat) return false;
  return true;
}

// buildManifest(spec) → a complete manifest object (plain data; the exporter JSON.stringifies it).
//   name, description        — human labels
//   createdISO               — timestamp string (the CALLER passes it; this module is deterministic/no clock)
//   seed                     — the master seed the world was authored at (determinism anchor)
//   world:{ recipe,config,simParams } — relative paths to the three data files (defaults below)
//   assets:[{ id, role, gltf?, usd? }] — model references; gltf = browser, usd = iOS (state BOTH when built)
//   baked:[{ id, kind, file, optional? }] — pre-baked data (RGBA8 atlases…); `optional` renderer may skip
export function buildManifest({
  name = 'untitled', description = '', createdISO = null, seed = null,
  world = {}, assets = [], baked = [],
} = {}) {
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    name, description,
    created: createdISO,
    seed,
    world: {
      recipe: world.recipe || 'recipe.json',
      config: world.config || 'config.json',
      simParams: world.simParams || 'sim-params.json',
    },
    assets: assets.map((a) => ({ id: a.id, role: a.role || 'asset', ...(a.gltf ? { gltf: a.gltf } : {}), ...(a.usd ? { usd: a.usd } : {}) })),
    baked: baked.map((b) => ({ id: b.id, kind: b.kind, file: b.file, ...(b.optional ? { optional: true } : {}) })),
  };
}

// validateManifest(manifest, { fileExists, loaderVersion }) → { ok, errors:[], warnings:[] }.
//   fileExists   — (relativePath) => boolean. Injected so the core is pure + testable (fake it in a test).
//                  Omit → file-resolution checks are SKIPPED (schema-only validation).
//   loaderVersion— the spec version a would-be loader implements (default = this module's BUNDLE_VERSION).
// An error means "a conformant loader would fail / mis-load". A warning means "loads, but sub-optimal".
export function validateManifest(manifest, { fileExists = null, loaderVersion = BUNDLE_VERSION } = {}) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, errors: ['manifest is not an object'], warnings };
  }
  // 1) format tag — refuse a foreign file fast.
  if (manifest.format !== BUNDLE_FORMAT) err(`format must be "${BUNDLE_FORMAT}" (got ${JSON.stringify(manifest.format)})`);
  // 2) version — present, well-formed, and loadable by the target loader.
  if (parseVersion(manifest.version)[0] == null) err(`version "${manifest.version}" is not MAJOR.MINOR.PATCH`);
  else if (!isVersionCompatible(manifest.version, loaderVersion)) err(`bundle version ${manifest.version} is not loadable by a v${loaderVersion} runtime (major mismatch or newer than loader)`);
  // 3) world entry — the three data files must be named AND (if we can check) exist.
  const w = manifest.world;
  if (!w || typeof w !== 'object') err('manifest.world missing (recipe/config/simParams entry)');
  else {
    for (const k of REQUIRED_WORLD_FILES) {
      const path = w[k];
      if (!path || typeof path !== 'string') { err(`manifest.world.${k} missing`); continue; }
      if (fileExists && !fileExists(path)) err(`world.${k} references "${path}" — file not found in bundle`);
    }
  }
  if (manifest.seed == null) warn('manifest.seed is null — determinism anchor unset (the recipe seed will be used)');
  // 4) assets — each must resolve at least one runtime format; flag iOS gaps (usd) as warnings, not errors.
  if (!Array.isArray(manifest.assets)) err('manifest.assets must be an array');
  else {
    const seen = new Set();
    for (const a of manifest.assets) {
      if (!a || !a.id) { err('an asset entry has no id'); continue; }
      if (seen.has(a.id)) err(`duplicate asset id "${a.id}"`); else seen.add(a.id);
      if (!a.gltf && !a.usd) { err(`asset "${a.id}" declares neither gltf nor usd — nothing to load`); continue; }
      if (a.gltf && fileExists && !fileExists(a.gltf)) err(`asset "${a.id}" gltf "${a.gltf}" not found in bundle`);
      if (a.usd && fileExists && !fileExists(a.usd)) err(`asset "${a.id}" usd "${a.usd}" not found in bundle`);
      if (!a.usd) warn(`asset "${a.id}" has no USD — the iOS/RealityKit runtime cannot load it (browser-only until a .usdz is exported)`);
      if (!a.gltf) warn(`asset "${a.id}" has no glTF — the browser runtime cannot load it`);
    }
  }
  // 5) baked data — referenced files must exist; a missing OPTIONAL bake is a warning (renderer substitutes).
  if (!Array.isArray(manifest.baked)) err('manifest.baked must be an array');
  else {
    for (const b of manifest.baked) {
      if (!b || !b.id) { err('a baked entry has no id'); continue; }
      if (!b.file) { err(`baked "${b.id}" has no file`); continue; }
      if (fileExists && !fileExists(b.file)) {
        if (b.optional) warn(`optional bake "${b.id}" file "${b.file}" not found — renderer must substitute (compute its own lighting)`);
        else err(`baked "${b.id}" file "${b.file}" not found in bundle`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
