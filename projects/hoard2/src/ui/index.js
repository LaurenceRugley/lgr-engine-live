/* ============================================================
   hoard2 · src/ui — THE GAME UI (DOM overlay: HUD · bag+crafting · pause · death).
   ------------------------------------------------------------
   OWNS: the HUD (HP/hunger/stamina bars, wave #, score, wood/scrap materials), the 8-slot inventory +
   crafting UI (config.BAG_SLOTS — opening it PAUSES the sim), the pause menu, and the death→restart/quit
   screen (DONE #6). Everything is a DOM overlay over the WebGL canvas — no Three.js, no engine imports,
   so this file is node-testable (the engine barrel is never touched here → no shader-load-in-node death).

   THE PAUSE RULE (non-negotiable): the UI NEVER freezes the sim itself. Opening the bag/menu emits
   `game:pause`; closing emits `game:resume`. main.js's core is the SOLE time authority — it listens for
   those events and calls time.setPaused(). We only ever emit. (Contract: "core executes".)

   RESTART (DONE #6): a full page reload with the SAME seed. main.js resolves the running seed into
   `window.__seed`; restartUrl() writes it back onto the query string so the reload is CLEAN (no state
   bleed — a fresh module graph) and SEEDED (same seed → identical run) even if the URL had no ?seed.

   ARCHITECTURE: `createUiController` is a DOM-FREE state machine (bag/menu/death flags + bag model) that
   only reads snapshots (getState/getMaterials) and EMITS events. `createUi` is the thin DOM+keyboard
   shell that drives it and paints its state. Tests exercise the controller directly (Rule 9: assert the
   pause/death/restart INTENT, not "it rendered").

   C++ anchor: the controller is the headless model (pure state + signals out); the DOM shell is the view
   — like an ImGui-free game-state class you can unit-test, plus a separate renderer that draws it.
   ============================================================ */
import * as config from '../core/config.js';

/* ---- ITEM + RECIPE DATA (display + emit payloads; balance magnitudes belong to sim/build) ----
   The bag holds `kind`s. Consumables emit `item:consume {kind, effect}` — `effect` is the DESCRIPTOR of
   what the item does; sim/build own the actual magnitude (the UI must not simulate). Non-consumables
   (scrap) are craft feedstock only. Glyphs mirror v1 (hoard.js:44-50) for visual continuity. */
export const ITEMS = {
  food:      { label: 'Food',       glyph: '🍖', consumable: true,  effect: 'feed' },
  bandage:   { label: 'Bandage',    glyph: '➕', consumable: true,  effect: 'heal' },
  medkit:    { label: 'Medkit',     glyph: '✚', consumable: true,  effect: 'heal_big' },
  repairkit: { label: 'Repair Kit', glyph: '🔧', consumable: true,  effect: 'repair' },
  scrap:     { label: 'Scrap',      glyph: '⚙️', consumable: false, effect: null },
  wood:      { label: 'Wood',       glyph: '🪵', consumable: false, effect: null },
};

/* Crafting costs are paid in MATERIALS (build owns wood/scrap). We gate a craft on build.materials()
   affording the cost, then emit `craft {recipe, cost}` — build deducts + resolves (repair-kit →
   hitBarrier, per the contract's cross-owner reactions). These costs are a UI-layer assumption flagged
   to the lead; move them to config if the run wants them pinned. */
export const RECIPES = {
  medkit:    { label: 'Medkit',     glyph: '✚', cost: { scrap: 6 } },
  repairkit: { label: 'Repair Kit', glyph: '🔧', cost: { wood: 8, scrap: 4 } },
};

/* ---- restartUrl (PURE — unit-tested directly) ----
   Given the current `location.search` and the running seed, return the query string that reloads a
   CLEAN + SEEDED run. We force ?seed=<seed> so restart is deterministic even when the original URL had
   none; all other params (e.g. a playtest flag) are preserved. Returns e.g. "?seed=1337". */
export function restartUrl(search, seed) {
  const params = new URLSearchParams(search || '');
  params.set('seed', String(seed));
  return '?' + params.toString();
}

/* ============================================================
   createUiController — the DOM-FREE state machine.
   deps: { events, getState, getMaterials, getSeed, win, onChange? }
     events       : the ctx event bus (emit only)
     getState     : () => sim.state snapshot (read-only)   — used by the view, not by the machine
     getMaterials : () => { wood, scrap } (build.materials) — used to gate crafting
     getSeed      : () => the running seed (window.__seed)
     win          : the window-like object for restart navigation (injectable for tests)
     onChange     : optional () => void the shell sets to repaint when state flips
   ============================================================ */
