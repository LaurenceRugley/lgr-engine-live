/* graph-layout.test.mjs — headless (node --test). createGraphLayout is a pure transform; each test encodes
   the WHY (Rule 9). Run: `node --test projects/atlas/graph-layout.test.mjs`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGraphLayout, DEFAULT_RINGS } from './graph-layout.js';

const spec = () => ({
  v: 1,
  nodes: [
    { id: 'hub', kind: 'hub' },
    { id: 'lo1', kind: 'live-ops' }, { id: 'lo2', kind: 'live-ops' },
    { id: 'd1', kind: 'doctrine' },
    { id: 'weird' },   // no kind → fallback ring
  ],
  edges: [],
});

const radius = (p) => Math.hypot(p.x, p.z);

test('hub lands exactly at the origin', () => {
  const pos = createGraphLayout(spec());
  assert.deepEqual(pos.get('hub'), { x: 0, y: 0, z: 0 });
});

test('nodes sit on the ring radius for their kind', () => {
  const pos = createGraphLayout(spec());
  assert.ok(Math.abs(radius(pos.get('lo1')) - DEFAULT_RINGS['live-ops']) < 1e-9);
  assert.ok(Math.abs(radius(pos.get('d1'))  - DEFAULT_RINGS['doctrine']) < 1e-9);
});

test('a kind-less node is PLACED on the fallback ring, never dropped', () => {
  // A layout must position every node it's handed — silently dropping one would desync the render/pick indices.
  const pos = createGraphLayout(spec());
  assert.ok(pos.has('weird'));
  assert.ok(radius(pos.get('weird')) > DEFAULT_RINGS['initiative']);   // beyond the known rings
});

test('every node gets a position; the map size equals the node count', () => {
  const s = spec();
  assert.equal(createGraphLayout(s).size, s.nodes.length);
});

test('layout is DETERMINISTIC — same spec → byte-identical positions (the stable-layout requirement)', () => {
  // The live graph must not reshuffle when re-laid-out; two runs must match exactly (no RNG, no Date).
  const a = createGraphLayout(spec());
  const b = createGraphLayout(spec());
  for (const [id, p] of a) assert.deepEqual(b.get(id), p, `mismatch for ${id}`);
});

test('order-independence — shuffling the input node order yields the SAME positions (sorted by id)', () => {
  const s1 = spec();
  const s2 = spec(); s2.nodes.reverse();
  const a = createGraphLayout(s1), b = createGraphLayout(s2);
  for (const [id, p] of a) assert.deepEqual(b.get(id), p, `mismatch for ${id} after reorder`);
});

test('two nodes on the same ring are spread apart (not stacked)', () => {
  const pos = createGraphLayout(spec());
  const p1 = pos.get('lo1'), p2 = pos.get('lo2');
  assert.ok(Math.hypot(p1.x - p2.x, p1.z - p2.z) > 1e-6, 'same-ring nodes must not coincide');
});

test('the empty graph yields an empty layout', () => {
  assert.equal(createGraphLayout({ v: 1, nodes: [], edges: [] }).size, 0);
});

test('an unknown layout kind throws (v1 supports only radial)', () => {
  assert.throws(() => createGraphLayout(spec(), { kind: 'force' }), /unknown layout kind/);
});

test('custom ring radii are honored', () => {
  const pos = createGraphLayout(spec(), { rings: { 'live-ops': 100 } });
  assert.ok(Math.abs(radius(pos.get('lo1')) - 100) < 1e-9);
});

test('opts.fallbackRadius overrides the untagged-node ring (a consumer with a different world scale sizes the halo directly, instead of post-hoc scaling positions)', () => {
  const pos = createGraphLayout(spec(), { fallbackRadius: 5 });
  assert.ok(Math.abs(radius(pos.get('weird')) - 5) < 1e-9);
  // default is unchanged when the option is omitted (back-compat)
  const posDefault = createGraphLayout(spec());
  assert.ok(radius(posDefault.get('weird')) > DEFAULT_RINGS['initiative']);
});
