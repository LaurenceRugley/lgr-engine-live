/* ============================================================
   graph-clusters.js — VIZ SLICE 24: SEMANTIC ZOOM. The pure math behind "structure when you're far,
   detail when you're close".
   ------------------------------------------------------------
   THE PROBLEM THIS SOLVES, honestly stated. Slice 23 quieted the resting web as far as it can go, and
   the finding it ended on was structural: a pixel-mode ribbon is either above DB32's black floor or it is
   gone — there is no "faintly visible". So the remaining lever on a busy graph is not FAINTER edges, it
   is FEWER THINGS. That is what semantic zoom is: at a distance you do not draw 78 nodes and 335 links,
   you draw the six things a person can actually hold in their head, and you let them get closer.

   Everything here is PURE — no THREE, no DOM, no camera. It turns (spec, positions, zoom) into "what
   should be visible", and `node --test` can assert every part of that. The renderer's job is only to obey.

   THE GROUPING IS A PROVIDER, ON PURPOSE. We start with `kind` — the grouping the vault already has, that
   the rings already lay out and the legend already explains. But `clusterBy` takes a keyOf() function, so
   a future community-detection pass (graphology-louvain was floated in DESIGN) can replace the grouping
   without touching the renderer, the transitions, or these tests. Nothing downstream knows what a "kind"
   is; it only knows that nodes have cluster keys.

   C++ anchor: a `std::unordered_map<Key, std::vector<NodeId>>` built in one pass, plus a reduction over
   it — the classic group-by/aggregate pair, kept pure so it can be tested without a renderer in scope.
   ============================================================ */

/* clusterBy(spec, keyOf) → [{ key, id, memberIds, count }] — DETERMINISTIC: clusters come out sorted by
   key, members sorted by id, so the same spec always yields the same summary nodes in the same order
   (the same reproducibility rule the layout holds). A node whose key is null/undefined is UNCLUSTERED and
   is returned separately — it must not silently vanish from the graph. */
export function clusterBy(spec, keyOf = (n) => n.kind) {
  const nodes = (spec && Array.isArray(spec.nodes)) ? spec.nodes : [];
  const buckets = new Map();
  const unclustered = [];
  for (const n of nodes) {
    if (!n || !n.id) continue;
    const key = keyOf(n);
    if (key == null || key === '') { unclustered.push(n.id); continue; }
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(n.id);
  }
  const clusters = [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, memberIds]) => ({
      key,
      id: `cluster:${key}`,          // the summary node's id — namespaced so it can never collide with a note
      memberIds: memberIds.slice().sort(),
      count: memberIds.length,
    }));
  return { clusters, unclustered: unclustered.slice().sort() };
}

/* clusterIndex(clusters) → Map<memberId, clusterKey> — the reverse lookup the edge aggregator needs. */
export function clusterIndex(clusters) {
  const m = new Map();
  for (const c of clusters) for (const id of c.memberIds) m.set(id, c.key);
  return m;
}

/* clusterOfNode(id, clusters) → the cluster a node belongs to (or null).
   clusterMembersOf(id, clusters) → the FULL member list of that node's cluster, including itself.
   ------------------------------------------------------------
   THE SPOTLIGHT'S DATA (slice 27). Clicking a node has always lit its immediate NEIGHBOURHOOD — the nodes
   it links to. That answers "what does this touch?", which is a different question from "what SECTION am I
   in?". A section is a cluster, and its members are related by MEANING, not by adjacency: two doctrine
   notes that never link to each other are still both doctrine. So the spotlight resolves the cluster, not
   the neighbourhood — and that is why this lives beside the clustering rather than in the renderer. */
export function clusterOfNode(id, clusters) {
  for (const c of clusters) if (c.memberIds.includes(id)) return c;
  return null;
}

export function clusterMembersOf(id, clusters) {
  /* A SUMMARY node is its own cluster's stand-in: clicking "doctrine · 14" from orbit must spotlight the
     same fourteen notes that clicking one of them does. One function, both entry points. */
  const direct = clusters.find((c) => c.id === id);
  if (direct) return direct.memberIds.slice();
  const c = clusterOfNode(id, clusters);
  return c ? c.memberIds.slice() : [];
}

