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
export const KINDS = ['hub', 'live-ops', 'doctrine', 'initiative', 'learning', 'ops', 'site'];   // 'ops' slice 13 (FACE-1); 'site' slice 26 (COCKPIT: the owner's live sites, health-checked)
export const RELS  = ['links-to', 'depends-on', 'explains', 'built-by', 'derived-from'];

/* ---- SITE HEALTH (COCKPIT SLICE 1 / atlas slice 26) ----
   The COCKPIT reaches OUTWARD: Face-1 has watched this repo's own git and baton since slice 13; now it
   watches the owner's LIVE SITES. `classifyHealth` is the pure reading of one HTTP check — it lives here,
   beside heatFromAgeDays and classifyMedia, for the same reason: it must be node-testable, and both the
   fetcher (which produces the numbers) and the renderer (which colours the node) must agree on ONE
   definition of what "green" means.

   THE THRESHOLD IS A POLICY, AND IT IS STATED, NOT HIDDEN. A site that answers 200 in 2.5 seconds is not
   "up" in any sense a customer would recognise — it is limping, and the whole point of a cockpit is to
   show you that BEFORE it becomes an outage. SLOW_MS is where "fine" stops; it is a judgment about what
   the owner's customers will tolerate, not a fact about HTTP, and a consumer can override it.

   The vocabulary is the one the graph already speaks (slice 13's STATES), so a site node needs no new
   colour machinery: green = healthy · working = degraded (amber) · red = down/erroring · unknown = we
   did not manage to check (a build machine with no network — which must never be reported as "down",
   because "I don't know" and "it's broken" are different facts and conflating them is how a dashboard
   starts lying).

   C++ anchor: a `constexpr State classify(int code, int ms, bool timedOut)` over POD fields — trivially
   unit-testable, which is exactly why it does not live inside the thing that does the network I/O. */
export const SLOW_MS = 1500;

export function classifyHealth(check, { slowMs = SLOW_MS } = {}) {
  if (!check || check.checked === false || check.httpCode == null && !check.timedOut && !check.error) return 'unknown';
  if (check.timedOut || check.error) return 'red';        // unreachable IS down, from a customer's chair
  const code = Number(check.httpCode);
  if (!Number.isFinite(code)) return 'unknown';
  if (code >= 400) return 'red';                          // 4xx and 5xx: the page is not being served
  if (code >= 200 && code < 400) {
    const ms = Number(check.responseMs);
    if (Number.isFinite(ms) && ms > slowMs) return 'working';   // up, but limping — amber
    return 'green';
  }
  return 'unknown';                                       // 1xx and anything exotic: don't pretend to know
}

/* worstState(states) → the state a SUMMARY should wear. "Are my sites ok?" is answered by the worst one,
   not the average — a cockpit that reports "mostly up" while a site is down is worse than no cockpit.
   Order of severity: red > working > unknown > green. `unknown` outranks green deliberately: not knowing
   is a weaker claim than knowing it is fine, and the overview should not paint confidence it lacks. */
const SEVERITY = { red: 4, working: 3, unknown: 2, green: 1, stale: 3 };
export function worstState(states = []) {
  let worst = null, rank = 0;
  for (const s of states) {
    const r = SEVERITY[s] || 0;
    if (r > rank) { rank = r; worst = s; }
  }
  return worst || 'unknown';
}

/* The runnable algorithm kinds (slice 20). Mirrors the keys of ALGORITHMS in algorithms.js — kept here
   as a plain list so the validator stays PURE (importing the algorithm library would drag the renderer's
   dependency graph into a module that must run headless). A kind added there must be added here; the
   registry test asserts they never drift. */
export const ALGORITHM_KINDS = ['bubble-sort', 'binary-search', 'merge-sort', 'quick-sort', 'heap-sort'];   // heap-sort joined in T2 (the drift test caught this the moment it was added — working as designed)
/* T2 (slice 29): the runnable STRUCTURES. Same policy as ALGORITHM_KINDS — a plain list here (so the
   validator stays headless-pure) mirroring the keys of STRUCTURES in data-structures.js; a test asserts
   they never drift. A lesson that promises a step-through the engine cannot mount must fail LOUD. */
