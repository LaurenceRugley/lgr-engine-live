/* ============================================================
   scroll-narrative.js — a chaptered CONTENT layer that sits ON TOP of createScrollDirector.
   ------------------------------------------------------------
   scroll-director.js already solved "native scroll → damped [0,1] progress" (F02). This module does NOT
   touch scroll at all — it takes the progress scalar the director already produces and answers a
   different question: "given N chapters, each with its own scroll budget, which chapter is active right
   now, how far through it am I, and what does the on-screen copy look like at that instant?" A project
   wires the two together:

     const scroll = createScrollDirector({ reducedMotion });
     const story  = createScrollNarrative({ sections, reducedMotion });
     shell.start((dt) => {
       scroll.update(dt);                              // ← pumps the director (the ONLY scroll listener)
       story.update(scroll.progress, scroll.targetProgress);   // ← pure function of the director's scalar
       driveCameraFromProgress(scroll.progress);         // ← a project's OWN camera code, same scalar
     });

   TWO EXPORTS, one dependency direction:
   - `buildChapterChain` / `readChapterChain` — pure, no DOM, no THREE. The chapter-boundary math alone,
     so a project's CAMERA code can consume the SAME chapter chain the content layer uses (one source of
     truth for "where chapter 3 starts"), without pulling in any DOM building.
   - `createScrollNarrative` — the DOM content layer (copy panels, section nav, progress rail, per-chapter
     accent). The real deliverable: everything above it is plumbing this needed to exist.

   AUTHORING MODEL credit: the segment-chain layout, the `linger` easing curve, and the three-branch
   copy-opacity shape (first section greets on landing / last holds its CTA / middle sections peak at
   their own mid-point) are lifted AS CODE from the MIT-licensed github.com/oso95/scroll-world
   (`mountScrollWorld`'s `layout()`/`lingerEase()`/`read()`) — see ./scroll-narrative.SOURCE.md. Ported to
   this engine's shape: their engine owns page height (a `track` div in vh) and scrubs pre-rendered AI
   VIDEO; this one owns neither — chapter boundaries are plain fractions of [0,1], the SAME [0,1] the
   director already produces from whatever scroll height the host page has, and there is no video, only
   the real renderer already running behind the page (the owner's explicit 2026-08-01 call — see brief).

   WHAT WAS NOT PORTED: their raf() loop re-smooths the (already-scrolled) position a SECOND time with a
   fixed-fraction lerp (`cur += (target-cur)*0.18`) — frame-rate DEPENDENT, the exact anti-pattern
   math.js's damp() docstring warns about (0.18/frame runs faster wall-clock on a 120 Hz display than a
   60 Hz one). They need it because a video seek is discrete/expensive and benefits from its own inertia
   masking the seek latency. We don't have that cost: `progress` is already the director's dt-correct
   `damp(rate=6)`, and writing a DOM opacity/transform is cheap enough to recompute directly from it every
   frame. A second smoothing stage on top would only add lag with no benefit — so it's dropped; the
   director's ONE damp is kept as the only ease in the whole pipeline (brief §5.5).

   C++ anchor: `readChapterChain` is a pure `struct ChapterState query(const Chain&, float p)` — no owned
   state, safe to call from anywhere (camera code, content code, a debug HUD) without fear of aliasing.
   ============================================================ */
import { clamp } from './math.js';
import { smoothstep } from './math/easing.js';

/* ---- pure chain math (no DOM) --------------------------------------------------------------------- */

/* buildChapterChain(sections, opts) → { segments, sectionSegments, totalWeight }
   `sections`: [{ id, weight=1, linger=0, connectorAfter }, …] (extra content fields are ignored here —
   this function only cares about layout). `weight` is a RELATIVE scroll budget: a section with weight 2
   occupies twice the [0,1] range of a sibling with weight 1 (bigger budget = a longer, slower dwell — the
   whole point of a chaptered chain over one flat scalar). `connectorAfter` (or the shared `opts.connectorWeight`
   default) inserts a content-free GAP segment after that section — the "optional connector segment" the
   brief asks for: during it no chapter's copy is on-screen (each panel's own opacity is a function of
   distance from ITS OWN segment, so leaving that segment is enough — no connector-specific code needed
   in the content layer, see readSectionOpacity below).
   Returns segments spanning the FULL [0,1] range (a section's `weight` is meaningless in isolation; only
   the RATIO across all sections + connectors matters), plus `sectionSegments[i]` — a flat lookup so a
   per-frame caller never has to search/filter the chain (no hot-loop allocation). */
