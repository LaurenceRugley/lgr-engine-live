/* graph-clusters.test.mjs — VIZ SLICE 24. Semantic zoom is a POLICY, and a policy you cannot test is a
   policy you cannot trust. These assert the three things that would silently corrupt the map:
   the grouping (a node must never vanish), the aggregation (an edge bundle must count what it stands
   for), and the hysteresis (without it, a camera that drifts a hair strobes the whole graph). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clusterBy, clusterIndex, clusterCentroids, aggregateEdges, summarySpec,
  zoomState, nearestCluster, visibleSet, ZOOM_DEFAULTS,
} from './graph-clusters.js';

const SPEC = {
  v: 1,
  nodes: [
    { id: 'h', kind: 'hub' },
    { id: 'd1', kind: 'doctrine' }, { id: 'd2', kind: 'doctrine' }, { id: 'd3', kind: 'doctrine' },
    { id: 'l1', kind: 'learning' }, { id: 'l2', kind: 'learning' },
    { id: 'x' },                                   // no kind: UNCLUSTERED — must not disappear
  ],
  edges: [
    { from: 'd1', to: 'd2' },                      // internal to doctrine
    { from: 'd1', to: 'h' }, { from: 'd2', to: 'h' },   // doctrine ↔ hub  (weight 2)
    { from: 'l1', to: 'h' },                       // learning ↔ hub  (weight 1)
    { from: 'l1', to: 'd3' },                      // learning ↔ doctrine (weight 1)
    { from: 'x', to: 'h' },                        // an unclustered endpoint — dropped from the aggregate
  ],
};
const POS = new Map([
  ['h', { x: 0, y: 0, z: 0 }],
  ['d1', { x: 2, y: 0, z: 0 }], ['d2', { x: 4, y: 0, z: 0 }], ['d3', { x: 6, y: 0, z: 0 }],
  ['l1', { x: 0, y: 0, z: 10 }], ['l2', { x: 0, y: 0, z: 12 }],
  ['x', { x: -9, y: 0, z: 0 }],
]);

test('clusterBy: groups by kind, deterministically, and LOSES NOBODY', () => {
  const { clusters, unclustered } = clusterBy(SPEC);
  assert.deepEqual(clusters.map((c) => c.key), ['doctrine', 'hub', 'learning']);   // sorted
  assert.deepEqual(clusters.find((c) => c.key === 'doctrine').memberIds, ['d1', 'd2', 'd3']);
  assert.equal(clusters.find((c) => c.key === 'learning').count, 2);
  assert.deepEqual(unclustered, ['x'], 'a node with no kind must be REPORTED, not silently dropped');
  const total = clusters.reduce((s, c) => s + c.count, 0) + unclustered.length;
  assert.equal(total, SPEC.nodes.length, 'every node must land somewhere');
  assert.deepEqual(clusterBy(SPEC), clusterBy(SPEC), 'same spec → same clusters, always');
});

test('clusterBy: the grouping is a PROVIDER — a future community detection swaps in without a rewrite', () => {
  const { clusters } = clusterBy(SPEC, (n) => (n.id.startsWith('d') ? 'left' : 'right'));
  assert.deepEqual(clusters.map((c) => c.key), ['left', 'right']);
  assert.equal(clusters[0].count, 3);
});

test('clusterCentroids: a summary sits at the MEAN of its members (derived, never authored)', () => {
  const { clusters } = clusterBy(SPEC);
  const cen = clusterCentroids(clusters, POS);
  assert.deepEqual(cen.get('cluster:doctrine'), { x: 4, y: 0, z: 0 });   // (2+4+6)/3
  assert.deepEqual(cen.get('cluster:learning'), { x: 0, y: 0, z: 11 });
});

test('aggregateEdges: one bundle per cluster PAIR, weight = the links it stands for', () => {
  const { clusters } = clusterBy(SPEC);
  const { edges, internal } = aggregateEdges(SPEC, clusters);
  const w = (a, b) => edges.find((e) =>
    (e.from === `cluster:${a}` && e.to === `cluster:${b}`) || (e.from === `cluster:${b}` && e.to === `cluster:${a}`))?.weight;
  assert.equal(w('doctrine', 'hub'), 2, 'two real links became one bundle of weight 2');
  assert.equal(w('learning', 'hub'), 1);
  assert.equal(w('learning', 'doctrine'), 1);
  assert.equal(internal.get('doctrine'), 1, 'an intra-cluster link is internal density, not a bundle');
  assert.equal(edges.length, 3, 'the unclustered endpoint contributes NO aggregate edge');
  // undirected: A→B and B→A are one bundle, not two
  const flipped = aggregateEdges({ ...SPEC, edges: SPEC.edges.map((e) => ({ from: e.to, to: e.from })) }, clusters);
  assert.equal(flipped.edges.length, 3);
});

test('summarySpec: summaries carry kind, count, members — and the AGGREGATE material', () => {
  const spec = {
    v: 1,
    nodes: [
      { id: 'a', kind: 'learning', media: { interactive: true } },
      { id: 'b', kind: 'learning' },
      { id: 'c', kind: 'doctrine' },
    ],
    edges: [{ from: 'a', to: 'c' }],
  };
  const { clusters } = clusterBy(spec);
  const s = summarySpec(spec, clusters, { hasMedia: (m) => !!m });
  const learn = s.nodes.find((n) => n.id === 'cluster:learning');
  assert.equal(learn.kind, 'learning', 'the summary paints in the kind colour the legend already explains');
  assert.equal(learn.count, 2);
  assert.equal(learn.label, 'learning · 2');
  assert.equal(learn.media.interactive, true, 'you can see from orbit that there is material worth landing for');
  assert.equal(learn.mediaCount, 1);
  assert.equal(s.edges.length, 1);
});

test('zoomState: HYSTERESIS — a camera drifting on the boundary must not strobe the whole graph', () => {
  const { detailIn, detailOut, overviewIn, overviewOut } = ZOOM_DEFAULTS;
  // entering detail requires crossing detailIn; LEAVING it requires going back past detailOut
  assert.equal(zoomState(detailIn - 0.1, 'focus'), 'detail');
  assert.equal(zoomState(detailIn + 0.5, 'detail'), 'detail', 'a hair past the entry must NOT flip it back');
  assert.equal(zoomState(detailOut + 0.1, 'detail'), 'focus', 'you must cross the far side of the band to leave');
  // same on the overview side
  assert.equal(zoomState(overviewIn + 0.1, 'focus'), 'overview');
  assert.equal(zoomState(overviewIn - 0.5, 'overview'), 'overview');
  assert.equal(zoomState(overviewOut - 0.1, 'overview'), 'focus');
  // and the pathological case the band exists for: jitter around a single number changes nothing
  let s = 'detail';
  for (const z of [detailIn, detailIn + 0.05, detailIn - 0.05, detailIn + 0.02, detailIn - 0.02]) {
    s = zoomState(z, s);
    assert.equal(s, 'detail', `jitter at the boundary flipped the state (z=${z})`);
  }
});

test('zoomState: a cold start decides fresh — and BOOT (zoom 9) must land in DETAIL', () => {
  assert.equal(zoomState(3, null), 'detail');
  assert.equal(zoomState(20, null), 'overview');
  /* The atlas boots at zoom 9. If that lands anywhere but 'detail', the app opens half-collapsed — which
     is exactly what the first threshold set did (and twenty gates went red at once). This assertion is
     the contract between the policy and the app's boot view. */
  assert.equal(zoomState(9, null), 'detail');
  assert.equal(zoomState(12.5, null), 'focus');
});

