/* ============================================================
   planar-reflection.js — L108: the mirror-camera ABILITY for a flat water plane at y = 0.
   ------------------------------------------------------------
   For a flat mirror, the reflection of the world is just the world rendered from a camera MIRRORED across the
   plane. This module owns the reusable, tier-agnostic piece: a half-res render target (`reflRT`) + a `mirrorCam`
   whose position/orientation/projection are the reflection of a source camera across y = 0, with an OBLIQUE
   near-plane clip so geometry BELOW the water can't leak into the reflection. The engine composes the rest
   (what to hide, the celestials skydome placement, when to run it, the beauty gate) — this stays a pure ability.

   THE MATH (adapted from three's `Reflector` addon — the crib sheet, not adopted: Reflector owns its own render
   loop + material; we need ours governor-gated + tier-safe). Reflecting position, look-target AND the up vector
   across the plane keeps the virtual camera a consistent frame → winding stays correct with NO manual front-face
   flip. For the y = 0 plane the reflection is simply "negate y" on points and directions.

   *In C++ this would be…* folding a reflection matrix R (about y=0) into the view, `V' = V·R`, then an oblique
   near-clip so the frustum's near plane coincides with the mirror — the classic textbook planar-mirror pass.
   ============================================================ */
import * as THREE from 'three';

export function createPlanarReflection({ drawBuffer, planeY = 0 }) {
  // Half-res (the bloom-buffer precedent) — a mirror is the most expensive add since bloom; it never needs full res.
  const reflRT = new THREE.WebGLRenderTarget(Math.max(1, drawBuffer.x >> 1), Math.max(1, drawBuffer.y >> 1), {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, stencilBuffer: false,
  });

  const mirrorCam = new THREE.PerspectiveCamera();   // config copied from the source cam each frame (persp OR ortho projection matrix)
  const NORMAL = new THREE.Vector3(0, 1, 0);         // the water plane's up-normal (world y)
  const _p = new THREE.Vector3(), _fwd = new THREE.Vector3(), _up = new THREE.Vector3(), _target = new THREE.Vector3();
  const _reflPlane = new THREE.Plane(), _clip = new THREE.Vector4(), _q = new THREE.Vector4();

  // reflect a point across the y=planeY plane (normal is world-up): only y flips, about planeY.
  const reflectPoint = (v) => v.set(v.x, 2 * planeY - v.y, v.z);
  const reflectDir   = (v) => v.set(v.x, -v.y, v.z);

  /* updateCamera(srcCam): recompute mirrorCam as the reflection of srcCam across y=planeY, with the oblique
     near-clip. Call every frame BEFORE the reflection render. */
  function updateCamera(srcCam) {
    srcCam.updateMatrixWorld();
    srcCam.getWorldPosition(_p);
    srcCam.getWorldDirection(_fwd);                        // unit forward
    _up.set(0, 1, 0).applyQuaternion(srcCam.quaternion);  // the source camera's up (handles any roll)

    reflectPoint(_p);                                      // mirrored eye
    _target.copy(_p).add(reflectDir(_fwd.clone()));        // a point ahead along the reflected forward
    mirrorCam.position.copy(_p);
    mirrorCam.up.copy(reflectDir(_up));                    // reflected up → consistent frame, winding stays correct
    mirrorCam.lookAt(_target);

    // Match the source projection (persp or ortho), then bend the near plane onto the water (Lengyel oblique clip):
    // anything below y=planeY is clipped, so a below-water tower base / seabed can't appear in the reflection.
    mirrorCam.projectionMatrix.copy(srcCam.projectionMatrix);
    mirrorCam.updateMatrixWorld();
    _reflPlane.setFromNormalAndCoplanarPoint(NORMAL, new THREE.Vector3(0, planeY, 0)).applyMatrix4(mirrorCam.matrixWorldInverse);
    _clip.set(_reflPlane.normal.x, _reflPlane.normal.y, _reflPlane.normal.z, _reflPlane.constant);
    const proj = mirrorCam.projectionMatrix;
    _q.x = (Math.sign(_clip.x) + proj.elements[8]) / proj.elements[0];
    _q.y = (Math.sign(_clip.y) + proj.elements[9]) / proj.elements[5];
    _q.z = -1.0;
    _q.w = (1.0 + proj.elements[10]) / proj.elements[14];
    _clip.multiplyScalar(2.0 / _clip.dot(_q));
    proj.elements[2]  = _clip.x;
    proj.elements[6]  = _clip.y;
    proj.elements[10] = _clip.z + 1.0;
    proj.elements[14] = _clip.w;
    return mirrorCam;
  }

  function setSize(db) { reflRT.setSize(Math.max(1, db.x >> 1), Math.max(1, db.y >> 1)); }
  function dispose() { reflRT.dispose(); }

  return { reflRT, mirrorCam, updateCamera, setSize, dispose, get texture() { return reflRT.texture; } };
}
