/* ============================================================
   asset-viewer.js — Arc A-VIEW: auto-frame a camera-rig from a loaded model's bounding box.
   ------------------------------------------------------------
   THE ABILITY (engine-first, per CLAUDE.md): "given ANY loaded object and an existing
   camera-rig, point the camera at it and back off far enough to see the whole thing" —
   parameterized over the object, not hard-wired to one model. A page (examples/asset-viewer/)
   only WIRES this + camera-rig.js + viewer-ui.js together; none of those three own "how far
   back do I stand for THIS model" — that's the one genuinely new piece of logic this arc adds.

   HOW IT REUSES THE EXISTING RIG, NOT A NEW ONE: camera-rig.js already has a "point the
   target here and jump the framing distance/zoom" seam — `setFollow(getWorldPos, {frame,
   snap})`, built for inspect.js's continuous object-following (L63). A static bounding-box
   center is just a DEGENERATE case of "a moving thing to follow" — call setFollow once with
   a function that always returns the same point, snap the target there instantly, then
   clearFollow() so nothing keeps re-reading it every frame (the object never moves, so there
   is nothing left to follow). Zero new camera-rig code; this module is composition, not a rig.
   C++ anchor: computing an AABB and sizing a bounding sphere for a "fit to view" camera move —
   the same operation a CAD viewer's "zoom to fit" button runs.
   ============================================================ */
import * as THREE from 'three';

/* Measure an object's world-space axis-aligned bounding box. Returns the box itself (so a
   caller can also build a BoxHelper/AxesHelper from it) plus the derived center + size —
   pure read, no side effects on the object or any camera. */
export function measureBounds(object3D) {
  const box = new THREE.Box3().setFromObject(object3D);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  return { box, center, size };
}

/* Point `rig` at `object3D` and back off far enough to see the whole bounding box, in ONE
   call, for any object at any scale — no hardcoded distance. `fit` is a loose multiplier on
   the object's largest dimension (bigger = more headroom around the model); the rig's own
   distMin/distMax (perspective) or zoomMin/zoomMax (ortho) factory clamps still bound the
   result, so pass generous clamps to createCameraRig() if the models this page loads vary
   wildly in scale. Returns the measured { box, center, size } so a caller can also show the
   dimensions on screen (the "make scale legible" half of the asset-viewer brief). */
export function autoFrame(rig, object3D, { fit = 1.6 } = {}) {
  const bounds = measureBounds(object3D);
  const maxDim = Math.max(bounds.size.x, bounds.size.y, bounds.size.z) || 1;   // guard a degenerate/empty box
  const frame = maxDim * fit;
  rig.setFollow((out) => out.copy(bounds.center), { frame, snap: true });
  rig.clearFollow();   // one-shot: the model is static, nothing left to track every frame
  return bounds;
}