/* clusterCentroids(clusters, positions, { mode }) → Map<clusterId, {x,y,z}>
   Where a summary node SITS. Derived from its members, never authored: the members own the one shared
   layout (slice 18's rule) and the summary follows them home.

   TWO MODES, AND THE SECOND ONE EXISTS BECAUSE OF A REAL FAILURE:
     'mean'  — the plain Cartesian centroid. Correct for a blob-shaped cluster.
     'polar' — mean DIRECTION and mean RADIUS. Correct for a RING.
   The atlas's kind clusters are concentric rings around the hub (that IS the layout), and the Cartesian
   centroid of a ring is its CENTRE — so every summary collapsed onto the hub, in a pile. Caught on the
   first overview capture. A polar centroid puts each summary out on its own ring, at the angular middle
   of its members, which is where a person would point if you asked them where "doctrine" is.

   Direction is averaged as UNIT VECTORS (not angles): averaging 350° and 10° in degrees gives 180°, the
   exact opposite of the right answer — the classic circular-mean bug. */
export function clusterCentroids(clusters, positions, { mode = 'mean' } = {}) {
  const out = new Map();
  for (const c of clusters) {
    let x = 0, z = 0, ux = 0, uz = 0, r = 0, n = 0;
    for (const id of c.memberIds) {
      const p = positions.get(id);
      if (!p) continue;
      x += p.x; z += p.z; n++;
      const len = Math.hypot(p.x, p.z);
      r += len;
      if (len > 1e-9) { ux += p.x / len; uz += p.z / len; }
    }
    if (!n) { out.set(c.id, { x: 0, y: 0, z: 0 }); continue; }
    if (mode !== 'polar') { out.set(c.id, { x: x / n, y: 0, z: z / n }); continue; }
    const meanR = r / n;
    const dirLen = Math.hypot(ux, uz);
    // A cluster whose members surround the origin evenly has NO meaningful direction (dirLen ≈ 0) —
    // the hub is exactly that. Leave it at the centre, which is the honest answer for it.
    if (dirLen < 1e-6) { out.set(c.id, { x: x / n, y: 0, z: z / n }); continue; }
    out.set(c.id, { x: (ux / dirLen) * meanR, y: 0, z: (uz / dirLen) * meanR });
  }
  return out;
}

/* ---- summaryLayout (VIZ SLICE 25) — where the COLLAPSED clusters actually go -------------------------
   THE DEFECT THIS FIXES, precisely: slice 24 placed each summary at its members' centroid. But the kinds
   are CONCENTRIC RINGS around the hub, so every cluster's centroid is (near) the same point — the seven
   summaries piled up in the middle. Slice 24's `polar` mode pulled them off the centre but not off each
   other: a polar centroid still lands where the members happen to average, which for overlapping rings is
   a cramped huddle. The overview is a MAP, and a map needs its landmarks separated.

   THE FIX IS TO STOP DERIVING AND START AUTHORING. The collapsed view is its own picture, and it gets its
   own deterministic layout: the hub at the centre (it is the thing everything hangs off), the rest on a
   ring around it, ordered stably, with the RING RADIUS SOLVED from the discs' own sizes so they cannot
   overlap. Members are untouched — they keep the one shared layout that gate BA guards. Only the
   collapsed summaries move, and only while collapsed.

   THE SOLVE: n discs of radius r_i, evenly spaced on a ring of radius R, have angular half-width
   asin(r_i / R). They fit iff the sum of (their angular widths + a gap) is <= 2π. Rather than invert that
   transcendental mess, we take the two constraints that actually bind and use the larger:
     · NEIGHBOURS must not touch: R >= (r_i + r_j + gap) / (2 sin(π/n)) for the worst adjacent pair.
     · The RING must clear the hub: R >= r_hub + max(r_i) + gap.
   Both are closed-form, both are exact, and the test asserts the result: no two discs overlap. */
