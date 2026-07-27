/* ============================================================
   data-structures.js — CURRICULUM T2: the structures themselves, instrumented.
   ------------------------------------------------------------
   T1 taught ALGORITHMS over an array (sort it, search it). T2 asks the question underneath: what if the
   SHAPE of the data is the thing that decides what is possible? A binary search tree is where that lands
   first — and it is also where the answer stops being comfortable, because the same tree, given the same
   keys in a different ORDER, can be a fast structure or a linked list wearing a costume.

   INSTRUMENTED THROUGH THE EXISTING SEAM. There is no second step engine here: a BST operation records
   through the same `createTracer` the sorts use (mark / compareValues), and the same `createTracePlayer`
   scrubs it. Only the PAINTER differs (tree-panel draws nodes at tree-layout's coordinates instead of an
   array of cells). That is the render-adapter split T1 established, earning its keep the first time a new
   structure arrives.

   THE VOCABULARY the panel paints (all through tracer.mark, so a new structure's marks paint for free):
     'visit'  — we are looking at this node right now
     'path'   — we came through here (the traversal's trail)
     'found'  — the key is here
     'insert' — the new node landed here
     'miss'   — the walk fell off the tree; the key is not present

   C++ anchor: `struct Node { int key; Node *left, *right; };` and a search is a `while (node)` loop that
   reassigns `node = key < node->key ? node->left : node->right`. Every comparison discards a whole
   SUBTREE — which is the same trick [[binary-search]] plays on a sorted array, with pointers instead of
   indices. The difference is that an array's halves are guaranteed equal; a tree's are only as balanced
   as the insertion order made them, and THAT is the lesson.
   ============================================================ */

/* ---- the structure ---------------------------------------------------------------------------------- */

/* bstInsert(root, key) → root — the plain, unbalanced insert. Returns the (possibly new) root.
   Duplicates are IGNORED: a set, not a multiset. Stating that is not pedantry — "what happens on a
   duplicate?" is the first question a real implementation has to answer, and silently allowing them turns
   your search into "find *a* match", which is a different function. */
export function bstInsert(root, key) {
  if (!root) return { key, left: null, right: null };
  let node = root;
  for (;;) {
    if (key === node.key) return root;                    // already present
    const side = key < node.key ? 'left' : 'right';
    if (!node[side]) { node[side] = { key, left: null, right: null }; return root; }
    node = node[side];
  }
}

export function bstFromKeys(keys) {
  let root = null;
  for (const k of keys) root = bstInsert(root, k);
  return root;
}

/* bstContains(root, key) → boolean — the uninstrumented version, for tests and measurement. */
export function bstContains(root, key) {
  let node = root;
  while (node) {
    if (key === node.key) return true;
    node = key < node.key ? node.left : node.right;
  }
  return false;
}

/* bstInOrder(root) → keys, ascending. THE INVARIANT MADE VISIBLE: an in-order walk of a BST comes out
   SORTED, always. That is not a coincidence or a nice property — it is the definition (left < node <
   right, applied recursively), and it is the cheapest possible check that a tree is really a BST. */
export function bstInOrder(root) {
  const out = [];
  const walk = (n) => { if (!n) return; walk(n.left); out.push(n.key); walk(n.right); };
  walk(root);
  return out;
}

/* ---- the instrumented operations (recorded through the T1 tracer) ------------------------------------ */

/* traceBST(tracer, { inserts, target }) → { root, found, comparisons }
   Builds the tree by inserting `inserts` in order (each insert is itself a walk, and the walk is what
   makes the shape), then searches for `target`. Every decision goes through tracer.compareValues, so the
   op-stream cannot diverge from the code — the same structural-faithfulness rule the sorts obey. */
