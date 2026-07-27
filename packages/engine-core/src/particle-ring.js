/* ============================================================
   @lgr/engine-core — particle-ring (Lesson M6): the PURE ring/budget math for GPU particle spawning.
   ------------------------------------------------------------
   Split out of createParticles.js so it is node-testable WITHOUT pulling in the THREE + GLSL imports (a
   `.frag` import can't be parsed by `node --test`). This is the CPU-side allocation logic the brief asks
   to unit-test: the pool is BOUNDED (budget clamp) and spawns WRAP as a ring, split into scissor
   rectangles the GPU pass can write.
   ============================================================ */

// Plan the scissor rectangles for spawning `count` particles at `cursor` in a texSize² ring, clamped to
// `cap`. Returns row-split segments {x, y, w} (each within one texture row so a scissor rect is
// rectangular), the advanced cursor, and how many were actually spawned after the budget clamp.
export function planSpawn(cursor, count, texSize, cap = Infinity) {
  const total = texSize * texSize;
  count = Math.max(0, Math.min(Math.floor(count), Math.floor(cap), total));   // budget clamp
  const segments = [];
  let t = ((cursor % total) + total) % total, remaining = count;
  while (remaining > 0) {
    const x = t % texSize, y = Math.floor(t / texSize) % texSize;
    const w = Math.min(remaining, texSize - x);            // to the end of this row (scissor is rectangular)
    segments.push({ x, y, w });
    remaining -= w; t = (t + w) % total;
  }
  return { segments, nextCursor: t, spawned: count };
}
