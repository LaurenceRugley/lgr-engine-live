/* ============================================================
   @lgr/engine-core — hints.js (Lesson 42): a tiny first-run COACHMARK system.
   ------------------------------------------------------------
   Discoverability was our worst gap: features hide behind a keyboard list that's itself hidden on
   touch. `createHints()` shows a small, charm-styled tips card ONCE per project on first visit,
   surfacing the key interactions (especially the touch ones the keyboard hints never show). It's
   non-intrusive — a bottom card over a transparent backdrop, so the scene stays fully interactive
   behind it — and dismissed via "Got it" / ✕ / Esc, then never shown again.

   ⚠ PER-PROJECT persistence: all three live apps share ONE origin (laurencerugley.github.io), so the
   "seen" flag is namespaced per project (`lgr_hints_city` / `_office` / `_hoard`). A single global key
   would make office/hoard skip their hints after someone visited city. (C++: prefix symbols to dodge an
   ODR/global-name clash across translation units; the latch itself = a config flag persisted across runs.)
   ============================================================ */
const SEEN_PREFIX = 'lgr_hints_';
let _cssInjected = false;

function injectCSS() {
  if (_cssInjected || typeof document === 'undefined') return;
  _cssInjected = true;
  const s = document.createElement('style');
  s.textContent = `
  /* L97: anchor the first-run coachmark to the BOTTOM-LEFT corner (an edge hint), not floating in the centre of
     the now-clean canvas (the redesign moved the bar to the top, leaving the lower-centre empty). Still a
     transparent, click-through backdrop with the card dismissible (Got it / ✕ / Esc). */
  .lgr-hints { position: fixed; inset: 0; z-index: 40; display: flex; align-items: flex-end;
    justify-content: flex-start; padding: 0 16px 18px; pointer-events: none; opacity: 0; transition: opacity .3s ease; }
  .lgr-hints.on { opacity: 1; }
  .lgr-hints-card { pointer-events: auto; position: relative; max-width: 340px; width: 100%;
    background: rgba(16,18,24,0.93); border: 1px solid rgba(184,153,104,0.42); border-radius: 14px;
    padding: 15px 18px; color: #e8edf4; font: 13px/1.55 ui-monospace, monospace;
    box-shadow: 0 14px 44px rgba(0,0,0,0.55); }
  .lgr-hints-h { font: 700 15px/1 Georgia, serif; color: #b89968; letter-spacing: .06em; margin: 0 0 10px; }
  .lgr-hints-card ul { margin: 0 0 14px; padding-left: 18px; }
  .lgr-hints-card li { margin: 4px 0; }
  /* L104: gold-not-blue — the "Got it" button matches the one gold accent (was blue #3a7bd5; white-on-blue
     failed 4.5:1). Gold fill + dark ink ≈ 6.95:1, pairing with the card's existing #b89968 title/border. */
  .lgr-hints-ok { min-width: 44px; min-height: 40px; padding: 0 18px; border: 0; border-radius: 9px;
    background: #b89968; color: #1b1d24; font: 600 13px/1 ui-monospace, monospace; cursor: pointer;
    letter-spacing: .04em; transition: transform .08s ease, background .12s; }
  .lgr-hints-ok:hover { background: #cdab74; }
  .lgr-hints-ok:active { transform: scale(0.94); background: #e8c069; }
  .lgr-hints-x { position: absolute; top: 7px; right: 7px; min-width: 36px; min-height: 36px; border: 0;
    background: transparent; color: #8a93a3; font: 15px/1 ui-monospace, monospace; cursor: pointer;
    border-radius: 8px; transition: transform .08s ease; }
  .lgr-hints-x:active { transform: scale(0.9); }
  @media (prefers-reduced-motion: reduce) {
    .lgr-hints, .lgr-hints-ok, .lgr-hints-x { transition: none; }
  }`;
  document.head.appendChild(s);
}

/* createHints({ key, title, tips, force }) — show the first-run card for `key` if it hasn't been seen.
   `force:true` shows it regardless (handy for a "show hints again" affordance / testing). Returns
   { dismiss, el } and mirrors state on window.__hints = { key, shown, dismissed, seen }. */
export function createHints({ key, title = 'Tips', tips = [], force = false } = {}) {
  const probe = { key, shown: false, dismissed: false, seen: false };
  if (typeof window !== 'undefined') window.__hints = probe;
  if (typeof document === 'undefined' || !key) return { dismiss() {}, el: null };

  const storeKey = SEEN_PREFIX + key;
  let seen = false;
  try { seen = localStorage.getItem(storeKey) === '1'; } catch (e) { /* private mode / blocked — show it */ }
  if (seen && !force) { probe.seen = true; return { dismiss() {}, el: null }; }

  injectCSS();
  const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const wrap = document.createElement('div');
  wrap.className = 'lgr-hints';
  wrap.innerHTML = `<div class="lgr-hints-card">
    <div class="lgr-hints-h">${title}</div>
    <ul>${tips.map((t) => `<li>${t}</li>`).join('')}</ul>
    <button class="lgr-hints-ok">Got it</button>
    <button class="lgr-hints-x" title="Dismiss (Esc)" aria-label="Dismiss">✕</button>
  </div>`;
  document.body.appendChild(wrap);
  probe.shown = true;
  if (reduce) wrap.classList.add('on'); else requestAnimationFrame(() => wrap.classList.add('on'));

  let done = false;
  function dismiss(persist = true) {
    if (done) return; done = true;
    if (persist) { try { localStorage.setItem(storeKey, '1'); } catch (e) { /* ignore */ } }
    probe.dismissed = true;
    window.removeEventListener('keydown', onKey);
    wrap.classList.remove('on');
    setTimeout(() => wrap.remove(), reduce ? 0 : 300);
  }
  // Esc dismisses the hint AND propagates (no stop) so it also runs the app's normal Esc — matching the
  // office/hoard hint text ("Esc exits"): one press clears the card and exits the mode.
  function onKey(e) { if (e.key === 'Escape') dismiss(true); }
  window.addEventListener('keydown', onKey);
  wrap.querySelector('.lgr-hints-ok').addEventListener('click', () => { navigator.vibrate?.(10); dismiss(true); });
  wrap.querySelector('.lgr-hints-x').addEventListener('click', () => { navigator.vibrate?.(10); dismiss(true); });

  return { dismiss, el: wrap };
}
