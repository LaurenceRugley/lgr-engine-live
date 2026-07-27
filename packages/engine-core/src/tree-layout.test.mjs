/* tree-layout.test.mjs — CURRICULUM T2. The layout is the ability the whole data-structures track will
   reuse, so its guarantees have to be structural, not eyeballed: a parent centred over its children, no
   two nodes ever on top of each other, and the same tree drawing the same way every time. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treeLayout, treeEdges, treeDepth } from './tree-layout.js';
import { bstFromKeys, bstInOrder, bstInsert, bstContains, bstSearchCost, balancedKeys, degenerateKeys, measureBST, traceBST, STRUCTURES } from './data-structures.js';
import { createTracer } from './tracer.js';

const tree = (key, left = null, right = null) => ({ key, left, right });

test('treeLayout: a parent sits CENTRED over its children', () => {
  const t = tree(1, tree(2), tree(3));
  const { positions } = treeLayout(t);
  const p = positions.get(t), l = positions.get(t.left), r = positions.get(t.right);
  assert.equal(p.x, (l.x + r.x) / 2, 'the parent must be the mean of its children');
  assert.equal(p.y, 0);
  assert.equal(l.y, r.y, 'siblings share a layer');
  assert.ok(l.y > p.y, 'children hang below');
});

test('treeLayout: NO TWO NODES OVERLAP — sibling subtrees own disjoint leaf ranges', () => {
  const t = bstFromKeys([50, 30, 70, 20, 40, 60, 80, 35, 45, 65]);
  const { positions } = treeLayout(t);
  const pts = [...positions.values()];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const same = Math.abs(pts[i].x - pts[j].x) < 1e-9 && Math.abs(pts[i].y - pts[j].y) < 1e-9;
      assert.ok(!same, `two nodes landed on the same point (${pts[i].x}, ${pts[i].y})`);
    }
  }
  // and no two nodes on the SAME LAYER share an x (the stronger claim: a layer reads left-to-right)
  const byLayer = new Map();
  for (const p of pts) {
    if (!byLayer.has(p.y)) byLayer.set(p.y, []);
    byLayer.get(p.y).push(p.x);
  }
  for (const [y, xs] of byLayer) {
    assert.equal(new Set(xs).size, xs.length, `layer ${y} has two nodes at the same x`);
  }
});

test('treeLayout: DETERMINISTIC — the same tree draws the same way, every reload', () => {
  const keys = [50, 30, 70, 20, 40];
  const a = treeLayout(bstFromKeys(keys));
  const b = treeLayout(bstFromKeys(keys));
  assert.deepEqual([...a.positions.values()], [...b.positions.values()]);
});

test('treeLayout: a DEGENERATE tree is a staircase — depth n−1, and the layout shows it', () => {
  const t = bstFromKeys([1, 2, 3, 4, 5]);           // sorted input: every node hangs right
  const L = treeLayout(t);
  assert.equal(L.depth, 4, 'five sorted keys make a 5-deep chain (depth 4)');
  assert.equal(treeDepth(t), 4);
  assert.equal(treeEdges(t).length, 4, 'a chain has n−1 edges');
});

test('treeLayout: degenerate inputs do not throw', () => {
  assert.equal(treeLayout(null).positions.size, 0);
  const single = treeLayout(tree(7));
  assert.deepEqual(single.positions.get(single.order[0]), { x: 0, y: 0, depth: 0 });
  assert.equal(treeDepth(null), -1);
});

/* ---- the STRUCTURE itself ---- */

test('BST: the INVARIANT holds — an in-order walk comes out sorted (that IS the definition)', () => {
  for (const keys of [[50, 30, 70, 20, 40, 60, 80], [1, 2, 3], [3, 2, 1], [5, 5, 5], []]) {
    const t = bstFromKeys(keys);
    const walked = bstInOrder(t);
    assert.deepEqual(walked, [...new Set(keys)].sort((a, b) => a - b),
      `in-order walk of [${keys}] must be sorted and de-duplicated`);
  }
});

test('BST: search finds what is there and honestly misses what is not', () => {
  const t = bstFromKeys([50, 30, 70, 20, 40, 60, 80]);
  for (const k of [50, 20, 80, 40]) assert.equal(bstContains(t, k), true, `${k} should be found`);
  for (const k of [55, 0, 100]) assert.equal(bstContains(t, k), false, `${k} should NOT be found`);
  assert.equal(bstContains(null, 1), false, 'searching an empty tree is a miss, not a crash');
});

test('BST: duplicates are IGNORED — it is a set, not a multiset (and the code says which)', () => {
  let t = bstFromKeys([5, 5, 5, 3, 5]);
  assert.deepEqual(bstInOrder(t), [3, 5]);
  t = bstInsert(t, 3);
  assert.deepEqual(bstInOrder(t), [3, 5], 'inserting an existing key changes nothing');
});

