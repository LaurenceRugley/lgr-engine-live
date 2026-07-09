/* ============================================================
   interior.js — Lesson 48: a REUSABLE interior toolkit (the "tools for other products" goal).
   ------------------------------------------------------------
   Beautify techniques that generalize beyond the office live HERE, so any future interior (more
   offices, the Walking Dead site, client scenes) inherits them instead of copy-pasting office code.
   Each export is a small pure factory returning a THREE object you `.add()` to your scene.

     makeContactShadow(opts) — a soft fake-AO blob to lay under a prop (the cheap stand-in for the
                               darkening you'd get from a real shadow map / global illumination).
     makeVignette(opts)      — a camera-facing radial-darkening quad for a cinematic edge falloff,
                               sized to the frustum each frame (call its .fit(camera) in update).

   C++ ANALOGY: a small reusable header of helpers (free functions + a couple of POD structs) that
   any scene "links against" — no office-specific state baked in.
   ============================================================ */
import * as THREE from 'three';

/* One shared soft radial texture (transparent rim → dark centre), cached across all callers — a
   contact shadow is just this blob laid flat under a prop. (Built lazily; needs a DOM canvas.) */
let _shadowTex = null;
function shadowTexture() {
  if (_shadowTex) return _shadowTex;
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.0, 'rgba(0,0,0,0.60)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.32)');
  g.addColorStop(1.0, 'rgba(0,0,0,0.0)');
  x.fillStyle = g; x.beginPath(); x.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); x.fill();
  _shadowTex = new THREE.CanvasTexture(c);
  _shadowTex.colorSpace = THREE.SRGBColorSpace;
  return _shadowTex;
}

/* A flat SOFT CONTACT SHADOW (fake ambient occlusion) to lay under a prop where it meets a surface.
   The single cheapest realism gain in a stylized interior: a real shadow map costs a depth pass +
   GPU shadow filtering every frame (the mobile-sensitive path); this is one transparent quad that
   never moves. w/d = footprint; (x,y,z) = where it rests (y a hair above the surface to avoid
   z-fighting); `rotation` spins it about up for non-square footprints. Lies in the XZ plane. */
export function makeContactShadow({ w = 0.6, d = 0.6, x = 0, y = 0.002, z = 0, opacity = 0.5, rotation = 0 } = {}) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, opacity, depthWrite: false, toneMapped: false }),
  );
  m.rotation.x = -Math.PI / 2;     // lay flat (faces up)
  m.rotation.z = rotation;
  m.position.set(x, y, z);
  m.renderOrder = -1;              // draw under the props that sit on it
  m.raycast = () => {};            // never pickable
  return m;
}

/* A SEATED FREE-LOOK head-turn (L51) — reusable across any interior. It owns the clamped + damped
   yaw/pitch state of "turning your head from a fixed seat" (NOT walking): feed it drag deltas (px) or
   key holds, call update(dt) each frame, then read `.yaw`/`.pitch` (radians) and apply them as a LOCAL
   rotation on top of your base camera orientation (the consumer keeps its own eye position + base look).
   C++ ANALOGY: a tiny state object — two clamped angles eased toward a target each tick (a critically-ish
   damped follow), with the matrix math left to the caller. Limits in degrees; everything else radians. */
export function createSeatedLook({ yawLimit = 80, pitchUp = 32, pitchDown = 20, sensitivity = 0.16, keySpeed = 70, damp = 9 } = {}) {
  const D = Math.PI / 180;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  let yaw = 0, pitch = 0, tYaw = 0, tPitch = 0;       // current + target, in DEGREES (clamp in degrees)
  return {
    addDrag(dx, dy) {                                  // pointer delta in px → look the OPPOSITE way (grab-the-world)
      tYaw = clamp(tYaw - dx * sensitivity, -yawLimit, yawLimit);
      tPitch = clamp(tPitch - dy * sensitivity, -pitchDown, pitchUp);
    },
    addKeys(dt, { left, right, up, down }) {
      const s = keySpeed * dt;
      if (left) tYaw = clamp(tYaw + s, -yawLimit, yawLimit);
      if (right) tYaw = clamp(tYaw - s, -yawLimit, yawLimit);
      if (up) tPitch = clamp(tPitch + s, -pitchDown, pitchUp);
      if (down) tPitch = clamp(tPitch - s, -pitchDown, pitchUp);
    },
    recenter() { tYaw = 0; tPitch = 0; },
    // Gyro seam: set absolute target angles (positive = right / up, clamped). Negates yawDeg
    // internally to match the addDrag convention (positive addDrag dx = looking left).
    setTarget(yawDegRight, pitchDegUp) {
      tYaw   = clamp(-yawDegRight, -yawLimit, yawLimit);
      tPitch = clamp(pitchDegUp,   -pitchDown, pitchUp);
    },
    update(dt) {                                       // frame-rate-independent easing toward the target
      const k = 1 - Math.exp(-damp * dt);
      yaw += (tYaw - yaw) * k; pitch += (tPitch - pitch) * k;
    },
    get yaw() { return yaw * D; }, get pitch() { return pitch * D; },   // radians, for the caller's Euler
    get active() { return Math.abs(yaw) > 0.05 || Math.abs(pitch) > 0.05; },
  };
}

/* One shared radial VIGNETTE texture: transparent centre → soft dark rim (a cinematic edge grade). */
let _vignetteTex = null;
function vignetteTexture() {
  if (_vignetteTex) return _vignetteTex;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, S * 0.32, S / 2, S / 2, S * 0.72);
  g.addColorStop(0.0, 'rgba(0,0,0,0)');
  g.addColorStop(1.0, 'rgba(0,0,0,1)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  _vignetteTex = new THREE.CanvasTexture(c);
  _vignetteTex.colorSpace = THREE.SRGBColorSpace;
  return _vignetteTex;
}

/* A camera-facing VIGNETTE quad — a cheap cinematic edge darkening WITHOUT a full post pipeline (no
   render-target ping-pong; just one transparent quad drawn last, in front of everything). Add it to
   the scene and call `.fit(camera)` each frame so it covers the frustum at any aspect. `strength`
   scales the rim darkness. The mesh carries `.fit` on itself. Reusable across any scene/camera. */
export function makeVignette({ strength = 0.55, dist = 0.5 } = {}) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: vignetteTexture(), transparent: true, opacity: strength, depthTest: false, depthWrite: false, toneMapped: false }),
  );
  mesh.renderOrder = 9999;          // draw on top of the whole scene
  mesh.raycast = () => {};
  mesh.frustumCulled = false;
  const _v = new THREE.Vector3();
  mesh.fit = (camera) => {
    // park the quad `dist` in front of the camera, sized to overfill the frustum at that distance.
    camera.getWorldDirection(_v);
    mesh.position.copy(camera.position).addScaledVector(_v, dist);
    mesh.quaternion.copy(camera.quaternion);
    const h = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5) * dist * 1.05;
    mesh.scale.set(h * camera.aspect, h, 1);
  };
  return mesh;
}
