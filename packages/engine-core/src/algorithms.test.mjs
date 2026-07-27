/* algorithms.test.mjs — VIZ SLICE 20. These tests exist because the lesson's CLAIM is a number: "bubble
   sort does n(n−1)/2 comparisons". If the instrumented implementation and the taught curve disagree, the
   chart draws a curve through dots that don't sit on it, and the lesson teaches a falsehood. So: the
   algorithm must be correct, the trace must be faithful to it, and the MEASURED work must match the
   TAUGHT complexity exactly. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTracer } from './tracer.js';
import { ALGORITHMS, bubbleSort, binarySearch, countOps, measureComplexity } from './algorithms.js';

test('bubbleSort: actually sorts (through the tracer seam)', () => {
  const t = createTracer([8, 3, 5, 1, 9, 2, 7, 4]);
  const { sorted } = bubbleSort(t);
  assert.deepEqual(sorted, [1, 2, 3, 4, 5, 7, 8, 9]);
  assert.deepEqual(t.getArray(), sorted, 'the tracer owns the array — its state IS the result');
});

test('bubbleSort: MEASURED comparisons == the TAUGHT curve n(n−1)/2 (the lesson is honest)', () => {
  for (const n of [2, 5, 8, 12]) {
    const input = Array.from({ length: n }, (_, i) => n - i);   // reversed: the worst case
    const t = createTracer(input);
    bubbleSort(t);
    const measured = countOps(t.getOps()).compare;
    const taught = ALGORITHMS['bubble-sort'].complexity.worst.fn(n);
    assert.equal(measured, taught, `n=${n}: the chart would draw dots off its own curve`);
  }
});

test('bubbleSort: the trace is FAITHFUL — replaying the ops reproduces the sort', () => {
  const t = createTracer([4, 1, 3, 2]);
  bubbleSort(t);
  const arr = [4, 1, 3, 2];
  for (const op of t.getOps()) {
    if (op.type === 'swap') { const tmp = arr[op.i]; arr[op.i] = arr[op.j]; arr[op.j] = tmp; }
  }
  assert.deepEqual(arr, t.getArray(), 'the op stream must be able to rebuild the final state');
});

test('binarySearch: finds the target, and misses honestly', () => {
  const data = [1, 3, 4, 7, 9, 11, 15, 22, 30, 41];
  const hit = createTracer(data);
  assert.equal(binarySearch(hit, { target: 22 }).found, 7);
  const miss = createTracer(data);
  assert.equal(binarySearch(miss, { target: 23 }).found, -1);
});

test('binarySearch: MEASURED reads stay within the taught ⌊log₂ n⌋+1 bound (the whole promise)', () => {
  for (const n of [8, 16, 64, 128]) {
    const data = Array.from({ length: n }, (_, i) => i * 2);
    const t = createTracer(data);
    binarySearch(t, { target: data[n - 1] });     // the deepest path
    const reads = countOps(t.getOps()).get;
    const bound = ALGORITHMS['binary-search'].complexity.worst.fn(n);
    assert.ok(reads <= bound, `n=${n}: ${reads} reads exceeded the taught bound ${bound}`);
    /* And the SPEEDUP must be real, which is the reason anyone learns this: reads grow like log₂ n while
       the linear scan grows like n. At n=8 that is 4 vs 8 (unimpressive — small inputs hide the point,
       which is itself worth teaching); by n=128 it is 8 vs 128. Assert the RATIO improves with n. */
    if (n >= 64) assert.ok(reads < n / 8, `n=${n}: ${reads} reads is not a convincing O(log n)`);
  }
});

test('countOps: counts work, and EXCLUDES the marks (an honest measurement excludes the instrument)', () => {
  const t = createTracer([2, 1]);
  bubbleSort(t);
  const c = countOps(t.getOps());
  assert.ok(c.mark > 0, 'bubble sort marks its settled cells (a teaching aid)');
  assert.equal(c.work, c.compare + c.get, 'work = the operations the complexity class counts');
  assert.ok(c.work < c.total, 'the marks are in total but NOT in work');
});

