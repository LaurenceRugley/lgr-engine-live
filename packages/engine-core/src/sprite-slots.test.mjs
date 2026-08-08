/* sprite-slots.test.mjs — node:test, headless, no THREE/DOM. Rule 9: each test states the consequence
   of failure. This is the trickiest correctness property in createSpriteBatcher (swap-remove
   compaction) — get it wrong and a sprite silently teleports, or a GPU write lands on the wrong
   instance and a DIFFERENT sprite's atlas frame/position is corrupted. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSlotAllocator } from './sprite-slots.js';

test('alloc() hands out contiguous slots 0,1,2,... and count tracks them', () => {
  // WHY: mesh.count (how many instances the renderer draws) is set directly from allocator.count — if
  // slots weren't contiguous from 0, some drawn instance indices would be genuinely unassigned.
  const a = createSlotAllocator(4);
  const s0 = a.alloc(), s1 = a.alloc(), s2 = a.alloc();
  assert.deepEqual([s0.slot, s1.slot, s2.slot], [0, 1, 2]);
  assert.equal(a.count, 3);
});

test('alloc() returns null at capacity — never overflows the fixed-size GPU buffer', () => {
  // WHY: addSprite silently corrupting memory past a Float32Array's end is a class of bug a bounds
  // check must prevent outright, not just discourage.
  const a = createSlotAllocator(2);
  a.alloc(); a.alloc();
  assert.equal(a.alloc(), null);
  assert.equal(a.count, 2);
});

test('free() on the LAST slot needs no move (nothing to relocate)', () => {
  // WHY: this is the base case swap-remove degenerates to — if it reported a spurious move here, the
  // batcher would rewrite a GPU slot with stale/wrong data for no reason.
  const a = createSlotAllocator(4);
  const s0 = a.alloc(), s1 = a.alloc();
  const result = a.free(s1.id);
  assert.deepEqual(result, { freedSlot: 1, movedFromSlot: null, movedId: null });
  assert.equal(a.count, 1);
  assert.equal(a.slotOf(s0.id), 0);
});

test('free() on a MIDDLE slot relocates the last slot into it, and count shrinks by exactly one', () => {
  // WHY: this is the O(1) compaction the whole module exists for — get freedSlot/movedFromSlot swapped
  // and the batcher writes the wrong sprite's transform into the wrong GPU instance.
  const a = createSlotAllocator(4);
  const s0 = a.alloc(), s1 = a.alloc(), s2 = a.alloc();   // slots 0,1,2
  const result = a.free(s0.id);                            // free the FIRST — slot 2 (s2) must move into slot 0
  assert.deepEqual(result, { freedSlot: 0, movedFromSlot: 2, movedId: s2.id });
  assert.equal(a.count, 2);
  assert.equal(a.slotOf(s2.id), 0, 's2 must now report slot 0 (it moved)');
  assert.equal(a.slotOf(s1.id), 1, 's1 must be untouched — the tradeoff the module documents');
  assert.equal(a.slotOf(s0.id), undefined, 'a freed id must never resolve to a slot again');
});

test('[0,count) stays exactly the set of live ids after a long alloc/free churn (fuzz-style, deterministic)', () => {
  // WHY: this is the invariant mesh.count / forEachActive / picking all depend on — if it ever drifts
  // (a duplicate slot, a gap, a stale id resolving), a sprite becomes invisible, unpickable, or a ghost.
  const CAP = 10;
  const a = createSlotAllocator(CAP);
  const live = new Set();
  const ops = 'aaaaaFaFaaFFaaaFaaaFFFaaaaaFaFFa'.split('');   // 'a'=alloc, 'F'=free the OLDEST live id — scripted, not random, so a failure reproduces byte-identically
  for (const op of ops) {
    if (op === 'a') {
      const r = a.alloc();
      if (r) live.add(r.id);
    } else if (live.size) {
      const oldest = [...live][0];
      a.free(oldest);
      live.delete(oldest);
    }
  }
  assert.equal(a.count, live.size, `allocator.count ${a.count} must equal the live-id set size ${live.size}`);
  const slots = new Set();
  for (const id of live) {
    const slot = a.slotOf(id);
    assert.ok(slot !== undefined && slot < a.count, `live id ${id} must resolve to a slot inside [0,count)`);
    assert.ok(!slots.has(slot), `slot ${slot} claimed by more than one live id — a corruption swap-remove must never produce`);
    slots.add(slot);
  }
});

test('freed capacity is reusable — a later alloc() can reclaim a slot below the old count', () => {
  // WHY: without this, a long-running game (spawn/despawn cycles) would eventually exhaust `maxSprites`
  // even though most sprites died long ago — the entire reason the allocator reclaims slots at all.
  const a = createSlotAllocator(2);
  const s0 = a.alloc();
  a.alloc();
  a.free(s0.id);
  assert.equal(a.count, 1);
  const s2 = a.alloc();
  assert.ok(s2, 'capacity must be reusable after a free()');
  assert.equal(a.count, 2);
});
