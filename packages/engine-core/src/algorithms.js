/* ============================================================
   algorithms.js — VIZ SLICE 20: the ALGORITHM LIBRARY. One instrumented implementation per algorithm,
   shared by every consumer that wants to SHOW it (projects/tracer's WebGL cell field, the atlas reader's
   DOM step panel, and whatever the cockpit builds next).
   ------------------------------------------------------------
   WHY THESE LIVE IN THE ENGINE. The tracer had bubble sort written inline in its main.js — which meant
   the atlas could not step through the same algorithm without COPYING it, and a copy is a lie waiting to
   happen (fix the sort in one place, the other lesson teaches the old one). The instrumented algorithm IS
   the teaching artifact; it belongs in the core beside the tracer that records it.

   THE CONTRACT: an algorithm is a pure function of (tracer, opts). It reads and writes ONLY through the
   tracer's seam (t.compare / t.get / t.swap / t.mark), so the recorded op-stream cannot diverge from what
   actually executed (tracer.js's structural-faithfulness rule). It returns a small result object.

   COMPLEXITY, HONESTLY. Each algorithm ships a `complexity` descriptor: the closed-form curve(s) we
   TEACH (best/average/worst) as functions of n, so a chart can draw them — and the op-counter below
   measures what the run ACTUALLY did. Drawing the theory and plotting the measurement on the same axes
   is the whole pedagogical point: the curve is a claim, the dots are evidence, and a student should be
   able to see them agree (or not).

   C++ anchor: `template <class It> void bubble_sort(It first, It last)` — the algorithm is generic over
   the ACCESS SEAM, not over the container. Here the tracer IS the iterator: every read and write goes
   through it, which is exactly how you'd instrument a C++ algorithm without touching its logic.
   ============================================================ */

/* countOps(ops) → { compare, swap, get, total, … } — the MEASUREMENT half of the lesson. Pure over the
   recorded stream, so it is node-testable and never guesses: it counts what the algorithm did. */
export function countOps(ops) {
  const out = { compare: 0, swap: 0, get: 0, set: 0, mark: 0, edgeVisit: 0, total: 0 };   // set: slice 21 (merge PLACES values)
  for (const op of ops || []) {
    if (op && typeof op.type === 'string') {
      if (out[op.type] !== undefined) out[op.type]++;
      out.total++;
    }
  }
  // The "work" a complexity class actually counts: comparisons + element reads. Marks are bookkeeping
  // for the VISUALIZATION (they exist to paint state), so counting them would inflate the measurement
  // with our own teaching aid — an honest measurement excludes the instrument.
  out.work = out.compare + out.get;
  return out;
}

/* ---- BUBBLE SORT ---------------------------------------------------------------------------------
   The classic O(n²): repeatedly walk the array, swapping any pair that is out of order. After pass k the
   k largest elements have BUBBLED to the end (hence the name), so each pass can stop one element earlier.
   We keep the naive form (no early-exit on a clean pass) because it is the one the O(n²) curve describes:
   n(n-1)/2 comparisons, always. The early-exit variant is a great exercise — and a different curve. */
export function bubbleSort(tracer, { n = tracer.getArray().length } = {}) {
  for (let pass = 0; pass < n - 1; pass++) {
    for (let i = 0; i < n - 1 - pass; i++) {
      // compare() RETURNS arr[i] < arr[i+1] — the branch below consumes the same boolean the trace
      // recorded, so the recording cannot drift from the execution.
      if (!tracer.compare(i, i + 1)) tracer.swap(i, i + 1);
    }
    tracer.mark(n - 1 - pass, 'done');   // the element that just bubbled into its final place
  }
  if (n > 0) tracer.mark(0, 'done');
  return { sorted: tracer.getArray() };
}

/* ---- BINARY SEARCH -------------------------------------------------------------------------------
   The classic O(log n): halve the search window each step. It REQUIRES a sorted input — that precondition
   is the price of the speed, and it is why "sort once, search many" is a real engineering strategy.
   Instrumented with get() (it reads values, it never swaps), and mark() to paint the live window. */
