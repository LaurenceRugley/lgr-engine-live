/* ============================================================
   graph-labels.js — VIZ SLICE 4: createGraphLabels — a DOM overlay that names the nodes.
   ------------------------------------------------------------
   The engine-first ABILITY every GraphSpec consumer wires instead of reinventing: one absolutely-positioned
   <div> per node, re-projected from world→screen each frame through the live camera, with importance-based
   LOD so the graph reads as a MAP (a few landmarks) when zoomed out and as an INDEX (everything named) when
   zoomed in.

   WHY DOM AND NOT SDF TEXT (dependency-minimalism, the standing rule): drawing crisp text in WebGL means a
   signed-distance-field atlas + a text-layout engine — troika-three-text and friends. That is a font stack,
   a build step, and ~200 kB of someone else's code, bought to render 45 short strings. The browser already
   has a world-class text renderer with hinting, subpixel AA, ligatures, and i18n; it is called CSS. We reuse
   the arrow-label pattern the lessons page already proved (project the world point, write left/top), and pay
   nothing. The cost of DOM labels is real but bounded: they cannot occlude behind geometry, and they cost a
   style write per visible label per frame — which is why the whole module is built around not writing.

   THREE INVARIANTS THIS MODULE HOLDS:
     1. POINTER-TRANSPARENT. The overlay and every label set `pointer-events: none`. A label that swallowed a
        click would break pan and pick everywhere it covered a node — a bug you'd chase for an hour because
        the graph would work perfectly except near the things you most want to click.
     2. NO HOT ALLOC. One module-scope Vector3, reused for every projection of every node of every frame
        (engine invariant — docs/engine-invariants.md). No per-frame arrays, no template strings for hidden
        labels, no getBoundingClientRect (we read clientWidth/clientHeight, which the container already knows).
     3. NO REDUNDANT STYLE WRITES. A label only touches the DOM when its screen position moved more than
        HALF A PIXEL, or its visibility actually flipped. Sub-pixel jitter is invisible and a style write is
        a layout invalidation; writing 45 transforms per frame for movement nobody can see is how a smooth
        graph becomes a janky one.

   LOD (level of detail) — the readability contract:
     ALWAYS  the hub + the top `alwaysTop` nodes by DEGREE. Degree is the importance metric the view already
             uses for node size, so labels and sizes agree about what matters (they must, or the eye is told
             two different stories).
     ZOOMED  everything else appears once the ortho half-height crosses `zoomThreshold` — you zoomed in, you
             asked for names. It fades rather than pops (a cut at 45 labels reads as a glitch).
     FOCUS   while a node is selected, labels of the FOCUS-DIMMED nodes hide. graph-view fades those spheres
             to 18%; a label floating over a node you can barely see is noise pointing at nothing.
     DECLUTTER  labels claim screen space in importance order (hub, then degree); any label whose box would
             overlap one already placed HIDES. This is the classic greedy map-labelling rule, and it is why
             LOD budgets alone are not enough: at 390 px the hub and the top live-ops node sit ~64 px apart
             while their pills are ~120 px wide, so even TWO labels collide. A budget can't fix that; only
             asking "does it fit?" can. Consequence worth knowing: which labels survive depends on zoom and
             pan, so a name can vanish as you drag. That is the correct trade — a legible partial map beats
             an illegible complete one.

   C++ anchor: a VIEW over positions it does not own (same contract as graph-view.js), plus a dirty-flag
   cache per label — `if (fabs(x - last.x) > 0.5) el.write(x)` is the classic "don't push to the device
   unless the value changed" guard you'd write around any expensive setter.
   ============================================================ */
import * as THREE from 'three';
import { THEME } from './diagram-theme.js';

// NO-HOT-ALLOC: one scratch vector for every world→screen projection this module will ever do.
const _v = new THREE.Vector3();

const MOVE_EPS_PX = 0.5;   // below this, the move is invisible — don't pay for the style write
const EDGE_PAD_PX = 2;     // a label must fit WHOLLY inside the container, with this much air, or it hides

