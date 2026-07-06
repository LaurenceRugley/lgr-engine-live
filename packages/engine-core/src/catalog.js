/* ============================================================
   catalog.js — Lesson 71: the OBJECT CATALOG (the world-editor's extensible registry).
   ------------------------------------------------------------
   The engine is becoming a general-purpose WORLD EDITOR (sculpt · paint terrain · paint scatter · place
   entities). Every PLACEABLE thing — a terrain material, a scatter prop, a live entity — needs to be
   describable under ONE shape so tools, palettes, save/load, and the inspector all speak the same
   language. That shape is a CATALOG ENTRY; this module is the registry of them.

   THE ONE DESCRIPTOR SHAPE (three `kind`s, one record):
     { id, label, kind:'material'|'scatter'|'entity', group, defaults:{…},
       art:{ factory, icon, placeholder } }
   - `kind` routes which TOOL edits it (material → paint-terrain, scatter → paint-scatter, entity → place).
   - `group` clusters the palette ("Terrain", "Vegetation", "Life", …).
   - `defaults` is kind-specific config (material{colorIndex} · scatter{geoKey,maxSlope,density} · entity{…}).
   - ⭐ `art` is THE SEAM — Laurence's "placeholder now, real art per-project later". Tools NEVER construct
     geometry; they call `catalog.get(id).art.factory()`. A project swaps art with `catalog.setArt(id,{factory})`
     and NOTHING else changes, because placement records store only DATA ({id,x,y,z,scale,yaw}), not meshes —
     the same saved world re-renders with whatever factory is currently bound.

   C++ anchor: a registry/factory map — entries are data records carrying a function pointer (`art.factory`)
   you call to build the thing; `setArt` rebinds the pointer with callers unchanged (a vtable edited at runtime).

   L71 ships only ONE tool (paint-terrain → materials), but we seed scatter + entity entries as DATA NOW to
   prove the schema + set up L72 (paint-scatter) / L73 (place-entities). See docs/guides/world-editor-design.md.
   ============================================================ */
import { BIOMES } from './terrain.js';

export function createCatalog() {
  const byId = new Map();
  const api = {
    register(entry) {                                  // add/replace one entry (last write wins)
      if (!entry || !entry.id) return api;
      entry.art = entry.art || {}; entry.defaults = entry.defaults || {};
      byId.set(entry.id, entry);
      return api;
    },
    registerAll(list) { for (const e of list) api.register(e); return api; },
    get(id) { return byId.get(id); },
    byKind(kind) { return [...byId.values()].filter((e) => e.kind === kind); },
    byGroup(group) { return [...byId.values()].filter((e) => e.group === group); },
    all() { return [...byId.values()]; },
    /* ⭐ rebind an entry's ART without touching the entry's data or any tool — the placeholder→real swap. */
    setArt(id, art) { const e = byId.get(id); if (e) e.art = { ...e.art, ...art }; return api; },
    get size() { return byId.size; },
  };
  return api;
}

/* Seed the catalog from the engine's existing tables — BIOMES become `material` entries (the paint-terrain
   palette), and the known scatter props + entity kinds register as DATA stubs (no tool uses them yet; L72/L73
   bind their art + tools). The catalog WRAPS the tables — generation keeps reading the tables directly. */
export function seedWorldEditorCatalog(catalog = createCatalog()) {
  // 1) TERRAIN MATERIALS — one per biome; `colorIndex` is the BIOMES index paint-terrain writes into biome[].
  BIOMES.forEach((b, i) => catalog.register({
    id: `mat-${b.key}`, label: cap(b.key), kind: 'material', group: 'Terrain',
    defaults: { colorIndex: i },
    art: { icon: b.color, placeholder: true },          // icon = the swatch colour; a real material LUT can rebind later
  }));
  // 2) SCATTER PROPS — data stubs (factories bound in L72; art.factory is a placeholder for now).
  catalog.registerAll([
    { id: 'scatter-tree', label: 'Tree', kind: 'scatter', group: 'Vegetation', defaults: { geoKey: 'tree', density: 0.4, maxSlope: 0.85 }, art: { icon: '🌲', factory: null, placeholder: true } },
    { id: 'scatter-rock', label: 'Rock', kind: 'scatter', group: 'Rock',       defaults: { geoKey: 'rock', density: 0.2, maxSlope: 2.0 },  art: { icon: '🪨', factory: null, placeholder: true } },
    { id: 'scatter-tuft', label: 'Grass tuft', kind: 'scatter', group: 'Vegetation', defaults: { geoKey: 'tuft', density: 0.3, maxSlope: 0.95 }, art: { icon: '🌱', factory: null, placeholder: true } },
  ]);
  // 3) LIVE ENTITIES — data stubs (placer/followable bound in L73), one per inspectable kind.
  catalog.registerAll([
    { id: 'ent-person', label: 'Person', kind: 'entity', group: 'Life', defaults: { medium: 'ground' }, art: { icon: '🚶', placeholder: true } },
    { id: 'ent-car',    label: 'Car',    kind: 'entity', group: 'Life', defaults: { medium: 'road' },   art: { icon: '🚗', placeholder: true } },
    { id: 'ent-boat',   label: 'Boat',   kind: 'entity', group: 'Life', defaults: { medium: 'water' },  art: { icon: '⛵', placeholder: true } },
    { id: 'ent-fish',   label: 'Fish',   kind: 'entity', group: 'Life', defaults: { medium: 'water' },  art: { icon: '🐟', placeholder: true } },
    { id: 'ent-gull',   label: 'Gull',   kind: 'entity', group: 'Life', defaults: { medium: 'air' },    art: { icon: '🕊', placeholder: true } },
    { id: 'ent-cloud',  label: 'Cloud',  kind: 'entity', group: 'Sky',  defaults: { medium: 'air' },    art: { icon: '☁️', placeholder: true } },
    // L76 — the all-terrain VEHICLE: a placeable entity that is also PILOTABLE (drop it, then possess + drive it).
    { id: 'ent-atv',    label: 'ATV',    kind: 'entity', group: 'Vehicles', defaults: { medium: 'ground', pilotable: true, roam: 'all-terrain', model: 'ground' }, art: { icon: '🛻', placeholder: true } },
    // L77 — the all-medium SPACECRAFT: pilotable, flows air↔water↔ground (one MovementModel, medium probe).
    { id: 'ent-craft',  label: 'Spacecraft', kind: 'entity', group: 'Vehicles', defaults: { medium: 'air', pilotable: true, roam: 'all-medium', model: 'spacecraft' }, art: { icon: '🛸', placeholder: true } },
  ]);
  return catalog;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
