import { createCommandPalette } from './command-palette.js';   // L99: the ⌘K command palette (a view over the same action bus)
/* ============================================================
   viewer-ui.js — Lesson 17: on-screen viewer controls (tap UI).
   ------------------------------------------------------------
   The engine is deployed live and shared with John — but every control was a KEY, so on a
   phone it did nothing. This adds a tap-friendly control bar so the demo drives itself, and
   pairs with shareable URL params (parsed in main.js) so a link can boot a pre-framed view.

   THE PATTERN — a COMMAND BUS. We do NOT re-implement any logic here. Each button dispatches
   the SAME action the keyboard already triggers (via a small `controls` object that, under the
   hood, fires the existing keydown handlers / SunRig verbs). One code path, two front-ends:
   keys for desktop power-users, taps for everyone else. (C++ analogy: a thin UI layer that
   POSTS messages into an existing event loop — it doesn't own the handlers, it feeds them.)

   PROGRESSIVE ENHANCEMENT: desktop keeps the hint bar + the ⓘ key list; touch devices (detected
   with `matchMedia('(pointer: coarse)')`) get the bar made prominent. The bar is pure DOM/CSS
   over the canvas with `pointer-events` only on itself, so the water-ripple DRAG still works
   everywhere else.
   ============================================================ */

