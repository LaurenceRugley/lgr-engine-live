/* graph-spec.test.mjs — headless (node --test, no GPU/DOM), mirroring scene-spec.test.mjs. GraphSpec v1 is a
   pure module; that decoupling is the point. Each test encodes the WHY, not just the WHAT (Rule 9). Run:
   `node --test projects/atlas/graph-spec.test.mjs` (wired into the root `npm test` glob on lift to engine-core). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGraphSpec, indexNodes, KINDS, RELS, GRAPH_SPEC_VERSION, heatFromAgeDays, HEAT_FLOOR, classifyMedia, hasMedia, DEEP_CHARS, ALGORITHM_KINDS, classifyHealth, worstState, mediaGlyph, mediaGlyphCode } from './graph-spec.js';

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
  assert.deepEqual(KINDS, ['hub', 'live-ops', 'doctrine', 'initiative', 'learning', 'ops', 'site']);   // 'site' joined in the cockpit slice (additive growth, as the policy allows)   // 'ops' added slice 13 (FACE-1)
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

/* ============================================================
   SLICE 19 — MEDIA RICHNESS. The badge exists to answer "which nodes carry real material?" at a
   glance, so these tests encode WHY the classifier is shaped this way: it must fire on real media
   (figma/pdf), it must NOT fire on a stub (that is the whole signal), and DEEP_CHARS must be a
   threshold a corpus can move — a badge that fires on 92% of the graph tells the eye nothing (which
   is exactly what 1200 chars did to this vault; measured, then raised to 5000).
   ============================================================ */
test('classifyMedia: figma assets badge the node', () => {
  const m = classifyMedia({ id: 'a', figmaAssets: [{ path: 'figma/x.png', name: 'Hero' }] });
  assert.equal(m.figma, true);
  assert.equal(hasMedia(m), true);
});

test('classifyMedia: a pdf asset badges; an unknown asset type does not', () => {
  assert.equal(classifyMedia({ assets: [{ type: 'pdf', path: 'a.pdf' }] }).pdf, true);
  assert.equal(hasMedia(classifyMedia({ assets: [{ type: 'zip', path: 'a.zip' }] })), false);
});

test('classifyMedia: a STUB does not badge — the signal only means something if it can be absent', () => {
  const m = classifyMedia({ id: 'stub', content: '# Title\n\nA one-line pointer note.\n' });
  assert.deepEqual(m, { figma: false, pdf: false, img: false, deep: false, interactive: false, launch: false });
  assert.equal(hasMedia(m), false);
});

test('classifyMedia: DEEP_CHARS is the policy knob (a corpus can move the bar)', () => {
  const node = { content: 'x'.repeat(2000) };
  assert.equal(classifyMedia(node).deep, false, '2000 chars is not deep at the shipped 5000 bar');
  assert.equal(classifyMedia(node, { deepChars: 1200 }).deep, true, 'a one-liner vault can lower it');
  assert.equal(classifyMedia({ content: 'x'.repeat(DEEP_CHARS) }).deep, true, 'the bar is inclusive');
});

test('classifyMedia: garbage in → false out, never a throw (the snapshot must not break the render)', () => {
  for (const bad of [null, undefined, {}, { assets: 'nope' }, { figmaAssets: {} }, { content: 42 }]) {
    assert.equal(hasMedia(classifyMedia(bad)), false);
  }
});

test('validateGraphSpec: a malformed media key fails LOUD (on the studio machine, not in the browser)', () => {
  const ok = validateGraphSpec({ v: 1, nodes: [{ id: 'a', media: { figma: true, deep: false } }], edges: [] });
  assert.equal(ok.ok, true);
  const bad = validateGraphSpec({ v: 1, nodes: [{ id: 'a', media: { figma: 'yes' } }], edges: [] });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /media\.figma must be a boolean/);
});

test('ALGORITHM_KINDS never drifts from the runnable registry (a lesson must not promise what we cannot run)', async () => {
  // graph-spec keeps a PLAIN LIST so it stays headless-pure; algorithms.js owns the implementations.
  // The two are allowed to live apart — they are NOT allowed to disagree, which is what this asserts.
  const { ALGORITHMS } = await import('./algorithms.js');
  assert.deepEqual([...ALGORITHM_KINDS].sort(), Object.keys(ALGORITHMS).sort());
});

test('validateGraphSpec: an algorithm node with an UNRUNNABLE kind fails loud', () => {
  const ok = validateGraphSpec({ v: 1, nodes: [{ id: 'a', algorithm: { kind: 'bubble-sort', input: [3, 1] } }], edges: [] });
  assert.equal(ok.ok, true);
  const bad = validateGraphSpec({ v: 1, nodes: [{ id: 'a', algorithm: { kind: 'quicksort' } }], edges: [] });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /not runnable/);
});