export function createUiController({ events, getState, getMaterials, getSeed, win, onChange } = {}) {
  const state = {
    bagOpen: false,
    menuOpen: false,
    dead: false,
    deathCause: null, // 'injury' | 'hunger'
    quit: false,
  };
  // The 8-slot bag: array of { kind, n } (stacks), capped at config.BAG_SLOTS. C++ anchor: a fixed-cap
  // slot vector — add stacks onto an existing kind, else push while length < cap.
  const bag = [];

  const notify = () => { if (typeof onChange === 'function') onChange(); };
  const emit = (name, payload) => { if (events && typeof events.emit === 'function') events.emit(name, payload); };

  /* ---- pause plumbing: emit only, core acts. `source` disambiguates who paused (bag vs menu). ---- */
  function openBag() {
    if (state.dead || state.bagOpen) return false;
    // opening the bag while the pause menu is up: close the menu first so pause/resume stay balanced.
    if (state.menuOpen) closeMenu();
    state.bagOpen = true;
    emit('game:pause', { source: 'bag' });
    notify();
    return true;
  }
  function closeBag() {
    if (!state.bagOpen) return false;
    state.bagOpen = false;
    emit('game:resume', { source: 'bag' });
    notify();
    return true;
  }
  function toggleBag() { return state.bagOpen ? closeBag() : openBag(); }

  function openMenu() {
    if (state.dead || state.menuOpen) return false;
    if (state.bagOpen) closeBag();
    state.menuOpen = true;
    emit('game:pause', { source: 'menu' });
    notify();
    return true;
  }
  function closeMenu() {
    if (!state.menuOpen) return false;
    state.menuOpen = false;
    emit('game:resume', { source: 'menu' });
    notify();
    return true;
  }

  /* ---- Esc semantics (brief): dived → UI ignores it (player/dive owns it); bag open → close bag;
     menu open → close menu; else → open the pause menu. `dived` is passed in by the shell. ---- */
  function onEscape(dived) {
    if (state.dead) return;
    if (dived) return;               // not ours while first-person
    if (state.bagOpen) return closeBag();
    if (state.menuOpen) return closeMenu();
    return openMenu();
  }

  /* ---- bag model ---- */
  function bagCount(kind) { const s = bag.find((x) => x.kind === kind); return s ? s.n : 0; }
  function addItem(kind, n = 1) {
    const s = bag.find((x) => x.kind === kind);
    if (s) { s.n += n; notify(); return true; }
    if (bag.length < config.BAG_SLOTS) { bag.push({ kind, n }); notify(); return true; }
    return false; // bag full — the pickup stays in the world (v1 hoard.js:219 behaviour)
  }
  function removeItem(kind, n = 1) {
    const s = bag.find((x) => x.kind === kind);
    if (!s || s.n < n) return false;
    s.n -= n; if (s.n <= 0) bag.splice(bag.indexOf(s), 1);
    notify(); return true;
  }

  // A pickup landed (sim emits item:pickup {kind}) → into the bag.
  function onPickup(kind) { return addItem(kind); }

  // Use a consumable: emit item:consume {kind, effect}; sim/build apply the magnitude, we drop the item.
  function consume(kind) {
    const meta = ITEMS[kind];
    if (!meta || !meta.consumable || bagCount(kind) <= 0) return false;
    emit('item:consume', { kind, effect: meta.effect });
    removeItem(kind, 1);
    return true;
  }

  // Craft: gate on affordable materials, emit craft {recipe, cost}, optimistically stock the bag.
  function affordable(recipe) {
    const r = RECIPES[recipe]; if (!r) return false;
    const mats = (getMaterials && getMaterials()) || {};
    for (const k in r.cost) if ((mats[k] || 0) < r.cost[k]) return false;
    return true;
  }
  function craft(recipe) {
    const r = RECIPES[recipe];
    if (!r || !affordable(recipe)) return false;
    emit('craft', { recipe, cost: r.cost }); // build deducts materials + resolves the recipe
    addItem(recipe, 1);
    return true;
  }

  /* ---- death (DONE #6): sim emits player:death {cause}; we raise the death screen. We drop any open
     overlay first (resume so the pause state is clean behind the screen). We do NOT emit our own pause —
     the sim is already dead; restart reloads the whole page. ---- */
  function onDeath(cause) {
    if (state.dead) return;
    if (state.bagOpen) closeBag();
    if (state.menuOpen) closeMenu();
    state.dead = true;
    state.deathCause = (cause === 'hunger' || cause === 'injury') ? cause : (cause || 'injury');
    notify();
  }
  const deathScreenVisible = () => state.dead;

  /* ---- restart / quit ---- */
  function restart() {
    const w = win || (typeof window !== 'undefined' ? window : null);
    if (!w || !w.location) return false;
    const seed = (getSeed && getSeed()) || (w.__seed) || config.DEFAULT_SEED;
    const target = restartUrl(w.location.search, seed);
    // Same query already? a plain reload is enough (still a clean fresh module graph). Else navigate.
    if (target === (w.location.search || '') && typeof w.location.reload === 'function') w.location.reload();
    else if (typeof w.location.assign === 'function') w.location.assign(target);
    else w.location.search = target; // last-resort: setting .search triggers a navigation
    return true;
  }
  function quit() {
    // Quit → blank the game to a bare menu (the shell paints it). We don't touch the sim; the page just
    // shows a "run ended" panel with a way back into a fresh seeded run.
    state.quit = true;
    if (state.bagOpen) closeBag();
    if (state.menuOpen) closeMenu();
    notify();
    return true;
  }

  return {
    state, bag,
    // pause surface
    openBag, closeBag, toggleBag, openMenu, closeMenu, onEscape,
    get paused() { return state.bagOpen || state.menuOpen; },
    // bag surface
    bagCount, addItem, removeItem, onPickup, consume, craft, affordable,
    // death / lifecycle
    onDeath, deathScreenVisible, restart, quit,
    // let the shell attach its repaint after construction
    setOnChange(fn) { onChange = fn; },
  };
}