test('BST: BALANCE IS THE WHOLE LESSON — the same keys, a different order, 100× the work', () => {
  const n = 128;
  const balanced = bstFromKeys(balancedKeys(n));
  const degenerate = bstFromKeys(degenerateKeys(n));
  // same contents...
  assert.deepEqual(bstInOrder(balanced), bstInOrder(degenerate), 'the two trees hold exactly the same keys');
  // ...wildly different cost
  const cB = bstSearchCost(balanced, n), cD = bstSearchCost(degenerate, n);
  assert.ok(cB <= Math.floor(Math.log2(n)) + 1, `balanced search took ${cB}, expected ≤ log₂(${n})+1`);
  assert.equal(cD, n, 'a sorted insert order makes a linked list: n comparisons');
  assert.ok(cD > cB * 10, `the degenerate tree must be DRAMATICALLY worse (${cD} vs ${cB})`);
});

test('measureBST: deterministic, and the three curves say what the lesson claims', () => {
  const m = measureBST([16, 64, 256]);
  assert.deepEqual(m, measureBST([16, 64, 256]), 'a chart that moves on reload teaches nothing');
  for (let i = 0; i < m.sizes.length; i++) {
    const n = m.sizes[i];
    assert.ok(m.balanced[i].y <= Math.floor(Math.log2(n)) + 1, 'balanced tracks log n');
    assert.equal(m.degenerate[i].y, n, 'degenerate tracks n');
    assert.equal(m.linear[i].y, n, 'and a linear scan is the same n — a degenerate tree buys you NOTHING');
  }
});

test('traceBST: the op-stream is well-formed and FAITHFUL (marks + compares, a real found/miss)', () => {
  const t = createTracer([]);
  const { root, found } = traceBST(t, { inserts: [50, 30, 70, 20], target: 20 });
  const ops = t.getOps();
  assert.equal(found, true);
  assert.ok(ops.length > 8, 'building and searching records real work');
  assert.ok(ops.some((o) => o.type === 'mark' && o.state === 'insert'), 'inserts are marked');
  assert.ok(ops.some((o) => o.type === 'mark' && o.state === 'found'), 'the hit is marked');
  assert.ok(ops.every((o) => o.type === 'mark' || o.type === 'compare'), 'a tree records only marks and comparisons');
  assert.deepEqual(bstInOrder(root), [20, 30, 50, 70], 'the traced build produced a REAL bst');

  const t2 = createTracer([]);
  const r2 = traceBST(t2, { inserts: [50, 30, 70], target: 55 });
  assert.equal(r2.found, false);
  assert.ok(t2.getOps().some((o) => o.type === 'mark' && o.state === 'miss'),
    'a miss must be RECORDED — a step-through that ends in silence teaches that the algorithm got confused');
});

test('the STRUCTURES registry mirrors ALGORITHMS (a lesson declares itself the same way either way)', () => {
  const s = STRUCTURES['binary-search-tree'];
  assert.equal(typeof s.run, 'function');
  assert.equal(s.panel, 'tree', 'the panel field is what tells the reader which painter to mount');
  assert.ok(s.source.length > 0);
  assert.ok(Number.isFinite(s.complexity.balanced.fn(64)) && Number.isFinite(s.complexity.worst.fn(64)));
});

/* ============================================================
   T2 BITE 2 — THE BINARY HEAP. The invariant is the whole structure, so every test checks the STRUCTURE
   after the operation, not just the return value: an operation that gives the right answer while
   corrupting the heap is the worst kind of bug — it works until it doesn't.
   ============================================================ */
import { heapIsValid, heapPush, heapPop, traceHeap, heapSortCost } from './data-structures.js';
import { heapSort, ALGORITHMS, countOps, raceAlgorithms, makeCaseInput, SORT_KINDS } from './algorithms.js';

test('heap: the INVARIANT (parent ≤ both children) holds after EVERY push', () => {
  const arr = [];
  for (const k of [42, 17, 63, 8, 29, 55, 11, 1, 99, 3]) {
    heapPush(arr, k);
    assert.ok(heapIsValid(arr), `the invariant broke after pushing ${k}: [${arr}]`);
    assert.equal(arr[0], Math.min(...arr), 'the root must always BE the minimum — that is the whole promise');
  }
});

test('heap: extract-min returns ASCENDING, and the invariant survives every pop', () => {
  const keys = [42, 17, 63, 8, 29, 55, 11];
  const arr = [];
  for (const k of keys) heapPush(arr, k);
  const out = [];
  while (arr.length) {
    out.push(heapPop(arr));
    assert.ok(heapIsValid(arr), `the invariant broke after a pop: [${arr}]`);
  }
  assert.deepEqual(out, keys.slice().sort((a, b) => a - b),
    'pulling the minimum repeatedly IS a sort — which is exactly what heap sort is');
});