test('nearestCluster + visibleSet: focus opens the one you are over, and NOTHING else', () => {
  const { clusters } = clusterBy(SPEC);
  const cen = clusterCentroids(clusters, POS);
  assert.equal(nearestCluster(cen, { x: 0, z: 11 }), 'cluster:learning');
  const v = visibleSet({ state: 'focus', clusters, centroids: cen, target: { x: 0, z: 11 } });
  assert.deepEqual([...v.members].sort(), ['l1', 'l2'], 'only the opened cluster shows members');
  assert.deepEqual([...v.summaries].sort(), ['cluster:doctrine', 'cluster:hub'], 'the rest stay summarised');
  assert.deepEqual(v.expanded, ['learning']);
});

test('visibleSet: overview = summaries only; detail = members only (never both)', () => {
  const { clusters } = clusterBy(SPEC);
  const cen = clusterCentroids(clusters, POS);
  const o = visibleSet({ state: 'overview', clusters, centroids: cen, target: { x: 0, z: 0 } });
  assert.equal(o.members.size, 0);
  assert.equal(o.summaries.size, 3);
  const d = visibleSet({ state: 'detail', clusters, centroids: cen, target: { x: 0, z: 0 } });
  assert.equal(d.summaries.size, 0);
  assert.equal(d.members.size, 6, 'every clustered node is visible in detail');
});