export const STRUCTURE_KINDS = ['binary-search-tree', 'binary-heap'];

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
      /* algorithm (slice 20): a note declaring `algorithm: { kind, input, target }` gets an INTERACTIVE
         step-through in the reader. The kind must be one the engine can actually run — a lesson that
         promises a step-through the renderer cannot mount is exactly the silent failure this validator
         exists to prevent (the figma-manifest rule, applied to code). */
      if ('algorithm' in n) {
        if (!isPlainObject(n.algorithm) || !isNonEmptyString(n.algorithm.kind)) {
          errors.push(`nodes[${i}] (${n.id}).algorithm must be an object with a non-empty kind`);
        } else if (!ALGORITHM_KINDS.includes(n.algorithm.kind)) {
          errors.push(`nodes[${i}] (${n.id}).algorithm.kind "${n.algorithm.kind}" is not runnable (have: ${ALGORITHM_KINDS.join('|')})`);
        }
        if ('input' in n.algorithm && !Array.isArray(n.algorithm.input)) {
          errors.push(`nodes[${i}] (${n.id}).algorithm.input must be an array`);
        }
      }
      /* structure (T2, slice 29): a note declaring `structure: { kind, inserts, target }` gets an
         interactive TREE step-through. Same contract as `algorithm`, different painter. */
      if ('structure' in n) {
        if (!isPlainObject(n.structure) || !isNonEmptyString(n.structure.kind)) {
          errors.push(`nodes[${i}] (${n.id}).structure must be an object with a non-empty kind`);
        } else if (!STRUCTURE_KINDS.includes(n.structure.kind)) {
          errors.push(`nodes[${i}] (${n.id}).structure.kind "${n.structure.kind}" is not runnable (have: ${STRUCTURE_KINDS.join('|')})`);
        }
        if ('inserts' in n.structure && !Array.isArray(n.structure.inserts)) {
          errors.push(`nodes[${i}] (${n.id}).structure.inserts must be an array`);
        }
      }
      /* launch (slice 27): a node that IS a runnable thing — the city, the world sculptor, the game.
         { url, label, run? }. Validated-if-present: a launch button that points nowhere is worse than no
         button, because the user has already decided to go. */
      if ('launch' in n) {
        if (!isPlainObject(n.launch) || !isNonEmptyString(n.launch.url) || !isNonEmptyString(n.launch.label)) {
          errors.push(`nodes[${i}] (${n.id}).launch must be an object with a non-empty url and label`);
        }
      }
      // media (slice 19): the richness signal, stamped at snapshot time by classifyMedia. Validated-if-
      // present (a bad shape must fail on the studio machine, not paint a garbage badge in the browser).
      if ('media' in n) {
        if (!isPlainObject(n.media)) errors.push(`nodes[${i}] (${n.id}).media must be an object`);
        else for (const k of ['figma', 'pdf', 'img', 'deep', 'interactive', 'launch']) {
          if (k in n.media && typeof n.media[k] !== 'boolean') errors.push(`nodes[${i}] (${n.id}).media.${k} must be a boolean`);
        }
      }
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

/* --- MEDIA RICHNESS (VIZ SLICE 19): "does this node carry real material?" ---
   Lives HERE, beside heatFromAgeDays, for the same reason: it must be node-testable, it is a pure
   reading of fields the snapshot ALREADY resolves (figmaAssets, assets[], content), and both the
   ingest (which stamps it) and the renderer (which badges it) must agree on one definition.

   DEEP_CHARS is the honest part of the honesty, and it was MEASURED, not guessed. At the intuitive
   1200 chars (about a screen of text) 65 of this vault's 71 nodes badge — a badge that fires on 92% of
   the graph tells the eye nothing. The real distribution: p50 ≈ 2.3k, p10 ≈ 5.1k, p0 ≈ 31k. 5000 is
   where "a substantive document" actually separates from "a note" HERE (12 of 71 ≈ 17% — a signal you
   can scan for). It is a POLICY over a corpus, not a fact about markdown: a vault of one-liners would
   want it far lower, and the consumer can override it (deepChars).

   C++ anchor: a `constexpr Media classify(const Node&)` over POD fields — trivially unit-testable,
   which is exactly why it does not live in the renderer that consumes it. */
