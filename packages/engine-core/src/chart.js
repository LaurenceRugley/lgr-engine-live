/* ============================================================
   chart.js — VIZ SLICE 20: a general first-party 2D CHART primitive (SVG, THEME-tokened, zero deps).
   ------------------------------------------------------------
   THE COCKPIT'S CHARTING FOUNDATION. Big-O curves are its first consumer, but nothing here knows what a
   Big-O is: it draws SERIES (lines and scatters) on SCALES (linear and log) with labeled axes. Latency
   over time, tokens per session, CI duration per run — the same primitive.

   BUILD-VS-BUY, DECIDED (dependency-minimalism doctrine): FIRST-PARTY. Our chart needs today are axes,
   ticks, two scale types and two mark types — roughly 200 lines, no interaction, no dataset joins. A
   charting library (uPlot, Observable Plot, Chart.js) is 40–200 KB to solve problems we do not have, and
   every one of them owns the DOM in its own way. THE EVALUATED ESCAPE HATCH: if a future chart needs
   brushing, zoom-linked panels, stacked layouts or 100k-point canvases, uPlot (canvas, ~40 KB, no deps)
   is the pick — this module's `series` shape is deliberately close to its input so the swap stays cheap.

   WHY SVG, NOT CANVAS: charts are TEXT-heavy (tick labels, axis titles, legends) and small. SVG gives
   crisp text at every DPR for free, is inspectable in devtools, and needs no resize/redraw bookkeeping.
   The atlas's node/edge fields are canvas because they are 300 instanced meshes; a chart is 30 elements.
   Use the right substrate for the density.

   THE PURE HALF IS THE TESTED HALF: niceTicks, makeScale and seriesToPoints are pure functions of numbers
   (no DOM), so `node --test` asserts the maths — tick selection, log mapping, pixel projection — while
   the DOM assembly below is a thin, boring translation of their output. This is the same split as
   graph-spec (pure) vs graph-view (renderer).

   C++ anchor: makeScale returns a closure over (domain, range) — a tiny functor, the way you'd pass a
   `std::function<double(double)>` transform into a plotting routine rather than baking the mapping in.
   ============================================================ */
import { THEME } from './diagram-theme.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/* niceTicks(min, max, count) → number[] — human tick values ("0, 25, 50, 75, 100", never
   "0, 23.7, 47.4"). The classic 1-2-5 algorithm: take the raw step, snap its mantissa UP to 1, 2, 5 or
   10, then walk multiples of that step across the domain. This is what makes a chart look authored
   instead of computed. */