const CSS = `
/* L104 — ONE GOLD ACCENT TOKEN (retires the L97 blue #3a7bd5 active-highlight). The blue was undocumented drift
   AND failed contrast: white-on-#3a7bd5 ≈ 4.22:1 < 4.5:1. Gold FILL + DARK INK ≈ 6.95:1 (passes WCAG 1.4.3) and
   matches the existing L99 ⌘K FAB (#b89968 on #1b1d24). One token, referenced by every .on/accent-color site below
   (grep'd ALL shell call-sites, Rule 7). Defined on :root so it reaches the panels too (they're appended to <body>,
   not children of .vui). --vui-accent-bright = the slightly lighter gold already used for focus rings (#e8c069). */
:root { --vui-accent: #b89968; --vui-accent-ink: #1b1d24; --vui-accent-bright: #e8c069; }
/* L97 REDESIGN — the GLOBAL TOP BAR (zone 2): docked to the TOP so the viewport reads as the hero (the scene
   fills the canvas; chrome floats translucent at the EDGES, not across the bottom-middle). Same glass identity. */
.vui { position: fixed; left: 50%; top: 12px; transform: translateX(-50%); z-index: 3;
  display: flex; gap: 8px; align-items: center; padding: 7px 9px; border-radius: 14px;
  background: rgba(16,18,24,0.72); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 6px 24px rgba(0,0,0,0.4); font: 600 12px/1 ui-monospace, monospace;
  color: #d8dde6; pointer-events: auto; user-select: none; max-width: calc(100vw - 24px);
  flex-wrap: wrap; justify-content: center; }
/* L54 FIX: the button rules apply to BOTH the primary bar (.vui) AND the "More" overflow panel
   (.vui-more) — the panel is a SEPARATE element appended to body, NOT a child of .vui, so a bare
   ".vui button" selector skipped it and its buttons collapsed to ~21px text height (below the 44px
   touch minimum). Same elements, same rules, two containers. (No backticks in this string — it is a
   JS template literal; a backtick here would close it early, the L-series build gotcha.) */
.vui button, .vui-more button { min-width: 44px; min-height: 44px; padding: 0 12px; border: 0; border-radius: 10px;
  background: rgba(255,255,255,0.07); color: inherit; font: inherit; cursor: pointer;
  letter-spacing: .04em; transition: background .12s, transform .08s ease; }
.vui button:hover, .vui-more button:hover { background: rgba(255,255,255,0.16); }
/* L41 BUTTON JUICE: a press scales down + flashes brighter so taps feel responsive (paired with a
   guarded haptic tick in JS). Reduced-motion users get the flash without the scale animation. */
.vui button:active, .vui-more button:active { transform: scale(0.92); background: rgba(255,255,255,0.26); }
@media (prefers-reduced-motion: reduce) { .vui button, .vui-more button { transition: background .12s; } .vui button:active, .vui-more button:active { transform: none; } }
.vui button.on, .vui-more button.on { background: var(--vui-accent); color: var(--vui-accent-ink); }
.vui .seg, .vui-more .seg { display: flex; gap: 2px; background: rgba(255,255,255,0.05); border-radius: 11px; padding: 2px; }
.vui .seg button, .vui-more .seg button { min-width: 44px; padding: 0 9px; border-radius: 9px; }
.vui .sep { width: 1px; align-self: stretch; margin: 4px 2px; background: rgba(255,255,255,0.12); }
.vui input[type=range] { width: 92px; accent-color: var(--vui-accent); height: 44px; cursor: pointer; }
.vui .lbl { opacity: .55; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; padding: 0 2px; }
/* L74 WORLD-EDITOR CHROME — a left-edge vertical MODE RAIL (the tool radio) + a floating per-tool CONTROL CARD.
   Reuses the .vui glass + 44px touch minimum; mounts ONLY in edit mode (?edit=1), so the clean showcase is untouched. */
.vui-rail { position: fixed; left: 12px; top: 50%; transform: translateY(-50%); z-index: 3; display: none;
  flex-direction: column; gap: 6px; padding: 7px; border-radius: 14px; background: rgba(16,18,24,0.72);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); box-shadow: 0 6px 24px rgba(0,0,0,0.4); pointer-events: auto; }
.vui-rail.open { display: flex; }
.vui-rail button { min-width: 48px; min-height: 48px; padding: 2px 0 0; border: 0; border-radius: 11px; cursor: pointer;
  background: rgba(255,255,255,0.07); color: #d8dde6; font: 600 19px/1 ui-monospace, monospace; transition: background .12s, transform .08s; }
.vui-rail button:hover { background: rgba(255,255,255,0.16); }
.vui-rail button:active { transform: scale(0.92); }
.vui-rail button.on { background: var(--vui-accent); color: var(--vui-accent-ink); }
.vui-rail .rk { display: block; font-size: 8px; opacity: .5; margin-top: 2px; letter-spacing: .1em; }
/* L97 REDESIGN — the PROPERTIES panel (zone 4) docked to the RIGHT edge (was left:74px beside the rail). The
   active tool's settings live here; the LEFT edge holds the tool palette (rail), the RIGHT holds its properties. */
.vui-card { position: fixed; right: 12px; left: auto; top: 50%; transform: translateY(-50%); z-index: 3; display: none;
  flex-direction: column; gap: 8px; padding: 11px 12px; border-radius: 14px; max-width: 236px; background: rgba(16,18,24,0.84);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); box-shadow: 0 6px 24px rgba(0,0,0,0.4);
  color: #d8dde6; font: 600 12px/1 ui-monospace, monospace; pointer-events: auto; }
.vui-card.open { display: flex; }
.vui-card .ct { font-size: 13px; color: #eef2f8; letter-spacing: .04em; }
.vui-card .crow { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.vui-card .clbl { opacity: .55; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; min-width: 46px; }
.vui-card input[type=range] { width: 108px; accent-color: var(--vui-accent); height: 36px; cursor: pointer; }
.vui-card button { min-width: 40px; min-height: 40px; padding: 0 10px; border: 0; border-radius: 9px;
  background: rgba(255,255,255,0.08); color: inherit; font: inherit; cursor: pointer; transition: background .12s; }
.vui-card button:hover { background: rgba(255,255,255,0.17); }
.vui-card button.on { background: var(--vui-accent); color: var(--vui-accent-ink); }
.vui-card .seg { display: flex; gap: 2px; background: rgba(255,255,255,0.05); border-radius: 11px; padding: 2px; }
.vui-card .seg button { min-width: 40px; padding: 0 9px; border-radius: 9px; }
/* L75 SAVE / LOAD panel — top-right floating glass; lists localStorage slots + the file/link transports. Edit-mode only. */
.vui-save { position: fixed; right: 12px; top: 12px; z-index: 3; display: none; flex-direction: column; gap: 7px;
  padding: 11px 12px; border-radius: 14px; max-width: 250px; background: rgba(16,18,24,0.84);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); box-shadow: 0 6px 24px rgba(0,0,0,0.4);
  color: #d8dde6; font: 600 12px/1 ui-monospace, monospace; pointer-events: auto; }
.vui-save.open { display: flex; }
.vui-save .ct { font-size: 13px; color: #eef2f8; letter-spacing: .04em; }
.vui-save .srow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.vui-save input[type=text], .vui-save select { flex: 1; min-width: 90px; min-height: 36px; border: 0; border-radius: 9px;
  background: rgba(255,255,255,0.09); color: #eef2f8; font: 600 12px ui-monospace, monospace; padding: 0 9px; }
.vui-save button { min-width: 40px; min-height: 38px; padding: 0 10px; border: 0; border-radius: 9px;
  background: rgba(255,255,255,0.08); color: inherit; font: inherit; cursor: pointer; transition: background .12s; }
.vui-save button:hover { background: rgba(255,255,255,0.17); }
.vui-save .st { font-size: 10px; opacity: .7; letter-spacing: .04em; min-height: 12px; }
/* L97: the key-list popover drops DOWN from the top bar (the ⓘ button) instead of up from the bottom. */
.vui-info { position: fixed; left: 50%; top: 64px; transform: translateX(-50%); z-index: 3;
  display: none; max-width: calc(100vw - 24px); padding: 10px 14px; border-radius: 12px;
  background: rgba(16,18,24,0.92); color: #c8ccd4; pointer-events: auto;
  font: 11px/1.7 ui-monospace, monospace; letter-spacing: .04em; }
.vui-info.open { display: block; }
/* L63 INSPECT readout — top-left panel naming the followed object + its live behaviour, with a
   tap "next" + "exit". Shown only while the inspection lens is on; pointer-events on so the buttons
   work, but it never covers the bottom control bar. */
.vui-inspect { position: fixed; left: 14px; top: 14px; z-index: 3; display: none; max-width: 260px;
  padding: 10px 12px; border-radius: 12px; background: rgba(16,18,24,0.9); color: #d8dde6;
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); pointer-events: auto;
  font: 600 12px/1.5 ui-monospace, monospace; box-shadow: 0 6px 24px rgba(0,0,0,0.4); }
.vui-inspect.open { display: block; }
.vui-inspect .ik { font-size: 10px; letter-spacing: .16em; text-transform: uppercase; opacity: .55; }
.vui-inspect .it { font-size: 13px; margin: 1px 0 3px; color: #eef2f8; }
.vui-inspect .ii { opacity: .82; font-weight: 500; }
.vui-inspect .ir { display: flex; gap: 6px; margin-top: 9px; }
.vui-inspect button { min-width: 40px; min-height: 36px; padding: 0 10px; border: 0; border-radius: 9px;
  background: rgba(255,255,255,0.09); color: inherit; font: inherit; cursor: pointer; }
.vui-inspect button:hover { background: rgba(255,255,255,0.18); }
/* L20 "show controls" pill — appears bottom-right when the bar is minimized, so a viewer can
   hide the UI to watch the scene unobstructed, then bring it back with one tap. */
.vui-show { position: fixed; right: 14px; bottom: 16px; z-index: 3; display: none;
  min-width: 44px; min-height: 44px; padding: 0 14px; border: 0; border-radius: 12px;
  background: rgba(16,18,24,0.72); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  color: #d8dde6; font: 600 12px/1 ui-monospace, monospace; letter-spacing: .04em; cursor: pointer;
  align-items: center; gap: 7px; box-shadow: 0 6px 24px rgba(0,0,0,0.4); pointer-events: auto; }
.vui-show.on { display: inline-flex; }
/* L27 on-screen STYLE HINT — a small top-centre pill naming the current look as you zoom the AUTO
   Style-LOD ladder (vector → toon → 16-bit → 8-bit → Game Boy), so the morph is legible. Fades in on
   change, out when idle; pointer-events none (never blocks the canvas). Hidden with the bar (M) + ?ui=0. */
/* L97: the style-hint pill moved to BOTTOM-centre (the top is now the global bar) — it names the live look as you
   zoom the AUTO morph ladder, away from the chrome. */
.vui-style { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 3;
  padding: 6px 13px; border-radius: 999px; background: rgba(16,18,24,0.72);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); color: #eaeef4;
  font: 700 11px/1 ui-monospace, monospace; letter-spacing: .16em; text-transform: uppercase;
  pointer-events: none; opacity: 0; transition: opacity .35s ease; box-shadow: 0 4px 16px rgba(0,0,0,0.35); }
.vui-style.on { opacity: 0.92; }
/* L31 "More" overflow panel (TOUCH only): the secondary toggles live here behind one tap, so the
   primary bar stays one/two compact rows and the ENGINE owns the mobile landing (progressive disclosure). */
.vui-more { position: fixed; left: 50%; top: 64px; transform: translateX(-50%); z-index: 3;
  display: none; flex-wrap: wrap; justify-content: center; align-items: center; gap: 8px;
  max-width: calc(100vw - 24px); padding: 9px 11px; border-radius: 14px;
  background: rgba(16,18,24,0.92); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 6px 24px rgba(0,0,0,0.4); pointer-events: auto; }
.vui-more.open { display: flex; }
/* L97 progressive disclosure — the ENVIRONMENT/VIEW expander: a small popover under the top bar holding the
   SECONDARY controls (auto-day/night · weather · season · shadows · theme) so the bar shows only the primary
   ones (time slider stays on the bar). Fixed under the top bar (which is itself fixed at top:12). */
.vui-env { position: fixed; top: 64px; right: 16px; z-index: 3; display: none; flex-wrap: wrap; gap: 8px;
  align-items: center; max-width: min(360px, calc(100vw - 24px)); padding: 9px 11px; border-radius: 14px;
  background: rgba(16,18,24,0.94); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 6px 24px rgba(0,0,0,0.4); pointer-events: auto; }
.vui-env.open { display: flex; }
.vui-env button { min-width: 44px; min-height: 44px; padding: 0 12px; border: 0; border-radius: 10px;
  background: rgba(255,255,255,0.07); color: inherit; font: inherit; cursor: pointer; transition: background .12s; }
.vui-env button:hover { background: rgba(255,255,255,0.16); }
.vui-env button.on { background: var(--vui-accent); color: var(--vui-accent-ink); }
.vui-env button:focus-visible { outline: 2px solid #e8c069; outline-offset: 2px; }
@media (pointer: coarse) { .vui { top: 16px; padding: 9px 11px; } .vui button { font-size: 13px; }
  .vui-show { bottom: 20px; } }
/* L99 MOBILE BOTTOM-SHEET (touch only) — the edge editor panels (left tool rail + right properties card) re-dock to a
   thumb-reachable BOTTOM SHEET with two snap states: PEEK (handle + the horizontal tool row) and EXPANDED (+ the active
   tool's full properties). Built/mounted ONLY on coarse pointers; desktop keeps the edge panels untouched. */
.vui-sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 4; display: none; flex-direction: column;
  background: rgba(16,18,24,0.96); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  border-top: 1px solid rgba(184,153,104,0.30); border-radius: 18px 18px 0 0; box-shadow: 0 -10px 34px rgba(0,0,0,0.55);
  padding: 0 12px max(12px, env(safe-area-inset-bottom)); max-height: 72vh; color: #d8dde6;
  font: 600 13px/1 ui-monospace, monospace; pointer-events: auto; }
.vui-sheet.on { display: flex; }
.vui-sheet-grip { align-self: center; min-width: 44px; min-height: 28px; display: flex; align-items: center; justify-content: center;
  background: transparent; border: 0; cursor: pointer; padding: 8px; }
.vui-sheet-grip::before { content: ''; width: 40px; height: 5px; border-radius: 3px; background: rgba(255,255,255,0.28); }
.vui-sheet-grip:focus-visible { outline: 2px solid #e8c069; outline-offset: 2px; border-radius: 8px; }
.vui-sheet-title { font-size: 12px; color: #eef2f8; letter-spacing: .04em; padding: 2px 4px 8px; text-align: center; }
.vui-sheet-tools { display: flex; gap: 8px; overflow-x: auto; padding: 0 0 10px; -webkit-overflow-scrolling: touch; }
.vui-sheet-body { overflow-y: auto; padding-bottom: 8px; }
.vui-sheet.peek .vui-sheet-body, .vui-sheet.peek .vui-sheet-title { display: none; }   /* PEEK = grip + tools only */
/* in-sheet overrides: the rail + card lose their fixed-edge positioning and flow inside the sheet (rail goes horizontal). */
.vui-sheet .vui-rail { position: static; transform: none; display: flex; flex-direction: row; background: transparent;
  box-shadow: none; padding: 0; gap: 8px; }
.vui-sheet .vui-card { position: static; transform: none; display: flex; max-width: none; width: 100%; background: transparent;
  box-shadow: none; padding: 0; }
/* L99 FAB (touch) — a thumb primary action: open the ⌘K command palette. Sits above the sheet/bar, bottom-right. */
.vui-fab { position: fixed; right: 16px; bottom: max(20px, env(safe-area-inset-bottom)); z-index: 6; display: none;
  width: 56px; height: 56px; border-radius: 50%; border: 0; cursor: pointer; align-items: center; justify-content: center;
  background: #b89968; color: #1b1d24; font: 700 16px/1 ui-monospace, monospace; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
.vui-fab.on { display: inline-flex; }
.vui-fab:active { transform: scale(0.92); }
.vui-fab:focus-visible { outline: 3px solid #e8c069; outline-offset: 3px; }
/* L97 a11y — a visually-hidden live region (announces mode/zone swaps to screen readers without repainting
   controls silently). The clip-rect pattern keeps it in the a11y tree but off-screen for sighted users. */
.vui-live { position: fixed; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); clip-path: inset(50%); border: 0; white-space: nowrap; }
/* L97 a11y — a clear keyboard focus ring on every control zone (don't regress the L91 visible-focus win). */
.vui button:focus-visible, .vui-rail button:focus-visible, .vui-card button:focus-visible,
.vui-save button:focus-visible, .vui-more button:focus-visible, .vui-inspect button:focus-visible {
  outline: 2px solid #e8c069; outline-offset: 2px; }
`;