export function traceBST(tracer, { inserts = [], target = null } = {}) {
  /* Nodes are addressed by a stable id (their insertion index) because the tracer's marks are keyed by a
     ref, and the panel needs to know WHICH node lit up. The tree's own objects carry the id. */
  let root = null;
  let nextId = 0;
  const byId = new Map();

  const mk = (key) => {
    const n = { id: nextId++, key, left: null, right: null };
    byId.set(n.id, n);
    return n;
  };

  for (const key of inserts) {
    if (!root) { root = mk(key); tracer.mark(root.id, 'insert'); continue; }
    let node = root;
    for (;;) {
      tracer.mark(node.id, 'visit');                       // we are looking at this node
      if (key === node.key) { tracer.mark(node.id, 'found'); break; }   // duplicate: nothing to do
      const goLeft = tracer.compareValues(key, node.key, { ref: node.id });   // records a 'compare'
      const side = goLeft ? 'left' : 'right';
      if (!node[side]) {
        const child = mk(key);
        node[side] = child;
        tracer.mark(node.id, 'path');                      // the parent we hung it from
        tracer.mark(child.id, 'insert');                   // ...and where it landed
        break;
      }
      tracer.mark(node.id, 'path');                        // we came through here
      node = node[side];
    }
  }

  let found = false;
  if (target != null && root) {
    let node = root;
    while (node) {
      tracer.mark(node.id, 'visit');
      if (target === node.key) { tracer.mark(node.id, 'found'); found = true; break; }
      const goLeft = tracer.compareValues(target, node.key, { ref: node.id });
      tracer.mark(node.id, 'path');
      node = goLeft ? node.left : node.right;
    }
    /* THE HONEST MISS. A search that falls off the bottom of the tree has answered the question — the key
       is not there — and the panel must SAY so rather than just stopping. A step-through that ends in
       silence teaches the student that the algorithm got confused; it didn't. */
    if (!found) tracer.mark(-1, 'miss');
  }

  return { root, byId, found, comparisons: tracer.getOps().filter((o) => o.type === 'compare').length };
}

/* ---- what it COSTS (the chart's data) --------------------------------------------------------------- */

/* bstSearchCost(root, key) → comparisons — one per layer walked. The depth IS the cost; everything the
   T2 track has to say about balance is contained in that sentence. */
export function bstSearchCost(root, key) {
  let node = root, c = 0;
  while (node) {
    c++;
    if (key === node.key) return c;
    node = key < node.key ? node.left : node.right;
  }
  return c;
}

/* The two shapes of the SAME structure, and why balance is not an aesthetic preference:
     BALANCED   keys inserted in a bisecting order → depth ≈ log₂ n → search ≈ log₂ n comparisons.
     DEGENERATE keys inserted ALREADY SORTED → every node hangs off the previous one's right → the "tree"
                is a linked list, depth = n−1, and search is O(n). Same code, same structure, 100× the
                work — decided entirely by the ORDER the data arrived in.
   That is the most important thing in T2, so it is what the chart plots. */
export function balancedKeys(n) {
  /* Insert the median first, then the medians of each half — a bisecting order, which builds the
     shallowest tree this (unbalanced) insert can produce. */
  const out = [];
  const rec = (lo, hi) => {
    if (lo > hi) return;
    const mid = (lo + hi) >> 1;
    out.push(mid + 1);                                     // 1..n
    rec(lo, mid - 1);
    rec(mid + 1, hi);
  };
  rec(0, n - 1);
  return out;
}

export function degenerateKeys(n) {
  return Array.from({ length: n }, (_, i) => i + 1);       // already sorted: the worst possible input
}

/* measureBST(sizes) → { balanced: [{x:n, y:comparisons}], degenerate: [...], linear: [...] }
   Deterministic (no RNG — the repo invariant): each size is BUILT and SEARCHED for real, and the numbers
   are what the code actually did. `linear` is the scan a plain array would need, for contrast — because
   the reason to build a tree at all is that it beats looking at everything. */
export function measureBST(sizes = [8, 16, 32, 64, 128, 256]) {
  const worstKey = (n) => n;                               // the deepest key in both shapes
  const balanced = [], degenerate = [], linear = [];
  for (const n of sizes) {
    balanced.push({ x: n, y: bstSearchCost(bstFromKeys(balancedKeys(n)), worstKey(n)) });
    degenerate.push({ x: n, y: bstSearchCost(bstFromKeys(degenerateKeys(n)), worstKey(n)) });
    linear.push({ x: n, y: n });
  }
  return { balanced, degenerate, linear, sizes };
}



