/* ============================================================
   hidden-prop.js — createHiddenProp: a hidden object that notices you.
   ------------------------------------------------------------
   THE ABILITY (engine-first, per CLAUDE.md): drop a small prop somewhere in a world; when
   the player's craft first comes within `radius` of it, fire `onEnter` ONCE and give the
   prop a little hop. The city's cardboard-box easter egg is the first CONSUMER of this —
   the capability itself knows nothing about cardboard, cities, or eggs.

   ⚠ THE GROUP IS OURS, AND IT IS ALWAYS VISIBLE. The prop parents to a Group this factory
   creates and adds to the scene itself. It deliberately does NOT reuse `placedLife.group`,
   which the city sets `visible = false` in city mode (createCityWorld.js:324) — parenting
   there would ship an INVISIBLE box that still shifted the render baseline. Owning the
   group is what makes that failure unrepresentable rather than merely avoided.

   The pure logic (where it sits, when it fires) lives in `hidden-prop-logic.js` so it can
   be node:test'd without a GPU. This file is only the GL half.

   C++ anchor: a small entity struct owning its own scene-graph node — construct, tick with
   the player position, destruct freeing its GPU handles. `update()` allocates nothing; it
   writes scalars into a Vector3 that already exists (no per-frame `new`).
   ============================================================ */
import * as THREE from 'three';
import { vectorize } from './vector-style.js';
import { createProximityLatch } from './hidden-prop-logic.js';

const HOP_DURATION = 0.55;   // seconds — one quick bounce, then done
const HOP_HEIGHT = 0.28;     // world units at the apex

/* createHiddenProp({ scene, at, radius, onEnter, size?, color? })
     scene   — THREE.Scene to attach our own group to
     at      — { x, y, z } world position of the prop's CENTRE
     radius  — trigger radius in world units (top-down; y is ignored)
     onEnter — called at most once, the first frame the craft is inside `radius`
   → { group, mesh, update(craftPos, dt), dispose() } */
export function createHiddenProp({
  scene, at, radius = 6, onEnter = null, size = 0.5, color = '#C9A668',
} = {}) {
  if (!scene) throw new Error('createHiddenProp: `scene` is required');
  if (!at) throw new Error('createHiddenProp: `at` is required');

  // Our OWN group — never placedLife's. Always visible, in every scene mode.
  const group = new THREE.Group();
  group.name = 'hiddenProp';

  // The shared placeholder-art language: a flat-shaded standard material run through
  // vectorize() so the prop inherits the vector/toon tiers like every other placed object
  // (idiom: placed-life.js:67). One box, no lid, no decals — the silhouette is the joke.
  const geometry = new THREE.BoxGeometry(size, size, size);
  const material = vectorize(
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true }),
    { color },
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.raycast = () => {};        // never intercept the building-click dive (placed-life idiom)
  mesh.rotation.y = 0.28;         // a few degrees off-grid: dropped, not installed
  mesh.position.set(at.x, at.y, at.z);
  group.add(mesh);
  scene.add(group);

  const latch = createProximityLatch(radius);
  const baseY = at.y;
  let hopRemaining = 0;           // seconds left in the hop; 0 = at rest

  /* update(craftPos, dt) — craftPos may be null (no craft seized yet): guard and bail.
     NOTE: the brief specified `update(craftPos)`, but a time-based hop needs a delta, so
     dt is a second parameter (defaulted, so a one-arg call still latches correctly and
     simply snaps the hop). Reported to DESIGN. */
  function update(craftPos, dt = 0) {
    if (craftPos && latch.test(craftPos.x - at.x, craftPos.z - at.z)) {
      hopRemaining = HOP_DURATION;
      if (onEnter) onEnter();
    }
    if (hopRemaining > 0) {
      hopRemaining -= dt;
      if (hopRemaining <= 0) {
        hopRemaining = 0;
        mesh.position.y = baseY;                    // land exactly, no drift
      } else {
        // p sweeps 0→1 across the hop; sin(pi*p) is a clean 0→1→0 arc. Scalars only.
        const p = 1 - hopRemaining / HOP_DURATION;
        mesh.position.y = baseY + Math.sin(Math.PI * p) * HOP_HEIGHT;
      }
    }
  }

  /* dispose() — free the GPU handles this factory allocated, and detach.
     The material carries no textures (vectorize only patches shader chunks/uniform scalars),
     so material.dispose() is sufficient here. */
  function dispose() {
    scene.remove(group);
    group.remove(mesh);
    geometry.dispose();
    material.dispose();
  }

  return { group, mesh, update, dispose, get found() { return latch.fired; } };
}
