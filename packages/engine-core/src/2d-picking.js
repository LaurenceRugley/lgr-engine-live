/* ============================================================
   2d-picking.js — pointer → world coords, hit testing, the primitives drag is built from.
   ------------------------------------------------------------
   2D-plan §4 gap #4: "nothing is interactive without this, and it's the cheapest item on the list."
   Deliberately owns NO DOM listener (the same shape createScrollNarrative settled on for scroll): a
   project already has its own pointerdown/pointermove/pointerup wiring with its own drag-threshold,
   multi-touch, and gesture rules, and a SECOND listener living inside the engine would either fight it
   or duplicate it. This module is two PURE queries a host calls from listeners it already owns:

     const picking = create2DPicking({ camera, batcher, domElement: renderer.domElement });
     canvas.addEventListener('pointerdown', (e) => {
       const hit = picking.pickAtScreen(e.clientX, e.clientY);      // topmost sprite under the pointer, or null
       if (hit) { dragging = hit.id; dragOffset = picking.screenToWorld(e.clientX, e.clientY); }
     });
     canvas.addEventListener('pointermove', (e) => {
       if (!dragging) return;
       const w = picking.screenToWorld(e.clientX, e.clientY);
       batcher.setSprite(dragging, { x: w.x, y: w.y });             // "drag" IS just this — no separate API
     });

   HIT TEST is a rotated-box test in the sprite's own local frame (rotate the query point by -rotation,
   then a plain half-extent compare) — not just an axis-aligned box, so a spun sprite picks correctly.
   TOPMOST-WINS: sprites draw in slot order (painter's algorithm, see sprite-batch.frag), so the scan
   keeps overwriting `hit` as it walks forward — the LAST match is the one drawn last, i.e. on top.
   O(sprite count) per call: pointer EVENTS are rare (not a per-frame render cost), so a brute-force scan
   is the right tool here — a spatial index would be solving a problem this system doesn't have yet.
   ============================================================ */
import * as THREE from 'three';

function pointInSprite(px, py, r) {
  const dx = px - r.x, dy = py - r.y;
  const rot = r.rotation || 0;
  let lx = dx, ly = dy;
  if (rot) {
    const c = Math.cos(-rot), s = Math.sin(-rot);
    lx = dx * c - dy * s;
    ly = dx * s + dy * c;
  }
  return Math.abs(lx) <= r.width / 2 && Math.abs(ly) <= r.height / 2;
}

export function create2DPicking({ camera, batcher, domElement } = {}) {
  if (!camera || !batcher) throw new Error('create2DPicking: camera and batcher required');
  const _v = new THREE.Vector3();   // hot-path scratch — screenToWorld can run at pointermove rate during a drag

  function screenToWorld(clientX, clientY) {
    const el = domElement;
    const rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
    _v.set(ndcX, ndcY, 0).unproject(camera);
    return { x: _v.x, y: _v.y };
  }

  function pickAt(worldX, worldY) {
    let hit = null;
    batcher.forEachActive((r) => { if (pointInSprite(worldX, worldY, r)) hit = r; });
    return hit;
  }

  function pickAtScreen(clientX, clientY) {
    const w = screenToWorld(clientX, clientY);
    return pickAt(w.x, w.y);
  }

  return { screenToWorld, pickAt, pickAtScreen };
}