export function summaryLayout(clusters, radiusOf, { hubKey = 'hub', gap = 0.6, order = null } = {}) {
  const hub = clusters.find((c) => c.key === hubKey) || null;
  const ring = clusters.filter((c) => c !== hub);
  /* Stable order: by the caller's list if given (so the ring reads in the legend's order), else by key.
     Determinism is not decoration — a map whose landmarks move between reloads is not a map. */
  const seq = order
    ? ring.slice().sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
    : ring.slice().sort((a, b) => (a.key < b.key ? -1 : 1));

  const out = new Map();
  const n = seq.length;
  if (hub) out.set(hub.id, { x: 0, y: 0, z: 0 });
  if (n === 0) return out;

  const rOf = (c) => Math.max(radiusOf(c) || 0, 1e-6);
  const rHub = hub ? rOf(hub) : 0;
  const rMax = Math.max(...seq.map(rOf));

  // constraint 1: the worst ADJACENT pair on the ring must not touch
  let needNeighbour = 0;
  const sinStep = Math.sin(Math.PI / Math.max(n, 2));
  for (let i = 0; i < n; i++) {
    const a = rOf(seq[i]), b = rOf(seq[(i + 1) % n]);
    needNeighbour = Math.max(needNeighbour, (a + b + gap) / (2 * sinStep));
  }
  // constraint 2: the ring must clear the hub sitting at the centre
  const needHub = rHub + rMax + gap;

  const R = Math.max(needNeighbour, needHub);
  seq.forEach((c, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;   // start at the top: a map should have a north
    out.set(c.id, { x: Math.cos(a) * R, y: 0, z: Math.sin(a) * R });
  });
  return out;
}

/* aggregateEdges(spec, clusters) → [{ from, to, weight }] between CLUSTER ids.
   One edge per cluster PAIR, weight = how many real links it stands for. Intra-cluster links are counted
   separately (they are the cluster's internal density — not drawn at overview zoom, but worth having) and
   an edge to an unclustered node is dropped from the aggregate (it has no cluster to land on).
   Undirected for aggregation: A→B and B→A are the same bundle, because at overview zoom the question is
   "are these two groups connected, and how strongly", not "which way". */
export function aggregateEdges(spec, clusters) {
  const idx = clusterIndex(clusters);
  const pairs = new Map();
  const internal = new Map();
  for (const c of clusters) internal.set(c.key, 0);
  for (const e of (spec && Array.isArray(spec.edges) ? spec.edges : [])) {
    if (!e) continue;
    const a = idx.get(e.from), b = idx.get(e.to);
    if (a == null || b == null) continue;                 // an endpoint outside every cluster
    if (a === b) { internal.set(a, (internal.get(a) || 0) + 1); continue; }
    const k = a < b ? `${a} ${b}` : `${b} ${a}`;   // order-independent key
    pairs.set(k, (pairs.get(k) || 0) + 1);
  }
  const edges = [...pairs.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))       // deterministic order
    .map(([k, weight]) => {
      const [a, b] = k.split(' ');
      return { from: `cluster:${a}`, to: `cluster:${b}`, weight, rel: 'links-to' };
    });
  return { edges, internal };
}

/* summarySpec(spec, clusters, opts) → a GraphSpec of the summary nodes + aggregated edges.
   The summary node carries: the cluster's kind (so it paints in the kind colour the legend already
   explains), its member count (so the renderer can size it), an aggregate `media` (a cluster containing
   material announces it — you can see from orbit that there is something worth landing for), and the
   member list (so the inspector can offer them). */
export function summarySpec(spec, clusters, { hasMedia = () => false, worstState = null } = {}) {
  const byId = new Map((spec.nodes || []).map((n) => [n.id, n]));
  const { edges } = aggregateEdges(spec, clusters);
  const nodes = clusters.map((c) => {
    const members = c.memberIds.map((id) => byId.get(id)).filter(Boolean);
    const withMedia = members.filter((m) => hasMedia(m.media));
    // The aggregate media: the union of what its members carry (the glyph priority then picks one).
    const media = withMedia.length
      ? withMedia.reduce((acc, m) => {
        for (const k of ['interactive', 'figma', 'pdf', 'img', 'deep']) if (m.media[k]) acc[k] = true;
        return acc;
      }, {})
      : undefined;
    /* THE SUMMARY'S STATE (cockpit slice 1): a cluster whose members carry health wears the WORST of
       them. "Are my sites ok?" must be answerable from ORBIT — a green summary over a dead site is the
       single worst thing a cockpit can do, so the rule is worst-not-average, and it is the caller's
       worstState() (one definition, in graph-spec) that decides. */
    const states = members.map((m) => m.state).filter(Boolean);
    const state = worstState && states.length ? worstState(states) : undefined;
    return {
      id: c.id,
      label: `${c.key} · ${c.count}`,
      kind: c.key,                       // paints in the kind colour — the legend needs no new line
      count: c.count,
      memberIds: c.memberIds,
      mediaCount: withMedia.length,
      ...(media ? { media } : {}),
      ...(state ? { state } : {}),
    };
  });
  return { v: 1, nodes, edges };
}