/* ============================================================
   createUi(ctx) — the DOM + keyboard shell. Guards every DOM access so importing/constructing in a
   headless node test never throws (tests never call the DOM path; they drive the controller).
   ============================================================ */
export function createUi(ctx) {
  const { registry, events } = ctx;
  const hasDOM = typeof document !== 'undefined' && typeof window !== 'undefined';

  const controller = createUiController({
    events,
    getState: () => (registry.has('sim') ? registry.get('sim').state : null),
    getMaterials: readMaterials,
    getSeed: () => (typeof window !== 'undefined' ? window.__seed : undefined),
    win: typeof window !== 'undefined' ? window : null,
  });

  // build.materials() is the pinned materials feed; guard so a still-stubbed build (no materials yet)
  // shows 0/0 instead of crashing the HUD during integration order.
  function readMaterials() {
    if (!registry.has('build')) return ZERO_MATS;
    const b = registry.get('build');
    return (typeof b.materials === 'function') ? b.materials() : ZERO_MATS;
  }

  // Expose the DONE #6 probe hook so the harness can assert the death screen appeared after a forced death.
  ctx.probe.deathScreenVisible = () => controller.deathScreenVisible();

  // sim owns item:pickup {kind}; feed the bag. player:death {cause} → death screen.
  events.on('item:pickup', (p) => controller.onPickup(p && p.kind));
  events.on('player:death', (p) => controller.onDeath(p && p.cause));

  if (!hasDOM) {
    // Headless (capture builds run in a browser, but be safe): no view, just the facade + probe.
    const facade = { update() {} };
    registry.register('ui', facade);
    return facade;
  }

  /* ---------- DOM: one overlay, reused nodes (no per-frame alloc in update) ---------- */
  injectStyle();
  const root = el('div', 'h2ui-root');
  const els = buildHud(root);
  const bagPanel = buildBag(root, controller);
  const menuPanel = buildMenu(root, controller);
  const deathPanel = buildDeath(root, controller);
  (document.getElementById('app') || document.body).appendChild(root);

  // Repaint the overlays (panels) whenever the controller's state flips. The HUD (bars) is repainted
  // every frame in update() from the live snapshot; the panels are event-driven, so this is enough.
  controller.setOnChange(renderPanels);
  renderPanels();

  function renderPanels() {
    show(bagPanel.root, controller.state.bagOpen);
    show(menuPanel.root, controller.state.menuOpen && !controller.state.dead);
    show(deathPanel.root, controller.state.dead);
    show(root.querySelector('.h2ui-quit'), controller.state.quit && !controller.state.dead);
    if (controller.state.bagOpen) bagPanel.render(controller, readMaterials());
    if (controller.state.dead) deathPanel.setCause(controller.state.deathCause);
  }

  // Quit panel (blank menu) — built lazily as part of root.
  const quitPanel = buildQuit(root, controller);
  show(quitPanel, false);

  /* ---------- keyboard: I toggles the bag, Esc drives pause/close ---------- */
  window.addEventListener('keydown', (e) => {
    if (controller.state.dead || controller.state.quit) return;
    const k = e.key;
    if (k === 'i' || k === 'I') { e.preventDefault(); controller.toggleBag(); }
    else if (k === 'Escape') { e.preventDefault(); controller.onEscape(ctx.dive && ctx.dive.active); }
  });

  /* ---------- per-frame HUD paint (reuse nodes; only write when the integer value changed) ---------- */
  const last = { hp: -1, hunger: -1, stamina: -1, wave: -1, score: -1, wood: -1, scrap: -1 };
  const S = config.SURVIVE;

  function update(_dt, _t) {
    const st = registry.has('sim') ? registry.get('sim').state : null;
    if (!st) return;
    const mats = readMaterials();
    setBar(els.hp, els.hpVal, st.hp, S.hpMax, last, 'hp');
    setBar(els.hunger, els.hungerVal, st.hunger, S.hungerMax, last, 'hunger');
    setBar(els.stamina, els.staminaVal, st.stamina, S.staminaMax, last, 'stamina');
    if (st.wave !== last.wave) { els.wave.textContent = String(st.wave); last.wave = st.wave; }
    if (st.score !== last.score) { els.score.textContent = String(st.score); last.score = st.score; }
    const wood = mats.wood | 0, scrap = mats.scrap | 0;
    if (wood !== last.wood) { els.wood.textContent = String(wood); last.wood = wood; }
    if (scrap !== last.scrap) { els.scrap.textContent = String(scrap); last.scrap = scrap; }
  }

  const facade = { update };
  registry.register('ui', facade);
  return facade;
}