test('clusterCentroids POLAR: a RING-shaped cluster does not collapse onto the hub', () => {
  /* The failure this mode exists for: the atlas lays kinds out as concentric rings, and the Cartesian
     centroid of a ring is its CENTRE — so every summary piled onto the hub (seen on the first overview
     capture). A polar centroid sits out on the ring, at the angular middle of its members. */
  const ring = { key: 'r', id: 'cluster:r', memberIds: ['a', 'b', 'c'], count: 3 };
  const pos = new Map([
    ['a', { x: 5, y: 0, z: 0 }],
    ['b', { x: 0, y: 0, z: 5 }],
    ['c', { x: 3.54, y: 0, z: 3.54 }],   // the arc between them
  ]);
  const mean = clusterCentroids([ring], pos).get('cluster:r');
  const polar = clusterCentroids([ring], pos, { mode: 'polar' }).get('cluster:r');
  assert.ok(Math.hypot(polar.x, polar.z) > Math.hypot(mean.x, mean.z),
    'the polar centroid must sit further out than the Cartesian one (which pulls toward the centre)');
  assert.ok(Math.abs(Math.hypot(polar.x, polar.z) - 5) < 0.1, 'it sits ON the ring (radius ≈ 5)');
  assert.ok(polar.x > 0 && polar.z > 0, 'and in the direction its members actually lie');
});

test('clusterCentroids POLAR: the circular-mean trap — 350° and 10° average to 0°, not 180°', () => {
  const c = { key: 'c', id: 'cluster:c', memberIds: ['a', 'b'], count: 2 };
  const rad = (deg) => (deg * Math.PI) / 180;
  const pos = new Map([
    ['a', { x: Math.cos(rad(350)) * 4, y: 0, z: Math.sin(rad(350)) * 4 }],
    ['b', { x: Math.cos(rad(10)) * 4, y: 0, z: Math.sin(rad(10)) * 4 }],
  ]);
  const p = clusterCentroids([c], pos, { mode: 'polar' }).get('cluster:c');
  assert.ok(p.x > 3.5, `averaging the ANGLES would put this at 180° (x ≈ -4); got x=${p.x.toFixed(2)}`);
  assert.ok(Math.abs(p.z) < 0.01);
});

test('clusterCentroids POLAR: a cluster that surrounds the origin (the hub) stays at the centre', () => {
  const c = { key: 'hub', id: 'cluster:hub', memberIds: ['n', 's', 'e', 'w'], count: 4 };
  const pos = new Map([
    ['n', { x: 0, y: 0, z: 3 }], ['s', { x: 0, y: 0, z: -3 }],
    ['e', { x: 3, y: 0, z: 0 }], ['w', { x: -3, y: 0, z: 0 }],
  ]);
  const p = clusterCentroids([c], pos, { mode: 'polar' }).get('cluster:hub');
  assert.ok(Math.hypot(p.x, p.z) < 0.01, 'no meaningful direction → the honest answer is the centre');
});