export function binarySearch(tracer, { target } = {}) {
  const n = tracer.getArray().length;
  let lo = 0, hi = n - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;          // >>1 is /2 floored — the same trick C++ writes as lo + (hi-lo)/2
    tracer.mark(mid, 'frontier');        // the element under examination
    const v = tracer.get(mid);           // the read the algorithm actually performs
    if (v === target) { tracer.mark(mid, 'done'); found = mid; break; }
    if (v < target) {
      for (let k = lo; k <= mid; k++) tracer.mark(k, 'visited');   // the half we just DISCARDED
      lo = mid + 1;
    } else {
      for (let k = mid; k <= hi; k++) tracer.mark(k, 'visited');
      hi = mid - 1;
    }
  }
  return { found, target };
}


/* ---- MERGE SORT ---------------------------------------------------------------------------------
   The first algorithm most people meet that is genuinely CLEVER, and the cleanest example of
   divide-and-conquer: split the array in half, sort each half (by the same method — that is the
   recursion), then MERGE the two sorted halves by repeatedly taking whichever front element is smaller.

   The merge is the whole trick, and it is where the log comes from: merging two sorted runs of total
   length m costs m comparisons at most, and there are log₂ n levels of splitting — so n log n.

   THE COST IT PAYS: memory. A merge cannot be done in place without heroics, so it copies a run out to
   scratch space and writes back (`set`). That extra O(n) memory is exactly why quicksort — which sorts
   in place — usually wins in practice despite the same average complexity. Nothing is free; you choose
   which price to pay. */
export function mergeSort(tracer, { n = tracer.getArray().length } = {}) {
  const sort = (lo, hi) => {
    if (hi - lo < 1) return;
    const mid = (lo + hi) >> 1;
    sort(lo, mid);
    sort(mid + 1, hi);

    // Copy both runs out (recorded reads) — the merge reads from this scratch and WRITES back into the
    // array, which is why the tracer needed a `set` op (slice 21).
    const left = [], right = [];
    for (let i = lo; i <= mid; i++) left.push(tracer.get(i));
    for (let j = mid + 1; j <= hi; j++) right.push(tracer.get(j));

    let a = 0, b = 0, w = lo;
    while (a < left.length && b < right.length) {
      // compareValues, not compare(i,j): the operands no longer live at array indices — they live in the
      // runs we just copied out. The branch still consumes the recorded boolean (faithfulness holds).
      if (tracer.compareValues(left[a], right[b], { i: lo + a, j: mid + 1 + b })) tracer.set(w++, left[a++]);
      else tracer.set(w++, right[b++]);
    }
    while (a < left.length) tracer.set(w++, left[a++]);
    while (b < right.length) tracer.set(w++, right[b++]);
    for (let k = lo; k <= hi; k++) tracer.mark(k, 'done');
  };
  sort(0, n - 1);
  return { sorted: tracer.getArray() };
}

/* ---- QUICK SORT ---------------------------------------------------------------------------------
   Divide-and-conquer again, but the clever part moves to the OTHER side of the recursion. Merge sort
   splits trivially (in half) and works hard to combine. Quicksort works hard to split (partition around
   a pivot, so everything smaller is left and everything larger is right) and then combines trivially —
   there is nothing to combine, the pieces are already in the right places.

   Lomuto partition, pivot = last element: walk the window, swap every element smaller than the pivot to
   the front, then drop the pivot into the boundary. In place: no scratch array, which is why it is the
   sort real libraries reach for.

   THE NUANCE THAT MAKES IT A REAL LESSON: quicksort is O(n log n) on AVERAGE and O(n²) in the WORST
   case — and the worst case is an ALREADY-SORTED array under this naive last-element pivot, because
   every partition splits off exactly one element. The fix (random or median-of-three pivot) is the first
   time most people see randomisation used to buy a performance guarantee. */