export function buildChapterChain(sections, { connectorWeight = 0 } = {}) {
  const n = sections.length;
  const weights = sections.map((s) => Math.max(1e-6, s.weight != null ? s.weight : 1));
  const connW = sections.map((s, i) => (i < n - 1)
    ? Math.max(0, s.connectorAfter != null ? s.connectorAfter : connectorWeight)
    : 0);
  const totalWeight = weights.reduce((a, b) => a + b, 0) + connW.reduce((a, b) => a + b, 0);

  const segments = [];
  const sectionSegments = new Array(n);
  let cum = 0;
  for (let i = 0; i < n; i++) {
    const w = weights[i];
    const seg = { kind: 'section', sectionIndex: i, section: sections[i], start: cum / totalWeight, end: (cum + w) / totalWeight };
    segments.push(seg);
    sectionSegments[i] = seg;
    cum += w;
    if (connW[i] > 0) {
      segments.push({ kind: 'connector', sectionIndex: i, start: cum / totalWeight, end: (cum + connW[i]) / totalWeight });
      cum += connW[i];
    }
  }
  return { segments, sectionSegments, totalWeight, sectionCount: n };
}

/* the `linger` remap (lifted as code, see SOURCE.md): a monotone reshape of LOCAL segment time so the
   camera/copy SETTLES mid-chapter (where the copy peaks, per readSectionOpacity below) and moves quicker
   near the seams. L=0 → linear (default, no-op). L=1 → a full mid-chapter pause. f(0)=0 and f(1)=1 always
   hold, so a seam is never touched by the remap — only what happens BETWEEN seams changes. */
function lingerEase(x, L) {
  const l = clamp(L, 0, 1);
  const c = x - 0.5;
  return (1 - l) * x + l * (4 * c * c * c + 0.5);
}

/* readChapterChain(chain, p) → { segment, segIndex, local, eased, activeIndex }
   `p` ∈ [0,1] — pass EITHER the director's eased `.progress` (for continuous, per-frame visuals) or its
   raw `.targetProgress` (for a discrete "which chapter is active" gate that can never lag-strand just
   under a boundary — the exact eased-vs-raw split scroll-director.js's own docstring establishes for
   continuous vs discrete consumers; this function doesn't pick for you, the caller does, same as the
   director itself). `local`/`eased` describe position WITHIN the active segment; `activeIndex` is always
   a valid section index (a connector resolves to whichever neighbour is closer — past its own midpoint). */
export function readChapterChain(chain, p) {
  p = clamp(p, 0, 1);
  const { segments, sectionCount } = chain;
  let i = 0;
  for (let k = 0; k < segments.length; k++) if (segments[k].start <= p) i = k;
  const seg = segments[i];
  const span = seg.end - seg.start || 1;
  const local = clamp((p - seg.start) / span, 0, 1);
  const eased = (seg.kind === 'section' && seg.section.linger) ? lingerEase(local, seg.section.linger) : local;
  const activeIndex = seg.kind === 'section'
    ? seg.sectionIndex
    : clamp(local > 0.5 ? seg.sectionIndex + 1 : seg.sectionIndex, 0, sectionCount - 1);
  return { segment: seg, segIndex: i, local, eased, activeIndex };
}

/* readSectionOpacity — the three-branch shape (lifted as code, SOURCE.md): the FIRST chapter greets on
   landing (visible at p=0 with no scroll needed — a page must never open on a blank hero), the LAST holds
   its CTA (stays visible through to p=1 — a call-to-action must never fade just as the user arrives at
   it), and every chapter in between peaks at ITS OWN mid-point and fades at both edges — the "crossfade
   across seams" the brief asks for, expressed as an opacity ramp since there is no video scene layer to
   cross-dissolve. `pr` is the section's OWN local progress (from ITS OWN [start,end] — NOT the chain's
   current active segment; this is why a connector gap "just works" with no special-casing: every panel
   independently reads `before`/`after` as true the moment scroll leaves ITS segment). */
function readSectionOpacity(pr, before, after, isFirst, isLast) {
  if (isFirst) return after ? 0 : smoothstep(1 - pr / 0.62);
  if (isLast) return before ? 0 : smoothstep(pr / 0.4);
  return (before || after) ? 0 : smoothstep(1 - Math.abs(pr - 0.5) / 0.5);
}

/* ---- the DOM content layer ------------------------------------------------------------------------- */