/* ============================================================
   SLICE 25 — summaryLayout. The overview is a MAP, and the one thing a map may not do is pile its
   landmarks on top of each other. These tests assert exactly the defect that shipped in slice 24:
   given each summary's real radius, NO TWO MAY OVERLAP — and the answer must be the same every reload.
   ============================================================ */
import { summaryLayout } from './graph-clusters.js';

const mkClusters = (spec) => Object.entries(spec).map(([key, count]) => ({
  key, id: `cluster:${key}`, count, memberIds: Array.from({ length: count }, (_, i) => `${key}${i}`),
}));
// the atlas's real sizing rule: area-proportional (sqrt of the member count)
const RADIUS = (c) => 0.42 * Math.sqrt(Math.max(c.count, 1));

test('summaryLayout: NO TWO SUMMARIES OVERLAP — the defect slice 24 shipped', () => {
  const clusters = mkClusters({ hub: 1, doctrine: 14, initiative: 16, learning: 20, 'live-ops': 5, ops: 5, untagged: 17 });
  const pos = summaryLayout(clusters, RADIUS);
  assert.equal(pos.size, clusters.length, 'every cluster must be placed');
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const a = clusters[i], b = clusters[j];
      const pa = pos.get(a.id), pb = pos.get(b.id);
      const d = Math.hypot(pa.x - pb.x, pa.z - pb.z);
      const need = RADIUS(a) + RADIUS(b);
      assert.ok(d >= need, `${a.key} and ${b.key} overlap: distance ${d.toFixed(2)} < r+r ${need.toFixed(2)}`);
    }
  }
});

test('summaryLayout: the hub sits at the centre, the rest ring around it', () => {
  const clusters = mkClusters({ hub: 1, a: 4, b: 9, c: 16 });
  const pos = summaryLayout(clusters, RADIUS);
  assert.deepEqual(pos.get('cluster:hub'), { x: 0, y: 0, z: 0 });
  const radii = ['a', 'b', 'c'].map((k) => {
    const p = pos.get(`cluster:${k}`);
    return Math.hypot(p.x, p.z);
  });
  assert.ok(radii.every((r) => r > 0.5), 'the ring must actually be a ring');
  assert.ok(Math.max(...radii) - Math.min(...radii) < 1e-9, 'and they share one radius (an even ring)');
});

test('summaryLayout: the ring CLEARS the hub even when the hub is the biggest disc', () => {
  const clusters = mkClusters({ hub: 100, a: 1, b: 1, c: 1 });   // a fat hub, tiny satellites
  const pos = summaryLayout(clusters, RADIUS);
  for (const k of ['a', 'b', 'c']) {
    const p = pos.get(`cluster:${k}`);
    const d = Math.hypot(p.x, p.z);
    assert.ok(d >= RADIUS({ count: 100 }) + RADIUS({ count: 1 }),
      `${k} is buried inside the hub (d=${d.toFixed(2)})`);
  }
});

test('summaryLayout: DETERMINISTIC — the same clusters give the same map, every reload', () => {
  const clusters = mkClusters({ hub: 1, doctrine: 14, learning: 20, ops: 5 });
  const a = summaryLayout(clusters, RADIUS);
  const b = summaryLayout(clusters.slice().reverse(), RADIUS);   // input order must not matter
  for (const [id, p] of a) {
    assert.deepEqual(b.get(id), p, `${id} moved when the input order changed`);
  }
});