/* ============================================================
   DOM helpers (view-only; none of this runs in the node tests).
   ============================================================ */
const ZERO_MATS = { wood: 0, scrap: 0 };

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function show(n, on) { if (n) n.style.display = on ? '' : 'none'; }

function setBar(fillNode, valNode, value, max, last, key) {
  const v = Math.max(0, Math.round(value || 0));
  if (v === last[key]) return; // no change → no string alloc, no layout write
  last[key] = v;
  const pct = Math.max(0, Math.min(100, (v / max) * 100));
  fillNode.style.width = pct + '%';
  if (valNode) valNode.textContent = v + '/' + max;
}

function buildHud(root) {
  const hud = el('div', 'h2ui-hud');
  const mkBar = (label, cls) => {
    const wrap = el('div', 'h2ui-bar');
    wrap.appendChild(el('span', 'h2ui-bar-label', label));
    const track = el('div', 'h2ui-bar-track');
    const fill = el('div', 'h2ui-bar-fill ' + cls);
    track.appendChild(fill);
    wrap.appendChild(track);
    const val = el('span', 'h2ui-bar-val', '');
    wrap.appendChild(val);
    hud.appendChild(wrap);
    return { fill, val };
  };
  const hpB = mkBar('HP', 'is-hp');
  const hungerB = mkBar('FED', 'is-hunger');
  const staminaB = mkBar('STA', 'is-stamina');

  const stats = el('div', 'h2ui-stats');
  const waveWrap = el('div', 'h2ui-stat'); waveWrap.appendChild(el('span', 'h2ui-stat-k', 'WAVE'));
  const wave = el('span', 'h2ui-stat-v', '0'); waveWrap.appendChild(wave);
  const scoreWrap = el('div', 'h2ui-stat'); scoreWrap.appendChild(el('span', 'h2ui-stat-k', 'SCORE'));
  const score = el('span', 'h2ui-stat-v', '0'); scoreWrap.appendChild(score);
  const woodWrap = el('div', 'h2ui-stat'); woodWrap.appendChild(el('span', 'h2ui-stat-k', '🪵'));
  const wood = el('span', 'h2ui-stat-v', '0'); woodWrap.appendChild(wood);
  const scrapWrap = el('div', 'h2ui-stat'); scrapWrap.appendChild(el('span', 'h2ui-stat-k', '⚙️'));
  const scrap = el('span', 'h2ui-stat-v', '0'); scrapWrap.appendChild(scrap);
  stats.append(waveWrap, scoreWrap, woodWrap, scrapWrap);
  hud.appendChild(stats);
  root.appendChild(hud);
  return { hp: hpB.fill, hpVal: hpB.val, hunger: hungerB.fill, hungerVal: hungerB.val,
    stamina: staminaB.fill, staminaVal: staminaB.val, wave, score, wood, scrap };
}

