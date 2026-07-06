/* ============================================================
   editor.js — Lesson 74: the WORLD-EDITOR tool dispatcher (the keystone lift).
   ------------------------------------------------------------
   L71–L73 grew five editing abilities (sculpt height · paint biome · paint scatter · place life ·
   select), but their STATE (which tool, which material/type/entity, brush radius, density, drop-count,
   brush direction) and their pointer ROUTING lived scattered in `projects/city/main.js`. That's the
   wiring-drift trap: a sibling project (office/hoard) that wanted the editor would have to re-copy all
   of it. This lesson UNIFIES it into ONE reusable engine-core object — `createEditor` — that owns the
   tool state + the shared brush + the apply-routing. The project keeps only the raw input plumbing
   (raycast + ring decal + pointer handlers) and calls `editor.applyAt(...)`.

   THIS IS A DISPATCHER, NOT A RE-IMPLEMENTATION. The actual edits still live on `engine.world`
   (`sculpt/paintBiome/paintScatter/placeEntity/removeEntityNear/snapshot/undo`) — `applyAt` just routes
   to the right one for the active tool. Undo stays world's (it owns the height/biome/scatter/placed-life
   mementos); the editor merely drives it via `beginStroke()` (= snapshot) / `undo()`.

   C++ anchor: a `class Editor` holding the tool enum + brush params, with `applyAt()` as a strategy/
   command dispatcher (switch on tool → call the matching world op). The project becomes a thin client
   that forwards pointer events to its methods. The mode rail is a radio over the tool enum; the control
   card is a view that reads the active tool's params.
   ============================================================ */