test('measureComplexity: deterministic dots that land ON the taught curve', () => {
  const sizes = [4, 8, 16];
  const dots = measureComplexity('bubble-sort', sizes, (n) => Array.from({ length: n }, (_, i) => n - i), createTracer);
  assert.equal(dots.length, 3);
  for (const { n, work } of dots) {
    assert.equal(work, ALGORITHMS['bubble-sort'].complexity.worst.fn(n));
  }
  // determinism: the same call twice gives the same dots (a chart that moves on reload teaches nothing)
  const again = measureComplexity('bubble-sort', sizes, (n) => Array.from({ length: n }, (_, i) => n - i), createTracer);
  assert.deepEqual(again, dots);
});

test('the registry is the curriculum seam: every algorithm has a runner, curves and source', () => {
  for (const [kind, spec] of Object.entries(ALGORITHMS)) {
    assert.equal(typeof spec.run, 'function', `${kind} must be runnable`);
    assert.ok(spec.source.length > 0, `${kind} must ship the source it teaches`);
    assert.ok(Object.keys(spec.complexity).length > 0, `${kind} must declare what it claims to cost`);
    for (const c of Object.values(spec.complexity)) {
      assert.ok(Number.isFinite(c.fn(10)), `${kind}'s curve must be a real function of n`);
    }
  }
});

/* ============================================================
   SLICE 21 — THE EFFICIENCY RACE. These tests guard the CLAIM the lesson makes, not the code path:
   merge and quick sort must actually sort, and their cost must GROW LIKE n log n, not like n². A sort
   that returns the right answer while doing quadratic work is a broken lesson even though every
   "does it sort?" test passes — so we measure the growth, which is the only thing a complexity class
   ever asserted.
   ============================================================ */
import { mergeSort, quickSort, raceAlgorithms, makeCaseInput, SORT_KINDS } from './algorithms.js';

const isSorted = (a) => a.every((v, i) => i === 0 || a[i - 1] <= v);

test('mergeSort + quickSort: they actually sort (random, reversed, sorted, duplicates, tiny)', () => {
  const cases = [
    [8, 3, 5, 1, 9, 2, 7, 4],
    [5, 4, 3, 2, 1],
    [1, 2, 3, 4, 5],
    [3, 3, 1, 3, 2, 1],
    [2, 1],
    [42],
    [],
  ];
  for (const input of cases) {
    for (const run of [mergeSort, quickSort]) {
      const t = createTracer(input);
      run(t);
      assert.ok(isSorted(t.getArray()), `${run.name} failed on [${input}] → [${t.getArray()}]`);
      assert.deepEqual(t.getArray().slice().sort((a, b) => a - b), t.getArray());
      assert.equal(t.getArray().length, input.length, 'a sort must not lose or invent elements');
    }
  }
});

test('mergeSort: the trace is FAITHFUL — the recorded op-stream rebuilds the sorted array', () => {
  const input = [8, 3, 5, 1, 9, 2, 7, 4];
  const t = createTracer(input);
  mergeSort(t);
  const arr = input.slice();
  for (const op of t.getOps()) {
    if (op.type === 'set') arr[op.i] = op.value;      // merge PLACES values (the slice-21 op)
    if (op.type === 'swap') { const x = arr[op.i]; arr[op.i] = arr[op.j]; arr[op.j] = x; }
  }
  assert.deepEqual(arr, t.getArray(), 'replaying the ops must reproduce the final state');
});

