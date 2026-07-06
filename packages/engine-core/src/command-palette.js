/* ============================================================
   command-palette.js — Lesson 99 (Controls Redesign Phase 2): a ⌘K COMMAND PALETTE.
   ------------------------------------------------------------
   The completeness backstop that lets the visible bar stay minimal: a searchable overlay that can RUN ANY
   action the bar/menus expose AND teaches its keyboard shortcut. It's a command DISPATCHER over the SAME action
   registry the buttons use — `commands` is one table of `{ id, label, group, shortcut, run }`, surfaced a second
   way; the palette INDEXES the actions, it never reimplements them (the L95 "one source of truth" rule). The
   buttons and ⌘K both call `controls.X` underneath.

   A11Y — the ARIA combobox/listbox pattern (don't regress L91): the input is `role="combobox"` driving a
   `role="listbox"`; the highlighted row is tracked with `aria-activedescendant` (focus STAYS in the input while
   ↑/↓ move the selection); Enter runs, Esc closes, focus is trapped + restored. Keyboard-first by design.

   C++ anchor: a command table you can both bind to hotkeys AND fuzzy-search — the palette is a view over the
   registry, like a debug console that lists every registered command and lets you invoke one by name.
   ============================================================ */

const CSS = `
.lgr-cmdk-back { position: fixed; inset: 0; z-index: 50; display: none; align-items: flex-start; justify-content: center;
  background: rgba(8,10,14,0.55); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); padding-top: 12vh; }
.lgr-cmdk-back.on { display: flex; }
.lgr-cmdk { width: min(560px, calc(100vw - 28px)); max-height: 64vh; display: flex; flex-direction: column;
  background: rgba(18,20,27,0.97); border: 1px solid rgba(184,153,104,0.32); border-radius: 14px; overflow: hidden;
  box-shadow: 0 22px 60px rgba(0,0,0,0.6); color: #e8edf4; font: 13px/1.4 ui-monospace, monospace; }
.lgr-cmdk-in { width: 100%; box-sizing: border-box; border: 0; outline: 0; background: transparent; color: #f2f5fa;
  font: 500 15px/1 ui-monospace, monospace; padding: 15px 16px; border-bottom: 1px solid rgba(255,255,255,0.08); }
.lgr-cmdk-in::placeholder { color: #8a93a3; }
.lgr-cmdk-list { list-style: none; margin: 0; padding: 6px; overflow-y: auto; }
.lgr-cmdk-grp { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #b89968; padding: 9px 10px 4px; }
.lgr-cmdk-opt { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 40px;
  padding: 0 10px; border-radius: 9px; cursor: pointer; }
.lgr-cmdk-opt[aria-selected="true"] { background: rgba(184,153,104,0.20); outline: 1px solid rgba(184,153,104,0.45); }
.lgr-cmdk-opt:hover { background: rgba(255,255,255,0.06); }
.lgr-cmdk-lbl { color: #eef2f8; }
.lgr-cmdk-sc { color: #9aa3b2; font-size: 11px; letter-spacing: .04em; padding: 2px 7px; border-radius: 6px;
  background: rgba(255,255,255,0.06); white-space: nowrap; }
.lgr-cmdk-empty { color: #8a93a3; padding: 16px; text-align: center; }
`;

/* createCommandPalette({ commands, onAfterRun }) → { open, close, toggle, setCommands, destroy }.
   `commands`: [{ id, label, group, shortcut, run() }]. Opens on ⌘K / Ctrl-K (global) — the caller also wires a
   visible affordance that calls .open(). */
