/* graph-spec.test.mjs — headless (node --test, no GPU/DOM), mirroring scene-spec.test.mjs. GraphSpec v1 is a
   pure module; that decoupling is the point. Each test encodes the WHY, not just the WHAT (Rule 9). Run:
   `node --test projects/atlas/graph-spec.test.mjs` (wired into the root `npm test` glob on lift to engine-core). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGraphSpec, indexNodes, KINDS, RELS, GRAPH_SPEC_VERSION, heatFromAgeDays, HEAT_FLOOR } from './graph-spec.js';

const HUB = { id: 'hub', label: 'MEMORY', kind: 'hub' };
const A = { id: 'a', label: 'A', kind: 'live-ops', type: 'memory' };
const B = { id: 'b', label: 'B', kind: 'doctrine' };
const okSpec = () => ({ v: 1, nodes: [HUB, A, B], edges: [{ from: 'hub', to: 'a' }, { from: 'hub', to: 'b', rel: 'depends-on' }] });

test('a well-formed graph validates (hub + typed nodes + typed edges)', () => {
  const r = validateGraphSpec(okSpec());
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.unknownSections, []);
});

test('the empty graph is valid (v1, no nodes, no edges)', () => {
  assert.equal(validateGraphSpec({ v: 1, nodes: [], edges: [] }).ok, true);
});

test('v is required and version-locked — a v2 doc errors, never silently misparses', () => {
  // The scene-spec lesson: a wrong version is an ERROR, not a best-effort parse (that bred the drift class).
  assert.equal(validateGraphSpec({ nodes: [], edges: [] }).ok, false);           // missing v
  assert.equal(validateGraphSpec({ v: 2, nodes: [], edges: [] }).ok, false);     // future version
  assert.equal(validateGraphSpec({ v: '1', nodes: [], edges: [] }).ok, false);   // string, not the int
});

test('nodes/edges must be arrays; a non-object spec is rejected up front', () => {
  assert.equal(validateGraphSpec(null).ok, false);
  assert.equal(validateGraphSpec([]).ok, false);                                 // an array is not a spec
  assert.equal(validateGraphSpec({ v: 1, nodes: {}, edges: [] }).ok, false);
  assert.equal(validateGraphSpec({ v: 1, nodes: [], edges: 'x' }).ok, false);
});

test('DANGLING EDGE is an error — the real [[L08]] class (a link to a node that does not exist)', () => {
  // This is THE graph-specific check. The vault's office-dive note links [[L08]] with no L08.md → a phantom
  // node. A GraphSpec must catch that at validate time (fail loud), not paper over it at render time.
  const spec = { v: 1, nodes: [HUB, A], edges: [{ from: 'hub', to: 'L08' }] };
  const r = validateGraphSpec(spec);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /L08.*dangling|dangling.*L08/i, 'error must name the dangling endpoint');
  // and a well-formed spec with the SAME shape but a real target passes — proving the check is about
  // reference resolution, not the presence of edges (guards against a "just reject all edges" mutation).
  assert.equal(validateGraphSpec({ v: 1, nodes: [HUB, A], edges: [{ from: 'hub', to: 'a' }] }).ok, true);
});

test('duplicate node ids are rejected (ids index the adjacency — collisions corrupt it)', () => {
  const r = validateGraphSpec({ v: 1, nodes: [A, { id: 'a', kind: 'doctrine' }], edges: [] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /duplicate/i);
});

test('closed vocabularies are enforced; open ones are not', () => {
  // kind + rel are closed (color/cluster axis + typed edges) → bad values error.
  assert.equal(validateGraphSpec({ v: 1, nodes: [{ id: 'x', kind: 'bogus' }], edges: [] }).ok, false);
  assert.equal(validateGraphSpec({ v: 1, nodes: [HUB], edges: [{ from: 'hub', to: 'hub', rel: 'nope' }] }).ok, false);
  // type is OPEN (the semantic taxonomy is intentionally not frozen) → any string is fine.
  assert.equal(validateGraphSpec({ v: 1, nodes: [{ id: 'x', type: 'some-future-type' }], edges: [] }).ok, true);
});

test('unknown TOP-LEVEL sections are tolerated + surfaced (forward-compat, not rejected)', () => {
  const r = validateGraphSpec({ v: 1, nodes: [], edges: [], clusters: [{ id: 'c1' }], meta: { built: 'x' } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.unknownSections.sort(), ['clusters', 'meta']);
});

test('unknown PER-NODE keys are tolerated (a saved layout adds x/y/z; live-ops adds heat/state)', () => {
  // NOTE the graduation: 'state' was this test's unknown-key example from slice 1 — slice 13 made it a
  // VALIDATED key (FACE-1), exactly the "live-ops adds heat/state later" future this test predicted.
  const spec = { v: 1, nodes: [{ id: 'a', kind: 'live-ops', x: 1, y: 2, z: 3, heat: 0.7, state: 'working' }], edges: [] };
  assert.equal(validateGraphSpec(spec).ok, true);   // validated-if-known, ignored-if-unknown
});

test('indexNodes builds an id→node map for adjacency lookups', () => {
  const m = indexNodes(okSpec());
  assert.equal(m.size, 3);
  assert.equal(m.get('a').label, 'A');
  assert.equal(m.get('missing'), undefined);
});

/* --- ageDays: the recency field + the heat curve that reads it (VIZ SLICE 4) --- */

