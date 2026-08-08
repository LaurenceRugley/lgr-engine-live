/* ============================================================
   sprite-slots.js — the id↔slot bookkeeping behind createSpriteBatcher's swap-remove compaction.
   ------------------------------------------------------------
   Pulled out of sprite-batcher.js so it's node-testable without a GPU or a `.vert`/`.frag` import (the
   same "pure math lives shader-free" shape forge-math.js established for createTextureForge) — this is
   the trickiest correctness property in the batcher (get the moved-slot bookkeeping wrong and sprites
   silently teleport or a GPU write lands on the wrong instance), so it earns its own tested module.
   Pure id/index bookkeeping — no THREE, no DOM, no GPU buffer writes; sprite-batcher.js owns those.
   ============================================================ */

export function createSlotAllocator(capacity) {
  const idToSlot = new Map();
  const slotToId = new Array(capacity).fill(null);
  let nextId = 1;
  let count = 0;

  /* alloc() → {id, slot} at the next free tail slot, or null at capacity. */
  function alloc() {
    if (count >= capacity) return null;
    const slot = count++;
    const id = nextId++;
    idToSlot.set(id, slot);
    slotToId[slot] = id;
    return { id, slot };
  }

  /* free(id) → { freedSlot, movedFromSlot, movedId } | null (null = id wasn't allocated).
       freedSlot                — now-empty, no longer in [0,count) after this call.
       movedFromSlot/movedId    — set when the sprite that was at the OLD LAST slot got relocated into
                                   `freedSlot` to keep [0,count) contiguous; null when the freed sprite
                                   WAS already the last slot (nothing needed to move). The caller (the
                                   batcher) uses this to know which GPU slot to rewrite with which
                                   sprite's data, and which old slot's record is now stale. */
  function free(id) {
    const slot = idToSlot.get(id);
    if (slot === undefined) return null;
    const last = count - 1;
    let movedId = null, movedFromSlot = null;
    if (slot !== last) {
      movedId = slotToId[last];
      movedFromSlot = last;
      slotToId[slot] = movedId;
      idToSlot.set(movedId, slot);
    }
    slotToId[last] = null;
    idToSlot.delete(id);
    count--;
    return { freedSlot: slot, movedFromSlot, movedId };
  }

  function slotOf(id) { return idToSlot.get(id); }

  return { alloc, free, slotOf, get count() { return count; }, get capacity() { return capacity; } };
}
