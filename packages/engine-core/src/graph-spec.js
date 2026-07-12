/* ============================================================
   graph-spec.js — GraphSpec v1: ONE versioned graph document (Mission Control atlas).
   ------------------------------------------------------------
   LIFTED into engine-core (VIZ SLICE 3) — pure logic (no renderer, no THREE), barrel-exported next to
   scene-spec.js (its sibling pattern). Was project-local only until createEngineCore landed. See
   docs/guides/mission-control-graph-design.md §7.

   THE PATTERN (deliberately mirrors scene-spec.js, L109): three drifting scene descriptions became ONE
   versioned, validated document. GraphSpec does the same for graph data — one document the layout engine,
   the renderer, the inspector, the live-data binder, and any exporter all target, so none re-invent "what a
   node is." It is the serialized form of the standing "everything emits a node-descriptor" principle; the
   32-note memory vault (atomic notes + node_type + kind/ tags + [[links]]) is what it ingests INTO.

   Rules inherited from scene-spec (keep it honest): VERSIONED (`v` required, validated first) · grow by
   VERSION BUMP never by loosening · hard-validate KNOWN keys, TOLERATE unknown top-level sections
   (forward-compat) · PURE + headless-testable (node --test, no GPU/DOM).

   The ONE check a graph needs that a scene doesn't: EDGE REFERENTIAL INTEGRITY — an edge endpoint that
   names no node is an ERROR, not a render-time shrug. This is the real `[[L08]]` dangling-link class from
   the vault (a wikilink to a note that doesn't exist); catching it at validate time is the "fail loud"
   discipline (Rule 12) that keeps the atlas honest as the vault grows.

   C++ anchor: a `struct GraphSpec { int v; vector<Node> nodes; vector<Edge> edges; }` plus a validating
   deserializer — the struct IS the contract; every downstream layer targets it, not raw files. Referential
   integrity = checking every edge's endpoint indices are in-bounds before you trust the adjacency list.
   ============================================================ */

export const GRAPH_SPEC_VERSION = 1;

// The two CLOSED vocabularies. `type` (node_type) is deliberately OPEN — a free string — because the
// semantic-node-type taxonomy is intentionally not frozen (see the RESOLVED note in the
// mission-control-graph memory: kind/ is the closed cluster axis, node_type stays open).
// VOCAB POLICY (clarified 2026-07-09): KINDS/RELS grow ADDITIVELY within a version — a new allowed value
// cannot misparse an existing doc; only INCOMPATIBLE changes (rename/removal/semantic shift) bump
// GRAPH_SPEC_VERSION. 'learning' added for the docs/guides learning modules (tags: [kind/learning]).
export const KINDS = ['hub', 'live-ops', 'doctrine', 'initiative', 'learning', 'ops'];   // 'ops' added slice 13 (FACE-1 live-ops entities)
export const RELS  = ['links-to', 'depends-on', 'explains', 'built-by', 'derived-from'];

/* FACE-1 (slice 13): ops entities carry a STATE — the live-ops display vocabulary. */
export const STATES = ['green', 'working', 'stale', 'red', 'unknown'];

const KNOWN_TOP = new Set(['v', 'nodes', 'edges']);
const isPlainObject = (o) => o != null && typeof o === 'object' && !Array.isArray(o);
const isNonEmptyString = (s) => typeof s === 'string' && s.length > 0;

/* validateGraphSpec(spec) → { ok, errors[], unknownSections[] }
   Hard-validates types/vocab of the KNOWN keys + edge referential integrity; TOLERATES unknown top-level
   sections (returns their names) AND unknown per-node/edge keys (a saved layout adds x/y/z; live-ops adds
   heat/state — validated-if-known, ignored-if-unknown). `v` is required and must equal this version. */