export function quickSort(tracer, { n = tracer.getArray().length } = {}) {
  const partition = (lo, hi) => {
    let i = lo;                                   // boundary: everything < i is smaller than the pivot
    for (let j = lo; j < hi; j++) {
      if (tracer.compare(j, hi)) {                // arr[j] < arr[hi] (the pivot)
        if (i !== j) tracer.swap(i, j);
        i++;
      }
    }
    if (i !== hi) tracer.swap(i, hi);             // the pivot lands on its final index — forever
    tracer.mark(i, 'done');
    return i;
  };
  const sort = (lo, hi) => {
    if (lo >= hi) { if (lo === hi) tracer.mark(lo, 'done'); return; }
    const p = partition(lo, hi);
    sort(lo, p - 1);
    sort(p + 1, hi);
  };
  sort(0, n - 1);
  return { sorted: tracer.getArray() };
}

/* ---- HEAP SORT (T2 bite 2 — where the two tracks meet) --------------------------------------------
   The sorts in T1 were clever about ARRANGING data. Heap sort is clever about the STRUCTURE it puts the
   data in first: build a heap (every parent <= its children), then pull the minimum off the top n times.
   Each pull costs O(log n) to re-heapify, so the whole sort is n·log n — the same class as merge and
   quick, arrived at from a completely different direction.

   AND IT HAS THE PROPERTY NEITHER OF THEM HAS: it is O(n log n) in the WORST case (unlike quicksort,
   which degrades to n² on sorted input) AND it sorts in place (unlike merge sort, which needs O(n)
   scratch). It is the algorithm you reach for when you cannot afford a bad day — which is exactly why
   std::sort's introsort BAILS OUT INTO HEAP SORT when quicksort's recursion goes too deep (the
   quick-sort lesson's "switches to heapsort mid-flight" — this is the thing it switches to).

   Instrumented through the same tracer: the heap's array IS the tracer's array. */
export function heapSort(tracer, { n = tracer.getArray().length } = {}) {
  const parent = (i) => (i - 1) >> 1;
  // 1. BUILD the heap in place, by sifting each new element up.
  for (let end = 1; end < n; end++) {
    let i = end;
    while (i > 0) {
      const p = parent(i);
      if (!tracer.compare(i, p)) break;      // arr[i] >= arr[p]: the invariant holds
      tracer.swap(i, p);
      i = p;
    }
  }
  // 2. Repeatedly pull the MINIMUM off the root, swapping it to the front of a growing sorted prefix.
  //    (Sorting ASCENDING with a MIN-heap means the sorted region grows from the left, and the heap
  //    shrinks from the right — which is why the STL default is a MAX-heap: it makes the arithmetic
  //    land the other way and lets the sorted region grow in place at the END. A real design detail.)
  for (let heapSize = n; heapSize > 1; heapSize--) {
    tracer.swap(0, heapSize - 1);            // the smallest goes to its final slot
    tracer.mark(heapSize - 1, 'done');
    let i = 0;
    const size = heapSize - 1;
    for (;;) {
      const l = 2 * i + 1, r = 2 * i + 2;
      let smallest = i;
      if (l < size && tracer.compare(l, smallest)) smallest = l;
      if (r < size && tracer.compare(r, smallest)) smallest = r;
      if (smallest === i) break;
      tracer.swap(i, smallest);
      i = smallest;
    }
  }
  if (n > 0) tracer.mark(0, 'done');
  /* NOTE the honest consequence: a MIN-heap sort leaves the array DESCENDING (each extracted minimum is
     parked at the far end). We reverse to hand back ascending — an O(n) tidy-up that costs no
     comparisons, and pretending it isn't there would be a lie in the op count. */
  const arr = tracer.getArray();
  const asc = arr.slice().reverse();
  for (let i = 0; i < n; i++) if (arr[i] !== asc[i]) tracer.set(i, asc[i]);
  return { sorted: tracer.getArray() };
}

/* ---- THE ALGORITHM REGISTRY ----------------------------------------------------------------------
   One entry per teachable algorithm: how to RUN it against a tracer, the complexity curves to DRAW, and
   the source lines to HIGHLIGHT. A note's `algorithm: { kind, input }` frontmatter names a key here; the
   reader looks it up and mounts the step-through. Adding an algorithm = adding an entry (and a lesson) —
   no renderer changes. THIS is the seam the curriculum arc grows through. */