const CSS = `
.lgr-narrative { position:fixed; inset:0; z-index:20; pointer-events:none; }
/* WIDTH IS EXPLICIT ON BOTH VARIANTS (2026-08-07). Both were position:fixed with a left offset and
   neither a right offset nor a width, so the box was SHRINK-TO-FIT against whatever space remained.
   Measured on a 390px phone: the left-aligned panels came out 366px and ran flush to the right bezel
   with a 0px gutter, and the centred ones (left:50% with nothing to push back against) got exactly
   the remaining half, 195px, wrapping the CTA chapter's body to NINE lines. Desktop never showed it,
   because at 1440px the max-width binds first, which is why it survived this long.
   The right offset gives the default variant a gutter matching its left; the centred variant takes an
   explicit width instead, and must clear that right offset or it would be stretched by both. The
   translate(-50%,-50%) in update() still does the centring.
   NOTE TO THE NEXT EDITOR: this whole CSS block lives inside a JS template literal, so a BACKTICK in
   a comment here terminates the string and the build fails with a misleading parse error. Same trap
   the repo already logged for backticks in GLSL comments. Quote code with single quotes instead. */
.lgr-narrative-panel { position:fixed; left:clamp(1.5rem,6vw,7rem); right:clamp(1.5rem,6vw,7rem); top:50%;
  max-width:34rem; opacity:0;
  pointer-events:none; will-change:opacity,transform; color:var(--lgr-narrative-ink,#f4ece0); }
.lgr-narrative-panel.is-center { left:50%; right:auto; width:min(40rem, calc(100vw - 3rem));
  max-width:none; text-align:center; }
/* TWO MORE LAYOUT FAMILIES (2026-08-07). A narrative whose every chapter is a left-clamped block at
   top:50% reads as a template no matter how good the copy is: same anchor, same measure, same rhythm,
   six times. These give a consumer somewhere else to put a panel.
     is-right   still vertically centred, anchored to the RIGHT gutter, ragged-left. Good for a chapter
                whose frame wants its LEFT side open.
     is-bottom  a wide band along the foot of the frame, no vertical centring at all. Good for a short
                declarative line, and it leaves the whole upper frame to the render.
   Both inherit the gutter fix above, so neither can go shrink-to-fit on a phone. */
.lgr-narrative-panel.is-right { left:clamp(1.5rem,6vw,7rem); right:clamp(1.5rem,6vw,7rem); text-align:right;
  margin-left:auto; }
.lgr-narrative-panel.is-bottom { top:auto; bottom:clamp(3rem,10vh,7rem); max-width:52rem; }
.lgr-narrative-panel.is-bottom .lgr-narrative-body { max-width:46ch; }
.lgr-narrative-num { display:block; font:600 .74rem/1 ui-monospace,Menlo,monospace; letter-spacing:.12em;
  color:var(--lgr-narrative-dim,rgba(244,236,224,.55)); }
.lgr-narrative-eyebrow { display:block; margin-top:1rem; font:700 .8rem/1 inherit; letter-spacing:.32em;
  text-transform:uppercase; color:var(--lgr-narrative-accent,#e8b46a); }
.lgr-narrative-title { margin-top:.6rem; font-size:clamp(2.2rem,6.5vw,5rem); line-height:1.02; font-weight:700;
  letter-spacing:-.02em; text-shadow:0 2px 30px rgba(0,0,0,.5); }
.lgr-narrative-body { margin-top:1.1rem; font-size:clamp(1rem,1.6vw,1.25rem); line-height:1.5; max-width:40ch;
  color:var(--lgr-narrative-dim,rgba(244,236,224,.72)); text-shadow:0 1px 16px rgba(0,0,0,.55); }
.lgr-narrative-tags { list-style:none; display:flex; flex-wrap:wrap; gap:.5rem; margin:1.4rem 0 0; padding:0;
  justify-content:inherit; }
.lgr-narrative-tags li { font-size:.8rem; font-weight:600; padding:.4rem .8rem; border-radius:999px;
  background:color-mix(in srgb, var(--lgr-narrative-accent,#e8b46a) 16%, transparent);
  border:1px solid color-mix(in srgb, var(--lgr-narrative-accent,#e8b46a) 34%, transparent); }
.lgr-narrative-cta { display:flex; flex-wrap:wrap; gap:.8rem; margin-top:1.6rem; pointer-events:auto;
  justify-content:inherit; }
.lgr-narrative-btn { font:600 1rem/1 inherit; padding:.9rem 1.7rem; border-radius:999px; border:1px solid transparent;
  cursor:pointer; text-decoration:none; display:inline-block; transition:transform .2s,background .2s; }
.lgr-narrative-btn:hover { transform:translateY(-2px); }
.lgr-narrative-btn--primary { color:#12100f; background:var(--lgr-narrative-accent,#e8b46a); }
.lgr-narrative-btn--secondary { color:inherit; border-color:currentColor; background:transparent; }
.lgr-narrative-nav { position:fixed; right:clamp(14px,2.4vw,30px); top:50%; z-index:21; transform:translateY(-50%);
  display:flex; flex-direction:column; gap:1.1rem; pointer-events:auto; }
.lgr-narrative-dot { width:.7rem; height:.7rem; border-radius:50%; border:0; padding:0; cursor:pointer;
  background:color-mix(in srgb, var(--lgr-narrative-accent,#e8b46a) 38%, transparent); transition:transform .3s,background .3s; }
.lgr-narrative-dot:hover { transform:scale(1.2); }
.lgr-narrative-dot.is-active { background:var(--lgr-narrative-accent,#e8b46a); transform:scale(1.45); }
.lgr-narrative-rail { position:fixed; top:0; left:0; height:2px; width:100%; z-index:21; background:transparent;
  pointer-events:none; }
.lgr-narrative-rail > i { display:block; height:100%; width:0%;
  background:linear-gradient(90deg, var(--lgr-narrative-accent,#e8b46a), #fff); transition:width .1s linear; }
@media (max-width:860px) { .lgr-narrative-nav { right:8px; gap:.8rem; } .lgr-narrative-dot { width:.6rem; height:.6rem; } }
`;
let cssInjected = false;
function ensureCSS() {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  const style = document.createElement('style');
  style.id = 'lgr-narrative-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

function buildPanel(section, index, total) {
  const el = document.createElement('article');
  /* `layout` is the field; `center: true` is kept working because projects already pass it. */
  const layout = section.layout || (section.center ? 'center' : 'left');
  el.className = 'lgr-narrative-panel' + (layout === 'left' ? '' : ` is-${layout}`);
  el.dataset.layout = layout;

  const num = document.createElement('span'); num.className = 'lgr-narrative-num';
  num.textContent = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
  el.appendChild(num);

  if (section.eyebrow) { const e = document.createElement('span'); e.className = 'lgr-narrative-eyebrow'; e.textContent = section.eyebrow; el.appendChild(e); }
  if (section.title) { const t = document.createElement('h2'); t.className = 'lgr-narrative-title'; t.textContent = section.title; el.appendChild(t); }
  if (section.body) { const b = document.createElement('p'); b.className = 'lgr-narrative-body'; b.textContent = section.body; el.appendChild(b); }
  if (section.tags && section.tags.length) {
    const ul = document.createElement('ul'); ul.className = 'lgr-narrative-tags';
    section.tags.forEach((tag) => { const li = document.createElement('li'); li.textContent = tag; ul.appendChild(li); });
    el.appendChild(ul);
  }
  if (section.cta && (section.cta.primary || section.cta.secondary)) {
    const wrap = document.createElement('div'); wrap.className = 'lgr-narrative-cta';
    [['primary', section.cta.primary], ['secondary', section.cta.secondary]].forEach(([kind, cta]) => {
      if (!cta) return;
      // href → a real link (marketing CTA); onClick → a button (an in-page action, e.g. "take the controls").
      const node = document.createElement(cta.href ? 'a' : 'button');
      node.className = `lgr-narrative-btn lgr-narrative-btn--${kind}`;
      node.textContent = cta.label || '';
      if (cta.href) node.href = cta.href;
      else { node.type = 'button'; if (cta.onClick) node.addEventListener('click', cta.onClick); }
      wrap.appendChild(node);
    });
    el.appendChild(wrap);
  }
  return el;
}

/* createScrollNarrative({ sections, connectorWeight, reducedMotion, mount, progressBar, nav, onJumpTo,
     onChapterChange }) → { update(progress, targetProgress), activeIndex, chain, destroy() }.

   `reducedMotion`: a plain boolean, READ from whatever already decided it for the director (the director
   owns the ONE `prefers-reduced-motion` decision point per the brief — this module never queries
   matchMedia itself, so there is exactly one place in a page that makes that call).
   `onJumpTo(midFraction, sectionIndex)`: fired when a nav dot is clicked, given the LOCAL [0,1] fraction
   of this chain's own range — the host (who owns the director) converts that to a real `scrollTo` call,
   because only the host knows how this chain's [0,1] maps onto the page's actual scroll range (the whole
   page, or — as in a page that also has a non-narrative tail like a configurator — a sub-range of it).
   Side-effect-free at import (no listeners, no DOM touched) until this factory actually runs, so an
   unused import still tree-shakes cleanly (F05) — the DOM/CSS work only happens once a caller invokes it. */
export function createScrollNarrative({
  sections = [],
  connectorWeight = 0,
  reducedMotion = false,
  mount,
  progressBar = true,
  nav = true,
  onJumpTo,
  onChapterChange,
} = {}) {
  if (typeof document === 'undefined' || !sections.length) {
    return { update() {}, destroy() {}, chain: null, get activeIndex() { return -1; } };
  }
  ensureCSS();
  const host = mount || document.body;
  const N = sections.length;
  const chain = buildChapterChain(sections, { connectorWeight });

  const root = document.createElement('div'); root.className = 'lgr-narrative';
  const panelEls = sections.map((s, i) => buildPanel(s, i, N));
  panelEls.forEach((el) => root.appendChild(el));
  host.appendChild(root);

  let railEl = null, railFill = null;
  if (progressBar) {
    railEl = document.createElement('div'); railEl.className = 'lgr-narrative-rail';
    railFill = document.createElement('i'); railEl.appendChild(railFill);
    host.appendChild(railEl);
  }

  let navEl = null; const dots = [];
  if (nav) {
    navEl = document.createElement('div'); navEl.className = 'lgr-narrative-nav';
    sections.forEach((s, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'lgr-narrative-dot';
      b.setAttribute('aria-label', s.label || s.id || `Chapter ${i + 1}`);
      b.addEventListener('click', () => {
        const seg = chain.sectionSegments[i];
        onJumpTo && onJumpTo((seg.start + seg.end) / 2, i);
      });
      navEl.appendChild(b); dots.push(b);
    });
    host.appendChild(navEl);
  }

  let activeIndex = -1;

  function update(progress, targetProgress = progress) {
    const p = clamp(progress, 0, 1);
    for (let i = 0; i < N; i++) {
      const seg = chain.sectionSegments[i];
      const span = seg.end - seg.start || 1;
      const pr = clamp((p - seg.start) / span, 0, 1);
      const before = p < seg.start, after = p > seg.end;
      const op = readSectionOpacity(pr, before, after, i === 0, i === N - 1);
      const el = panelEls[i];
      el.style.opacity = op;
      el.style.pointerEvents = op > 0.5 ? 'auto' : 'none';
      /* A11Y (2026-08-07): opacity + pointer-events hide a panel from the MOUSE and from sight, and
         from neither the tab order nor a screen reader. Every chapter's controls stayed focusable at
         all times, so on this page a keyboard user tabbing from the top hit the final chapter's
         "Take the controls" button while looking at chapter one, and a screen reader read all six
         chapters as one run-on block. `inert` removes focusability, clicks and AT exposure in a
         single property; aria-hidden is belt-and-braces for older AT. Written alongside the opacity
         so the three can never disagree. */
      const hidden = op <= 0.01;
      if (el.inert !== hidden) el.inert = hidden;
      el.setAttribute('aria-hidden', String(hidden));
      const drift = reducedMotion ? '' : ` translateY(${((0.5 - pr) * 4).toFixed(2)}vh)`;
      /* Each family anchors differently, so each needs its own centring transform. is-bottom is
         anchored to the FOOT of the frame and must not be pulled up by half its own height. */
      const lay = el.dataset.layout;
      const base = lay === 'center' ? 'translate(-50%,-50%)' : lay === 'bottom' ? '' : 'translateY(-50%)';
      el.style.transform = (base + drift).trim() || 'none';
    }
    // discrete gate off the RAW target (never lag-strand the active dot/accent just under a boundary —
    // the same eased-vs-raw split scroll-director.js's docstring establishes).
    const r = readChapterChain(chain, targetProgress);
    if (r.activeIndex !== activeIndex) {
      activeIndex = r.activeIndex;
      const accent = sections[activeIndex] && sections[activeIndex].accent;
      if (accent) root.style.setProperty('--lgr-narrative-accent', accent);
      for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('is-active', i === activeIndex);
      onChapterChange && onChapterChange(activeIndex, sections[activeIndex]);
    }
    if (railFill) railFill.style.width = (p * 100).toFixed(1) + '%';
  }

  function destroy() {
    root.remove();
    if (railEl) railEl.remove();
    if (navEl) navEl.remove();
  }

  return { update, destroy, chain, get activeIndex() { return activeIndex; } };
}