/* ---- THE ZOOM POLICY (with hysteresis) ------------------------------------------------------------
   zoomState(zoom, prev, opts) → 'overview' | 'focus' | 'detail'
     overview  far out — summaries only. The graph is six things and how they connect.
     focus     the middle band — ONE cluster (the one you are over) is opened; the rest stay summarised.
     detail    close in — every member, every real edge (the pre-24 graph).

   HYSTERESIS is not a nicety, it is the difference between a map and a strobe light. With a single
   threshold, a zoom that lands exactly on it (or a camera that drifts a hair) flips the entire graph
   between two very different pictures, repeatedly. So each boundary is a BAND: you must cross further to
   change state than you did to enter it, and the state only moves one step at a time. `prev` is the state
   we are in; passing an unknown prev is treated as "decide fresh". */
/* THE BANDS ARE AUTHORED AROUND THE APP'S BOOT ZOOM, and that is not a detail — it is the difference
   between "the graph you know, until you pull back" and "the graph is mysteriously half-collapsed when it
   loads". The atlas boots at zoom 9; the first cut put detail below 6.5, so BOOT ITSELF landed in the
   focus band and twenty existing gates went red at once. Detail must cover the boot view. */
export const ZOOM_DEFAULTS = Object.freeze({
  detailIn: 10.5,    // zoom BELOW this (closer) → detail. Boot (9) sits comfortably inside it.
  detailOut: 11.8,   // ...and you must go back ABOVE this to leave detail (the hysteresis band)
  overviewIn: 15.0,  // zoom ABOVE this (further) → overview: structure only
  overviewOut: 13.5, // ...and you must come back BELOW this to leave overview
});

export function zoomState(zoom, prev = null, opts = {}) {
  const { detailIn, detailOut, overviewIn, overviewOut } = { ...ZOOM_DEFAULTS, ...opts };
  if (prev === 'detail') return zoom > detailOut ? (zoom >= overviewIn ? 'overview' : 'focus') : 'detail';
  if (prev === 'overview') return zoom < overviewOut ? (zoom <= detailIn ? 'detail' : 'focus') : 'overview';
  // from 'focus' (or cold): the outer bands are the entry conditions
  if (zoom <= detailIn) return 'detail';
  if (zoom >= overviewIn) return 'overview';
  return 'focus';
}

/* nearestCluster(centroids, target) → clusterId — which cluster the camera is over (the one that opens in
   the focus band). Plain nearest-centroid on the graph plane; ties broken by id so it is deterministic. */
export function nearestCluster(centroids, target = { x: 0, z: 0 }) {
  let best = null, bd = Infinity;
  for (const [id, p] of [...centroids.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const d = (p.x - target.x) ** 2 + (p.z - target.z) ** 2;
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

/* visibleSet({ state, clusters, centroids, target }) → { members: Set<id>, summaries: Set<clusterId>, expanded: [keys] }
   THE ONE FUNCTION the renderer obeys. Everything above feeds it; nothing below it makes a decision.
     overview → no members, every summary
     focus    → the members of the nearest cluster, summaries of all the others
     detail   → every member, no summaries */
export function visibleSet({ state, clusters, centroids, target }) {
  const members = new Set();
  const summaries = new Set();
  const expanded = [];
  if (state === 'detail') {
    for (const c of clusters) { expanded.push(c.key); for (const id of c.memberIds) members.add(id); }
    return { members, summaries, expanded };
  }
  if (state === 'overview') {
    for (const c of clusters) summaries.add(c.id);
    return { members, summaries, expanded };
  }
  const openId = nearestCluster(centroids, target);
  for (const c of clusters) {
    if (c.id === openId) { expanded.push(c.key); for (const id of c.memberIds) members.add(id); }
    else summaries.add(c.id);
  }
  return { members, summaries, expanded };
}
