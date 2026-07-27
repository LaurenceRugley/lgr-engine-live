// createForest.test.mjs — node:test of the PURE placeForest math (no THREE geometry, no GPU).
// These encode the FOREST DESIGN INVARIANTS, not just "it runs" (Rule 9):
//   • DETERMINISM — same seed ⇒ same forest (the ?capture + regression contract);
//   • MIN-SPACING — no two trees clump (the sparse, long-sightline Zomboid look is the whole point);
//   • CLEARING — no tree inside the arena-heart keep-out (the fight + the barriers + the dive need it open);
//   • COLLIDERS — only trees within the PLAYABLE radius block movement (distant trees are visual-only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeForest } from './createForest.js';

const flat = (pl) => Object.values(pl).flat();

test('deterministic: same seed ⇒ identical placement', () => {
  const a = placeForest({ seed: 42 }), b = placeForest({ seed: 42 });
  assert.deepEqual(flat(a.placements).map((p) => [p.x, p.z]), flat(b.placements).map((p) => [p.x, p.z]));
  const c = placeForest({ seed: 43 });
  assert.notDeepEqual(flat(a.placements).map((p) => [p.x, p.z]), flat(c.placements).map((p) => [p.x, p.z]));
});

test('min-spacing honoured: no two trees closer than minSpacing (no clumping)', () => {
  const minSpacing = 1.6;
  const { placements } = placeForest({ seed: 7, minSpacing, count: 80 });
  const pts = flat(placements);
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
    assert.ok(d >= minSpacing - 1e-9, `trees ${i},${j} only ${d.toFixed(3)} apart (< ${minSpacing})`);
  }
});

test('clearing respected: nothing inside the arena-heart keep-out', () => {
  const clearings = [{ x: 0, z: 0, r: 6 }, { x: 8, z: -3, r: 2.5 }];
  const { placements } = placeForest({ seed: 3, clearings, count: 90 });
  for (const p of flat(placements)) for (const c of clearings) {
    assert.ok(Math.hypot(p.x - c.x, p.z - c.z) >= c.r - 1e-9, `a tree landed inside the clearing at (${p.x.toFixed(1)},${p.z.toFixed(1)})`);
  }
});

test('all trees inside the forest radius', () => {
  const radius = 14;
  const { placements } = placeForest({ seed: 9, radius });
  for (const p of flat(placements)) assert.ok(Math.hypot(p.x, p.z) <= radius + 1e-9, `tree outside radius: ${Math.hypot(p.x, p.z).toFixed(2)}`);
});

test('colliders only for playable-radius trees; each sits at a placed tree', () => {
  const arenaR = 7.3;
  const { colliders, placements } = placeForest({ seed: 11, arenaR, radius: 18, count: 70 });
  const pts = flat(placements);
  for (const col of colliders) {
    assert.ok(Math.hypot(col.x, col.z) <= arenaR + 1e-9, `collider beyond arenaR at ${Math.hypot(col.x, col.z).toFixed(2)}`);
    assert.ok(col.r > 0, 'collider radius must be positive');
    assert.ok(pts.some((p) => p.x === col.x && p.z === col.z), 'every collider must coincide with a placed tree');
  }
  // there ARE playable trees (else the collision test is vacuous) but fewer than the total (sparse arena).
  assert.ok(colliders.length > 0 && colliders.length <= pts.length);
});

test('produces a sparse forest: some trees, never more than the target', () => {
  const { count } = placeForest({ seed: 5, count: 60 });
  assert.ok(count > 10 && count <= 60, `unexpected count ${count}`);
});
