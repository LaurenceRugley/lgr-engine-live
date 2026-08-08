/* ============================================================
   pedestrians.js — A-PEDS (2026-08-06): real walking PEOPLE on the sidewalks.
   ------------------------------------------------------------
   Look-bible §6 item 4 — "pedestrians at correct scale sell 'alive' more than anything." The city's
   existing pedestrians are 0.18-unit capsules strolling the waterfront rim ring (agents.js, a ring
   the scale audit measured as 61% inside building footprints at citygen's real extent). This module
   replaces that read at street level with SKINNED HUMANS walking block perimeters.

   REUSE, NOT REBUILD (everything load-bearing already existed):
     • createCharacterRig — GLB load-once, SkeletonUtils clones with independent mixers, cross-fade
       state machine, stride-matched walk timeScale, distance-LOD mixer throttling (M1a/M1b).
     • survivor.glb — the CC0 Quaternius human already shipped in two projects, now promoted into the
       engine's own asset home (assets/models/CREDITS.md carries the citation).
     • The path needs NO street graph: pedestrians walk the SIDEWALK, and a sidewalk is the block's
       perimeter — a rectangle ring per block, deterministic from the seed. Corners are turned by
       simple param wrap; facing is the tangent.

   Contract: createPedestrians({ scene, blocks, blockSize, count, url, height, speed, seed, y })
     → { ready: Promise, update(dt), group, dispose(), get count() }
   `blocks` = [[bx, bz], …] block centres (citygen exposes state.blocks); `height` = desired human
   height in world units (the city's own pedestrian anchor is ~0.18; a hero-ish 0.22 reads better
   against the 0.28 player eye without towering over the AI cars).
   C++ anchor: a particle system whose particles are skeletal-animation handles — the path math is
   the cheap part; the rig does the heavy lifting.
   ============================================================ */
import * as THREE from 'three';
import { createCharacterRig } from './createCharacterRig.js';
import { mulberry32 } from './citygen.js';
/* NO ?url import of survivor.glb here, deliberately: in the lib build a ?url asset is base64-inlined,
   and the skinned survivor took the full lib from 530KB to 917KB gzip — the size-budget guard went
   red on first build. The asset LIVES in this package (assets/models/survivor.glb, CREDITS.md cites
   it); the CONSUMER imports its url (vite: `from '@lgr/engine-core/assets/models/survivor.glb?url'`)
   so only projects that ship pedestrians pay for the model. */

export function createPedestrians({
  scene,
  blocks = [],
  blockSize = 1.9,          // citygen LAYOUT.BLOCK
  count = 24,
  url,
  height = 0.22,
  speed = 0.14,             // u/s stroll — a touch above the city's 0.12 capsule amble
  seed = 7,
  y = 0.33,                 // sidewalk top (PLINTH_TOP + slab 0.03)
} = {}) {
  if (!url) throw new Error("createPedestrians: `url` is required — import it from '@lgr/engine-core/assets/models/survivor.glb?url' (kept out of the module so the lib build does not inline a 500KB GLB; see the header note)");
  const group = new THREE.Group();
  scene.add(group);
  const rand = mulberry32(seed);

  const rig = createCharacterRig({ url });
  const walkers = [];
  // The perimeter ring sits mid-sidewalk: half the block, minus half the sidewalk band.
  const R = blockSize / 2 - 0.06;
  const PERIM = 8 * R;

  /* param t ∈ [0, PERIM) → position+tangent on the block-perimeter square (CCW). */
  function onPerimeter(t, bx, bz, out, tan) {
    const side = Math.floor(t / (2 * R)), u = t - side * 2 * R;
    if (side === 0)      { out.set(bx - R + u, y, bz - R); tan.set(1, 0, 0); }
    else if (side === 1) { out.set(bx + R, y, bz - R + u); tan.set(0, 0, 1); }
    else if (side === 2) { out.set(bx + R - u, y, bz + R); tan.set(-1, 0, 0); }
    else                 { out.set(bx - R, y, bz + R - u); tan.set(0, 0, -1); }
  }

  const _pos = new THREE.Vector3(), _tan = new THREE.Vector3();
  const TINTS = ['#b98a6a', '#8a9ab9', '#a9b98a', '#b9a9c9', '#c9b98a', '#8ab9b0'];

  const ready = rig.ready.then(() => {
    for (let i = 0; i < count; i++) {
      const h = rig.spawn();
      /* Scale the native model to `height` world units. NOT measured with Box3 — a just-cloned
         SkinnedMesh's bounds are bind-pose garbage before the first mixer tick (measured live:
         a 0.0006 scale, microscopic walkers). The survivor's native height is KNOWN and recorded
         in hoard2's own scaling comment: ~5.26 units. */
      h.object.scale.setScalar(height / 5.26);
      // per-walker tint: clone the shared material once per walker and shade it (24 clones, boot-only)
      const tint = new THREE.Color(TINTS[i % TINTS.length]).offsetHSL(0, 0, rand() * 0.12 - 0.06);
      h.object.traverse((o) => {
        if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.color.multiply(tint); }
      });
      const block = blocks.length ? blocks[Math.floor(rand() * blocks.length)] : [0, 0];
      walkers.push({
        h, block,
        t: rand() * PERIM,
        dir: rand() < 0.5 ? 1 : -1,
        pace: speed * (0.8 + rand() * 0.5),
      });
      h.setState('walk');
      h.setTimeScale(0.8 + rand() * 0.4);          // desynchronised strides
      group.add(h.object);
    }
  });

  function update(dt) {
    for (const w of walkers) {
      w.t = ((w.t + w.dir * w.pace * dt) % PERIM + PERIM) % PERIM;
      onPerimeter(w.t, w.block[0], w.block[1], _pos, _tan);
      w.h.object.position.copy(_pos);
      w.h.object.rotation.y = Math.atan2(_tan.x * w.dir, _tan.z * w.dir);
    }
    rig.update(dt);
  }

  return {
    ready, group, update,
    get count() { return walkers.length; },
    dispose() { walkers.length = 0; scene.remove(group); rig.dispose(); },
  };
}