/* ============================================================
   THE BINARY HEAP (T2 bite 2) — the tree that isn't a tree.
   ------------------------------------------------------------
   A heap answers a different question from a [[binary-search-tree]]. A BST is ORDERED — it can tell you
   where any key is. A heap is only ever asked ONE question: **what is the smallest thing right now?** —
   and it is ruthlessly optimised for exactly that, at the cost of knowing nothing else.

   THE INVARIANT is weaker than the BST's, and the weakness is the point:
       every parent is <= both of its children.
   That is all. There is NO left/right ordering between siblings, so you cannot search a heap — but you
   can always read the minimum off the root in O(1), and restore the invariant in O(log n) after a change.

   THE ARRAY TRICK, which is the real lesson. A heap is a COMPLETE binary tree (every layer full, the last
   filled left to right), and a complete tree needs no pointers at all — the shape is implied by the index:

       node i   →   left child 2i+1   ·   right child 2i+2   ·   parent (i-1)/2

   So the whole structure is ONE FLAT ARRAY. No allocation per node, no pointer chasing, and the children
   of a node sit near it in memory — which is why a heap is fast in a way a pointer tree simply cannot be
   (see the cache note in the BST lesson). The tree in the panel above is a PICTURE of an array.

   C++ anchor: `std::priority_queue` IS this, and `std::make_heap` / `push_heap` / `pop_heap` expose the
   same operations over any random-access range. Note the default is a MAX-heap — the STL asks for a
   comparator and gives you the *largest* first, which trips up everyone exactly once.
   ============================================================ */

const parentOf = (i) => (i - 1) >> 1;
const leftOf = (i) => 2 * i + 1;
const rightOf = (i) => 2 * i + 2;

/* heapIsValid(arr, size) → boolean — the invariant, checkable in one pass. Every test in this file leans
   on it, because "did the operation work?" is not "did it return the right number" — it is "is the
   structure still a heap afterwards". An operation that returns the right answer while corrupting the
   structure is the worst kind of bug: it works until it doesn't. */
export function heapIsValid(arr, size = arr.length) {
  for (let i = 0; i < size; i++) {
    for (const c of [leftOf(i), rightOf(i)]) {
      if (c < size && arr[c] < arr[i]) return false;   // a child smaller than its parent breaks it
    }
  }
  return true;
}

/* The pure (uninstrumented) heap, for tests and for heap-sort's measurement pass. */
export function heapPush(arr, key) {
  arr.push(key);
  let i = arr.length - 1;
  while (i > 0 && arr[i] < arr[parentOf(i)]) {
    const p = parentOf(i);
    [arr[i], arr[p]] = [arr[p], arr[i]];
    i = p;
  }
  return arr;
}

export function heapPop(arr) {
  if (!arr.length) return undefined;
  const min = arr[0];
  const last = arr.pop();
  if (arr.length) {
    arr[0] = last;
    let i = 0;
    for (;;) {
      const l = leftOf(i), r = rightOf(i);
      let smallest = i;
      if (l < arr.length && arr[l] < arr[smallest]) smallest = l;
      if (r < arr.length && arr[r] < arr[smallest]) smallest = r;
      if (smallest === i) break;
      [arr[i], arr[smallest]] = [arr[smallest], arr[i]];
      i = smallest;
    }
  }
  return min;
}

/* ---- the INSTRUMENTED heap: recorded through the SAME tracer the sorts and the BST use ---------------
   The tracer's array IS the heap's array (that is the whole point of the array layout), so the existing
   compare(i,j) / swap(i,j) / set(i,v) ops express every heap operation with nothing new invented. The
   keyframes the tracer already snapshots after each op are exactly what the panel needs to paint: which
   value is sitting in which slot, at every step. */
export function traceHeap(tracer, { inserts = [], extracts = 0 } = {}) {
  let size = 0;

  const siftUp = (start) => {
    let i = start;
    while (i > 0) {
      const p = parentOf(i);
      tracer.mark(i, 'visit');
      if (!tracer.compare(i, p)) { tracer.mark(i, 'settled'); break; }   // arr[i] >= parent: we are done
      tracer.mark(p, 'path');
      tracer.swap(i, p);                                                  // the value BUBBLES up
      i = p;
    }
    if (i === 0) tracer.mark(0, 'settled');
  };

  const siftDown = () => {
    let i = 0;
    for (;;) {
      const l = leftOf(i), r = rightOf(i);
      let smallest = i;
      tracer.mark(i, 'visit');
      if (l < size && tracer.compare(l, smallest)) smallest = l;
      if (r < size && tracer.compare(r, smallest)) smallest = r;
      if (smallest === i) { tracer.mark(i, 'settled'); break; }
      tracer.mark(smallest, 'path');
      tracer.swap(i, smallest);                                           // the value SINKS
      i = smallest;
    }
  };

  for (const key of inserts) {
    tracer.set(size, key);            // the new value lands at the END of the array...
    tracer.mark(size, 'insert');
    size++;
    siftUp(size - 1);                 // ...and bubbles up to where it belongs
  }

  const popped = [];
  for (let k = 0; k < extracts && size > 0; k++) {
    tracer.mark(0, 'found');          // the minimum is ALWAYS the root — that is the entire promise
    popped.push(tracer.get(0));
    size--;
    if (size > 0) {
      tracer.swap(0, size);           // move the last leaf to the root...
      tracer.set(size, null);         // ...and clear the slot it left (the array shrinks)
      siftDown();                     // ...then sink it to where it belongs
    } else {
      tracer.set(0, null);
    }
  }

  return { popped, size };
}