export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || count < 2) return [];
  const raw = (max - min) / (count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  /* The step ladder uses GEOMETRIC-MEAN thresholds (√50, √10, √2), not the naive "≤1 → 1, ≤2 → 2, ≤5 → 5".
     Caught by the test: with the naive ladder a raw step of 25 rounds UP to 50, so a 0-100 axis gets three
     ticks (0, 50, 100) instead of six. The geometric mean is the point where a value is equally far from
     both candidate steps in RATIO terms — which is how the eye reads a scale. (Same choice d3 makes.) */
  const step = (norm >= Math.sqrt(50) ? 10 : norm >= Math.sqrt(10) ? 5 : norm >= Math.sqrt(2) ? 2 : 1) * mag;
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  // Guard the float drift: 0.1+0.2 style error can drop the last tick or add a 1e-15 ghost.
  for (let v = start; v <= max + step * 1e-6; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

/* logTicks(min, max) → number[] — decade ticks (1, 10, 100…) plus the 2/5 subdivisions when the span is
   narrow, because a log axis with two labels is unreadable. */
export function logTicks(min, max) {
  const lo = Math.max(min, 1e-9), hi = Math.max(max, lo * 10);
  const decades = Math.log10(hi) - Math.log10(lo);
  const out = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    const base = Math.pow(10, e);
    const mults = decades <= 2.5 ? [1, 2, 5] : [1];
    for (const m of mults) {
      const v = base * m;
      if (v >= lo * 0.999 && v <= hi * 1.001) out.push(Number(v.toPrecision(12)));
    }
  }
  return out;
}

/* makeScale({ domain:[d0,d1], range:[r0,r1], type }) → (value) → pixel.
   type 'linear' | 'log'. A log scale of a non-positive value is undefined, not zero — we clamp the
   domain to a positive epsilon and say so here rather than silently drawing a lie at the axis. */
export function makeScale({ domain, range, type = 'linear' }) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  if (type === 'log') {
    const l0 = Math.log10(Math.max(d0, 1e-9));
    const l1 = Math.log10(Math.max(d1, 1e-9));
    const span = l1 - l0 || 1;
    return (v) => r0 + ((Math.log10(Math.max(v, 1e-9)) - l0) / span) * (r1 - r0);
  }
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

/* seriesToPoints(series, sx, sy) → [{x,y}] in PIXELS. Non-finite points are DROPPED (a NaN in a data
   series should leave a gap, never a line to the origin — the classic charting lie). */
export function seriesToPoints(series, sx, sy) {
  const pts = [];
  for (const p of series.data || []) {
    const x = Number(p.x), y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    pts.push({ x: sx(x), y: sy(y), dx: x, dy: y });
  }
  return pts;
}

/* chartLayout(opts) → the full pure geometry of a chart: scales, ticks, and each series' pixel points.
   The DOM half below does nothing but read this. Exported so a probe (or a test) can assert what the
   chart WILL draw without a browser. */
export function chartLayout({ series = [], width = 460, height = 260, padding = {}, xScale = 'linear', yScale = 'linear', xDomain, yDomain, ticks = 5 } = {}) {
  const pad = { top: 16, right: 14, bottom: 34, left: 46, ...padding };
  const plot = { x0: pad.left, y0: height - pad.bottom, x1: width - pad.right, y1: pad.top };

  const xs = series.flatMap((s) => (s.data || []).map((p) => Number(p.x))).filter(Number.isFinite);
  const ys = series.flatMap((s) => (s.data || []).map((p) => Number(p.y))).filter(Number.isFinite);
  const dx = xDomain || [Math.min(...xs), Math.max(...xs)];
  // y starts at 0 on a linear axis (a truncated y-axis exaggerates differences — the most common chart
  // lie, and one a teaching chart must not tell). A log axis cannot include 0, so it starts at the min.
  const dy = yDomain || (yScale === 'log' ? [Math.max(Math.min(...ys), 1), Math.max(...ys)] : [0, Math.max(...ys)]);

  const sx = makeScale({ domain: dx, range: [plot.x0, plot.x1], type: xScale });
  const sy = makeScale({ domain: dy, range: [plot.y0, plot.y1], type: yScale });

  return {
    width, height, plot, xDomain: dx, yDomain: dy, xScale, yScale, sx, sy,
    xTicks: (xScale === 'log' ? logTicks(dx[0], dx[1]) : niceTicks(dx[0], dx[1], ticks)),
    yTicks: (yScale === 'log' ? logTicks(dy[0], dy[1]) : niceTicks(dy[0], dy[1], ticks)),
    points: series.map((s) => ({ series: s, pts: seriesToPoints(s, sx, sy) })),
  };
}

const el = (name, attrs = {}) => {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

/* createChart(opts) → { node, setSeries(series), dispose }
     series: [{ label, type: 'line'|'scatter', color, data: [{x,y}], dashed?, size? }]
     xLabel/yLabel, xScale/yScale ('linear'|'log'), width/height.
   Colors default to the THEME accents in order, so a chart looks native to the studio without the
   consumer picking hexes. */
export function createChart(opts = {}) {
  const { xLabel = '', yLabel = '', legend = true } = opts;
  const PALETTE = [THEME.ACCENT.ihat, THEME.ACCENT.jhat, THEME.ACCENT.gold, THEME.ACCENT.guide];
  const node = document.createElement('div');
  node.className = 'lgr-chart';
  let current = opts.series || [];

  function draw() {
    const L = chartLayout({ ...opts, series: current });
    node.replaceChildren();
    /* An SVG's width/height attributes take LENGTHS — "auto" is a CSS value and the browser rejects it
       (console error, caught on the first run). Responsiveness belongs in CSS: viewBox + preserveAspectRatio
       do the scaling, and the style below lets the chart fill its column at any width. */
    const svg = el('svg', {
      viewBox: `0 0 ${L.width} ${L.height}`,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img', 'aria-label': `${yLabel} versus ${xLabel}`,
    });
    svg.style.width = '100%';
    svg.style.height = 'auto';
    svg.style.display = 'block';
    svg.style.fontFamily = THEME.TYPE.font;

    // --- grid + axes ---
    for (const t of L.yTicks) {
      const y = L.sy(t);
      svg.appendChild(el('line', { x1: L.plot.x0, y1: y, x2: L.plot.x1, y2: y, stroke: THEME.NEUTRAL.border, 'stroke-width': 0.5, opacity: 0.5 }));
      const lab = el('text', { x: L.plot.x0 - 6, y: y + 3, 'text-anchor': 'end', fill: THEME.NEUTRAL.dim, 'font-size': 9 });
      lab.textContent = fmtTick(t);
      svg.appendChild(lab);
    }
    for (const t of L.xTicks) {
      const x = L.sx(t);
      svg.appendChild(el('line', { x1: x, y1: L.plot.y0, x2: x, y2: L.plot.y0 + 4, stroke: THEME.NEUTRAL.border, 'stroke-width': 0.5 }));
      const lab = el('text', { x, y: L.plot.y0 + 15, 'text-anchor': 'middle', fill: THEME.NEUTRAL.dim, 'font-size': 9 });
      lab.textContent = fmtTick(t);
      svg.appendChild(lab);
    }
    svg.appendChild(el('line', { x1: L.plot.x0, y1: L.plot.y0, x2: L.plot.x1, y2: L.plot.y0, stroke: THEME.NEUTRAL.border, 'stroke-width': 1 }));
    svg.appendChild(el('line', { x1: L.plot.x0, y1: L.plot.y0, x2: L.plot.x0, y2: L.plot.y1, stroke: THEME.NEUTRAL.border, 'stroke-width': 1 }));

    if (xLabel) {
      const t = el('text', { x: (L.plot.x0 + L.plot.x1) / 2, y: L.height - 4, 'text-anchor': 'middle', fill: THEME.NEUTRAL.dim, 'font-size': 9, 'letter-spacing': '0.08em' });
      t.textContent = xLabel.toUpperCase();
      svg.appendChild(t);
    }
    if (yLabel) {
      const t = el('text', { x: 10, y: (L.plot.y0 + L.plot.y1) / 2, 'text-anchor': 'middle', fill: THEME.NEUTRAL.dim, 'font-size': 9, 'letter-spacing': '0.08em', transform: `rotate(-90 10 ${(L.plot.y0 + L.plot.y1) / 2})` });
      t.textContent = yLabel.toUpperCase();
      svg.appendChild(t);
    }

    // --- series ---
    L.points.forEach(({ series: s, pts }, i) => {
      const color = s.color || PALETTE[i % PALETTE.length];
      if (s.type === 'scatter') {
        for (const p of pts) {
          svg.appendChild(el('circle', { cx: p.x, cy: p.y, r: s.size || 3, fill: color, stroke: THEME.NEUTRAL.bg, 'stroke-width': 1 }));
        }
      } else {
        const d = pts.map((p, k) => `${k ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
        svg.appendChild(el('path', {
          d, fill: 'none', stroke: color, 'stroke-width': s.width || 1.6,
          'stroke-linejoin': 'round', ...(s.dashed ? { 'stroke-dasharray': '4 3' } : {}),
        }));
      }
    });

    /* --- legend: WRAPS (slice 21). With five series and real labels ("O(n²) — n²/2", "Quick sort ← you
       are here") a single row ran off the right edge of the plot and the last entry was clipped — a
       legend you cannot read is worse than no legend. It now flows onto as many rows as it needs, and
       the SVG grows to fit them, so no series is ever silently lost. --- */
    if (legend && current.length) {
      const ROW = 12, GAP = 14, CHAR = 5.0;
      let lx = L.plot.x0, ly = L.plot.y1 - 4, rows = 1;
      const maxX = L.plot.x1;
      current.forEach((s, i) => {
        const color = s.color || PALETTE[i % PALETTE.length];
        const label = s.label || `series ${i + 1}`;
        const w = 12 + label.length * CHAR + GAP;
        if (lx + w > maxX && lx > L.plot.x0) { lx = L.plot.x0; ly += ROW; rows++; }   // wrap
        const g = el('g', {});
        g.appendChild(el('rect', { x: lx, y: ly - 6, width: 8, height: 8, fill: color, rx: 1 }));
        const tx = el('text', { x: lx + 12, y: ly + 1, fill: THEME.NEUTRAL.text, 'font-size': 9 });
        tx.textContent = label;
        g.appendChild(tx);
        svg.appendChild(g);
        lx += w;
      });
      // Push the whole plot down by however many extra rows the legend needed (the viewBox grows; the
      // chart never overlaps its own legend).
      const extra = (rows - 1) * ROW + 8;
      if (extra > 0) {
        svg.setAttribute('viewBox', `0 ${-extra} ${L.width} ${L.height + extra}`);
      }
    }
    node.appendChild(svg);
  }

  const fmtTick = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : String(Number(v.toFixed(2))));

  function setSeries(s) { current = s || []; draw(); }
  function dispose() { node.replaceChildren(); }

  draw();
  return { node, setSeries, dispose, get layout() { return chartLayout({ ...opts, series: current }); } };
}
