/* ============================================================
   tree-panel.js — CURRICULUM T2: the tree's render adapter (SVG, THEME-tokened, zero deps).
   ------------------------------------------------------------
   The third painter over the SAME step engine. projects/tracer paints an array with instanced WebGL
   quads; the atlas reader paints one with divs (step-panel.js); this paints a TREE with SVG at
   tree-layout's coordinates. All three scrub the same `createTracePlayer` over the same `createTracer`
   op-stream — because the model is the trace, and a painter is just a point of view on it.

   SVG, for the same reason chart.js is: a lesson tree is thirty elements with text on them, not thirty
   thousand instances. Crisp labels at every DPR, no resize bookkeeping, inspectable in devtools.

   REDUCED MOTION: no auto-play, stepping snaps. Same contract as every other panel in the reader.
   ============================================================ */
import { THEME } from './diagram-theme.js';
import { createTracer } from './tracer.js';
import { createTracePlayer } from './trace-player.js';
import { treeLayout, treeEdges, treeDepth } from './tree-layout.js';
import { STRUCTURES, heapIsValid } from './data-structures.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (n, a = {}) => {
  const e = document.createElementNS(NS, n);
  for (const [k, v] of Object.entries(a)) e.setAttribute(k, String(v));
  return e;
};

/* createTreePanel({ kind, inserts, target, reducedMotion }) → { node, update, dispose, player, ops, … } */
/* slotTree(n) → the complete binary tree of n ARRAY SLOTS. This function IS the array trick: it needs no
   data at all, because in a heap the shape is implied by the index (children of i are 2i+1 and 2i+2). */
function slotTree(n) {
  if (n <= 0) return null;
  const nodes = Array.from({ length: n }, (_, i) => ({ id: i, key: null, left: null, right: null }));
  for (let i = 0; i < n; i++) {
    const l = 2 * i + 1, r = 2 * i + 2;
    if (l < n) nodes[i].left = nodes[l];
    if (r < n) nodes[i].right = nodes[r];
  }
  return nodes[0];
}

