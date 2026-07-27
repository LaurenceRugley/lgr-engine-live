/* ============================================================
   hoard2 · src/player/movement.js — PURE ground-movement maths (THREE-free, node-testable).
   ------------------------------------------------------------
   The iso survivor's motion split out of index.js so the intent — clamp to the play disc, get pushed
   OUT of trees/ruins/barriers, face where you aim — can be unit-tested without a GPU (Rule 9). index.js
   owns the THREE glue (input listeners, the rig, the model); this owns only the numbers.

   All functions are ALLOCATION-FREE: they write into a caller-supplied `out` (a reused scratch), never
   `new`. C++ anchor: each is a free function taking an out-param by reference — the classic "fill this
   struct" shape, so the hot per-frame path never touches the allocator (engine-invariants #7).

   Conventions (match v1 hoard.js + the walker): facing is a yaw where forward = (sin f, cos f) in xz;
   +x strafes right of that. AABBs here use the build facade's LOWERCASE keys {minx,minz,maxx,maxz}.
   ============================================================ */

// Clamp a point to a disc of radius R centred on the origin (the play area). Writes {x,z} into `out`.
// C++: like clamping a vector to a max length — scale it back onto the boundary circle when it escapes.
export function clampToRadius(x, z, R, out) {
  const r = Math.hypot(x, z);
  if (r > R && r > 1e-8) { const k = R / r; out.x = x * k; out.z = z * k; }
  else { out.x = x; out.z = z; }
  return out;
}

// Push a body of radius `pr` OUT of any circle collider it ended up inside (trees/ruins {x,z,r}). One
// discrete "resolve penetration" pass (move first, un-overlap second) — ported from v1 hoard.js:141.
export function resolveCircles(x, z, pr, circles, out) {
  out.x = x; out.z = z;
  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    const dx = out.x - c.x, dz = out.z - c.z, rr = c.r + pr, d2 = dx * dx + dz * dz;
    if (d2 < rr * rr) {
      if (d2 > 1e-8) { const d = Math.sqrt(d2), push = (rr - d) / d; out.x += dx * push; out.z += dz * push; }
      else { out.x += rr; }                     // dead-centre on a trunk → nudge out along +x
    }
  }
  return out;
}

// Push a body of radius `pr` OUT of any axis-aligned box it ended up inside (barriers, build.aabbs()
// lowercase keys), ejecting along the axis of LEAST penetration. Mirrors the walker's box resolve.
export function resolveAabbs(x, z, pr, aabbs, out) {
  out.x = x; out.z = z;
  for (let i = 0; i < aabbs.length; i++) {
    const b = aabbs[i];
    const mnx = b.minx - pr, mxx = b.maxx + pr, mnz = b.minz - pr, mxz = b.maxz + pr;
    if (out.x > mnx && out.x < mxx && out.z > mnz && out.z < mxz) {
      const pxl = out.x - mnx, pxr = mxx - out.x, pzl = out.z - mnz, pzr = mxz - out.z;
      const m = Math.min(pxl, pxr, pzl, pzr);
      if (m === pxl) out.x = mnx; else if (m === pxr) out.x = mxx; else if (m === pzl) out.z = mnz; else out.z = mxz;
    }
  }
  return out;
}

// Yaw that makes the survivor face the ground point (tx,tz) from (px,pz). forward = (sin f, cos f), so
// the heading toward the target is atan2(Δx, Δz). Returns the previous facing if the target IS us (no NaN).
export function aimFacing(px, pz, tx, tz, prevFacing = 0) {
  const dx = tx - px, dz = tz - pz;
  if (dx * dx + dz * dz < 1e-8) return prevFacing;
  return Math.atan2(dx, dz);
}

// One camera-relative acceleration step. `input` = {x:strafe(+right), y:forward(+fwd)} in SCREEN axes;
// `azimuth` is the rig heading. Eases current velocity toward the desired (exp accel, frame-rate stable),
// advances position, and reports the move heading. Writes x,z,vx,vz,moving,facing into `out` (no clamp /
// no collision here — the caller applies clampToRadius + resolve* after, exactly like v1's update order).
export function isoStep(state, input, azimuth, dt, params, out) {
  const { walkSpeed, sprintSpeed, accel } = params;
  let ix = input.x || 0, iy = input.y || 0;
  const il = Math.hypot(ix, iy);
  if (il > 1) { ix /= il; iy /= il; }             // clamp diagonal to unit so diagonal isn't faster
  const moving = il > 0.05;
  // Screen input → world direction via the camera azimuth (v1 hoard.js:632): right = (cos, -sin),
  // forward projects onto the ground as (-sin, -cos). This is why W always goes "up the screen".
  const ca = Math.cos(azimuth), sa = Math.sin(azimuth);
  const dirX = ca * ix + (-sa) * iy, dirZ = (-sa) * ix + (-ca) * iy;
  const sp = (input.sprint ? sprintSpeed : walkSpeed);
  const k = 1 - Math.exp(-accel * dt);
  out.vx = state.vx + (dirX * sp - state.vx) * k;
  out.vz = state.vz + (dirZ * sp - state.vz) * k;
  out.x = state.x + out.vx * dt;
  out.z = state.z + out.vz * dt;
  out.moving = moving;
  out.facing = moving ? Math.atan2(dirX, dirZ) : state.facing;
  return out;
}