/* heapSortKeys(keys) → sorted — the pure version whose op-count the race measures. */
export function heapSortCost(keys) {
  /* Count comparisons the way the instrumented version does: build by repeated push (sift-up), then
     pop repeatedly (sift-down). n log n both halves. */
  let comparisons = 0;
  const arr = [];
  for (const k of keys) {
    arr.push(k);
    let i = arr.length - 1;
    while (i > 0) {
      comparisons++;
      if (!(arr[i] < arr[parentOf(i)])) break;
      const p = parentOf(i);
      [arr[i], arr[p]] = [arr[p], arr[i]];
      i = p;
    }
  }
  const out = [];
  while (arr.length) {
    out.push(arr[0]);
    const last = arr.pop();
    if (!arr.length) break;
    arr[0] = last;
    let i = 0;
    for (;;) {
      const l = leftOf(i), r = rightOf(i);
      let smallest = i;
      if (l < arr.length) { comparisons++; if (arr[l] < arr[smallest]) smallest = l; }
      if (r < arr.length) { comparisons++; if (arr[r] < arr[smallest]) smallest = r; }
      if (smallest === i) break;
      [arr[i], arr[smallest]] = [arr[smallest], arr[i]];
      i = smallest;
    }
  }
  return { sorted: out, comparisons };
}

/* The catalog entry the reader looks up (mirrors ALGORITHMS' shape, so a lesson declares itself the same
   way whether it teaches an algorithm or a structure). `panel: 'tree'` is what tells the reader to mount
   the tree painter instead of the array one. */
export const STRUCTURES = {
  'binary-heap': {
    label: 'Binary min-heap',
    panel: 'heap',                      // the tree painter, in ARRAY-SLOT mode (values move, slots don't)
    run: traceHeap,
    complexity: {
      op: { label: 'O(log n) — insert / extract-min', fn: (n) => Math.floor(Math.log2(Math.max(n, 1))) + 1, klass: 'O(log n)' },
      peek: { label: 'O(1) — read the minimum', fn: () => 1, klass: 'O(1)' },
    },
    defaultInserts: [42, 17, 63, 8, 29, 55, 11],
    defaultExtracts: 3,
    source: [
      'push(key):                  // sift UP',
      '  arr[size++] = key;',
      '  while (i && arr[i] < arr[(i-1)/2]) swap up;',
      '',
      'pop():                      // sift DOWN',
      '  min = arr[0];             // O(1) — always the root',
      '  arr[0] = arr[--size];     // last leaf to the top...',
      '  while (a child is smaller) swap down;   // ...and sink it',
    ],
  },
  'binary-search-tree': {
    label: 'Binary search tree',
    panel: 'tree',
    run: traceBST,
    complexity: {
      balanced: { label: 'O(log n) — balanced', fn: (n) => Math.floor(Math.log2(Math.max(n, 1))) + 1, klass: 'O(log n)' },
      worst: { label: 'O(n) — degenerate (sorted input)', fn: (n) => n, klass: 'O(n)' },
    },
    defaultInserts: [50, 30, 70, 20, 40, 60, 80, 35],
    defaultTarget: 60,
    source: [
      'search(root, key):',
      '  node = root;',
      '  while (node) {',
      '    if (key == node.key) return FOUND;',
      '    node = key < node.key ? node.left : node.right;',
      '  }                       // every step discards a SUBTREE',
      '  return NOT_FOUND;',
    ],
  },
};