test('summaryLayout: a caller-supplied order controls the ring (the legend order reads round the map)', () => {
  const clusters = mkClusters({ hub: 1, z: 4, a: 4, m: 4 });
  const pos = summaryLayout(clusters, RADIUS, { order: ['z', 'm', 'a'] });
  const ang = (k) => { const p = pos.get(`cluster:${k}`); return Math.atan2(p.z, p.x); };
  // first in the order starts at the top (-π/2), and they proceed clockwise in the given sequence
  assert.ok(Math.abs(ang('z') + Math.PI / 2) < 1e-9, 'the first entry starts at the top');
  assert.notEqual(ang('m'), ang('a'));
});

test('summaryLayout: degenerate inputs do not throw (one cluster, no hub, empty)', () => {
  assert.equal(summaryLayout([], RADIUS).size, 0);
  const oneHub = summaryLayout(mkClusters({ hub: 3 }), RADIUS);
  assert.deepEqual(oneHub.get('cluster:hub'), { x: 0, y: 0, z: 0 });
  const noHub = summaryLayout(mkClusters({ a: 3, b: 3 }), RADIUS);
  assert.equal(noHub.size, 2);
  const pa = noHub.get('cluster:a'), pb = noHub.get('cluster:b');
  assert.ok(Math.hypot(pa.x - pb.x, pa.z - pb.z) >= 2 * RADIUS({ count: 3 }), 'two clusters still separate');
});

test('summarySpec: a cluster wears the WORST member state — a green summary over a dead site is the worst lie a cockpit can tell', async () => {
  const { worstState } = await import('./graph-spec.js');
  const spec = {
    v: 1,
    nodes: [
      { id: 's1', kind: 'site', state: 'green' },
      { id: 's2', kind: 'site', state: 'red' },      // one is DOWN
      { id: 'd1', kind: 'doctrine' },
    ],
    edges: [],
  };
  const { clusters } = clusterBy(spec);
  const s = summarySpec(spec, clusters, { worstState });
  assert.equal(s.nodes.find((n) => n.id === 'cluster:site').state, 'red',
    'from orbit, one dead site must turn the whole cluster red');
  assert.equal(s.nodes.find((n) => n.id === 'cluster:doctrine').state, undefined,
    'a cluster with no health carries no state (it must not invent one)');
});

/* ============================================================
   SLICE 27 — the SPOTLIGHT's data. The whole feature rests on one claim: given anything you can click,
   name the section it belongs to, COMPLETELY. A spotlight that misses a member is worse than none — it
   quietly tells you a note is not part of a section it IS part of.
   ============================================================ */
import { clusterOfNode, clusterMembersOf } from './graph-clusters.js';

test('clusterMembersOf: a MEMBER lights its whole section — including siblings it never links to', () => {
  const { clusters } = clusterBy(SPEC);
  const members = clusterMembersOf('d1', clusters);
  assert.deepEqual(members.sort(), ['d1', 'd2', 'd3'],
    'd3 links to nothing in doctrine, but it IS doctrine — adjacency is not membership');
});

test('clusterMembersOf: a SUMMARY lights the same section its members do (one function, two entry points)', () => {
  const { clusters } = clusterBy(SPEC);
  assert.deepEqual(clusterMembersOf('cluster:doctrine', clusters).sort(), clusterMembersOf('d2', clusters).sort());
});

test('clusterMembersOf: an unknown or unclustered id lights NOTHING (never a partial lie)', () => {
  const { clusters } = clusterBy(SPEC);
  assert.deepEqual(clusterMembersOf('nope', clusters), []);
  assert.deepEqual(clusterMembersOf('x', clusters), [], 'x has no kind — it belongs to no section');
});

test('clusterOfNode: the section is complete — every node in the spec resolves to its own cluster', () => {
  const { clusters, unclustered } = clusterBy(SPEC);
  for (const n of SPEC.nodes) {
    const c = clusterOfNode(n.id, clusters);
    if (unclustered.includes(n.id)) { assert.equal(c, null); continue; }
    assert.ok(c, `${n.id} resolved to no cluster`);
    assert.ok(c.memberIds.includes(n.id), `${n.id} is not in the cluster it resolved to`);
    assert.equal(c.key, n.kind);
  }
});