test('mergeSort + quickSort GROW LIKE n log n, not n² (the whole point of the lesson)', () => {
  /* The discriminator: bubble sort's comparisons QUADRUPLE when n doubles (n² → 4n²). An O(n log n)
     sort's roughly DOUBLE (a little more, because log grows too). So measure the growth ratio between
     n and 2n and demand it sits far below 4 — that is what "a different curve" means, numerically. */
  for (const kind of ['merge-sort', 'quick-sort']) {
    const spec = ALGORITHMS[kind];
    const cost = (n) => {
      const t = createTracer(makeCaseInput(n, 'random'));
      spec.run(t, {});
      return countOps(t.getOps()).compare;
    };
    const c128 = cost(128), c256 = cost(256);
    const ratio = c256 / c128;
    assert.ok(ratio < 3, `${kind}: doubling n multiplied the work by ${ratio.toFixed(2)} — that is quadratic behaviour`);
    assert.ok(ratio > 1.5, `${kind}: work barely grew (${ratio.toFixed(2)}) — the measurement is probably broken`);
    // and it must be DRAMATICALLY cheaper than bubble sort at the same size
    const bubble = (() => { const t = createTracer(makeCaseInput(256, 'random')); bubbleSort(t); return countOps(t.getOps()).compare; })();
    assert.ok(c256 < bubble / 5, `${kind}: ${c256} comparisons vs bubble's ${bubble} — the race has no winner`);
  }
});

test('quickSort: the WORST case is real — sorted input under a naive pivot degrades to quadratic', () => {
  // This is the nuance the lesson teaches, and it must be TRUE of our implementation or the lesson lies.
  const n = 64;
  const sortedIn = createTracer(makeCaseInput(n, 'sorted'));
  quickSort(sortedIn);
  const worst = countOps(sortedIn.getOps()).compare;
  const randomIn = createTracer(makeCaseInput(n, 'random'));
  quickSort(randomIn);
  const avg = countOps(randomIn.getOps()).compare;
  assert.equal(worst, (n * (n - 1)) / 2, 'sorted input must hit the exact n(n−1)/2 worst case');
  assert.ok(worst > avg * 3, `worst (${worst}) should dwarf average (${avg}) — that IS the lesson`);
});

test('raceAlgorithms: pure, deterministic, and the race RESOLVES the right way', () => {
  const a = raceAlgorithms({ createTracerFn: createTracer });
  const b = raceAlgorithms({ createTracerFn: createTracer });
  assert.deepEqual(a, b, 'a seeded race must give the same chart on every machine and every reload');
  assert.equal(a.measured.length, SORT_KINDS.length);
  assert.equal(a.reference.length, 2, 'both reference curves (n²/2 and n·log₂n) must be drawn');

  const at = (kind) => a.measured.find((m) => m.kind === kind).points;
  const last = (pts) => pts[pts.length - 1].y;
  // The payoff, asserted: at the largest n, bubble sort must sit ABOVE both n-log-n sorts.
  assert.ok(last(at('bubble-sort')) > last(at('merge-sort')) * 5,
    'bubble sort must visibly peel away above merge sort — if not, the chart tells the wrong story');
  assert.ok(last(at('bubble-sort')) > last(at('quick-sort')) * 5);
  for (const m of a.measured) {
    assert.ok(m.points.every((p) => Number.isFinite(p.y) && p.y > 0), `${m.kind} produced a non-finite cost`);
  }
});

test('makeCaseInput: the case FAMILIES are what they claim (the input is half the lesson)', () => {
  assert.deepEqual(makeCaseInput(5, 'sorted'), [1, 2, 3, 4, 5]);
  assert.deepEqual(makeCaseInput(5, 'reversed'), [5, 4, 3, 2, 1]);
  const r1 = makeCaseInput(16, 'random'), r2 = makeCaseInput(16, 'random');
  assert.deepEqual(r1, r2, 'seeded: the same input every time');
  assert.notDeepEqual(r1, makeCaseInput(16, 'sorted'), 'random must actually be shuffled');
  assert.deepEqual(r1.slice().sort((a, b) => a - b), makeCaseInput(16, 'sorted'), 'a shuffle is a permutation');
});
