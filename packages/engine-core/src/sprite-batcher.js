/* ============================================================
   sprite-batcher.js — thousands of atlas sprites, ONE draw call, via THREE.InstancedMesh.
   ------------------------------------------------------------
   2D-plan §4 gap #1, THE performance difference: a naive `new THREE.Sprite()` per game object is one
   draw call PER sprite (10,000 sprites = 10,000 draws, dead on arrival on a phone). InstancedMesh draws
   ONE shared quad geometry N times in a single call, varying only per-instance data (transform, tint,
   and — the one thing InstancedMesh doesn't give you for free — WHICH atlas sub-image, via the custom
   `aUvRect` attribute in sprite-batch.vert/frag).

   `InstancedMesh`, not `BatchedMesh` (owner decision, brief §4.3): every sprite here shares the exact
   same PlaneGeometry, which is precisely InstancedMesh's designed case; BatchedMesh exists for
   DIFFERING geometries batched together and emulates instancing with repeated multidraw params for the
   equal-geometry case — measurably slower for zero benefit when there's only one geometry to begin with.

   SWAP-REMOVE COMPACTION: active sprites always occupy the CONTIGUOUS slots [0, count) — there is no
   "dead but still drawn" slot to skip, so `mesh.count` alone tells the renderer exactly how many
   instances to draw, and no scan/rebuild is ever needed. Removing a sprite that isn't already last moves
   the LAST active sprite's data into the freed slot (one write) instead of shifting everything after it
   (an O(n) memmove) or leaving a hole (a zero-scale ghost the shader would still have to sample-and-
   discard every frame). The tradeoff, stated once so it never has to be rediscovered: draw ORDER among
   the sprites that DIDN'T move is preserved, but the removed sprite's old neighbours' relative order to
   the sprite that got moved into its slot is not — for a system with no depth buffer (painter's-algorithm
   stacking, see sprite-batch.frag), that means removing a sprite from the middle can shuffle who's "on
   top of" whom among far-apart sprites. Undetectable for a scattered field of independent sprites (the
   Phase 1 benchmark case); would matter for a strict UI z-stack, noted as a Phase-2-if-needed caveat.

   NO HOT-LOOP ALLOCATION (engine invariant, docs/engine-invariants.md): every `addSprite`/`setSprite`
   call reuses ONE closure-scoped scratch Matrix4/Vector3/Quaternion/Color — a busy game can call these
   every frame for hundreds of sprites without ever pressuring the GC, the classic sprite-batcher stutter.

   FINAL PER-INSTANCE ATTRIBUTE LAYOUT (2D LAYER PHASE 2 — this is EVERY sprite AND every text glyph AND
   every 9-slice panel piece; text-block.js and nine-slice.js are thin layout layers over THIS SAME
   batcher/mesh, not a second mesh or a second shader):
     instanceMatrix (mat4, THREE built-in) — position.xy, a Z rotation, scale.xy (the quad's world size)
     instanceColor  (vec3, THREE built-in) — RGB tint
     aUvRect        (vec4, custom)         — this instance's atlas sub-rect (u0, v0, uWidth, vHeight)
     aAlpha         (float, custom, PHASE 2) — opacity multiplier, bundled into this pass rather than a
       later migration (owner's Q2 call, brief §0): SDF/bitmap text was going to touch this per-instance
       format anyway (glyphs need their OWN attribute additions no sprite ever needed), and touching the
       instanced layout twice would have meant two migrations, two guard updates, and two chances to
       break byte-identity for one real feature (fade-in HUDs, dimmed disabled buttons, cross-fading two
       text states) — see sprite-batch.vert's own header for why it isn't folded into aUvRect (already a
       fully-used vec4).
   ============================================================ */
import * as THREE from 'three';

import spriteBatchVert from './shaders/sprite-batch.vert';
import spriteBatchFrag from './shaders/sprite-batch.frag';
import { createSlotAllocator } from './sprite-slots.js';

const Z_AXIS = new THREE.Vector3(0, 0, 1);