/* ============================================================
   COCKPIT SLICE 1 — classifyHealth. A monitoring classifier is the one place where being "roughly right"
   is worthless: the whole value is that you can TRUST the colour. So the tests pin every boundary, and
   the one that matters most is the last: a machine that could not check must never report DOWN.
   ============================================================ */
test('classifyHealth: a fast 2xx is GREEN', () => {
  assert.equal(classifyHealth({ checked: true, httpCode: 200, responseMs: 300 }), 'green');
  assert.equal(classifyHealth({ checked: true, httpCode: 204, responseMs: 10 }), 'green');
});

test('classifyHealth: a redirect is still up (a 301 to https is how half the web works)', () => {
  assert.equal(classifyHealth({ checked: true, httpCode: 301, responseMs: 120 }), 'green');
  assert.equal(classifyHealth({ checked: true, httpCode: 308, responseMs: 120 }), 'green');
});

test('classifyHealth: a SLOW 2xx is WORKING (amber) — "up" is not the same as "fine"', () => {
  assert.equal(classifyHealth({ checked: true, httpCode: 200, responseMs: 1501 }), 'working');
  assert.equal(classifyHealth({ checked: true, httpCode: 200, responseMs: 1499 }), 'green', 'the boundary is inclusive of fast');
  // the threshold is a POLICY the consumer owns, not a fact about HTTP
  assert.equal(classifyHealth({ checked: true, httpCode: 200, responseMs: 600 }, { slowMs: 500 }), 'working');
});

test('classifyHealth: 4xx and 5xx are RED — the page is not being served', () => {
  for (const code of [400, 403, 404, 500, 502, 503]) {
    assert.equal(classifyHealth({ checked: true, httpCode: code, responseMs: 50 }), 'red', `HTTP ${code}`);
  }
});

test('classifyHealth: a timeout or a connection error is RED (unreachable IS down, from a customer\'s chair)', () => {
  assert.equal(classifyHealth({ checked: true, timedOut: true, responseMs: 8000 }), 'red');
  assert.equal(classifyHealth({ checked: true, error: 'ENOTFOUND', httpCode: null }), 'red');
});

test('classifyHealth: NOT CHECKED is UNKNOWN, never red — the lie this classifier exists to prevent', () => {
  /* A build machine with no network is not evidence that the owner's estate is down. A dashboard that
     paints "my wifi is off" as a red outage teaches you to ignore red — which is the only way a
     dashboard can truly fail. */
  assert.equal(classifyHealth({ checked: false, offline: true }), 'unknown');
  assert.equal(classifyHealth(null), 'unknown');
  assert.equal(classifyHealth({}), 'unknown');
  assert.equal(classifyHealth({ checked: true, httpCode: 'nonsense' }), 'unknown');
});

test('worstState: a summary wears the WORST of its members (not the average)', () => {
  assert.equal(worstState(['green', 'green', 'red']), 'red', 'one site down means the estate is not ok');
  assert.equal(worstState(['green', 'working']), 'working');
  assert.equal(worstState(['green', 'green']), 'green');
  // "unknown" outranks green: not knowing is a weaker claim than knowing it is fine
  assert.equal(worstState(['green', 'unknown']), 'unknown');
  assert.equal(worstState([]), 'unknown');
});

test('launch: a runnable node validates; a broken one fails LOUD (a button that goes nowhere is worse than none)', () => {
  const ok = validateGraphSpec({ v: 1, nodes: [{ id: 'a', launch: { url: 'http://localhost:5173/?world=1', label: 'Sculpt a world' } }], edges: [] });
  assert.equal(ok.ok, true);
  for (const bad of [{ url: 'x' }, { label: 'y' }, { url: '', label: 'y' }, 'nope']) {
    const r = validateGraphSpec({ v: 1, nodes: [{ id: 'a', launch: bad }], edges: [] });
    assert.equal(r.ok, false, `launch ${JSON.stringify(bad)} should not validate`);
  }
});

test('mediaGlyph: ROCKET outranks everything — running a thing beats reading about it', () => {
  assert.equal(mediaGlyph({ launch: true, interactive: true, deep: true }), 'rocket');
  assert.equal(mediaGlyph({ interactive: true, deep: true }), 'play');
  assert.equal(mediaGlyph({ deep: true }), 'book');
  assert.equal(mediaGlyphCode({ launch: true }), 1, 'the shader branches on this number — 1 is the rocket');
  assert.equal(hasMedia(classifyMedia({ launch: { url: 'http://x', label: 'go' } })), true);
});
