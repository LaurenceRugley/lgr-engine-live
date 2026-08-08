/* ============================================================
   create2DLayer.js — an orthographic 2D layer that composites with the 3D scene in ONE renderer, ONE frame.
   ------------------------------------------------------------
   This IS the reason a first-party 2D layer was built instead of adopting Pixi/Phaser (2D-plan §2/§3,
   owner decision 2026-08-01): a second rendering stack means two canvases or two GL contexts to
   synchronise — two clocks, two resize paths, two loss/restore handlers. This module shares the ONE
   `THREE.WebGLRenderer` `createEngineCore` already owns; the composition seam is simply "call `.render()`
   at the right point in the SAME per-frame body that already calls the 3D render" — no edit to
   createEngineCore.js itself (engine-first: the ABILITY is a self-contained factory that CONSUMES an
   existing renderer, the same shape createProductStage already established for a second scene sharing
   one renderer).

   COORDINATE SYSTEM: an OrthographicCamera on a center-origin, Y-up, 1-world-unit = 1-CSS-pixel plane
   (matches `width`/`height`, defaulting to the renderer's current CSS size) — so `addSprite({x:0,y:0})`
   is screen center and `{width:64,height:64}` is a 64px square, no unit conversion for the common case.

   OVER vs UNDER (brief §5.1 — "composites OVER (and optionally UNDER)"): see render()'s own doc comment.
   Sprites render with depthTest/depthWrite OFF (sprite-batch.frag) — the compositing works by controlling
   WHEN each pass writes to the shared color/depth buffer (autoClear + an explicit clearDepth), never by
   depth-testing 2D quads against the 3D scene's z-buffer.
   ============================================================ */
import * as THREE from 'three';

import { createTextureAtlas } from './texture-atlas.js';
import { createSpriteBatcher } from './sprite-batcher.js';
import { create2DPicking } from './2d-picking.js';

export function create2DLayer({ renderer, width, height, atlasSize = 1024, maxSprites = 1000 } = {}) {
  if (!renderer) throw new Error('create2DLayer: renderer required');

  const _size = renderer.getSize(new THREE.Vector2());
  let w = width != null ? width : _size.x;
  let h = height != null ? height : _size.y;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, -1000, 1000);
  camera.position.z = 10;

  const atlas = createTextureAtlas({ size: atlasSize });
  const batcher = createSpriteBatcher({ atlas, maxSprites });
  scene.add(batcher.mesh);

  const picking = create2DPicking({ camera, batcher, domElement: renderer.domElement });

  /* resize(newW, newH) — a project calls this from its OWN resize handler (the same one that resizes
     the 3D camera/renderer); this layer doesn't listen for `resize` itself (same no-owned-listeners
     shape as createScrollNarrative/2d-picking). Defaults to the renderer's current CSS size. */
  function resize(newW, newH) {
    const size = (newW != null && newH != null) ? { x: newW, y: newH } : renderer.getSize(new THREE.Vector2());
    w = size.x; h = size.y;
    camera.left = -w / 2; camera.right = w / 2; camera.top = h / 2; camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
  }

  /* render({clear}) — draw this ortho pass into whatever's ALREADY in the shared color buffer.
       clear:false (default) = OVER mode. Call this AFTER your 3D render() call. autoClear is forced off
       for this pass so the 3D frame underneath survives; clearDepth() is cheap hygiene (sprites ignore
       depth anyway, see sprite-batch.frag, but a future depth-testing 2D material would want it).
       clear:true = UNDER mode. Call this FIRST in your frame, as a 2D background. This pass DOES clear
       (color+depth+stencil, the renderer's normal autoClear behaviour) — the HOST must then set
       `renderer.autoClear = false` before its OWN 3D render() call, or that call will wipe this layer.
     Either way this function restores whatever `renderer.autoClear` was before it ran — it never leaves
     that as a side effect on the shared renderer past its own call. */
  function render({ clear = false } = {}) {
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = clear;
    if (!clear) renderer.clearDepth();
    renderer.render(scene, camera);
    renderer.autoClear = prevAutoClear;
  }

  function dispose() {
    batcher.dispose();
    atlas.dispose();
  }

  return {
    scene, camera, atlas, batcher, picking,
    addSprite: batcher.addSprite, setSprite: batcher.setSprite, removeSprite: batcher.removeSprite, getSprite: batcher.getSprite,
    render, resize, dispose,
    get width() { return w; }, get height() { return h; },
  };
}
