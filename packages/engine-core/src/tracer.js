/* ============================================================
   tracer.js — VIZ SLICE 2: element-addressed algorithm tracing
   ------------------------------------------------------------
   SEAM: createTracer(initialArr) wraps an array so any algorithm that reads/writes
   it through the tracer automatically records a stream of typed ops + a keyframe
   snapshot after each op.

   STRUCTURAL FAITHFULNESS (Opus-refute correction 2): the instrumented algorithm
   READS through the tracer — `t.compare(i,j)` RETURNS the boolean the branch uses,
   `t.get(i)` returns the value. The trace CANNOT diverge from execution. A snapshot
   test alone can't guarantee this; the API contract does.

   VOCAB (correction 1 — element-addressed, not sort-flavored):
     compare(i,j)      → reads arr, returns boolean (arr[i] < arr[j]), records op
     get(i)            → reads arr[i], records op
     swap(i,j)         → swaps arr[i]↔arr[j] in-place, records op
     mark(ref, state)  → generic element/node state label (BFS: 'frontier','visited','done')
     highlight(ref)    → single-element highlight
     edgeVisit(from,to)→ graph edge traversal
     pushFrame(label)  → recursion stack entry  (corrections: BFS frontier is a 2nd cellField, not a frame)
     popFrame(label)   → recursion stack exit

   KEYFRAMES (correction 5): snapshot the FULL array state after EACH op (K=1). The
   player's backward scrub SNAPS to keyframe[stepIndex] — no reverse-animation.

   PEDAGOGICAL BOUND: designed for N ≤ 16 (stated in trace JSON via `bound` field).
   ============================================================ */

export function createTracer(initialArr) {
  // Working copy of the array — the tracer owns it (the algorithm reads/writes via seam).
  const arr = [...initialArr];
  const ops = [];

  // Keyframe 0 = initial state (before any op). Keyframe k+1 = state after ops[k].
  // Each keyframe is a cheap [...arr] snapshot — N ≤ 16, so ~16 numbers per frame.
  const keyframes = [{ arr: [...arr] }];

  function _record(op) {
    ops.push({ step: ops.length, ...op });
    keyframes.push({ arr: [...arr] });  // snapshot AFTER side effects
  }

  return {
    // RETURNS the comparison result — the branch uses this value, so the trace is structurally
    // faithful: it cannot diverge from execution no matter how the algorithm is written.
    // Returns arr[i] < arr[j] (in-order predicate — true → no swap needed in bubble sort).
    compare(i, j) {
      const result = arr[i] < arr[j];
      _record({ type: 'compare', i, j, result });
      return result;
    },

    // Read arr[i] (no array mutation) and record. Return value drives the algorithm.
    get(i) {
      const value = arr[i];
      _record({ type: 'get', i, value });
      return value;
    },

    // Swap arr[i] ↔ arr[j] in-place; snapshot AFTER the swap.
    swap(i, j) {
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      _record({ type: 'swap', i, j });
    },

    // Generic element/node state label. `ref` is an index or node-id; `state` is a string.
    mark(ref, state) { _record({ type: 'mark', ref, state }); },

    // Highlight a single element — emphasis without changing its value.
    highlight(ref)    { _record({ type: 'highlight', ref }); },

    // Record traversal of a directed graph edge (for BFS/DFS consumers).
    edgeVisit(from, to) { _record({ type: 'edgeVisit', from, to }); },

    // Recursion frame markers (for recursive algorithm consumers — NOT for BFS frontiers,
    // which are data and map to a second cellField per the architecture brief).
    pushFrame(label) { _record({ type: 'pushFrame', label }); },
    popFrame(label)  { _record({ type: 'popFrame', label }); },

    // Query the trace. Ops and keyframes are LIVE references (not copies) — treat as read-only.
    getOps()       { return ops; },
    getKeyframes() { return keyframes; },
    // Snapshot of the FINAL array state (after all ops).
    getArray()     { return [...arr]; },
    get stepCount() { return ops.length; },

    // Trace metadata for pedagogy — states the N bound and the initial array.
    meta() {
      return { bound: 16, initialArr: [...initialArr], stepCount: ops.length };
    },
  };
}
