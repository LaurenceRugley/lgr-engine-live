/* ============================================================
   hoard2 · src/ui/ui.test.mjs — INTENT tests (Rule 9). Node-testable: drives the DOM-FREE controller +
   the pure restartUrl. NEVER imports the engine barrel (shaders → node death) — only ../ui/index.js,
   which imports only ../core/config.js.

   WHY these assertions (not "it renders"): the whole subsystem rests on three contracts —
     · the bag PAUSES the sim by EMITTING game:pause / game:resume (core, not the UI, freezes),
     · a player:death raises the death screen naming the RIGHT cause (DONE #6),
     · restart is CLEAN + SEEDED — it reloads with the same seed on the URL.
   Each test would FAIL if that business behaviour regressed, which is the point of Rule 9.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiController, restartUrl, ITEMS, RECIPES } from './index.js';

/* A recording event bus: captures every emit so we can assert the exact vocabulary + payload. */
function fakeEvents() {
  const emitted = [];
  return { emitted, emit: (name, payload) => emitted.push({ name, payload }) };
}
const names = (ev) => ev.emitted.map((e) => e.name);

/* A fake window whose location records how restart navigated. */
function fakeWin(search, seed) {
  const calls = [];
  return {
    __seed: seed,
    location: {
      search,
      assign: (u) => calls.push(['assign', u]),
      reload: () => calls.push(['reload']),
      set search(v) { calls.push(['setSearch', v]); },
      get search() { return search; },
    },
    calls,
  };
}

test('opening the bag emits game:pause, closing emits game:resume (core freezes, not the UI)', () => {
  const ev = fakeEvents();
  const ui = createUiController({ events: ev, getMaterials: () => ({ wood: 0, scrap: 0 }) });

  assert.equal(ui.paused, false);
  assert.equal(ui.openBag(), true);
  assert.equal(ui.state.bagOpen, true);
  assert.equal(ui.paused, true);
  assert.deepEqual(names(ev), ['game:pause']);
  assert.equal(ev.emitted[0].payload.source, 'bag');

  // re-opening an already-open bag must NOT double-emit (pause/resume stay balanced).
  assert.equal(ui.openBag(), false);
  assert.deepEqual(names(ev), ['game:pause']);

  assert.equal(ui.closeBag(), true);
  assert.equal(ui.state.bagOpen, false);
  assert.equal(ui.paused, false);
  assert.deepEqual(names(ev), ['game:pause', 'game:resume']);
});

test('toggleBag flips pause/resume; Esc closes an open bag instead of opening the menu', () => {
  const ev = fakeEvents();
  const ui = createUiController({ events: ev, getMaterials: () => ({ wood: 0, scrap: 0 }) });
  ui.toggleBag(); // open
  ui.onEscape(false); // bag open → Esc closes the bag (not open the menu)
  assert.equal(ui.state.bagOpen, false);
  assert.equal(ui.state.menuOpen, false);
  assert.deepEqual(names(ev), ['game:pause', 'game:resume']);
});

test('Esc opens the pause menu when idle, and does nothing while dived (player owns Esc there)', () => {
  const ev = fakeEvents();
  const ui = createUiController({ events: ev });
  ui.onEscape(true); // dived → UI ignores Esc
  assert.equal(ui.state.menuOpen, false);
  assert.deepEqual(names(ev), []);

  ui.onEscape(false); // idle → open menu (pause)
  assert.equal(ui.state.menuOpen, true);
  assert.deepEqual(names(ev), ['game:pause']);
  assert.equal(ev.emitted[0].payload.source, 'menu');

  ui.onEscape(false); // menu open → Esc closes it (resume)
  assert.equal(ui.state.menuOpen, false);
  assert.deepEqual(names(ev), ['game:pause', 'game:resume']);
});

test('player:death raises the death screen and records the correct cause (DONE #6)', () => {
  for (const cause of ['injury', 'hunger']) {
    const ev = fakeEvents();
    const ui = createUiController({ events: ev });
    assert.equal(ui.deathScreenVisible(), false);
    ui.onDeath(cause);
    assert.equal(ui.deathScreenVisible(), true);
    assert.equal(ui.state.deathCause, cause);
  }
});