export function createCommandPalette({ commands = [], onAfterRun } = {}) {
  if (typeof document === 'undefined') return { open() {}, close() {}, toggle() {}, setCommands() {}, destroy() {} };
  let cmds = commands.slice();

  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const back = document.createElement('div'); back.className = 'lgr-cmdk-back';
  const panel = document.createElement('div'); panel.className = 'lgr-cmdk'; panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Command palette');
  const input = document.createElement('input'); input.className = 'lgr-cmdk-in'; input.type = 'text';
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', 'lgr-cmdk-list'); input.setAttribute('aria-label', 'Search commands');
  input.placeholder = 'Type a command…  (↑↓ to move · Enter to run · Esc to close)';
  const list = document.createElement('ul'); list.className = 'lgr-cmdk-list'; list.id = 'lgr-cmdk-list'; list.setAttribute('role', 'listbox');
  panel.append(input, list); back.append(panel); document.body.append(back);

  let open = false, filtered = [], active = 0, lastFocus = null;

  const norm = (s) => (s || '').toLowerCase();
  function match(q) {
    q = norm(q).trim();
    if (!q) return cmds.slice();
    // simple subsequence/substring score: prefer label startswith, then includes, then group includes.
    return cmds.filter((c) => norm(c.label).includes(q) || norm(c.group).includes(q) || norm(c.shortcut).includes(q))
      .sort((a, b) => (norm(a.label).startsWith(q) ? -1 : 0) - (norm(b.label).startsWith(q) ? -1 : 0));
  }

  function render() {
    list.innerHTML = '';
    filtered = match(input.value);
    if (active >= filtered.length) active = Math.max(0, filtered.length - 1);
    if (!filtered.length) { const e = document.createElement('li'); e.className = 'lgr-cmdk-empty'; e.textContent = 'No commands'; list.append(e); input.removeAttribute('aria-activedescendant'); return; }
    let lastGroup = null;
    filtered.forEach((c, i) => {
      if (c.group && c.group !== lastGroup) { lastGroup = c.group; const g = document.createElement('li'); g.className = 'lgr-cmdk-grp'; g.textContent = c.group; g.setAttribute('aria-hidden', 'true'); list.append(g); }
      const li = document.createElement('li'); li.className = 'lgr-cmdk-opt'; li.id = `lgr-cmdk-opt-${i}`; li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      const lbl = document.createElement('span'); lbl.className = 'lgr-cmdk-lbl'; lbl.textContent = c.label;
      li.append(lbl);
      if (c.shortcut) { const sc = document.createElement('span'); sc.className = 'lgr-cmdk-sc'; sc.textContent = c.shortcut; li.append(sc); }
      li.addEventListener('mousemove', () => { if (active !== i) { active = i; syncActive(); } });
      li.addEventListener('click', () => run(i));
      list.append(li);
    });
    syncActive();
  }
  function syncActive() {
    [...list.querySelectorAll('.lgr-cmdk-opt')].forEach((el, i) => el.setAttribute('aria-selected', String(i === active)));
    const el = list.querySelector(`#lgr-cmdk-opt-${active}`);
    if (el) { input.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  }
  function run(i) {
    const c = filtered[i]; if (!c) return;
    doClose();
    try { c.run(); } catch (e) { /* a command throwing must not break the palette */ }
    onAfterRun && onAfterRun(c);
  }

  function doOpen() {
    if (open) return; open = true;
    lastFocus = document.activeElement;
    input.value = ''; active = 0; render();
    back.classList.add('on');
    input.focus();
    if (typeof window !== 'undefined') window.__cmdk = true;
  }
  function doClose() {
    if (!open) return; open = false;
    back.classList.remove('on');
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) { /* gone */ }
    if (typeof window !== 'undefined') window.__cmdk = false;
  }

  input.addEventListener('input', () => { active = 0; render(); });
  // keys WHILE OPEN — handled on the panel so they don't leak to the app keymap (focus trap).
  // L110 (audit P0-4): every handled key gets stopPropagation, not just Escape — else ArrowUp/Down/Enter/Tab BUBBLE to
  // the app's window keydown handler (the palette lives on `back`, the app listens on window), so navigating the palette
  // also drove the app keymap, contradicting this handler's own "don't leak to the app keymap" contract.
  back.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); doClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); if (filtered.length) { active = (active + 1) % filtered.length; syncActive(); } return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); if (filtered.length) { active = (active - 1 + filtered.length) % filtered.length; syncActive(); } return; }
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); run(active); return; }
    if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); }   // trap: nothing else is focusable in the dialog
  });
  back.addEventListener('mousedown', (e) => { if (e.target === back) doClose(); });   // click the backdrop closes

  // GLOBAL ⌘K / Ctrl-K toggles the palette (capture so it wins over app shortcuts).
  const onGlobalKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); e.stopPropagation(); open ? doClose() : doOpen(); }
  };
  window.addEventListener('keydown', onGlobalKey, true);

  return {
    open: doOpen, close: doClose, toggle: () => (open ? doClose() : doOpen()),
    setCommands(next) { cmds = (next || []).slice(); if (open) render(); },
    get isOpen() { return open; },
    destroy() { window.removeEventListener('keydown', onGlobalKey, true); back.remove(); style.remove(); },
  };
}