export const DEEP_CHARS = 5000;

export function classifyMedia(node, { deepChars = DEEP_CHARS } = {}) {
  const assets = Array.isArray(node && node.assets) ? node.assets : [];
  const media = {
    figma: !!(node && Array.isArray(node.figmaAssets) && node.figmaAssets.length),
    pdf: assets.some((a) => a && a.type === 'pdf'),
    img: assets.some((a) => a && (a.type === 'img' || a.type === 'image')),
    deep: typeof (node && node.content) === 'string' && node.content.length >= deepChars,
    /* INTERACTIVE (slice 20): a note that declares a runnable algorithm carries the richest material we
       have — you can step through it. It badges regardless of length: a 3k-char lesson you can PLAY is
       not thinner than a 6k-char note you can only read. (The first cut missed this and the two new
       algorithm lessons badged as nothing — caught by looking at the count.) */
    interactive: !!(node && ((node.algorithm && typeof node.algorithm.kind === 'string')
      || (node.structure && typeof node.structure.kind === 'string'))),   // T2: a structure is interactive too
    launch: !!(node && node.launch && typeof node.launch.url === 'string'),   // slice 27: you can RUN this
  };
  return media;
}

/* MEDIA_GLYPH (slice 22) — which glyph a badged node wears, and the PRIORITY when it has several.
   The order is by what the material lets you DO, not by what it is: an interactive step-through beats a
   picture beats a document beats prose. A node that is both a deep note and an algorithm is, to a reader
   scanning the graph, an ALGORITHM — that is the thing worth crossing the graph for.
     1 play  ▶  interactive (a runnable algorithm — step through it)
     2 frame ▣  figma / image (a picture to look at)
     3 page  ▤  pdf (a document to open)
     4 book  ▥  deep note (substantial prose)
   The renderer, the legend and the inspector all read THIS function — none of them re-derives the
   priority (the anti-drift rule that has held since slice 8). */
export const MEDIA_GLYPHS = ['rocket', 'play', 'frame', 'page', 'book'];

export function mediaGlyph(media) {
  if (!media) return null;
  /* ROCKET outranks everything (slice 27): a node you can LAUNCH — fly the city, sculpt a world, play the
     game — is the strongest call to action in the graph. Reading about a thing is good; running it is
     better, and the glyph priority is ordered by what the material lets you DO. */
  if (media.launch) return 'rocket';
  if (media.interactive) return 'play';
  if (media.figma || media.img) return 'frame';
  if (media.pdf) return 'page';
  if (media.deep) return 'book';
  return null;
}

/* mediaGlyphCode(media) → 0 (none) | 1 play | 2 frame | 3 page | 4 book — the number the GPU gets. */
export function mediaGlyphCode(media) {
  const g = mediaGlyph(media);
  return g ? MEDIA_GLYPHS.indexOf(g) + 1 : 0;
}

/* hasMedia(media) — the ONE definition of "badge this node". The renderer, the legend, the inspector
   and the ingest's own count all call this; none of them re-derives it (the anti-drift rule). */
export function hasMedia(media) {
  return !!(media && (media.figma || media.pdf || media.img || media.deep || media.interactive || media.launch));
}

/* indexNodes(spec) → Map<id, node> — the adjacency-building convenience the layout engine + renderer both
   want (look a node up by an edge's endpoint id). Does NOT validate — call validateGraphSpec first. */
export function indexNodes(spec) {
  const m = new Map();
  if (spec && Array.isArray(spec.nodes)) for (const n of spec.nodes) if (n && n.id) m.set(n.id, n);
  return m;
}