/* createGraphLabels({ container, nodes, edges, positions, camera, ... })
     -> { root, update(), setSelected(id), labelFor(id), dispose(), visibleCount }

   container:     the element the canvas fills. MUST be a positioned ancestor (position: relative/absolute) —
                  the overlay pins to its inset. Atlas's #canvas-mount already is.
   nodes/edges:   straight off the GraphSpec (edges only feed the degree ranking + focus adjacency).
   positions:     the Map<id,{x,y,z}> from createGraphLayout — read, never mutated.
   camera:        the rig's live camera. For an ORTHOGRAPHIC camera, `camera.top` IS the zoom (the half-height
                  in world units the rig writes each frame), so LOD reads it directly and needs no rig seam.
                  Under a PERSPECTIVE camera there is no equivalent scalar, so the zoom gate opens and every
                  label shows — documented, not silently different.
   project:       optional (id) => {x,y}|null override, if a consumer already owns a projection helper.
   radiusOf:      optional (id) => world-space node radius (graph-view exposes exactly this). Used to seat the
                  label BELOW the sphere rather than on top of it, and to keep it seated as zoom changes the
                  sphere's pixel size. Without it, labels sit at the node's centre.
   alwaysTop:     how many high-degree nodes are labelled at every zoom (default 8). Drop it on narrow
                  viewports — 8 slugs across 390 px is soup, not a map.
   zoomThreshold: ortho half-height below which the remaining labels fade in (default 5.5). */