export const ALGORITHMS = {
  'merge-sort': {
    label: 'Merge sort',
    run: mergeSort,
    complexity: {
      worst: { label: 'O(n log n) — n·log₂n comparisons', fn: (n) => n * Math.log2(Math.max(n, 1)), klass: 'O(n log n)' },
    },
    defaultInput: [8, 3, 5, 1, 9, 2, 7, 4],
    source: [
      'sort(lo, hi):',
      '  if (hi <= lo) return;',
      '  mid = (lo + hi) / 2;',
      '  sort(lo, mid); sort(mid+1, hi);   // divide',
      '  merge: take the smaller front element,',
      '         place it, repeat            // conquer',
    ],
  },
  'quick-sort': {
    label: 'Quick sort',
    run: quickSort,
    complexity: {
      average: { label: 'O(n log n) — average case', fn: (n) => n * Math.log2(Math.max(n, 1)), klass: 'O(n log n)' },
      worst: { label: 'O(n²) — worst case (sorted input, naive pivot)', fn: (n) => (n * (n - 1)) / 2, klass: 'O(n²)' },
    },
    defaultInput: [8, 3, 5, 1, 9, 2, 7, 4],
    source: [
      'sort(lo, hi):',
      '  if (lo >= hi) return;',
      '  p = partition(lo, hi);   // pivot lands FINAL',
      '  sort(lo, p-1); sort(p+1, hi);',
      'partition: swap everything < pivot to the front,',
      '           then drop the pivot on the boundary',
    ],
  },
  'heap-sort': {
    label: 'Heap sort',
    run: heapSort,
    complexity: {
      worst: { label: 'O(n log n) — worst case too (no bad days)', fn: (n) => n * Math.log2(Math.max(n, 1)), klass: 'O(n log n)' },
    },
    defaultInput: [8, 3, 5, 1, 9, 2, 7, 4],
    source: [
      'build: sift every element UP into a heap',
      'then repeatedly:',
      '  swap the root (the minimum) to the end',
      '  shrink the heap by one',
      '  sift the new root DOWN',
      '// in place, and O(n log n) even on its worst day',
    ],
  },
  'bubble-sort': {
    label: 'Bubble sort',
    run: bubbleSort,
    /* The curves we TEACH, as pure functions of n. Comparisons only (the work the class counts).
       worst/average: n(n-1)/2 ≈ n²/2. best: the same, for THIS naive form — which is exactly the
       teaching point (a bubble sort with no early-exit cannot get lucky). */
    complexity: {
      worst: { label: 'O(n²) — n(n−1)/2 comparisons', fn: (n) => (n * (n - 1)) / 2, klass: 'O(n²)' },
    },
    defaultInput: [8, 3, 5, 1, 9, 2, 7, 4],
    source: [
      'for (let pass = 0; pass < n - 1; pass++) {',
      '  for (let i = 0; i < n - 1 - pass; i++) {',
      '    if (!compare(i, i + 1)) swap(i, i + 1);',
      '  }',
      '  // the largest unsorted element is now in place',
      '}',
    ],
  },
  'binary-search': {
    label: 'Binary search',
    run: binarySearch,
    complexity: {
      worst: { label: 'O(log n) — ⌊log₂ n⌋ + 1 reads', fn: (n) => Math.floor(Math.log2(Math.max(n, 1))) + 1, klass: 'O(log n)' },
      linear: { label: 'O(n) — linear scan, for contrast', fn: (n) => n, klass: 'O(n)' },
    },
    defaultInput: [1, 3, 4, 7, 9, 11, 15, 22, 30, 41],
    defaultTarget: 22,
    source: [
      'let lo = 0, hi = n - 1;',
      'while (lo <= hi) {',
      '  const mid = (lo + hi) >> 1;',
      '  const v = get(mid);',
      '  if (v === target) return mid;',
      '  if (v < target) lo = mid + 1; else hi = mid - 1;',
      '}',
    ],
  },
};