function buildBag(root, controller) {
  const panel = el('div', 'h2ui-panel h2ui-bag');
  panel.appendChild(el('h2', 'h2ui-title', 'RUCKSACK'));
  panel.appendChild(el('p', 'h2ui-hint', 'I to close · click an item to use'));
  const grid = el('div', 'h2ui-grid');
  panel.appendChild(grid);
  const craftRow = el('div', 'h2ui-craft');
  craftRow.appendChild(el('span', 'h2ui-craft-label', 'CRAFT:'));
  for (const rk of Object.keys(RECIPES)) {
    const r = RECIPES[rk];
    const b = el('button', 'h2ui-btn h2ui-craft-btn', r.glyph + ' ' + r.label);
    b.dataset.recipe = rk;
    b.addEventListener('click', () => controller.craft(rk));
    craftRow.appendChild(b);
  }
  panel.appendChild(craftRow);
  root.appendChild(panel);

  function render(ctrl, mats) {
    grid.textContent = '';
    for (let i = 0; i < config.BAG_SLOTS; i++) {
      const slot = el('div', 'h2ui-slot');
      const it = ctrl.bag[i];
      if (it) {
        const meta = ITEMS[it.kind] || { glyph: '?', label: it.kind, consumable: false };
        slot.classList.add('is-filled');
        slot.appendChild(el('span', 'h2ui-slot-glyph', meta.glyph));
        if (it.n > 1) slot.appendChild(el('span', 'h2ui-slot-n', 'x' + it.n));
        slot.title = meta.label;
        if (meta.consumable) { slot.classList.add('is-use'); slot.addEventListener('click', () => ctrl.consume(it.kind)); }
      }
      grid.appendChild(slot);
    }
    // grey out unaffordable craft buttons
    for (const b of panel.querySelectorAll('.h2ui-craft-btn')) {
      b.disabled = !ctrl.affordable(b.dataset.recipe);
    }
  }
  return { root: panel, render };
}

function buildMenu(root, controller) {
  const panel = el('div', 'h2ui-panel h2ui-menu');
  panel.appendChild(el('h2', 'h2ui-title', 'PAUSED'));
  const resume = el('button', 'h2ui-btn', 'Resume');
  resume.addEventListener('click', () => controller.closeMenu());
  const restart = el('button', 'h2ui-btn', 'Restart');
  restart.addEventListener('click', () => controller.restart());
  const quit = el('button', 'h2ui-btn', 'Quit');
  quit.addEventListener('click', () => controller.quit());
  panel.append(resume, restart, quit);
  root.appendChild(panel);
  return { root: panel };
}

function buildDeath(root, controller) {
  const panel = el('div', 'h2ui-panel h2ui-death');
  panel.appendChild(el('h1', 'h2ui-death-title', 'YOU DIED'));
  const cause = el('p', 'h2ui-death-cause', '');
  panel.appendChild(cause);
  const restart = el('button', 'h2ui-btn h2ui-btn-lg', 'Restart');
  restart.addEventListener('click', () => controller.restart());
  const quit = el('button', 'h2ui-btn h2ui-btn-lg', 'Quit');
  quit.addEventListener('click', () => controller.quit());
  panel.append(restart, quit);
  root.appendChild(panel);
  const CAUSE_TEXT = { hunger: 'Starvation took you.', injury: 'The horde tore you apart.' };
  return { root: panel, setCause: (c) => { cause.textContent = CAUSE_TEXT[c] || 'You did not survive.'; } };
}

function buildQuit(root, controller) {
  const panel = el('div', 'h2ui-panel h2ui-quit');
  panel.appendChild(el('h1', 'h2ui-death-title', 'THE HOARD'));
  panel.appendChild(el('p', 'h2ui-hint', 'Run ended.'));
  const again = el('button', 'h2ui-btn h2ui-btn-lg', 'New Run');
  again.addEventListener('click', () => controller.restart());
  panel.appendChild(again);
  root.appendChild(panel);
  return panel;
}