export function createTreePanel({ kind = 'binary-search-tree', inserts, target, extracts, reducedMotion = false, secondsPerStep = 0.62 } = {}) {
  const spec = STRUCTURES[kind];
  if (!spec) throw new Error(`createTreePanel: unknown structure "${kind}" (have: ${Object.keys(STRUCTURES).join(', ')})`);

  const keys = Array.isArray(inserts) && inserts.length ? inserts.slice() : spec.defaultInserts.slice();
  const goal = target ?? spec.defaultTarget;

  /* TWO MODES, ONE PAINTER (T2 bite 2). The difference between a BST and a HEAP, as far as a renderer is
     concerned, is which half of the picture is fixed:
       BST  — the NODES are fixed (a node's key never changes) and the SHAPE was built by the inserts.
       HEAP — the SHAPE is fixed (slot i's children are always 2i+1 and 2i+2 — the array layout) and the
              VALUES move between slots as things sift up and down.
     So a heap is laid out over its SLOTS, and each slot's label is read from the tracer's keyframe — the
     array snapshot it has been taking after every op since slice 2, which turns out to be exactly what a
     heap panel needs. Nothing new had to be recorded. */
  const isHeap = spec.panel === 'heap';
  const tracer = createTracer(isHeap ? new Array(keys.length).fill(null) : []);
  const runOpts = isHeap
    ? { inserts: keys, extracts: extracts ?? spec.defaultExtracts ?? 0 }
    : { inserts: keys, target: goal };
  const result = spec.run(tracer, runOpts);
  const root = isHeap ? slotTree(keys.length) : result.root;
  const ops = tracer.getOps();
  const keyframes = tracer.getKeyframes();
  const player = createTracePlayer(tracer, { secondsPerStep });

  /* The FINAL tree is what we lay out — nodes that do not exist yet are simply not drawn (their reveal
     is 0 until the step that inserts them). Laying out the final shape once, rather than re-laying it on
     every insert, is what keeps the tree from jumping around as it grows: a node lands where it will
     live forever. That stability is the difference between watching a structure BUILD and watching a
     diagram twitch. */
  const L = treeLayout(root, { gapX: 1, gapY: 1 });
  const edges = treeEdges(root);
  const depth = treeDepth(root);

  const PAD = { x: 26, y: 24 };
  const STEP_X = 44, STEP_Y = 56;
  const W = L.width * STEP_X + PAD.x * 2;
  const H = L.height * STEP_Y + PAD.y * 2;
  const R = 15;

  const node = document.createElement('div');
  node.className = 'lgr-tree-panel';
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'binary search tree' });
  svg.style.width = '100%';
  svg.style.height = 'auto';
  svg.style.display = 'block';
  svg.style.fontFamily = THEME.TYPE.font;

  const px = (n) => {
    const p = L.positions.get(n);
    return { x: PAD.x + p.x * STEP_X, y: PAD.y + p.y * STEP_Y };
  };

  // ---- edges first (they draw UNDER the nodes) ----
  const edgeEls = new Map();
  for (const [a, b] of edges) {
    const pa = px(a), pb = px(b);
    const line = el('line', {
      x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y,
      stroke: THEME.NEUTRAL.border, 'stroke-width': 1.4, 'stroke-linecap': 'round',
    });
    svg.appendChild(line);
    edgeEls.set(b.id, line);          // an edge is identified by the CHILD it leads to
  }

  // ---- nodes ----
  const circles = new Map(), labels = new Map();
  for (const [n] of L.positions) {
    const p = px(n);
    const g = el('g', {});
    const c = el('circle', {
      cx: p.x, cy: p.y, r: R,
      fill: THEME.NEUTRAL.surface, stroke: THEME.NEUTRAL.border, 'stroke-width': 1.5,
    });
    const t = el('text', {
      x: p.x, y: p.y + 4, 'text-anchor': 'middle', 'font-size': 12, fill: THEME.NEUTRAL.text,
    });
    t.textContent = isHeap ? '' : String(n.key);   // a heap's slot label is written per-step (values move)
    g.append(c, t);
    svg.appendChild(g);
    circles.set(n.id, c);
    labels.set(n.id, t);
  }

  // ---- transport ----
  const bar = document.createElement('div');
  bar.className = 'lgr-step-bar';
  const status = document.createElement('div');
  status.className = 'lgr-step-status';
  const code = document.createElement('pre');
  code.className = 'lgr-step-code';
  const src = document.createElement('div');
  for (const line of spec.source) {
    const l = document.createElement('div');
    l.className = 'lgr-step-line';
    l.textContent = line;
    src.appendChild(l);
  }
  code.appendChild(src);

  const btn = (label, title, fn) => {
    const b = document.createElement('button');
    b.textContent = label; b.title = title;
    b.addEventListener('click', fn);
    return b;
  };
  const playBtn = btn('▶', 'Play / pause', () => {
    if (player.playing) { player.pause(); playBtn.textContent = '▶'; }
    else { player.play(); playBtn.textContent = '❚❚'; }
  });
  const scrub = document.createElement('input');
  scrub.type = 'range'; scrub.min = '0'; scrub.max = String(ops.length); scrub.step = '1'; scrub.value = '0';
  scrub.className = 'lgr-step-scrub';
  scrub.setAttribute('aria-label', 'scrub through the tree operations');
  scrub.addEventListener('input', () => {
    player.pause(); playBtn.textContent = '▶';
    player.scrub(ops.length ? Number(scrub.value) / ops.length : 0);
  });
  bar.append(
    btn('⟨', 'Step back', () => { player.pause(); playBtn.textContent = '▶'; player.step(-1); }),
    playBtn,
    btn('⟩', 'Step forward', () => { player.pause(); playBtn.textContent = '▶'; player.step(1); }),
    scrub,
  );
  if (reducedMotion) { playBtn.disabled = true; playBtn.title = 'Auto-play is off (reduced motion) — use the step buttons'; }

  node.append(svg, code, bar, status);

  /* render(stepIndex) — replay the marks up to here. A node not yet inserted is HIDDEN (opacity 0), so the
     tree grows as you step; the traversal path stays lit behind the cursor, which is what makes a search
     read as a WALK rather than a series of unrelated flashes. */
  const C = {
    idle:   { fill: THEME.NEUTRAL.surface, stroke: THEME.NEUTRAL.border, text: THEME.NEUTRAL.text },
    path:   { fill: THEME.NEUTRAL.surface, stroke: THEME.ACCENT.jhat,    text: THEME.NEUTRAL.text },
    visit:  { fill: THEME.ACCENT.ihat,     stroke: THEME.ACCENT.ihat,    text: THEME.NEUTRAL.bg },
    insert: { fill: THEME.ACCENT.gold,     stroke: THEME.ACCENT.gold,    text: THEME.NEUTRAL.bg },
    found:  { fill: THEME.ACCENT.gold,     stroke: THEME.ACCENT.gold,    text: THEME.NEUTRAL.bg },
    settled:{ fill: THEME.NEUTRAL.surface, stroke: THEME.ACCENT.jhat,    text: THEME.NEUTRAL.text },
  };

  function render(stepIndex) {
    const live = new Set();
    const state = new Map();
    let missed = false;
    let lastVisit = null;

    /* HEAP: the slot labels come from the keyframe — the array as it stands after `stepIndex` ops. A slot
       holding null is EMPTY (not yet filled, or just vacated by an extract), and shows as a ghost. This
       is the array being drawn as the tree it secretly is. */
    if (isHeap) {
      const kf = keyframes[Math.min(stepIndex, keyframes.length - 1)].arr;
      for (const [id, t] of labels) {
        const v = kf[id];
        t.textContent = v == null ? '' : String(v);
        if (v != null) live.add(id);
      }
    }
    for (let k = 0; k < stepIndex && k < ops.length; k++) {
      const op = ops[k];
      if (op.type !== 'mark') continue;
      if (op.ref === -1) { missed = true; continue; }
      /* In a heap the keyframe already decided which slots are live; a mark must not resurrect a slot the
         array says is empty (an extract clears it, and the mark that preceded the clear is history). */
      if (!isHeap) { if (op.state === 'insert') live.add(op.ref); live.add(op.ref); }
      if (op.state === 'visit') { if (lastVisit != null && state.get(lastVisit) === 'visit') state.set(lastVisit, 'path'); lastVisit = op.ref; }
      state.set(op.ref, op.state === 'insert' && state.get(op.ref) ? state.get(op.ref) : op.state);
    }
    if (isHeap) for (const id of [...state.keys()]) if (!live.has(id)) state.delete(id);

    for (const [id, c] of circles) {
      const on = live.has(id);
      const s = C[state.get(id)] || C.idle;
      c.setAttribute('fill', s.fill);
      c.setAttribute('stroke', s.stroke);
      c.setAttribute('opacity', on ? '1' : '0.12');
      const t = labels.get(id);
      t.setAttribute('fill', on ? s.text : THEME.NEUTRAL.dim);
      t.setAttribute('opacity', on ? '1' : '0.25');
      const e = edgeEls.get(id);
      if (e) {
        e.setAttribute('opacity', on ? '1' : '0.1');
        const lit = state.get(id) === 'path' || state.get(id) === 'visit' || state.get(id) === 'found';
        e.setAttribute('stroke', lit ? THEME.ACCENT.jhat : THEME.NEUTRAL.border);
        e.setAttribute('stroke-width', lit ? 2.2 : 1.4);
      }
    }

    const op = ops[stepIndex - 1];
    const LINE_OF = { compare: 4, mark: 3 };
    for (const [i, l] of [...src.children].entries()) l.dataset.on = op && LINE_OF[op.type] === i ? '1' : '';

    scrub.value = String(stepIndex);
    const compares = ops.slice(0, stepIndex).filter((o) => o.type === 'compare').length;
    const built = live.size;
    if (isHeap) {
      const pulled = ops.slice(0, stepIndex).filter((o) => o.type === 'get').map((o) => o.value);
      const arr = keyframes[Math.min(stepIndex, keyframes.length - 1)].arr;
      const rootV = arr[0];
      /* THE INVARIANT IS TEMPORARILY FALSE MID-SIFT, and saying so is the honest thing — and the better
         lesson. A value climbing toward its place is, for those few steps, sitting above a parent it is
         smaller than: the heap is BROKEN, on purpose, and the sift is what repairs it. Claiming "the root
         is always the minimum" while a smaller value is visibly two rows down would teach the student to
         distrust their own eyes. (Caught by reading the panel's own status line mid-step.) */
      const live = arr.filter((v) => v != null);
      const settled = heapIsValid(live);
      status.textContent =
        `step ${stepIndex} / ${ops.length} · ${built} in the heap · ${compares} comparisons`
        + (rootV != null
          ? (settled
            ? ` · root = ${rootV} — the minimum, read in O(1)`
            : ` · root = ${rootV} — mid-sift: the invariant is BROKEN right now, and the sift is what repairs it`)
          : '')
        + (pulled.length ? ` · pulled: ${pulled.join(' → ')}` : '');
    } else {
      status.textContent =
        `step ${stepIndex} / ${ops.length} · ${built}/${keys.length} nodes · ${compares} comparisons`
        + (missed ? ` — ${goal} is NOT in the tree (the walk fell off the bottom)` : '')
        + (stepIndex >= ops.length && !missed ? ` — found ${goal} · depth ${depth} · a balanced tree of ${keys.length} would need ~${Math.floor(Math.log2(keys.length)) + 1}` : '');
    }
  }

  player.onUpdate((i) => render(i));
  render(0);

  function update(dt) { player.update(dt); }
  function dispose() { player.pause(); node.replaceChildren(); }

  return { node, update, dispose, player, tracer, ops, spec, root, depth, render, get stepIndex() { return player.stepIndex; } };
}