test('heap: a heap is NOT sorted — the weaker invariant is the point', () => {
  /* This is the misconception worth killing on sight. A heap only promises parent ≤ children; siblings
     are in NO order at all, so you cannot binary-search it. It buys O(1) minimum, and pays for it by
     knowing nothing else. */
  const arr = [];
  for (const k of [5, 3, 8, 1, 9, 2]) heapPush(arr, k);
  assert.ok(heapIsValid(arr));
  const sorted = arr.slice().sort((a, b) => a - b);
  assert.notDeepEqual(arr, sorted, 'a valid heap is (almost never) a sorted array — and it does not claim to be');
});

test('heap: degenerate inputs do not throw', () => {
  assert.equal(heapPop([]), undefined, 'popping an empty heap is undefined, not a crash');
  const one = [];
  heapPush(one, 7);
  assert.equal(heapPop(one), 7);
  assert.equal(one.length, 0);
});

test('traceHeap: the instrumented heap builds a REAL heap and the op-stream is faithful', () => {
  const keys = [42, 17, 63, 8, 29];
  const t = createTracer(new Array(keys.length).fill(null));
  const { popped } = traceHeap(t, { inserts: keys, extracts: 2 });
  assert.deepEqual(popped, [8, 17], 'extract-min pulls the two smallest, in order');
  // replay the ops onto a fresh array — the trace must reproduce the structure it claims
  const arr = new Array(keys.length).fill(null);
  for (const op of t.getOps()) {
    if (op.type === 'set') arr[op.i] = op.value;
    if (op.type === 'swap') { const x = arr[op.i]; arr[op.i] = arr[op.j]; arr[op.j] = x; }
  }
  assert.deepEqual(arr, t.getArray(), 'replaying the op-stream must reproduce the final array');
  const live = t.getArray().filter((v) => v != null);
  assert.ok(heapIsValid(live), 'what remains after the extracts is still a valid heap');
});

/* ---- HEAP SORT: where T2 meets T1 ---- */

test('heapSort: it actually sorts (through the tracer seam)', () => {
  for (const input of [[8, 3, 5, 1, 9, 2, 7, 4], [5, 4, 3, 2, 1], [1, 2, 3], [2, 2, 1], [42], []]) {
    const t = createTracer(input);
    heapSort(t);
    assert.deepEqual(t.getArray(), input.slice().sort((a, b) => a - b), `failed on [${input}]`);
  }
});

test('heapSort: it GROWS like n log n — and unlike quicksort it has NO bad day', () => {
  const cost = (keys) => { const t = createTracer(keys); heapSort(t); return countOps(t.getOps()).compare; };
  const c128 = cost(makeCaseInput(128, 'random')), c256 = cost(makeCaseInput(256, 'random'));
  const ratio = c256 / c128;
  assert.ok(ratio < 3, `doubling n multiplied the work by ${ratio.toFixed(2)} — that is quadratic behaviour`);
  /* THE PROPERTY THAT MAKES IT WORTH KNOWING: quicksort collapses to n² on SORTED input. Heap sort does
     not care what order the data arrived in — its worst case IS its average case, which is why introsort
     bails out into it. */
  const sortedCost = cost(makeCaseInput(256, 'sorted'));
  const randomCost = cost(makeCaseInput(256, 'random'));
  assert.ok(sortedCost < randomCost * 1.5,
    `sorted input must NOT punish heap sort (${sortedCost} vs ${randomCost}) — that is its whole selling point`);
  const quickOnSorted = (() => {
    const t = createTracer(makeCaseInput(256, 'sorted'));
    ALGORITHMS['quick-sort'].run(t, {});
    return countOps(t.getOps()).compare;
  })();
  assert.ok(sortedCost < quickOnSorted / 5,
    `on sorted input heap sort (${sortedCost}) must dwarf quicksort's collapse (${quickOnSorted})`);
});

test('the RACE now has FOUR sorts, and heap-sort runs with merge/quick — not with bubble', () => {
  assert.deepEqual(SORT_KINDS, ['bubble-sort', 'merge-sort', 'quick-sort', 'heap-sort']);
  const race = raceAlgorithms({ createTracerFn: createTracer });
  assert.equal(race.measured.length, 4);
  const last = (kind) => {
    const pts = race.measured.find((m) => m.kind === kind).points;
    return pts[pts.length - 1].y;
  };
  assert.ok(last('heap-sort') < last('bubble-sort') / 5,
    'heap sort must peel away from bubble sort, like the other n-log-n sorts');
  assert.ok(last('heap-sort') < last('merge-sort') * 3,
    'and it must sit in the same class as merge sort, not somewhere in between');
});