/* `controls` is the command bus from main.js. Every method maps to an existing key/verb:
   cam('iso'|'dimetric'|'persp') · post('auto'|'pixel'|'toon'|'none') · vector() [toggle] · city() ·
   shuffle() · time(0..1) · auto(). `state()` returns { cam, post, vector, auto, t, … } for highlighting.
   L55: post (crunch radio) + vector (material chip) are INDEPENDENT — vector layers onto any post mode. */
export function createViewerUI({ controls, state, show, coarse }) {
  if (typeof document === 'undefined') return;
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);

  const bar = document.createElement('div'); bar.className = 'vui';
  const info = document.createElement('div'); info.className = 'vui-info'; info.id = 'vui-info-panel';
  // L95: hint updated to the CURRENT bindings — WASD now PANS the camera (L88), weather moved to SHIFT+W, and
  // S still / R rec are armed only under ?capture (L88) so they're omitted from the public view's key list.
  info.innerHTML = 'KEYS · WASD move · 4/5/6 cam · 0 vector · 7/8 pixel/toon · B era · T time · [ ] scrub · 9 auto · '
    + 'Shift+W weather · K season · G shuffle · C city · I inspect · click a building / O office · J office skin · U painted props · Esc exit · M hide UI · H shadows · P theme · drag water to ripple';

  // helper: a labelled <button>
  const btn = (label, onClick, title) => {
    const b = document.createElement('button'); b.textContent = label; if (title) b.title = title;
    // L41 HAPTICS: a tiny tap buzz on touch devices. navigator.vibrate is feature-detected (optional
    // chaining) — desktop + iOS Safari lack it and no-op cleanly. The command-bus call is unchanged.
    b.addEventListener('click', (e) => { navigator.vibrate?.(10); onClick(e); });
    return b;
  };
  const segment = (items) => {            // a segmented control (mutually-exclusive buttons)
    const seg = document.createElement('div'); seg.className = 'seg';
    const btns = items.map(([label, val]) => { const b = btn(label, () => items.find((i) => i[1] === val)[2](), label); b.dataset.val = val; seg.appendChild(b); return b; });
    return { seg, btns };
  };
  // L74 helpers for the control card
  const labelEl = (text) => { const s = document.createElement('span'); s.className = 'clbl'; s.textContent = text; return s; };
  const rangeInput = (min, max, step, onInput, label) => {
    const r = document.createElement('input'); r.type = 'range'; r.min = String(min); r.max = String(max); r.step = String(step);
    if (label) r.setAttribute('aria-label', label);   // L110 (audit B13): a screen reader otherwise announces the sculpt sliders as an unnamed "slider"
    r.addEventListener('input', () => onInput(parseFloat(r.value)));
    return r;
  };

  /* Build EVERY control as a node up front, then assemble the bar differently per modality (L31):
     desktop = the full inline bar (unchanged); TOUCH = a compact PRIMARY row + a "More" overflow
     panel, so the bar never walls the small screen. */
  const cityBtn = btn('City', () => controls.city(), 'Next city profile (C)');
  const shuffleBtn = btn('Shuffle', () => controls.shuffle(), 'New random seed (G)');

  // --- Weather + Season (L18) — single cycling buttons whose label tracks the live state ---
  const WX = { clear: 'Clear', rain: 'Rain', snow: 'Snow', fog: 'Fog' };
  const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
  const wxBtn = btn('Clear', () => controls.weather(), 'Cycle weather: clear→rain→snow→fog (Shift+W)');   // L95: key is Shift+W (plain W now pans)
  const seasonBtn = btn('Spring', () => controls.season(), 'Cycle season: spring→summer→autumn→winter (K)');
  const officeBtn = btn('Office', () => controls.office(), 'Dive into / exit the office (O · Esc)');
  // L29: cycle the office look (stylized-3D → smooth-diffusion → charm-diffusion). Label tracks state.
  const SKIN_LBL = { '3d': '3D', dressed2: 'Dressed', night2: 'Night', modern: 'Modern', charm: 'Charm' };   // L59
  const skinBtn = btn('Skin', () => controls.officeSkin(), 'Office look: 3D → dressed → night → modern → charm diffusion (J)');
  // L30: under a skin, toggle the props between PAINTED (cohesive, baked in the skin) and LIVE 3D.
  const PROPS_LBL = { painted: 'Painted', '3d': 'Live 3D' };
  const propsBtn = btn('Props', () => controls.officeProps(), 'Office props: painted (cohesive) ↔ live 3D (animated) — under a skin (U)');
  // L63: the INSPECT lens toggle — free-fly + click/tap any car·person·bird·boat·cloud to follow it.
  const inspectBtn = btn('Inspect', () => controls.inspect(), 'Inspect: fly + click/tap any car·person·bird·boat·cloud to follow + watch its behaviour (I)');
  // L64: the procedural TERRAIN WORLD — a toggle + 🎲 reroll + a biome-preset cycle. The reroll + preset
  // buttons only make sense while a world is up, so refresh() shows/hides them with the world state.
  const WORLD_PRESET_LBL = { valley: 'Valley', archipelago: 'Archi', mountains: 'Mountains', plains: 'Plains' };
  const worldBtn = btn('World', () => controls.world(), 'Generate + explore a procedural terrain world');
  const worldRerollBtn = btn('🎲', () => controls.worldReroll(), 'New random world (seed) — G');
  const worldPresetBtn = btn('Valley', () => controls.worldPreset(), 'Cycle biome preset: valley → archipelago → mountains → plains');
  // L69/L70/L71: the ✎ EDITOR brush. The Edit chip toggles it; a tool segment routes the shared brush
  // (Sculpt = reshape · Paint = recolour the ground); a material palette appears for Paint.
  const sculptBtn = btn('✎ Edit', () => controls.sculpt && controls.sculpt(), 'World editor — brush the terrain (Sculpt to reshape, Paint to recolour)');
  // L74 — the MODE RAIL replaces the old inline tool toggle. Built lazily from the editor's tool list
  // (icon + number key); clicking switches tool. Mounts only in edit mode (refresh toggles `.open`).
  const rail = document.createElement('div'); rail.className = 'vui-rail';
  let railBtns = null;
  function buildRail(tools) {
    if (railBtns || !tools) return;
    railBtns = tools.map((t) => {
      const b = document.createElement('button'); b.dataset.id = t.id; b.title = `${t.label} (${t.key})`;
      b.innerHTML = `${t.icon}<span class="rk">${t.key}</span>`;
      b.addEventListener('click', () => { navigator.vibrate?.(10); controls.editTool && controls.editTool(t.id); });
      rail.appendChild(b); return b;
    });
  }
  // L74 — the per-tool CONTROL CARD (a floating panel that swaps its controls by active tool).
  const card = document.createElement('div'); card.className = 'vui-card';
  const cardTitle = document.createElement('div'); cardTitle.className = 'ct';
  const sizeRow = document.createElement('div'); sizeRow.className = 'crow';
  const sizeSlider = rangeInput(0.8, 6.0, 0.1, (v) => controls.brushSize && controls.brushSize(v), 'Brush size');
  sizeRow.append(labelEl('Size'), sizeSlider);
  const strengthRow = document.createElement('div'); strengthRow.className = 'crow';
  const strengthSlider = rangeInput(0.01, 0.15, 0.005, (v) => controls.brushStrength && controls.brushStrength(v), 'Sculpt strength');
  strengthRow.append(labelEl('Force'), strengthSlider);
  const densityRow = document.createElement('div'); densityRow.className = 'crow';
  const densitySlider = rangeInput(0.1, 1.0, 0.05, (v) => controls.brushDensity && controls.brushDensity(v), 'Scatter density');
  densityRow.append(labelEl('Density'), densitySlider);
  const sculptDirBtn = btn('↑ Raise', () => controls.sculptDir && controls.sculptDir(), 'Brush direction: raise ↔ lower / add ↔ erase / place ↔ delete');   // L70/L74
  const sculptUndoBtn = btn('↶ Undo', () => controls.worldUndo && controls.worldUndo(), 'Undo the last edit (Z)');                                    // L70/L71
  const worldResetBtn = btn('↺ Reset', () => controls.worldReset && controls.worldReset(), 'Reset to the generated world (discard edits) — same seed, NOT a reroll');  // L70
  const cardResetBtn = btn('↺ Reset', () => controls.worldReset && controls.worldReset(), 'Reset the world (discard edits) — same seed');   // L74 card copy
  const hideScatterBtn = btn('👁 Trees', () => controls.hideScatter && controls.hideScatter(), 'Hide the scatter (trees/rocks) to see the ground you are editing');   // L74
  // L71: PAINT MATERIAL palette — a row of colour swatches built lazily from the catalog materials.
  const paletteWrap = document.createElement('div'); paletteWrap.className = 'seg'; paletteWrap.style.display = 'none';
  let paletteBtns = null;
  function buildPalette(materials) {
    if (paletteBtns || !materials) return;
    paletteBtns = materials.map((mInfo, i) => {
      const sw = document.createElement('button');
      sw.title = mInfo.key; sw.style.cssText = `min-width:30px;padding:0;background:${mInfo.color};border:0;border-radius:8px;`;
      sw.addEventListener('click', () => { navigator.vibrate?.(8); controls.material && controls.material(i); });
      paletteWrap.appendChild(sw); return sw;
    });
  }
  // L72: OBJECT palette — icon buttons for the catalog scatter types (tree/rock/tuft); picks the 🌲 Objects brush
  //      type. Shown only while the Objects tool is active. Built lazily once (the catalog list is fixed).
  const scatterWrap = document.createElement('div'); scatterWrap.className = 'seg'; scatterWrap.style.display = 'none';
  let scatterBtns = null;
  function buildScatterPalette(kinds) {
    if (scatterBtns || !kinds) return;
    scatterBtns = kinds.map((k) => {
      const b = document.createElement('button');
      b.dataset.key = k.key; b.textContent = k.icon; b.title = k.label;
      b.style.cssText = 'min-width:30px;padding:4px 6px;';
      b.addEventListener('click', () => { navigator.vibrate?.(8); controls.scatterType && controls.scatterType(k.key); });
      scatterWrap.appendChild(b); return b;
    });
  }

  // L73: ENTITY palette — icon buttons for the catalog entity kinds (gull/boat/fish/cloud/person); picks the
  //      ✚ Place type. + a DROP-N chip group (×1/×10/×50). Both shown only while the Place tool is active.
  const entityWrap = document.createElement('div'); entityWrap.className = 'seg'; entityWrap.style.display = 'none';
  let entityBtns = null;
  function buildEntityPalette(kinds) {
    if (entityBtns || !kinds) return;
    entityBtns = kinds.map((k) => {
      const b = document.createElement('button');
      b.dataset.key = k.key; b.textContent = k.icon; b.title = k.label;
      b.style.cssText = 'min-width:30px;padding:4px 6px;';
      b.addEventListener('click', () => { navigator.vibrate?.(8); controls.entity && controls.entity(k.key); });
      entityWrap.appendChild(b); return b;
    });
  }
  const dropSeg = segment([
    ['×1', '1', () => controls.dropN && controls.dropN(1)],
    ['×10', '10', () => controls.dropN && controls.dropN(10)],
    ['×50', '50', () => controls.dropN && controls.dropN(50)],
  ]);
  dropSeg.seg.style.display = 'none';
  dropSeg.seg.title = 'How many to drop per click (scattered in the ring)';

  // L74 — ASSEMBLE the control card: title, the always-on brush-size row, then the per-tool control groups
  // (refresh() shows/hides each by active tool), then the shared dir/undo/reset/hide-scatter actions.
  const cardActions = document.createElement('div'); cardActions.className = 'crow';
  cardActions.append(sculptDirBtn, sculptUndoBtn, cardResetBtn, hideScatterBtn);
  card.append(cardTitle, sizeRow, strengthRow, paletteWrap, scatterWrap, densityRow, entityWrap, dropSeg.seg, cardActions);

  // L75 — the SAVE / LOAD panel (top-right): a named-slot store + JSON file export/import + a best-effort share link.
  const save = document.createElement('div'); save.className = 'vui-save';
  const saveTitle = document.createElement('div'); saveTitle.className = 'ct'; saveTitle.textContent = '💾 Save / Load';
  const nameInput = document.createElement('input'); nameInput.type = 'text'; nameInput.placeholder = 'world name'; nameInput.value = 'my-world';
  nameInput.setAttribute('aria-label', 'World name');   // L110 (audit B13): accessible name (placeholder ≠ a label to AT)
  const slotSelect = document.createElement('select'); let slotKnown = '';
  slotSelect.setAttribute('aria-label', 'Saved worlds');   // L110 (audit B13)
  slotSelect.addEventListener('change', () => { if (slotSelect.value) nameInput.value = slotSelect.value; });
  const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = '.json,application/json'; fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) { controls.importWorld(fileInput.files[0]); fileInput.value = ''; } });
  const saveBtn = btn('💾 Save', () => controls.saveWorld(nameInput.value.trim()), 'Save to this device (a named slot)');
  const loadBtn = btn('📂 Load', () => controls.loadWorld(nameInput.value.trim()), 'Load the named slot');
  const delBtn = btn('🗑', () => controls.deleteWorld(nameInput.value.trim()), 'Delete the named slot');
  const exportBtn = btn('⬇ Export', () => controls.exportWorld(nameInput.value.trim()), 'Download the world as a JSON file (portable, lossless)');
  const importBtn = btn('⬆ Import', () => fileInput.click(), 'Load a world from a JSON file');
  const shareBtn = btn('🔗 Link', () => controls.shareLink(), 'Copy a shareable link (light edits only — else use Export)');
  const saveStatus = document.createElement('div'); saveStatus.className = 'st';
  const slotRow = document.createElement('div'); slotRow.className = 'srow'; slotRow.append(nameInput);
  const slotRow2 = document.createElement('div'); slotRow2.className = 'srow'; slotRow2.append(slotSelect);
  const saveRow = document.createElement('div'); saveRow.className = 'srow'; saveRow.append(saveBtn, loadBtn, delBtn);
  const fileRow = document.createElement('div'); fileRow.className = 'srow'; fileRow.append(exportBtn, importBtn, shareBtn);
  save.append(saveTitle, slotRow, slotRow2, saveRow, fileRow, saveStatus, fileInput);

  // L67: the "Realistic" showcase preset — one tap to the cinematic beauty tier (ACES + bloom + graded sky).
  const realisticBtn = btn('✨ Realistic', () => controls.realistic(), 'Cinematic beauty look — atmospheric sky, glowing sun, colour-graded (showcase)');

  // --- POST-mode segmented (L55) — the crunch chain: AUTO (zoom morph) / Pixel / Toon / None. This is a
  //     mutually-exclusive radio (you're in exactly one post-mode). VECTOR was split OUT of here into its own
  //     independent chip below — it's a MATERIAL flag, orthogonal to post, so it LAYERS onto any of these
  //     (Vector+Pixel = flat-vector pixel-crunched, etc.). + an ERA cycle (L27). ---
  const styleSeg = segment([
    ['Auto', 'auto', () => controls.post('auto')],
    ['Pixel', 'pixel', () => controls.post('pixel')],
    ['Toon', 'toon', () => controls.post('toon')],
    ['None', 'none', () => controls.post('none')],
  ]);
  styleSeg.btns[0].title = 'AUTO: zoom morphs the style (toon → 16-bit → 8-bit → Game Boy)';
  styleSeg.btns[3].title = 'NONE: raw beauty render, no post-crunch (clean flat-vector when Vector is on)';
  // L55 VECTOR chip — an independent ON/OFF toggle (flat-shaded materials), separate from the post radio so
  // it composes with any post-mode. Label/`.on` track the live state in refresh().
  const vectorBtn = btn('Vector', () => controls.vector(), 'Flat-vector materials — LAYERS onto the post mode (Vector + Pixel/Toon/Auto). Toggle (0)');
  const ERA_LBL = { native: 'Era', gb: 'GB', '8-bit': '8-bit', '16-bit': '16-bit', modern: 'Modern', '1-bit': '1-bit' };
  const eraBtn = btn('Era', () => controls.era(), 'Cycle the pixel era (B): native → GB → 8-bit → 16-bit → Modern');

  // --- Time: a day slider + play/pause for the auto-cycle ---
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = '0'; slider.max = '1'; slider.step = '0.01';
  slider.title = 'Time of day'; slider.setAttribute('aria-label', 'Time of day');   // L110 (audit B13): accessible name
  let dragging = false;
  slider.addEventListener('pointerdown', () => { dragging = true; });
  slider.addEventListener('pointerup', () => { dragging = false; });
  slider.addEventListener('pointercancel', () => { dragging = false; });   // L110 (audit B13): a cancelled touch drag (no pointerup) otherwise leaves `dragging` latched true → the slider stops syncing to the clock forever
  slider.addEventListener('input', () => controls.time(parseFloat(slider.value)));
  const playBtn = btn('▶', () => controls.auto(), 'Play/pause day cycle (9)');
  // L97: the time SLIDER stays primary on the bar; play/auto moves into the environment expander.
  const timeWrap = document.createElement('div'); timeWrap.style.cssText = 'display:flex;align-items:center;gap:6px;';
  const tlbl = document.createElement('span'); tlbl.className = 'lbl'; tlbl.textContent = 'Day';
  timeWrap.append(tlbl, slider);
  // L97 — the still-key-only Shadows (H) + Theme (P) are now surfaced as bar controls (inside the env expander).
  const shadowsBtn = btn('☀ Shadows', () => controls.shadows && controls.shadows(), 'Sun shadows on/off (H)');
  const themeBtn = btn('◐ Theme', () => controls.theme && controls.theme(), 'Swap the UI palette: ink/gold ↔ terminal (P)');
  // L97 progressive disclosure — the ENVIRONMENT/VIEW expander (auto · weather · season · shadows · theme).
  const envPanel = document.createElement('div'); envPanel.className = 'vui-env'; envPanel.id = 'vui-env-panel';
  envPanel.setAttribute('role', 'group'); envPanel.setAttribute('aria-label', 'Environment and view settings');
  // L110 (audit B13): a disclosure button must expose its open/closed state + what it controls (WCAG 4.1.2), like the sheet grip.
  const envBtn = btn('⚙ More ▾', () => { const open = envPanel.classList.toggle('open'); envBtn.setAttribute('aria-expanded', String(open)); }, 'Environment & view: day/night play · weather · season · shadows · theme');
  envBtn.setAttribute('aria-expanded', 'false'); envBtn.setAttribute('aria-controls', 'vui-env-panel');

  // --- Camera segmented (Iso / Dimetric / Perspective) ---
  const camSeg = segment([
    ['Iso', 'iso', () => controls.cam('iso')],
    ['Dim', 'dimetric', () => controls.cam('dimetric')],
    ['3D', 'persp', () => controls.cam('persp')],
  ]);

  const infoBtn = btn('ⓘ', () => { const open = info.classList.toggle('open'); infoBtn.setAttribute('aria-expanded', String(open)); }, 'All keys');
  infoBtn.setAttribute('aria-expanded', 'false'); infoBtn.setAttribute('aria-controls', 'vui-info-panel');   // L110 (audit B13)
  const minBtn = btn('⌄', () => setHidden(true), 'Hide controls — watch unobstructed (M)');

  /* L99 ⌘K COMMAND PALETTE — a view over the SAME `controls` action bus (one source of truth). The registry is one
     table; the palette indexes it. Shortcuts shown match the keymap. Save/Load stay in their panel (they need a name). */
  const COMMANDS = [
    { group: 'Modes', label: 'Go to City', shortcut: '', run: () => controls.mode('city') },
    { group: 'Modes', label: 'Go to World — terrain editor', shortcut: '', run: () => controls.mode('world') },
    { group: 'Modes', label: 'Go to Office', shortcut: 'O', run: () => controls.mode('office') },
    { group: 'Modes', label: 'Go to Hoard — the game', shortcut: 'X', run: () => controls.mode('hoard') },
    { group: 'Camera', label: 'Camera: Perspective (3D orbit)', shortcut: '4', run: () => controls.cam('persp') },
    { group: 'Camera', label: 'Camera: Isometric', shortcut: '5', run: () => controls.cam('iso') },
    { group: 'Camera', label: 'Camera: Dimetric (2:1)', shortcut: '6', run: () => controls.cam('dimetric') },
    { group: 'Art', label: 'Art tier: Auto LOD (zoom morph)', shortcut: '3', run: () => controls.post('auto') },
    { group: 'Art', label: 'Art tier: Pixel', shortcut: '7', run: () => controls.post('pixel') },
    { group: 'Art', label: 'Art tier: Toon', shortcut: '8', run: () => controls.post('toon') },
    { group: 'Art', label: 'Art tier: Raw (no crunch)', shortcut: '1', run: () => controls.post('none') },
    { group: 'Art', label: 'Toggle Vector (flat materials)', shortcut: '0', run: () => controls.vector() },
    { group: 'Art', label: 'Realistic — cinematic beauty', shortcut: '', run: () => controls.realistic() },
    { group: 'Art', label: 'Cycle pixel Era', shortcut: 'B', run: () => controls.era() },
    { group: 'Environment', label: 'Play / pause day-night', shortcut: '9', run: () => controls.auto() },
    { group: 'Environment', label: 'Time of day: Dawn', shortcut: '', run: () => controls.time(0.25) },
    { group: 'Environment', label: 'Time of day: Noon', shortcut: '', run: () => controls.time(0.5) },
    { group: 'Environment', label: 'Time of day: Dusk', shortcut: '', run: () => controls.time(0.75) },
    { group: 'Environment', label: 'Time of day: Night', shortcut: '', run: () => controls.time(0.0) },
    { group: 'Environment', label: 'Cycle Weather', shortcut: 'Shift+W', run: () => controls.weather() },
    { group: 'Environment', label: 'Cycle Season', shortcut: 'K', run: () => controls.season() },
    { group: 'Environment', label: 'Toggle sun Shadows', shortcut: 'H', run: () => controls.shadows && controls.shadows() },
    { group: 'Environment', label: 'Swap UI Theme', shortcut: 'P', run: () => controls.theme && controls.theme() },
    { group: 'City', label: 'Next city profile', shortcut: 'C', run: () => controls.city() },
    { group: 'City', label: 'Shuffle city seed', shortcut: 'G', run: () => controls.shuffle() },
    { group: 'City', label: 'Inspect — follow a car/person/bird…', shortcut: 'I', run: () => controls.inspect() },
    { group: 'Office', label: 'Cycle office look (skin)', shortcut: 'J', run: () => controls.officeSkin() },
    { group: 'Office', label: 'Office props: painted ↔ live 3D', shortcut: 'U', run: () => controls.officeProps() },
    { group: 'World editor', label: 'Toggle ✎ Sculpt editor', shortcut: '', run: () => controls.sculpt && controls.sculpt() },
    { group: 'World editor', label: 'New random world', shortcut: 'G', run: () => controls.worldReroll && controls.worldReroll() },
    { group: 'World editor', label: 'Reset world (discard edits)', shortcut: '', run: () => controls.worldReset && controls.worldReset() },
    { group: 'World editor', label: 'Cycle biome preset', shortcut: '', run: () => controls.worldPreset && controls.worldPreset() },
    { group: 'World editor', label: 'Undo last edit', shortcut: 'Z', run: () => controls.worldUndo && controls.worldUndo() },
    { group: 'World editor', label: 'Export world (JSON file)', shortcut: '', run: () => controls.exportWorld && controls.exportWorld('my-world') },
    { group: 'World editor', label: 'Copy share link', shortcut: '', run: () => controls.shareLink && controls.shareLink() },
    { group: 'View', label: 'Hide / show controls', shortcut: 'M', run: () => toggle() },
    { group: 'View', label: 'Show all keyboard shortcuts', shortcut: '', run: () => info.classList.add('open') },
  ];
  const cmdk = createCommandPalette({ commands: COMMANDS });
  const cmdkBtn = btn('⌘K', () => cmdk.open(), 'Command palette — run anything (⌘K / Ctrl-K)');

  // L97 UNIFIED MODE-SWITCH (spec §2) — one segmented City·World·Office·Hoard control (top-left of the bar) that
  // drives the scene mode via controls.mode(...). Replaces the old separate World/Office toggles + key-only Hoard.
  // refresh() filters the segments by the audience (audienceModes) + highlights the active mode in gold.
  const modeSwitch = segment([
    ['City', 'city', () => controls.mode('city')],
    ['World', 'world', () => controls.mode('world')],
    ['Office', 'office', () => controls.mode('office')],
    ['Hoard', 'hoard', () => controls.mode('hoard')],
  ]);
  modeSwitch.btns[0].title = 'City — the living skyline'; modeSwitch.btns[1].title = 'World — the procedural terrain editor';
  modeSwitch.btns[2].title = 'Office — dive into the building'; modeSwitch.btns[3].title = 'Hoard — the survival game';

  // L31 "More" overflow panel (touch) + its toggle button.
  const more = document.createElement('div'); more.className = 'vui-more'; more.id = 'vui-more-panel';
  const moreBtn = btn('More', () => { const open = more.classList.toggle('open'); moreBtn.setAttribute('aria-expanded', String(open)); positionMore(); }, 'More controls');
  moreBtn.setAttribute('aria-expanded', 'false'); moreBtn.setAttribute('aria-controls', 'vui-more-panel');   // L110 (audit B13)

  if (coarse) {
    // TOUCH: a compact PRIMARY row; everything secondary lives behind "More" (engine owns the landing).
    // L97: the segmented mode-switch leads; playBtn + the post radio stay primary; the rest goes to More.
    bar.append(modeSwitch.seg, inspectBtn, playBtn, styleSeg.seg, cmdkBtn, moreBtn, minBtn);
    const dayWrap = document.createElement('div'); dayWrap.style.cssText = 'display:flex;align-items:center;gap:6px;';
    dayWrap.append(tlbl, slider);
    more.append(cityBtn, shuffleBtn, realisticBtn, worldRerollBtn, worldResetBtn, worldPresetBtn, sculptBtn, wxBtn, seasonBtn, shadowsBtn, themeBtn, skinBtn, propsBtn, vectorBtn, eraBtn, camSeg.seg, dayWrap);   // L74 tools→rail/card; L97: + shadows/theme
    // (ⓘ omitted on touch — it's a keyboard list; the tap-bar + tooltips cover discovery.)
  } else {
    // DESKTOP: the four-zone global bar — L97 GROUPS (gold only on active): mode-switch | scene-content | world-edit |
    // art | environment (slider primary + ⚙ expander) | camera | view. The unified mode-switch leads (top-left); the
    // World/Office toggles are GONE (the switcher replaces them). Mode-contextual refresh() hides inapplicable groups,
    // and the secondary environment controls (auto/weather/season/shadows/theme) live behind the ⚙ expander.
    bar.append(modeSwitch.seg, sep(),
      cityBtn, shuffleBtn, skinBtn, propsBtn, inspectBtn, sep(),                                 // scene content (mode-gated)
      worldRerollBtn, worldResetBtn, worldPresetBtn, sculptBtn, sep(),                           // world-edit (world only)
      styleSeg.seg, realisticBtn, vectorBtn, eraBtn, sep(), timeWrap, envBtn, sep(), camSeg.seg, cmdkBtn, infoBtn, sep(), minBtn);
    envPanel.append(playBtn, wxBtn, seasonBtn, shadowsBtn, themeBtn);                            // L97: the environment expander contents
  }

  /* L63 INSPECT readout panel (top-left): a kind chip, the live behaviour line, and a [▸ Next] / [✕]
     row. Built once; setInspect() fills + shows/hides it each frame from main's tick. */
  const inspectPanel = document.createElement('div'); inspectPanel.className = 'vui-inspect';
  const inspKind = document.createElement('div'); inspKind.className = 'ik';
  const inspTitle = document.createElement('div'); inspTitle.className = 'it';
  const inspInfo = document.createElement('div'); inspInfo.className = 'ii';
  const inspRow = document.createElement('div'); inspRow.className = 'ir';
  const inspNextBtn = btn('▸ Next', () => controls.inspectNext && controls.inspectNext(), 'Follow the next object (Tab)');
  const inspExitBtn = btn('✕', () => controls.inspect(), 'Exit inspect (Esc)');
  inspRow.append(inspNextBtn, inspExitBtn);
  inspectPanel.append(inspKind, inspTitle, inspInfo, inspRow);

  const pill = document.createElement('button');
  pill.className = 'vui-show'; pill.innerHTML = '⌃ Controls';
  pill.title = 'Show controls (M)';
  pill.addEventListener('click', () => setHidden(false));

  // L27 style-hint pill (top-centre); pointer-events none so it never blocks the canvas.
  const stylePill = document.createElement('div'); stylePill.className = 'vui-style';

  // L97 a11y — each control ZONE is a labelled toolbar/group (so a screen reader announces "Global controls
   // toolbar" / "Tools toolbar" / "Tool properties group" on entry), and a live region announces mode swaps.
  bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Global controls');
  rail.setAttribute('role', 'toolbar'); rail.setAttribute('aria-label', 'Tools'); rail.setAttribute('aria-orientation', 'vertical');
  card.setAttribute('role', 'group'); card.setAttribute('aria-label', 'Tool properties');
  save.setAttribute('role', 'group'); save.setAttribute('aria-label', 'Save and load worlds');
  const liveRegion = document.createElement('div'); liveRegion.className = 'vui-live';
  liveRegion.setAttribute('role', 'status'); liveRegion.setAttribute('aria-live', 'polite');
  document.body.append(info, more, bar, pill, stylePill, inspectPanel, rail, card, save, liveRegion, envPanel);   // L74/L75: + rail + card + save; L97: + live region + env expander
  const available = show;          // ?ui=0 → no UI at all (clean embed): no bar, no pill, no hint

  /* L99 MOBILE BOTTOM-SHEET + FAB (touch only) — RE-DOCK the editor's left tool rail + right properties card into one
     thumb-reachable bottom sheet (peek = grip + tool row; expand = + properties), and add a ⌘K FAB. Built only on a
     coarse pointer + when the UI is available; desktop keeps the edge panels exactly as Phase 1 left them. */
  let sheet = null, fab = null;
  if (coarse && available) {
    sheet = document.createElement('div'); sheet.className = 'vui-sheet';
    sheet.setAttribute('role', 'group'); sheet.setAttribute('aria-label', 'Editor tools and properties');
    const grip = document.createElement('button'); grip.className = 'vui-sheet-grip';
    grip.title = 'Expand / collapse'; grip.setAttribute('aria-label', 'Expand or collapse the editor sheet'); grip.setAttribute('aria-expanded', 'true');
    const sheetTitle = document.createElement('div'); sheetTitle.className = 'vui-sheet-title'; sheetTitle.textContent = '✎ Editor';
    const sheetTools = document.createElement('div'); sheetTools.className = 'vui-sheet-tools';
    const sheetBody = document.createElement('div'); sheetBody.className = 'vui-sheet-body';
    sheetTools.append(rail); sheetBody.append(card);                         // re-parent the edge panels into the sheet
    sheet.append(grip, sheetTitle, sheetTools, sheetBody);
    grip.addEventListener('click', () => { navigator.vibrate?.(8); const peek = sheet.classList.toggle('peek'); grip.setAttribute('aria-expanded', String(!peek)); });
    document.body.append(sheet);
    fab = document.createElement('button'); fab.className = 'vui-fab on'; fab.textContent = '⌘K';
    fab.title = 'Command palette'; fab.setAttribute('aria-label', 'Open the command palette');
    fab.addEventListener('click', () => { navigator.vibrate?.(10); cmdk.open(); });
    document.body.append(fab);
  }
  let hidden = false;
  // L31: on TOUCH, default-MINIMIZED — the landing is pure engine + the "⌃ Controls" pill (one tap in).
  setHidden(coarse);

  // --- highlight the ACTIVE style/camera + sync the slider — poll the live state cheaply ---
  let lastAnnouncedMode = null;   // L97 a11y: only announce a mode swap on CHANGE (refresh polls at 5Hz)
  function refresh() {
    const s = state();
    styleSeg.btns.forEach((b) => b.classList.toggle('on', b.dataset.val === s.post));   // L55: post-mode radio
    vectorBtn.classList.toggle('on', !!s.vector);                                       // L55: independent Vector chip
    camSeg.btns.forEach((b) => b.classList.toggle('on', b.dataset.val === s.cam));
    wxBtn.textContent = WX[s.weather] || 'Clear'; wxBtn.classList.toggle('on', s.weather !== 'clear');
    seasonBtn.textContent = SEASONS[s.season] || 'Spring'; seasonBtn.classList.toggle('on', (s.season || 0) > 0);
    officeBtn.textContent = s.office ? 'Exit' : 'Office'; officeBtn.classList.toggle('on', !!s.office);
    skinBtn.textContent = SKIN_LBL[s.officeSkin] || 'Skin'; skinBtn.classList.toggle('on', s.officeSkin && s.officeSkin !== '3d');
    propsBtn.textContent = PROPS_LBL[s.officeProps] || 'Props'; propsBtn.classList.toggle('on', s.officeProps === 'painted' && s.officeSkin && s.officeSkin !== '3d');
    playBtn.textContent = s.auto ? '❚❚' : '▶'; playBtn.classList.toggle('on', s.auto);
    eraBtn.textContent = ERA_LBL[s.era] || 'Era'; eraBtn.classList.toggle('on', s.era && s.era !== 'native');
    inspectBtn.textContent = s.inspect ? 'Exit' : 'Inspect'; inspectBtn.classList.toggle('on', !!s.inspect);   // L63
    worldBtn.textContent = s.world ? 'Exit' : 'World'; worldBtn.classList.toggle('on', !!s.world);             // L64
    worldPresetBtn.textContent = WORLD_PRESET_LBL[s.worldPreset] || 'Valley';
    worldRerollBtn.style.display = s.world ? '' : 'none';     // 🎲 + reset + preset + sculpt only matter while a world is up
    worldResetBtn.style.display = s.world ? '' : 'none';      // L70
    worldPresetBtn.style.display = s.world ? '' : 'none';
    sculptBtn.style.display = s.world ? '' : 'none';
    /* L97 MODE-CONTEXTUAL top bar (spec §1.2/§3): show only the controls relevant to the ACTIVE mode — you never
       see office looks in the city or city tools in the office. A pure function of the mode (render(mode)→controls). */
    const cm = s.currentMode;                                  // 'city'|'world'|'office'|'hoard' (handles diving states)
    const inCity = cm === 'city', inWorld = cm === 'world', inOffice = cm === 'office';
    const outdoors = inCity || inWorld;                        // weather/season read outdoors, not in the office/hoard
    // L97 UNIFIED MODE-SWITCH — filter the segments by AUDIENCE (spec §2) + highlight the active mode (gold).
    const allowed = s.audienceModes || ['city', 'world', 'office', 'hoard'];
    modeSwitch.btns.forEach((b) => { const m = b.dataset.val; b.style.display = allowed.includes(m) ? '' : 'none'; b.classList.toggle('on', m === cm); });
    cityBtn.style.display = inCity ? '' : 'none';              // city profile + shuffle — open city only (world has its own reroll)
    shuffleBtn.style.display = inCity ? '' : 'none';
    inspectBtn.style.display = inCity ? '' : 'none';           // the inspect lens — open city only
    skinBtn.style.display = inOffice ? '' : 'none';            // office look + props — office only
    propsBtn.style.display = inOffice ? '' : 'none';
    wxBtn.style.display = outdoors ? '' : 'none';              // weather + season — outdoors
    seasonBtn.style.display = outdoors ? '' : 'none';
    // L97 a11y — ANNOUNCE the mode/contextual swap so a screen reader isn't left with silently-repainted controls.
    const modeLabel = inWorld ? (s.sculpt ? 'World editor — editing' : 'World') : inOffice ? 'Office' : cm === 'hoard' ? 'Hoard' : 'City';
    if (modeLabel !== lastAnnouncedMode) { lastAnnouncedMode = modeLabel; liveRegion.textContent = `${modeLabel} mode — controls updated`; }
    shadowsBtn.classList.toggle('on', !!s.shadows);           // L97: env expander — shadows on
    themeBtn.classList.toggle('on', !!s.theme);               // L97: env expander — terminal palette on
    sculptBtn.classList.toggle('on', !!s.sculpt);             // L69/L71: editor brush active
    // L74 — the MODE RAIL + per-tool CONTROL CARD (both mount only while the editor is open).
    buildRail(s.tools);
    rail.classList.toggle('open', !!s.sculpt);
    if (railBtns) railBtns.forEach((b) => b.classList.toggle('on', b.dataset.id === s.editTool));
    card.classList.toggle('open', !!s.sculpt);
    if (sheet) sheet.classList.toggle('on', !!s.sculpt);   // L99: the bottom sheet shows while the ✎ editor is open (touch)
    const tool = s.editTool;
    const painting = tool === 'paint', scattering = tool === 'scatter', placing = tool === 'place', sculpting2 = tool === 'sculpt';
    cardTitle.textContent = ({ place: '✚ Place', sculpt: '⛰ Sculpt', paint: '🎨 Paint', scatter: '🌲 Objects', select: '◳ Select' })[tool] || 'Editor';
    sizeRow.style.display = tool === 'select' ? 'none' : '';   // size applies to every brush tool
    strengthRow.style.display = sculpting2 ? '' : 'none';      // force = sculpt only
    densityRow.style.display = scattering ? '' : 'none';       // density = objects only
    buildPalette(s.materials);                                 // L71: material swatches (paint)
    paletteWrap.style.display = painting ? '' : 'none';
    if (paletteBtns) paletteBtns.forEach((b, i) => b.classList.toggle('on', i === s.material));
    buildScatterPalette(s.scatterKinds);                       // L72: object icons (objects)
    scatterWrap.style.display = scattering ? '' : 'none';
    if (scatterBtns) scatterBtns.forEach((b) => b.classList.toggle('on', b.dataset.key === s.scatterType));
    buildEntityPalette(s.entityKinds);                         // L73: entity icons (place)
    entityWrap.style.display = placing ? '' : 'none';
    if (entityBtns) entityBtns.forEach((b) => b.classList.toggle('on', b.dataset.key === s.entityKind));
    dropSeg.seg.style.display = placing ? '' : 'none';         // drop-count chips (place)
    dropSeg.btns.forEach((b) => b.classList.toggle('on', b.dataset.val === String(s.dropN)));
    // the dir toggle = the 2nd action per tool (sculpt raise/lower · objects add/erase · place/delete); hidden for paint/select
    sculptDirBtn.style.display = (scattering || placing || sculpting2) ? '' : 'none';
    sculptDirBtn.textContent = placing ? (s.sculptRaise ? '➕ Place' : '🗑 Delete') : scattering ? (s.sculptRaise ? '➕ Add' : '➖ Erase') : (s.sculptRaise ? '↑ Raise' : '↓ Lower');
    sculptUndoBtn.disabled = !s.canUndo; sculptUndoBtn.style.opacity = s.canUndo ? '' : '0.45';
    hideScatterBtn.classList.toggle('on', !!s.scatterHidden);
    sizeSlider.value = String(s.brushRadius); strengthSlider.value = String(s.brushStrength); densitySlider.value = String(s.brushDensity);
    // L75 — the SAVE / LOAD panel: mounts in edit mode; keep the slot dropdown + status line in sync.
    save.classList.toggle('open', !!s.sculpt);
    const slots = s.saveSlots || []; const slotKey = slots.join(',');
    if (slotKey !== slotKnown) {   // rebuild the <select> only when the slot set changes (don't fight typing)
      slotKnown = slotKey;
      slotSelect.innerHTML = '';
      const opt0 = document.createElement('option'); opt0.value = ''; opt0.textContent = slots.length ? `— ${slots.length} saved —` : '— no saves —'; slotSelect.append(opt0);
      for (const n of slots) { const o = document.createElement('option'); o.value = n; o.textContent = n; slotSelect.append(o); }
    }
    saveStatus.textContent = s.saveStatus || '';
    realisticBtn.classList.toggle('on', !!s.realistic);       // L67: highlight when the beauty tier is active
    if (!dragging) slider.value = String(s.t);
  }
  refresh();
  const timer = setInterval(refresh, 200);

  /* Collapse / restore the bar. When the UI isn't available at all (?ui=0, a clean embed) both
     the bar AND the pill stay hidden — minimize is a no-op there. Otherwise hiding the bar shows
     the corner pill (and vice-versa), so the control is always one tap from coming back. */
  function setHidden(v) {
    if (!available) { bar.style.display = 'none'; pill.classList.remove('on'); info.classList.remove('open'); more.classList.remove('open'); stylePill.classList.remove('on'); infoBtn.setAttribute('aria-expanded', 'false'); moreBtn.setAttribute('aria-expanded', 'false');   /* L110 (audit B13): keep the disclosure state honest when force-closed */ return; }
    hidden = v;
    bar.style.display = v ? 'none' : 'flex';
    pill.classList.toggle('on', v);
    if (v) { info.classList.remove('open'); more.classList.remove('open'); stylePill.classList.remove('on'); infoBtn.setAttribute('aria-expanded', 'false'); moreBtn.setAttribute('aria-expanded', 'false');   /* L110 (audit B13): keep the disclosure state honest when force-closed */ }  // minimize hides the More panel + hint too
  }
  function toggle() { setHidden(!hidden); }

  /* L54 mobile fix — the "More" panel is fixed-positioned, but on a narrow phone the PRIMARY bar
     FLEX-WRAPS to several rows (variable height). A magic `bottom:84px` collided with the wrapped bar
     ("more controls hidden behind the previous controls"). Instead, MEASURE the bar's top edge and park
     More just above it — correct at any wrap height. (Desktop never opens More, so this is a no-op there.) */
  function positionMore() {
    if (!more.classList.contains('open')) return;
    const r = bar.getBoundingClientRect();
    more.style.top = Math.round(r.bottom + 8) + 'px';   // L97: park the More panel BELOW the top bar (the bar is top-docked now)
    more.style.bottom = 'auto';
  }
  const onResize = () => positionMore();   // re-anchor if the bar re-wraps (rotate / resize)
  window.addEventListener('resize', onResize);

  /* L27 — main.js calls this each frame with the current look name ('' = nothing to show). We only
     touch the DOM on a CHANGE, then auto-fade after a couple idle seconds (so it shows while you
     zoom and quietly leaves when you stop). Suppressed entirely when minimized or ?ui=0. */
  let lastHint = null, hintTimer = null;
  function setStyleHint(text) {
    if (!available || hidden) { stylePill.classList.remove('on'); lastHint = null; return; }
    if (!text) { stylePill.classList.remove('on'); lastHint = ''; return; }
    if (text === lastHint) return;
    lastHint = text;
    stylePill.textContent = text;
    stylePill.classList.add('on');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => stylePill.classList.remove('on'), 2000);
  }

  /* L63 — main calls this each frame with the inspection state: a `{kind,label,info}` readout while
     FOLLOWING (shows the object + its live behaviour), a `{hint}` while flying-but-not-locked (a prompt),
     or null when the lens is off (panel hidden). Only touches the DOM on a change of text. */
  let lastInspect = null;
  function setInspect(r) {
    if (!available || !r) { inspectPanel.classList.remove('open'); lastInspect = null; return; }
    const sig = r.hint ? `hint:${r.hint}` : `${r.kind}|${r.info}`;
    if (sig === lastInspect) return;        // no change → skip the DOM write
    lastInspect = sig;
    if (r.hint) {                            // flying, nothing locked yet
      inspKind.textContent = 'INSPECT'; inspTitle.textContent = 'Free-fly'; inspInfo.textContent = r.hint;
      inspNextBtn.style.display = '';
    } else {                                 // locked onto an object
      inspKind.textContent = r.kind; inspTitle.textContent = r.label || r.kind; inspInfo.textContent = r.info || '';
      inspNextBtn.style.display = '';
    }
    inspectPanel.classList.add('open');
  }

  // L91 H-minor (a11y) — mirror each control's `title` into an `aria-label`: the buttons' textContent is an
  // emoji/icon, so a screen reader otherwise announces nothing meaningful. One pass covers every creation site.
  [bar, info, more, pill, stylePill, inspectPanel, rail, card, save, envPanel, sheet, style].forEach((el) => el && el.querySelectorAll && el.querySelectorAll('button[title]:not([aria-label])').forEach((b) => b.setAttribute('aria-label', b.title)));

  // L104 a11y seam — let a project post a status message to the shared .vui-live region (WCAG 4.1.3). The pilot
  // HUD uses this to announce possess/release/exit; any project inherits it (engine-first, no per-project live region).
  function announce(text) { if (liveRegion && text) { liveRegion.textContent = ''; liveRegion.textContent = String(text); } }
  // L110 (audit P0-5) — let a project HIDE the touch ⌘K FAB while another bottom-right affordance owns the corner
  // (the pilot HUD's CLIMB/DESCEND lift cluster overlaps it exactly). Engine-first seam; the FAB only exists on coarse
  // pointers (fab is null on desktop → no-op). Toggling `.on` drives its display (see .vui-fab.on).
  function setFabVisible(v) { if (fab) fab.classList.toggle('on', !!v); }
  return { toggle, setHidden, refresh, setStyleHint, setInspect, announce, setFabVisible, destroy() { clearInterval(timer); window.removeEventListener('resize', onResize); bar.remove(); info.remove(); more.remove(); pill.remove(); stylePill.remove(); inspectPanel.remove(); rail.remove(); card.remove(); save.remove(); liveRegion.remove(); envPanel.remove(); if (sheet) sheet.remove(); if (fab) fab.remove(); cmdk.destroy(); style.remove(); clearTimeout(hintTimer); } };

  function sep() { const s = document.createElement('div'); s.className = 'sep'; return s; }
}