/* measureComplexity(kind, sizes, makeInput) → [{ n, work }] — RUN the algorithm at several input sizes
   and count the work each run actually did. These are the DOTS the chart overlays on the theoretical
   curve. Deterministic by construction: the caller supplies the inputs (no Math.random here — the repo
   invariant, and a chart that changes on reload teaches nothing).

   `makeInput(n)` defaults to a reversed array (bubble sort's worst case) / a sorted array for search. */
export function measureComplexity(kind, sizes, makeInput, createTracerFn) {
  const spec = ALGORITHMS[kind];
  if (!spec) throw new Error(`measureComplexity: unknown algorithm "${kind}"`);
  const out = [];
  for (const n of sizes) {
    const input = makeInput(n);
    const t = createTracerFn(input);
    const opts = kind === 'binary-search'
      ? { target: input[input.length - 1] }   // worst case for search: the last element (deepest path)
      : {};
    spec.run(t, opts);
    out.push({ n, work: countOps(t.getOps()).work });
  }
  return out;
}

/* ============================================================
   THE EFFICIENCY RACE (slice 21) — the pure op-count pass behind the comparison chart.
   ------------------------------------------------------------
   This is where a complexity class stops being a claim on a slide and becomes a measurement. We RUN each
   algorithm over the same generated inputs at growing sizes and count the comparisons it actually
   performed. No animation, no DOM, no clock — just the algorithms and a counter, which is why it is a
   pure function and node-testable.

   THE INPUT MATTERS, AND SAYING SO IS THE LESSON. An algorithm has no single cost: it has a cost FOR AN
   INPUT. `case` picks the family — 'random' (a seeded shuffle: the average case everyone quotes),
   'sorted' (quicksort's naive worst case, and the one that embarrasses it), 'reversed' (bubble sort's
   worst case). Change the case and the race changes places, which is a far more useful thing to learn
   than "quicksort is fast".

   SEEDED, never Math.random: the same chart on every machine and every reload (the repo invariant). A
   race whose result shuffles when you refresh teaches nothing.
   ============================================================ */
export const SORT_KINDS = ['bubble-sort', 'merge-sort', 'quick-sort', 'heap-sort'];   // T2: heap-sort joins the race

/* The house LCG (same constants as the atmosphere/ambient streams) — deterministic shuffles. */
function seededShuffle(arr, seed) {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
  }
  return out;
}

export function makeCaseInput(n, kase = 'random', seed = 0x51ce21) {
  const sorted = Array.from({ length: n }, (_, i) => i + 1);
  if (kase === 'sorted') return sorted;
  if (kase === 'reversed') return sorted.slice().reverse();
  return seededShuffle(sorted, seed + n);   // vary by n so sizes are independent samples, still seeded
}

/* raceAlgorithms({ kinds, sizes, case, createTracerFn }) → { measured: [{kind,label,points}], reference: [...] }
   `points` are {x:n, y:comparisons} — the MEASURED series. `reference` carries the theoretical curves
   (n²/2 and n·log₂n) so the chart can draw what the classes PREDICT behind what the runs DID. */
export function raceAlgorithms({ kinds = SORT_KINDS, sizes = [8, 16, 32, 64, 128, 256], case: kase = 'random', seed = 0x51ce21, createTracerFn } = {}) {
  const measured = kinds.map((kind) => {
    const spec = ALGORITHMS[kind];
    if (!spec) throw new Error(`raceAlgorithms: unknown algorithm "${kind}"`);
    const points = sizes.map((n) => {
      const t = createTracerFn(makeCaseInput(n, kase, seed));
      spec.run(t, {});
      return { x: n, y: countOps(t.getOps()).compare };   // COMPARISONS: the currency both classes are quoted in
    });
    return { kind, label: spec.label, points };
  });
  const reference = [
    { label: 'O(n²) — n²/2', klass: 'O(n²)', points: sizes.map((n) => ({ x: n, y: (n * (n - 1)) / 2 })) },
    { label: 'O(n log n) — n·log₂n', klass: 'O(n log n)', points: sizes.map((n) => ({ x: n, y: n * Math.log2(Math.max(n, 1)) })) },
  ];
  return { measured, reference, sizes, case: kase };
}
