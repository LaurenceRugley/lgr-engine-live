/* ============================================================
   step-panel.js — VIZ SLICE 20: a DOM step-through view for a recorded trace.
   ------------------------------------------------------------
   WHY A DOM VIEW AND NOT THE TRACER'S CELL FIELD. projects/tracer paints its array with createCellField —
   an InstancedMesh in the engine's WebGL scene. The atlas reader is a DOM panel floating over a canvas
   that already owns the page's ONE renderer (the second-consumer proof asserts exactly one), and mounting
   a second WebGL context inside a slide-over panel to draw eight rectangles would be an absurd trade.

   So the SHARED thing is the part that matters: the algorithm (algorithms.js) and the step engine
   (createTracer + createTracePlayer). Both projects record the same op-stream from the same code and
   scrub it with the same player; only the PAINTER differs — instanced quads there, divs here. That is
   the render-adapter split the brief asked for, and it is why the tracer needed no changes at all.

   REDUCED MOTION: no auto-play, no tween — stepping snaps. A panel that starts animating on open is
   exactly what prefers-reduced-motion is asking us not to do.

   C++ anchor: the player is a cursor over a const vector<Op>; this file is one of two view backends
   reading that cursor — the classic model/view split, with the trace as the model.
   ============================================================ */
import { THEME } from './diagram-theme.js';
import { createTracer } from './tracer.js';
import { createTracePlayer } from './trace-player.js';
import { ALGORITHMS, countOps } from './algorithms.js';

/* createStepPanel({ kind, input, target, reducedMotion }) → { node, dispose, player, tracer, ops, counts }
   Renders: the array as labeled cells (active pair lit, done cells settled), the source lines with the
   current one highlighted, a transport (play/pause · step ± · scrub), and a live op counter — the same
   number the Big-O chart plots, so the student watches the measurement accumulate. */
export function createStepPanel({ kind, input, target, reducedMotion = false, secondsPerStep = 0.65 } = {}) {
  const spec = ALGORITHMS[kind];
  if (!spec) throw new Error(`createStepPanel: unknown algorithm "${kind}" (have: ${Object.keys(ALGORITHMS).join(', ')})`);

  const arr = Array.isArray(input) && input.length ? input.slice() : spec.defaultInput.slice();
  const tracer = createTracer(arr);
  const runOpts = kind === 'binary-search' ? { target: target ?? spec.defaultTarget } : {};
  spec.run(tracer, runOpts);
  const ops = tracer.getOps();
  const keyframes = tracer.getKeyframes();
  const counts = countOps(ops);

  const player = createTracePlayer(tracer, { secondsPerStep });

  // ---- DOM ----
  const node = document.createElement('div');
  node.className = 'lgr-step-panel';
  const cells = document.createElement('div');
  cells.className = 'lgr-step-cells';
  const code = document.createElement('pre');
  code.className = 'lgr-step-code';
  const bar = document.createElement('div');
  bar.className = 'lgr-step-bar';
  const status = document.createElement('div');
  status.className = 'lgr-step-status';

  const btn = (label, title, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
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
  scrub.setAttribute('aria-label', 'scrub through the algorithm');
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
  // Reduced motion: the transport still works — you step, it snaps. Only AUTO-PLAY is withheld.
  if (reducedMotion) { playBtn.disabled = true; playBtn.title = 'Auto-play is off (reduced motion) — use the step buttons'; }

  const src = document.createElement('div');
  for (const line of spec.source) {
    const l = document.createElement('div');
    l.className = 'lgr-step-line';
    l.textContent = line;
    src.appendChild(l);
  }
  code.appendChild(src);
  node.append(cells, code, bar, status);

  /* opLine(op) — which source line does this op belong to? A tiny map, not a debugger: the point is
     "the code you are reading is the code that just ran", and for a 6-line teaching snippet a per-op-type
     mapping is honest and sufficient. */
  const LINE_OF = {
    'bubble-sort': { compare: 2, swap: 2, mark: 4 },
    'binary-search': { mark: 2, get: 3 },
    'merge-sort': { get: 3, compare: 4, set: 5, mark: 5 },      // slice 21
    'quick-sort': { compare: 4, swap: 5, mark: 2 },
  }[kind] || {};

  const cellEls = [];
  function buildCells(values) {
    cells.replaceChildren();
    cellEls.length = 0;
    values.forEach((v, i) => {
      const c = document.createElement('div');
      c.className = 'lgr-step-cell';
      const val = document.createElement('span');
      val.textContent = String(v);
      const idx = document.createElement('i');
      idx.textContent = String(i);
      c.append(val, idx);
      cells.appendChild(c);
      cellEls.push(c);
    });
  }
  buildCells(keyframes[0].arr);

  /* render(stepIndex) — paint the state AFTER stepIndex ops. The keyframe is the truth (the tracer
     snapshotted it), so scrubbing backwards is exact rather than replayed. `state` classes are the
     mark vocabulary, so a new algorithm's marks paint for free. */
  function render(stepIndex) {
    const kf = keyframes[Math.min(stepIndex, keyframes.length - 1)];
    const values = kf.arr;
    if (cellEls.length !== values.length) buildCells(values);
    // Replay marks up to here (marks are display state, not array state — they live in the op stream).
    const marks = new Map();
    for (let k = 0; k < stepIndex && k < ops.length; k++) {
      const op = ops[k];
      if (op.type === 'mark') marks.set(op.ref, op.state);
    }
    const active = new Set();
    const op = ops[stepIndex - 1];
    if (op) {
      if (op.type === 'compare' || op.type === 'swap') { active.add(op.i); active.add(op.j); }
      if (op.type === 'get' || op.type === 'highlight' || op.type === 'set') active.add(op.i ?? op.ref);
      // slice 21: a merge's compareValues carries the SOURCE indices of the two runs it is choosing between
      if (op.type === 'compare' && op.i != null && op.j != null) { active.add(op.i); active.add(op.j); }
    }
    cellEls.forEach((c, i) => {
      c.firstChild.textContent = String(values[i]);
      c.dataset.state = marks.get(i) || '';
      c.dataset.active = active.has(i) ? '1' : '';
    });
    for (const [i, l] of [...src.children].entries()) {
      l.dataset.on = op && LINE_OF[op.type] === i ? '1' : '';
    }
    scrub.value = String(stepIndex);
    const done = countOps(ops.slice(0, stepIndex));
    status.textContent = `step ${stepIndex} / ${ops.length} · ${done.compare} compares · ${done.swap} swaps · ${done.get} reads`
      + (counts.set ? ` · ${done.set || 0} writes` : '')
      + (stepIndex >= ops.length ? ` — done: ${counts.work} operations of work` : '');
  }

  player.onUpdate((stepIndex) => render(stepIndex));
  render(0);

  /* update(dt) — the consumer's animation frame drives the player, dt in SECONDS (the reader owns
     its own rAF; the panel never starts a loop of its own — a hidden panel must cost nothing). */
  function update(dt) { player.update(dt); }

  function dispose() { player.pause(); node.replaceChildren(); }

  return { node, update, dispose, player, tracer, ops, counts, spec, render, get stepIndex() { return player.stepIndex; } };
}
