/* ============================================================
   graph-layout.js — createGraphLayout: GraphSpec → node positions (Mission Control atlas).
   ------------------------------------------------------------
   LIFTED into engine-core (VIZ SLICE 3) — pure math over plain objects, no THREE, no renderer. Was
   project-local (projects/atlas/) only until createEngineCore landed; now a barrel export alongside
   scene-spec.js. See docs/guides/mission-control-graph-design.md §5/§7.

   Pure function: a validated GraphSpec → Map<id, {x, y, z}>. The renderer reads positions BY ID; it never
   computes them (the layout is swappable without touching the render).

   v1 = AUTHORED/RADIAL: hub at origin, concentric rings by `kind`, even angular spread within a ring.
   DETERMINISTIC — nodes are sorted by id before placement, so re-running yields byte-identical positions
   (no seed, no RNG). That reproducibility is a REQUIREMENT, not a nicety: the live graph must not reshuffle
   every node when one is added (the "stable/incremental layout" refinement from the mission-control-graph
   Phase-2 research). v2 force-directed (d3-force-3d in a worker) relaxes FROM this authored seed.

   Flat XZ plane (y=0): under the atlas's orthographic iso camera a flat layout reads as a pannable MAP,
   which is the whole framing choice. (A future 3D layout can lift y; the renderer already handles it.)

   C++ anchor: a pure transform pass — immutable input (the spec), deterministic output (the position map),
   no hidden state — the kind you unit-test exhaustively because the same input always gives the same bytes.
   ============================================================ */

// Ring radius per kind. hub is special-cased to the origin. A kind absent here (or a node with no kind)
// falls to opts.fallbackRadius (default FALLBACK_RADIUS) — placed, never dropped (a layout must position
// every node it's handed).
export const DEFAULT_RINGS = {
  'ops':        2,    // FACE-1 entities — the control room sits at the center of attention (slice 13)
  'live-ops':   4,
  'doctrine':   8,
  'initiative': 12,
  'learning':   14,   // the docs/guides learning modules — outermost authored ring (the seed only; the
                      // force sim relaxes it, and the modules' dense cross-links clump them naturally)
};
const FALLBACK_RADIUS = 16;

/* createGraphLayout(spec, opts) → Map<id, {x,y,z}>
   opts.kind: 'radial' (only mode in v1; 'force' is a v2 addition with the SAME signature).
   opts.rings: override the per-kind radii (defaults to DEFAULT_RINGS).
   opts.fallbackRadius: override the untagged-node ring radius (defaults to FALLBACK_RADIUS=16) — a
   consumer whose world scale differs from the authored default (e.g. atlas's near-clip compression)
   can now size the outer halo without post-hoc scaling every position. */
export function createGraphLayout(spec, { kind = 'radial', rings = DEFAULT_RINGS, fallbackRadius = FALLBACK_RADIUS } = {}) {
  if (kind !== 'radial') throw new Error(`createGraphLayout: unknown layout kind "${kind}" (v1 supports 'radial')`);
  const positions = new Map();
  const nodes = (spec && Array.isArray(spec.nodes)) ? spec.nodes : [];

  // Bucket by placement radius. hub → its own 0-radius bucket so it lands exactly at origin.
  const byRadius = new Map();   // radius → [node, ...]
  for (const n of nodes) {
    if (!n || !n.id) continue;
    const r = n.kind === 'hub' ? 0 : (rings[n.kind] ?? fallbackRadius);
    if (!byRadius.has(r)) byRadius.set(r, []);
    byRadius.get(r).push(n);
  }

  for (const [radius, ring] of byRadius) {
    if (radius === 0) {
      // hub(s) at origin. (More than one hub is unusual but harmless — they stack at 0,0,0.)
      for (const n of ring) positions.set(n.id, { x: 0, y: 0, z: 0 });
      continue;
    }
    // DETERMINISTIC order: sort by id so the angular assignment is stable across runs.
    ring.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const count = ring.length;
    ring.forEach((n, i) => {
      const angle = (i / count) * Math.PI * 2;
      positions.set(n.id, {
        x: Math.cos(angle) * radius,
        y: 0,
        z: Math.sin(angle) * radius,
      });
    });
  }
  return positions;
}