export function createGraphLabels({
  container,
  nodes = [],
  edges = [],
  positions,
  camera,
  project = null,
  radiusOf = null,
  alwaysTop = 8,
  zoomThreshold = 5.5,
  gapPx = 5,
} = {}) {
  if (!container) throw new Error('createGraphLabels: container is required');
  if (!positions) throw new Error('createGraphLabels: positions (Map<id,{x,y,z}>) is required');
  if (!camera && !project) throw new Error('createGraphLabels: need a camera or a project(id) function');

  // ---- adjacency + degree: the SAME metrics graph-view derives, so labels and node sizes rank alike ----
  const degree = new Map();
  const neighbors = new Map();
  for (const n of nodes) neighbors.set(n.id, new Set());
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) || 0) + 1);
    degree.set(e.to, (degree.get(e.to) || 0) + 1);
    if (neighbors.has(e.from) && neighbors.has(e.to)) {
      neighbors.get(e.from).add(e.to);
      neighbors.get(e.to).add(e.from);
    }
  }

  // The always-visible set: every hub, plus the top-N by degree. Ties break on id so the choice is
  // DETERMINISTIC — the same vault must produce the same labelled landmarks on every machine and every run.
  const ranked = nodes.filter((n) => n.kind !== 'hub')
    .sort((a, b) => ((degree.get(b.id) || 0) - (degree.get(a.id) || 0)) || (a.id < b.id ? -1 : 1));
  const always = new Set(ranked.slice(0, Math.max(0, alwaysTop)).map((n) => n.id));
  for (const n of nodes) if (n.kind === 'hub') always.add(n.id);

  // ---- the overlay: one pointer-transparent layer, styled from THEME tokens (no consumer CSS required) ----
  const root = document.createElement('div');
  root.className = 'lgr-graph-labels';
  Object.assign(root.style, {
    position: 'absolute', inset: '0', overflow: 'hidden',
    pointerEvents: 'none',   // INVARIANT 1 — see header
  });

  const scrimBg = `color-mix(in srgb, ${THEME.SUBSTRATE.scrim.color} ${Math.round(THEME.SUBSTRATE.scrim.opacity * 100)}%, transparent)`;

  /* One record per node. `x`/`y`/`shown` are the dirty-flag cache (INVARIANT 3): the last values we actually
     wrote to the DOM, not the values we just computed. In C++ this is the shadow copy you diff against
     before touching a memory-mapped register. */
  const items = nodes.map((n) => {
    const el = document.createElement('div');
    const isHub = n.kind === 'hub';
    el.textContent = n.label || n.id;
    el.dataset.graphLabel = n.id;   // the capture probe's handle — query the layer, not a CSS class
    Object.assign(el.style, {
      position: 'absolute', left: '0', top: '0',
      pointerEvents: 'none', whiteSpace: 'nowrap', willChange: 'transform',
      font: `${isHub ? 500 : 400} ${isHub ? THEME.TYPE.sm : THEME.TYPE.xs}/1 ${THEME.TYPE.font}`,
      letterSpacing: isHub ? '0.18em' : '0.06em',
      // NEUTRAL.text, not NEUTRAL.dim: `dim` is the token for secondary text on a SURFACE panel. Over the
      // near-black canvas, behind a translucent scrim, it disappears (verified by looking at the capture).
      // The hub still leads — it wins on size and letter-spacing, not on being the only readable thing.
      color: THEME.NEUTRAL.text,
      background: scrimBg,
      padding: '3px 6px',
      borderRadius: '6px',
      opacity: '0',
      // The zoom-threshold crossing FADES. A hard cut at 45 labels reads as a rendering glitch, not as a
      // level-of-detail decision. This is a UI transition, not the state-encoding motion the reduced-motion
      // rule governs (color + size already carry heat) — so it is not motion-gated.
      transition: 'opacity 220ms ease',
    });
    root.appendChild(el);
    // The hub's label sits ABOVE its sphere; every other label below. Not decoration: the hub is at the
    // layout's origin and the innermost ring is only ~2 world units out, so at a framing zoom the hub's pill
    // and its ring-neighbours' pills fight for the same pixels. Since the hub outranks everyone in the
    // declutter order, it would silently evict the graph's most-connected node from ever being named.
    // Sending it the other way costs nothing and hands that space back.
    return { id: n.id, el, p: positions.get(n.id) || null, x: NaN, y: NaN, shown: false, hw: 0, hh: 0, above: isHub, hub: isHub };
  });

  container.appendChild(root);

  /* Measure each pill ONCE, here, in a single batched layout after everything is in the DOM. The text never
     changes, so its box never changes — caching the half-size buys us edge-containment culling in update()
     without a per-frame offsetWidth read (which would force layout 45 times a frame). opacity:0 elements
     still have a box, so this measures correctly while they're invisible. */
  for (const it of items) { it.hw = it.el.offsetWidth / 2; it.hh = it.el.offsetHeight; }

  /* DECLUTTER priority: the order in which labels claim screen space. Hub first (it is the index of the whole
     vault), then descending degree, ties on id. Precomputed ONCE — the ranking is a property of the graph,
     not of the camera, so recomputing it per frame would be 45 sorts a second for a constant answer. */
  const order = items.map((_, i) => i).sort((a, b) => {
    const na = nodes[a], nb = nodes[b];
    if ((na.kind === 'hub') !== (nb.kind === 'hub')) return na.kind === 'hub' ? -1 : 1;
    return ((degree.get(nb.id) || 0) - (degree.get(na.id) || 0)) || (na.id < nb.id ? -1 : 1);
  });
  // NO-HOT-ALLOC: the placed-box list is one preallocated buffer, refilled (not reallocated) each frame.
  const placed = new Float32Array(items.length * 4);   // [x0,y0,x1,y1] per placed label
  let placedN = 0;

  let selectedId = null;
  let visibleCount = 0;
  function setSelected(id) { selectedId = id; }

  /* setPalette(swatch | null) — recolour every label to a look's palette; null restores the THEME tokens.
     WHY LABELS DO NOT GET PIXELATED (§8, and the FTL / Into-the-Breach precedent): these are a mission
     control DATA layer, and a bitmap-fonted 9px slug is unreadable. Because the labels are DOM, the post
     chain never touches them — they are already crisp for free. All that is left is to make them BELONG to
     the picture, by drawing their colours from the same palette the quantizer snaps everything else to.
     Only colours change, never the font metrics, so the cached half-sizes stay valid (no re-measure). */
  function setPalette(sw) {
    const text  = sw ? sw.text  : THEME.NEUTRAL.text;
    const hub   = sw ? sw.hub   : THEME.NEUTRAL.text;
    const scrim = sw ? `${sw.scrim}` : scrimBg;
    for (const it of items) {
      it.el.style.color = it.hub ? hub : text;
      it.el.style.background = scrim;
    }
  }

  /* fits(x0,y0,x1,y1) — AABB overlap test against every box already claimed this frame. O(k²) over VISIBLE
     labels only (≤ ~20 in practice, 45 worst case = ~1000 float compares); far cheaper than the DOM writes
     it prevents. C++ anchor: the same broad-phase rejection a physics engine does before narrow-phase. */
  function fits(x0, y0, x1, y1) {
    for (let k = 0; k < placedN; k++) {
      const j = k * 4;
      if (x0 < placed[j + 2] && x1 > placed[j] && y0 < placed[j + 3] && y1 > placed[j + 1]) return false;
    }
    return true;
  }

  /* show/hide through the cache — the ONLY place `opacity` is written. */
  function setShown(it, want) {
    if (it.shown === want) return;
    it.shown = want;
    it.el.style.opacity = want ? '1' : '0';
  }

  /* update() — call once per frame, AFTER rig.update() has moved the camera (labels must land on the pixels
     the nodes were actually drawn at this frame, not last frame's). */
  function update() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;   // container is display:none / mid-layout — nothing to project onto

    // ORTHO: camera.top is the half-height in world units the rig writes each frame — that IS the zoom.
    // PERSPECTIVE: no equivalent scalar; open the gate rather than invent a fake one.
    const ortho = !!(camera && camera.isOrthographicCamera);
    const zoomedIn = ortho ? camera.top <= zoomThreshold : true;
    // Ortho projection is uniform, so ONE scalar converts world units to pixels for every node on screen.
    // This is what lets a label stay seated just under its sphere as zooming grows the sphere.
    const pxPerWorld = ortho ? h / (2 * camera.top) : 0;

    const focusActive = selectedId != null;
    const inFocus = focusActive ? neighbors.get(selectedId) : null;

    visibleCount = 0;
    placedN = 0;
    for (let oi = 0; oi < order.length; oi++) {
      const it = items[order[oi]];   // importance order — the hub claims its space before anything else
      if (!it.p) { setShown(it, false); continue; }   // a node with no layout position has nowhere to be named

      let want = always.has(it.id) || zoomedIn;
      // FOCUS: hide the labels of the nodes graph-view is dimming to 18%.
      if (want && focusActive) want = it.id === selectedId || (inFocus && inFocus.has(it.id));
      if (!want) { setShown(it, false); continue; }   // hidden → skip the projection entirely

      let sx, sy;
      if (project) {
        const pt = project(it.id);
        if (!pt) { setShown(it, false); continue; }
        sx = pt.x; sy = pt.y;
      } else {
        _v.set(it.p.x, it.p.y, it.p.z).project(camera);
        if (_v.z > 1) { setShown(it, false); continue; }   // behind the camera / past the far plane
        sx = (_v.x + 1) * 0.5 * w;
        sy = (1 - _v.y) * 0.5 * h;
      }
      // Seat the pill clear of the sphere: the node's world radius in pixels, plus a small gap. Without this
      // the label lands on the node's centre and the sphere paints over its own name. (The hub seats above.)
      const rPx = radiusOf ? radiusOf(it.id) * pxPerWorld : 0;
      const ly = it.above ? sy - rPx - gapPx - it.hh : sy + rPx + gapPx;

      // CONTAINMENT: the whole pill must fit, not just its anchor point. The overlay clips at the container
      // edge, so a label allowed to hang half-off renders as a truncated word ("-projects-and-showcase") —
      // which reads as a bug, not as an edge. Better to say nothing than to say half a name.
      const x0 = sx - it.hw, x1 = sx + it.hw, y0 = ly, y1 = ly + it.hh;
      if (x0 < EDGE_PAD_PX || x1 > w - EDGE_PAD_PX || y0 < 0 || y1 > h - EDGE_PAD_PX) {
        setShown(it, false); continue;
      }
      // DECLUTTER: a label that would collide with a more important one already placed says nothing at all.
      if (!fits(x0 - EDGE_PAD_PX, y0 - EDGE_PAD_PX, x1 + EDGE_PAD_PX, y1 + EDGE_PAD_PX)) {
        setShown(it, false); continue;
      }
      const b = placedN * 4;
      placed[b] = x0; placed[b + 1] = y0; placed[b + 2] = x1; placed[b + 3] = y1;
      placedN++;

      // INVARIANT 3: write only a move the eye could possibly see.
      if (!(Math.abs(sx - it.x) < MOVE_EPS_PX && Math.abs(ly - it.y) < MOVE_EPS_PX)) {
        it.x = sx; it.y = ly;
        // translate(-50%,0) centers the pill on the node horizontally; the px translate places it. Percentages
        // resolve against the element's own box, so this needs no width read on the hot path.
        it.el.style.transform = `translate(-50%, 0) translate(${sx.toFixed(1)}px, ${ly.toFixed(1)}px)`;
      }
      setShown(it, true);
      visibleCount++;
    }
  }

  function labelFor(id) {
    const it = items.find((x) => x.id === id);
    return it ? it.el : null;
  }

  function dispose() {
    root.remove();
    items.length = 0;
  }

  return {
    root, update, setSelected, setPalette, labelFor, dispose,
    get visibleCount() { return visibleCount; },
    get alwaysVisible() { return always; },
  };
}