export function createSpriteBatcher({ atlas, maxSprites = 1000 } = {}) {
  if (!atlas) throw new Error('createSpriteBatcher: atlas required');

  const geometry = new THREE.PlaneGeometry(1, 1);
  const uvRect = new THREE.InstancedBufferAttribute(new Float32Array(maxSprites * 4), 4);
  uvRect.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aUvRect', uvRect);
  const alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(maxSprites).fill(1), 1);
  alphaAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aAlpha', alphaAttr);

  const material = new THREE.ShaderMaterial({
    vertexShader: spriteBatchVert, fragmentShader: spriteBatchFrag,
    uniforms: { uMap: { value: atlas.texture } },
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,   // see sprite-batch.frag header
  });

  const mesh = new THREE.InstancedMesh(geometry, material, maxSprites);
  mesh.count = 0;
  mesh.frustumCulled = false;   // the 2D layer's own ortho camera bounds the whole batch; per-instance culling isn't worth it at this scale

  // ---- hot-path scratch (reused every write — see header) ----
  const _pos = new THREE.Vector3(), _quat = new THREE.Quaternion(), _scale = new THREE.Vector3(1, 1, 1);
  const _mat = new THREE.Matrix4(), _color = new THREE.Color();

  const records = new Array(maxSprites);   // records[slot] = the live sprite record (picking reads these directly)
  const allocator = createSlotAllocator(maxSprites);   // id<->slot bookkeeping (sprite-slots.js, node-tested)

  function writeSlot(slot, r) {
    _quat.setFromAxisAngle(Z_AXIS, r.rotation || 0);
    _mat.compose(_pos.set(r.x, r.y, 0), _quat, _scale.set(r.width, r.height, 1));
    mesh.setMatrixAt(slot, _mat);
    mesh.setColorAt(slot, _color.set(r.tint != null ? r.tint : 0xffffff));
    const f = r.frame || {};
    uvRect.setXYZW(slot, f.u0 || 0, f.v0 || 0, f.uWidth != null ? f.uWidth : 1, f.vHeight != null ? f.vHeight : 1);
    alphaAttr.setX(slot, r.alpha != null ? r.alpha : 1);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    uvRect.needsUpdate = true;
    alphaAttr.needsUpdate = true;
  }

  /* addSprite({x,y,width,height,rotation,tint,alpha,frame}) → id (a stable handle), or null at capacity.
     `frame` is an atlas.addImage() return value (the {u0,v0,uWidth,vHeight} sub-rect); omit for a
     flat-tinted quad sampling the atlas's default (0,0,1,1) — useful for solid-color sprites/particles
     with no image at all. `alpha` (0..1, default 1) is PHASE 2's addition — see this file's header. */
  function addSprite(opts = {}) {
    const a = allocator.alloc();
    if (!a) return null;
    const r = { id: a.id, x: 0, y: 0, width: 32, height: 32, rotation: 0, tint: 0xffffff, alpha: 1, frame: null, ...opts };
    records[a.slot] = r;
    writeSlot(a.slot, r);
    mesh.count = allocator.count;
    return a.id;
  }

  /* setSprite(id, patch) → mutate an existing sprite in place (position, size, rotation, tint, frame). */
  function setSprite(id, patch) {
    const slot = allocator.slotOf(id);
    if (slot === undefined) return false;
    Object.assign(records[slot], patch);
    writeSlot(slot, records[slot]);
    return true;
  }

  /* removeSprite(id) → swap-remove via sprite-slots.js's allocator (see that file + this module's
     header for the compaction shape). O(1), no memmove, no hole. */
  function removeSprite(id) {
    const result = allocator.free(id);
    if (!result) return false;
    if (result.movedId != null) {
      const moved = records[result.movedFromSlot];
      records[result.freedSlot] = moved;
      writeSlot(result.freedSlot, moved);
    }
    records[result.movedFromSlot != null ? result.movedFromSlot : result.freedSlot] = undefined;
    mesh.count = allocator.count;
    return true;
  }

  /* getSprite(id) → the LIVE record (zero-copy — picking reads many of these per query). Treat as
     read-only; go through setSprite to mutate so the GPU buffers stay in sync. */
  function getSprite(id) {
    const slot = allocator.slotOf(id);
    return slot === undefined ? null : records[slot];
  }

  /* forEachActive(fn) — iterate the [0,count) contiguous active range, for picking's O(n) hit-test
     (see 2d-picking.js) and anything else that needs every live sprite without a Map iteration. */
  function forEachActive(fn) {
    for (let slot = 0; slot < allocator.count; slot++) fn(records[slot], slot);
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
  }

  return {
    mesh, addSprite, setSprite, removeSprite, getSprite, forEachActive,
    get count() { return allocator.count; },
    get capacity() { return maxSprites; },
    dispose,
  };
}