test('ageDays must be a non-negative finite number — a bad age is a data bug, not a render shrug', () => {
  // WHY: ageDays feeds an exp() that feeds an instance COLOR. A NaN here paints a black hole silently;
  // a negative age (clock skew, a file stamped in the future) would paint heat > 1 and bloom the whole ring.
  // Fail at validate time, on the snapshot machine, where a human can see it.
  assert.equal(validateGraphSpec({ v: 1, nodes: [{ id: 'a', ageDays: 3.2 }], edges: [] }).ok, true);
  assert.equal(validateGraphSpec({ v: 1, nodes: [{ id: 'a', ageDays: 0 }], edges: [] }).ok, true);
  assert.equal(validateGraphSpec({ v: 1, nodes: [{ id: 'a', ageDays: -1 }], edges: [] }).ok, false);
  assert.equal(validateGraphSpec({ v: 1, nodes: [{ id: 'a', ageDays: NaN }], edges: [] }).ok, false);
  assert.equal(validateGraphSpec({ v: 1, nodes: [{ id: 'a', ageDays: '3' }], edges: [] }).ok, false);
});

test('heat decays with age: a note edited now burns, a note left for a tau is dimmer, order never inverts', () => {
  // WHY THIS MATTERS: the whole "alive" premise is that BRIGHTNESS RANKS RECENCY. If the curve ever
  // non-monotonically ordered two notes, the graph would lie about which work is warm — the one claim
  // the visualization makes. Assert the ORDERING, not the arithmetic.
  const tau = 1.5;
  const ages = [0, 0.5, 1, 2, 4, 8];
  const heats = ages.map((a) => heatFromAgeDays(a, tau));
  assert.equal(heats[0], 1, 'a note edited this instant is at full heat');
  for (let i = 1; i < heats.length; i++) {
    assert.ok(heats[i] <= heats[i - 1], `heat must never rise with age (${ages[i]}d > ${ages[i - 1]}d)`);
  }
  // One tau of age = 1/e of the heat — the definition of the time-constant, not a magic number.
  assert.ok(Math.abs(heatFromAgeDays(tau, tau) - Math.exp(-1)) < 1e-12);
});

test('tau is a POLICY knob: the same note is hot under a slow vault and quiet under a fast one', () => {
  // WHY: engine-core must not bake one vault's editing cadence into the ability. atlas runs tau=1.5 because
  // 30 of its 45 notes share one bulk mtime; a slower archive wants the tau=7 default. Same age, both valid.
  const age = 3.82;                                  // the real bulk-mtime cluster in the LGR vault
  assert.ok(heatFromAgeDays(age, 7) > 0.5, 'under a 7-day tau this note still reads as recent');
  assert.ok(heatFromAgeDays(age, 1.5) < 0.1, 'under a 1.5-day tau the same note has gone quiet');
});

test('quiet means quiet: sub-floor heat snaps to exactly 0, and a missing age never glows', () => {
  // WHY: an 0.003 heat is not "off" — it still multiplies an instance color above the bloom threshold's
  // noise, leaving a permanently smudged halo on every ancient note. Old work must sit DARK.
  assert.equal(heatFromAgeDays(365, 1.5), 0);
  assert.ok(heatFromAgeDays(1e-9, 1.5) > HEAT_FLOOR);
  assert.equal(heatFromAgeDays(undefined, 1.5), 0, 'a node with no ageDays (hand-authored spec) is quiet, not NaN');
  assert.equal(heatFromAgeDays(3, 0), 0, 'a nonsensical tau yields quiet, never a divide-by-zero Infinity');
});

test('exported vocabularies are the v1 contract (KINDS grows ADDITIVELY within a version — see the vocab policy)', () => {
  assert.equal(GRAPH_SPEC_VERSION, 1);
  assert.deepEqual(KINDS, ['hub', 'live-ops', 'doctrine', 'initiative', 'learning', 'ops']);   // 'ops' added slice 13 (FACE-1)
  assert.deepEqual(RELS, ['links-to', 'depends-on', 'explains', 'built-by', 'derived-from']);
});

test("kind 'learning' validates (the docs/guides learning-module nodes)", () => {
  // Additive vocab growth: a learning node is a first-class citizen — validator, layout ring, and
  // color map all know it; this guards the validator half (a typo'd kind still fails).
  assert.equal(validateGraphSpec({ v: 1, nodes: [{ id: 'workers', kind: 'learning' }], edges: [] }).ok, true);
  assert.equal(validateGraphSpec({ v: 1, nodes: [{ id: 'x', kind: 'lernin' }], edges: [] }).ok, false);
});

test("'batch' is a validated known key (a non-boolean batch would silently skew the heat layer)", () => {
  assert.equal(validateGraphSpec({ v: 1, nodes: [{ id: 'a', batch: true }], edges: [] }).ok, true);
  assert.equal(validateGraphSpec({ v: 1, nodes: [{ id: 'a', batch: 'yes' }], edges: [] }).ok, false);
});