export function validateGraphSpec(spec) {
  const errors = [];
  if (!isPlainObject(spec)) return { ok: false, errors: ['spec must be a plain object'], unknownSections: [] };

  if (spec.v !== GRAPH_SPEC_VERSION) {
    errors.push(`v must be ${GRAPH_SPEC_VERSION} (got ${JSON.stringify(spec.v)}) — a different version needs its own loader`);
  }

  // ---- NODES: array of records; ids required, unique; vocab-checked ----
  const ids = new Set();
  if (!Array.isArray(spec.nodes)) {
    errors.push('nodes must be an array');
  } else {
    spec.nodes.forEach((n, i) => {
      if (!isPlainObject(n)) { errors.push(`nodes[${i}] must be an object`); return; }
      if (!isNonEmptyString(n.id)) { errors.push(`nodes[${i}].id must be a non-empty string`); return; }
      if (ids.has(n.id)) errors.push(`nodes[${i}].id "${n.id}" is a duplicate (ids must be unique)`);
      ids.add(n.id);
      if ('label' in n && typeof n.label !== 'string') errors.push(`nodes[${i}] (${n.id}).label must be a string`);
      if ('kind'  in n && !KINDS.includes(n.kind))      errors.push(`nodes[${i}] (${n.id}).kind must be one of ${KINDS.join('|')}`);
      if ('type'  in n && typeof n.type !== 'string')   errors.push(`nodes[${i}] (${n.id}).type must be a string`);
      if ('group' in n && typeof n.group !== 'string')  errors.push(`nodes[${i}] (${n.id}).group must be a string`);
      if ('href'  in n && typeof n.href !== 'string')   errors.push(`nodes[${i}] (${n.id}).href must be a string`);
      if ('weight' in n && !Number.isFinite(n.weight))  errors.push(`nodes[${i}] (${n.id}).weight must be a finite number`);
      // ageDays (VIZ SLICE 4): days since the source note was last edited, STAMPED AT SNAPSHOT TIME by the
      // ingest script — never recomputed from Date.now() at render time (deterministic modules stay deterministic).
      if ('batch' in n && typeof n.batch !== 'boolean') errors.push(`nodes[${i}] (${n.id}).batch must be a boolean`);
      if ('state' in n && !STATES.includes(n.state)) errors.push(`nodes[${i}] (${n.id}).state must be one of ${STATES.join('|')}`);
      if ('ageDays' in n && (!Number.isFinite(n.ageDays) || n.ageDays < 0)) {
        errors.push(`nodes[${i}] (${n.id}).ageDays must be a finite number >= 0`);
      }
    });
  }

  // ---- EDGES: from/to required + MUST resolve to a node id (the [[L08]] dangling class) ----
  if (!Array.isArray(spec.edges)) {
    errors.push('edges must be an array');
  } else {
    spec.edges.forEach((e, i) => {
      if (!isPlainObject(e)) { errors.push(`edges[${i}] must be an object`); return; }
      for (const end of ['from', 'to']) {
        if (!isNonEmptyString(e[end])) { errors.push(`edges[${i}].${end} must be a non-empty string`); continue; }
        // Only assert referential integrity when the node set parsed cleanly (avoid noise on a broken nodes array).
        if (Array.isArray(spec.nodes) && !ids.has(e[end])) {
          errors.push(`edges[${i}].${end} "${e[end]}" references no node (dangling edge)`);
        }
      }
      if ('rel'    in e && !RELS.includes(e.rel))       errors.push(`edges[${i}].rel must be one of ${RELS.join('|')}`);
      if ('weight' in e && !Number.isFinite(e.weight))  errors.push(`edges[${i}].weight must be a finite number`);
    });
  }

  // Unknown top-level sections TOLERATED (a future "clusters"/"layout"/"meta"). Surface, don't reject.
  const unknownSections = Object.keys(spec).filter((k) => !KNOWN_TOP.has(k));
  return { ok: errors.length === 0, errors, unknownSections };
}

/* --- RECENCY → HEAT (VIZ SLICE 4): the canonical reading of a node's `ageDays` field ---
   Lives HERE, beside the field it interprets, for one hard reason: it must be node-testable. graph-view.js
   imports raw .vert/.frag (vite-plugin-glsl), so Node's loader can never import it — a curve buried there
   could only ever be eyeballed in a screenshot. Pure in, pure out: no THREE, no DOM, no clock.

   The curve is exponential decay — the same shape a contribution graph, a half-life, or an RC discharge has:
   heat = e^(-age/tau). tau is the "how long until a note stops feeling fresh" knob, and it is a POLICY the
   consumer owns, not a fact about graphs: a vault edited daily wants a small tau, a slow archive a large one.
   Below HEAT_FLOOR the note is quiet — an exact 0, not a 0.003 that keeps a pixel faintly lit forever.

   C++ anchor: `constexpr double heat(double age, double tau)` — a free function over a POD field, which is
   why it's trivially unit-testable while the renderer that calls it is not. */
export const HEAT_TAU_DAYS = 7;      // engine default; projects override (atlas runs hotter — see its main.js)
export const HEAT_FLOOR = 0.02;      // below this, snap to exactly 0 (quiet means quiet)

export function heatFromAgeDays(ageDays, tauDays = HEAT_TAU_DAYS) {
  if (!Number.isFinite(ageDays) || ageDays < 0) return 0;      // absent/garbage age → no glow, never NaN into a color
  if (!Number.isFinite(tauDays) || tauDays <= 0) return 0;
  const h = Math.exp(-ageDays / tauDays);
  return h < HEAT_FLOOR ? 0 : h;
}

/* indexNodes(spec) → Map<id, node> — the adjacency-building convenience the layout engine + renderer both
   want (look a node up by an edge's endpoint id). Does NOT validate — call validateGraphSpec first. */
export function indexNodes(spec) {
  const m = new Map();
  if (spec && Array.isArray(spec.nodes)) for (const n of spec.nodes) if (n && n.id) m.set(n.id, n);
  return m;
}