function injectStyle() {
  if (document.getElementById('h2ui-style')) return;
  const s = document.createElement('style');
  s.id = 'h2ui-style';
  // Decrepit-survival look: dark, grimy, high-legibility mono. Overlay ignores pointer events except on
  // the interactive panels (so the game canvas stays clickable during play).
  s.textContent = `
  .h2ui-root{position:fixed;inset:0;z-index:20;pointer-events:none;font-family:"Courier New",ui-monospace,monospace;color:#d8cfc0;-webkit-user-select:none;user-select:none}
  .h2ui-hud{position:absolute;top:14px;left:14px;display:flex;flex-direction:column;gap:6px;padding:10px 12px;background:rgba(14,12,10,.62);border:1px solid rgba(120,96,64,.35);border-radius:4px;text-shadow:0 1px 2px #000}
  .h2ui-bar{display:flex;align-items:center;gap:8px;font-size:12px;letter-spacing:.08em}
  .h2ui-bar-label{width:30px;color:#9a8f7e}
  .h2ui-bar-track{width:150px;height:12px;background:#201c18;border:1px solid #000;box-shadow:inset 0 0 4px #000}
  .h2ui-bar-fill{height:100%;width:100%;transition:width .12s linear}
  .h2ui-bar-fill.is-hp{background:linear-gradient(#b6423a,#7c2a25)}
  .h2ui-bar-fill.is-hunger{background:linear-gradient(#b98a3a,#7c5a20)}
  .h2ui-bar-fill.is-stamina{background:linear-gradient(#5b9a6a,#356045)}
  .h2ui-bar-val{width:52px;font-size:10px;color:#8a8175;text-align:right}
  .h2ui-stats{display:flex;gap:14px;margin-top:4px;padding-top:6px;border-top:1px solid rgba(120,96,64,.25)}
  .h2ui-stat{display:flex;flex-direction:column;line-height:1.1}
  .h2ui-stat-k{font-size:9px;color:#8a7f6e;letter-spacing:.1em}
  .h2ui-stat-v{font-size:16px;font-weight:700;color:#e6dccb}
  .h2ui-panel{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:auto;min-width:280px;padding:22px 26px;background:rgba(18,15,12,.94);border:1px solid rgba(140,110,72,.5);border-radius:6px;box-shadow:0 12px 60px rgba(0,0,0,.7);text-align:center}
  .h2ui-title{margin:0 0 12px;font-size:18px;letter-spacing:.22em;color:#cbb892}
  .h2ui-hint{margin:0 0 14px;font-size:11px;color:#8a7f6e}
  .h2ui-grid{display:grid;grid-template-columns:repeat(4,56px);gap:8px;justify-content:center;margin-bottom:16px}
  .h2ui-slot{position:relative;width:56px;height:56px;background:#191512;border:1px solid #3a2f22;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:24px}
  .h2ui-slot.is-filled{background:#241d16;border-color:#5a4630}
  .h2ui-slot.is-use{cursor:pointer}
  .h2ui-slot.is-use:hover{border-color:#caa05a;background:#2e2418}
  .h2ui-slot-n{position:absolute;right:3px;bottom:1px;font-size:10px;color:#cbb892}
  .h2ui-craft{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center}
  .h2ui-craft-label{font-size:11px;color:#8a7f6e;letter-spacing:.1em}
  .h2ui-btn{pointer-events:auto;display:block;width:100%;margin:6px 0;padding:9px 16px;background:#2a2118;color:#e0d6c4;border:1px solid #5a4630;border-radius:4px;font-family:inherit;font-size:13px;letter-spacing:.08em;cursor:pointer}
  .h2ui-btn:hover{background:#38291b;border-color:#caa05a}
  .h2ui-btn:disabled{opacity:.4;cursor:not-allowed}
  .h2ui-craft-btn{width:auto;margin:0}
  .h2ui-btn-lg{font-size:15px;padding:12px 20px}
  .h2ui-death{border-color:#7c2a25;box-shadow:0 12px 80px rgba(120,20,16,.4)}
  .h2ui-death-title{margin:0 0 8px;font-size:34px;letter-spacing:.3em;color:#c0413a;text-shadow:0 2px 12px #000}
  .h2ui-death-cause{margin:0 0 18px;font-size:13px;color:#9a8f7e}
  `;
  document.head.appendChild(s);
}