// internal tool ids are kept STABLE from L71–L73 ('sculpt'/'paint'/'scatter'/'place') so `?tool=…`, the
// harness probes, and saved state keep working; L74 adds 'select'. The rail order + labels live here.
const TOOLS = [
  { id: 'place',   label: 'Place',   icon: '✚',  key: '1' },
  { id: 'sculpt',  label: 'Sculpt',  icon: '⛰',  key: '2' },
  { id: 'paint',   label: 'Paint',   icon: '🎨', key: '3' },
  { id: 'scatter', label: 'Objects', icon: '🌲', key: '4' },
  { id: 'flow',    label: 'Water',   icon: '💧', key: '5' },   // L81: pour water → it flows (the From-Dust tool)
  { id: 'select',  label: 'Select',  icon: '◳',  key: '6' },
];
const SCATTER_TYPES = ['tree', 'rock', 'tuft'];
const PLACE_KINDS = ['gull', 'boat', 'fish', 'cloud', 'person', 'atv', 'craft'];   // L76 ATV · L77 spacecraft (both pilotable; car/road still deferred)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createEditor({ world, catalog, inspector } = {}) {
  let tool = 'sculpt';                          // the active tool (matches L71's default)
  let dir = 1;                                  // brush direction: +1 = raise / add / place, -1 = lower / erase / delete
  let scatterHidden = false;                    // the hide-scatter QoL view toggle
  const brush = { radius: 2.2, strength: 0.03, density: 0.6, dropN: 1 };   // the ONE shared brush, all tools read it (L96: gentler default strength 0.05→0.03 → ~5 strokes carve a basin, not ~3 punching below sea; range unchanged 0.01–0.15)
  const sel = { biome: 2, scatter: 'tree', entity: 'gull' };               // per-tool selection (grassland / tree / gull)
  let _lastPlace = null, _freshDown = false;    // place-stroke state (drag spacing + drop-N once-per-press gate)

  function setTool(id) { if (TOOLS.some((t) => t.id === id)) tool = id; return tool; }
  function setToolByKey(k) { const t = TOOLS.find((t) => t.key === k); if (t) tool = t.id; return tool; }
  function toggleDir() { dir = -dir; return dir; }
  function setRadius(r) { brush.radius = clamp(r, 0.8, 6.0); return brush.radius; }
  function setStrength(s) { brush.strength = clamp(s, 0.01, 0.15); return brush.strength; }
  function setDensity(d) { brush.density = clamp(d, 0.1, 1.0); return brush.density; }
  function setDropN(n) { brush.dropN = [1, 10, 50].includes(n) ? n : 1; return brush.dropN; }
  function setMaterial(i) { sel.biome = i | 0; return sel.biome; }
  function setScatter(k) { if (SCATTER_TYPES.includes(k)) sel.scatter = k; return sel.scatter; }
  function setEntity(k) { if (PLACE_KINDS.includes(k)) sel.entity = k; return sel.entity; }

  /* unified pick by CATALOG id — routes to the right selection by the entry's kind (the design doc's
     "one descriptor, every tool speaks it"). The granular setters above stay for the UI/harness. */
  function select(catalogId) {
    const e = catalog && catalog.get(catalogId); if (!e) return null;
    if (e.kind === 'material') return setMaterial(e.defaults.colorIndex ?? sel.biome);
    if (e.kind === 'scatter') return setScatter(e.defaults.geoKey);
    if (e.kind === 'entity') return setEntity(catalogId.replace('ent-', ''));
    return null;
  }

  // PLACE routing (lifted from city's placeAtHit): delete on dir<0; drop-N once per press; else spacing-throttled single.
  function dropEntities(cx, cz, n) {
    let placed = 0;
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * brush.radius; if (world.placeEntity(sel.entity, cx + Math.cos(a) * rr, cz + Math.sin(a) * rr)) placed++; }
    return placed;
  }
  function placeRoute(x, z, d) {
    if (d < 0) { world.removeEntityNear(x, z, brush.radius); _lastPlace = { x, z }; return; }
    if (brush.dropN > 1) { if (_freshDown) { dropEntities(x, z, brush.dropN); _freshDown = false; } return; }
    const far = !_lastPlace || Math.hypot(x - _lastPlace.x, z - _lastPlace.z) >= brush.radius * 0.7;   // drag spacing
    if (far) { world.placeEntity(sel.entity, x, z); _lastPlace = { x, z }; }
  }

  /* THE DISPATCHER — route a brush apply at world (wx,wz) with direction d (+1/-1) to the active tool's
     world op. Select is a no-op here (it picks on click via inspector.pickAt, handled by the app). */
  function applyAt(wx, wz, d) {
    if (d === 0) return;
    if (tool === 'paint') world.paintBiome(wx, wz, sel.biome, brush.radius);
    else if (tool === 'scatter') world.paintScatter(wx, wz, { type: sel.scatter, density: brush.density, radius: brush.radius, erase: d < 0 });
    else if (tool === 'place') placeRoute(wx, wz, d);
    else if (tool === 'sculpt') world.sculpt(wx, wz, d, brush.radius, brush.strength);
    else if (tool === 'flow') { if (d > 0) world.flowPourAt(wx, wz, undefined, brush.radius); }   // L81: 💧 pour (drag to keep pouring); dir<0 is a no-op here
    // select → nothing (pick happens on the up-click)
  }
  const edits = () => tool !== 'select' && tool !== 'flow';   // L81: flow pours transient water → NOT an undoable terrain edit (no snapshot)
  function beginStroke() { if (edits()) world.snapshot(); _freshDown = true; _lastPlace = null; }   // a pointer-down opens an undo transaction
  function endStroke() { _lastPlace = null; }
  function pickAt(ndcX, ndcY) { return inspector ? inspector.pickAt(ndcX, ndcY) : null; }   // the Select tool's action
  function undo() { return world.undo(); }
  function snapshot() { return world.snapshot(); }
  function toggleHideScatter() { scatterHidden = !scatterHidden; if (world.setScatterHidden) world.setScatterHidden(scatterHidden); return scatterHidden; }

  return {
    get tools() { return TOOLS; }, placeKinds: PLACE_KINDS,
    get tool() { return tool; }, setTool, setToolByKey,
    get dir() { return dir; }, get raise() { return dir > 0; }, toggleDir,
    brush, setRadius, setStrength, setDensity, setDropN,
    get selection() { return { ...sel }; },
    get material() { return sel.biome; }, get scatterType() { return sel.scatter; }, get entity() { return sel.entity; },
    setMaterial, setScatter, setEntity, select,
    applyAt, beginStroke, endStroke, pickAt, dropEntities, undo, snapshot, get canUndo() { return world.canUndo; },
    get scatterHidden() { return scatterHidden; }, toggleHideScatter,
  };
}