test('death while the bag is open resumes first, so the sim is not left frozen behind the screen', () => {
  const ev = fakeEvents();
  const ui = createUiController({ events: ev });
  ui.openBag(); // pause
  ui.onDeath('hunger');
  assert.deepEqual(names(ev), ['game:pause', 'game:resume']);
  assert.equal(ui.state.bagOpen, false);
  assert.equal(ui.deathScreenVisible(), true);
});

test('a bad/unknown death cause still shows a screen (fails loud as visible, not silent)', () => {
  const ui = createUiController({ events: fakeEvents() });
  ui.onDeath(undefined);
  assert.equal(ui.deathScreenVisible(), true);
  assert.equal(ui.state.deathCause, 'injury'); // sane default, never null-into-a-blank-screen
});

test('restartUrl forces ?seed onto the query so restart is deterministic even with no seed in the URL', () => {
  assert.equal(restartUrl('', 1337), '?seed=1337');
  assert.equal(restartUrl('?seed=42', 42), '?seed=42');
  // an existing seed is overwritten with the RUNNING seed (single source of truth = window.__seed)
  assert.equal(restartUrl('?seed=1', 999), '?seed=999');
  // unrelated params are preserved
  assert.ok(restartUrl('?playtest=1', 7).includes('playtest=1'));
  assert.ok(restartUrl('?playtest=1', 7).includes('seed=7'));
});

test('restart navigates preserving the running seed; same-seed URL uses a plain reload', () => {
  // no seed in URL → navigate to ?seed=<running seed>
  const w1 = fakeWin('', 1337);
  createUiController({ events: fakeEvents(), win: w1, getSeed: () => 1337 }).restart();
  assert.deepEqual(w1.calls, [['assign', '?seed=1337']]);

  // URL already carries the running seed → a plain reload (no redundant navigation) still clean.
  const w2 = fakeWin('?seed=1337', 1337);
  createUiController({ events: fakeEvents(), win: w2, getSeed: () => 1337 }).restart();
  assert.deepEqual(w2.calls, [['reload']]);
});

test('using a consumable emits item:consume {kind,effect} and removes it; scrap is not consumable', () => {
  const ev = fakeEvents();
  const ui = createUiController({ events: ev });
  ui.onPickup('bandage');
  assert.equal(ui.bagCount('bandage'), 1);
  assert.equal(ui.consume('bandage'), true);
  assert.equal(ui.bagCount('bandage'), 0);
  const consumeEv = ev.emitted.find((e) => e.name === 'item:consume');
  assert.ok(consumeEv);
  assert.equal(consumeEv.payload.kind, 'bandage');
  assert.equal(consumeEv.payload.effect, ITEMS.bandage.effect);

  // scrap is craft feedstock only — using it is a no-op, no event.
  ui.onPickup('scrap');
  assert.equal(ui.consume('scrap'), false);
  assert.equal(ui.bagCount('scrap'), 1);
});

test('bag is capped at 8 stacking slots (config.BAG_SLOTS)', () => {
  const ui = createUiController({ events: fakeEvents() });
  // 8 distinct kinds fill the bag; a 9th distinct kind is rejected, but an existing kind still stacks.
  const kinds = ['food', 'bandage', 'medkit', 'repairkit', 'scrap', 'wood', 'k7', 'k8'];
  for (const k of kinds) assert.equal(ui.addItem(k), true);
  assert.equal(ui.addItem('k9'), false);      // full → rejected
  assert.equal(ui.addItem('food'), true);     // existing stack still grows
  assert.equal(ui.bagCount('food'), 2);
});

test('craft gates on affordable materials, emits craft {recipe,cost}, and stocks the bag', () => {
  const ev = fakeEvents();
  let mats = { wood: 0, scrap: 0 };
  const ui = createUiController({ events: ev, getMaterials: () => mats });

  assert.equal(ui.affordable('medkit'), false);
  assert.equal(ui.craft('medkit'), false);            // can't afford → no emit
  assert.equal(ev.emitted.length, 0);

  mats = { wood: 20, scrap: 20 };
  assert.equal(ui.affordable('medkit'), true);
  assert.equal(ui.craft('medkit'), true);
  const craftEv = ev.emitted.find((e) => e.name === 'craft');
  assert.ok(craftEv);
  assert.equal(craftEv.payload.recipe, 'medkit');
  assert.deepEqual(craftEv.payload.cost, RECIPES.medkit.cost);
  assert.equal(ui.bagCount('medkit'), 1);             // crafted item lands in the bag
});
