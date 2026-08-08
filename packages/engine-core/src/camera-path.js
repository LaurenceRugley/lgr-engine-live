/* ============================================================
   camera-path.js — a C2-ISH camera flight path + curvature-derived banking.
   ------------------------------------------------------------
   Owner feedback 2026-08-01: "the turning and banking is really jittery… smooth banking and turning
   realistically, not discrete turns." camera-rig.js had NO spline or roll support at all — a scripted
   flythrough (`projects/city/main.js`'s dead `buildHeroPath`/`samplePath`) LERPs raw waypoints, which is
   discrete-velocity: the camera's direction of travel SNAPS at every waypoint, read as a jitter/kink at
   every turn. This module is the fix: a real curve through the waypoints, plus the physics to bank into
   its turns like an aircraft.

   ── SPLINE CHOICE: CENTRIPETAL CATMULL-ROM, not a B-spline (say which, and why — brief's own ask) ──
   Built via the standard non-uniform-knot Catmull-Rom construction (Hermite interpolation where each
   waypoint's tangent is a knot-weighted blend of its two neighbouring secants, knots spaced by
   |ΔP|^0.5 — the CENTRIPETAL parameterization, vs. uniform spacing or |ΔP|^1 "chordal"). Centripetal is
   the one of the three that never loops or cusps for unevenly-spaced waypoints (a well-known failure of
   the uniform version) — Unreal's spline component and most game camera tools use exactly this for
   exactly that reason.

   HONESTY ABOUT CONTINUITY CLASS (this matters because roll is derived from curvature — a SECOND
   derivative): Catmull-Rom, in ANY parameterization (uniform/chordal/centripetal), is mathematically
   C1-continuous — position AND tangent agree across a segment boundary, but CURVATURE can still jump a
   small amount at each waypoint, because each segment's tangent only looks at its own two neighbours, not
   the full local curve shape. A cubic B-SPLINE, by contrast, IS C2 by construction (degree-3 B-spline
   basis functions are C^(degree-1) = C2) — but a raw B-spline curve does not pass through its control
   points at all (it only APPROXIMATES them), which is the wrong behaviour for AUTHORED waypoints — an
   artist places a camera beat expecting the camera to actually BE there, not near there. Turning that
   into a true interpolating C2 curve means solving a GLOBAL tridiagonal system (a "natural cubic spline")
   — real, well-known, but non-local: moving one waypoint recomputes the WHOLE curve's coefficients, a bad
   fit for a general-purpose engine primitive meant to be simple to extend with new waypoints.
   DECISION: centripetal Catmull-Rom — local (O(1) per segment, cheap, trivially extensible), interpolates
   every waypoint exactly, and is the industry-standard choice for exactly this job. The residual
   knot-level curvature discontinuity is real but SMALL, and is exactly what camera-rig.js's roll damping
   (the SAME `damp()` from math.js every other rig value already uses) absorbs — the spline buys the
   big win (continuous position + tangent, replacing fully-discrete waypoint snaps), the damp buys the
   rest (smoothing the small residual so the final banked motion reads as continuous, not kinked).

   ── CURVATURE → BANK ANGLE ── the real aircraft coordinated-turn formula: a banked aircraft's lift
   provides the centripetal force for a turn when tan(bank) = v²·κ/g (v=speed, κ=turn curvature, g=gravity
   — here a tunable `turnGain`, not literally 9.8, since world units aren't meters). `signed` curvature
   (about a reference "up" axis) gives the TURN DIRECTION — bank left into a left turn, right into a right
   one — magnitude alone can't do that (κ from |v×a|/|v|³ is always ≥0).

   NO HOT-LOOP ALLOCATION (engine invariant): tangentAt/curvatureAt reuse closure-scoped scratch Vector3s;
   pointAt writes into a caller-supplied `out` when driven every frame (see camera-rig.js's own call site).
   ============================================================ */
import * as THREE from 'three';

const ALPHA = 0.5;   // centripetal (0=uniform, 0.5=centripetal, 1=chordal — see header)

/* createCameraPath(waypoints) — waypoints: Vector3[] | {x,y,z}[], length >= 2.
   → { pointAt(t, out), tangentAt(t, out), curvatureAt(t, upRef), waypointCount } */
export function createCameraPath(waypoints) {
  if (!waypoints || waypoints.length < 2) throw new Error('createCameraPath: at least 2 waypoints required');
  const pts = waypoints.map((p) => (p && p.isVector3) ? p.clone() : new THREE.Vector3(p.x, p.y, p.z));
  const n = pts.length;

  // Phantom endpoints (standard Catmull-Rom end handling): mirror the second/second-last point through
  // the first/last so the curve still passes exactly through pts[0] and pts[n-1] with a well-defined
  // tangent there, instead of needing a special-cased end formula.
  const first = pts[0].clone().multiplyScalar(2).sub(pts[1]);
  const last = pts[n - 1].clone().multiplyScalar(2).sub(pts[n - 2]);
  const P = [first, ...pts, last];

  const centripetalDelta = (a, b) => Math.pow(Math.max(a.distanceTo(b), 1e-4), ALPHA);
  const knots = [0];
  for (let i = 1; i < P.length; i++) knots.push(knots[i - 1] + centripetalDelta(P[i - 1], P[i]));

  // per-waypoint tangent: a knot-weighted blend of the two adjacent secants (the non-uniform Catmull-Rom
  // tangent formula — this IS what makes the construction equivalent to centripetal Catmull-Rom while
  // staying expressible as plain cubic Hermite interpolation, with clean analytic basis functions below).
  const m = [];
  for (let i = 0; i < n; i++) {
    const j = i + 1;   // index into the phantom-extended P/knots arrays
    const d1 = knots[j] - knots[j - 1] || 1e-4, d2 = knots[j + 1] - knots[j] || 1e-4;
    const v1 = P[j].clone().sub(P[j - 1]).divideScalar(d1);
    const v2 = P[j + 1].clone().sub(P[j]).divideScalar(d2);
    m.push(v1.multiplyScalar(d2 / (d1 + d2)).addScaledVector(v2, d1 / (d1 + d2)));
  }

  // per-segment duration (real waypoint i → i+1) in the SAME centripetal knot units — this is what makes
  // a longer/farther-apart segment occupy proportionally more of the global t∈[0,1] range.
  const segDur = [];
  for (let i = 0; i < n - 1; i++) segDur.push(knots[i + 2] - knots[i + 1] || 1e-4);
  const totalDur = segDur.reduce((a, b) => a + b, 0);

  function locate(t) {
    t = THREE.MathUtils.clamp(t, 0, 1);
    const target = t * totalDur;
    let acc = 0;
    for (let i = 0; i < segDur.length; i++) {
      if (i === segDur.length - 1 || target <= acc + segDur[i]) {
        return { i, s: THREE.MathUtils.clamp((target - acc) / segDur[i], 0, 1), dt: segDur[i] };
      }
      acc += segDur[i];
    }
    return { i: 0, s: 0, dt: segDur[0] };   // unreachable (n>=2 guarantees segDur.length>=1) — satisfies control-flow analysis
  }

  /* pointAt(t, out) — t∈[0,1] over the WHOLE path. Cubic Hermite basis (h00/h10/h01/h11), the textbook
     form; `dt` (this segment's own duration) scales the tangent terms so units match (m[] is a rate
     "world units per knot unit", multiplied back up by the segment's own knot span). */
  function pointAt(t, out = new THREE.Vector3()) {
    const { i, s, dt } = locate(t);
    const s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    return out.copy(pts[i]).multiplyScalar(h00)
      .addScaledVector(m[i], h10 * dt)
      .addScaledVector(pts[i + 1], h01)
      .addScaledVector(m[i + 1], h11 * dt);
  }

  // ---- hot-path scratch (no per-call allocation — engine invariant) ----
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
  const _vel = new THREE.Vector3(), _acc = new THREE.Vector3(), _cross = new THREE.Vector3();
  const H = 1 / 1024;   // finite-difference probe width in the GLOBAL [0,1] path parameter

  /* tangentAt(t, out) — a central-difference dP/dt (NOT unit length — callers wanting a facing direction
     should normalize; curvatureAt below needs the raw magnitude, so this doesn't normalize for them). */
  function tangentAt(t, out = new THREE.Vector3()) {
    const t0 = Math.max(0, t - H), t1 = Math.min(1, t + H);
    pointAt(t0, _a); pointAt(t1, _b);
    return out.copy(_b).sub(_a).divideScalar(Math.max(t1 - t0, 1e-6));
  }

  /* curvatureAt(t, upRef) → { signed, magnitude }. Central-difference velocity + acceleration (a 3-point
     stencil — simple, robust, and accurate enough for a VISUAL banking signal; this module deliberately
     does not carry the analytic 2nd-derivative of the rational Hermite/non-uniform-knot construction,
     which is exact but easy to get subtly wrong — Rule 2, simplicity where the accuracy bar allows it).
     `signed` is the curvature's component about `upRef` (world +Y for a normal flythrough) — its SIGN is
     the turn direction (bank left vs right); `magnitude` is the unsigned |κ| (always ≥0, from |v×a|/|v|³,
     never tells you which way to bank on its own — this is why bankAngleFromCurvature below takes signed). */
  function curvatureAt(t, upRef) {
    const t0 = Math.max(0, t - H), t1 = Math.min(1, t + H);
    const dt = Math.max(t1 - t0, 1e-6);
    pointAt(t0, _a); pointAt(t, _b); pointAt(t1, _c);
    _vel.copy(_c).sub(_a).divideScalar(dt);
    _acc.copy(_c).add(_a).addScaledVector(_b, -2).divideScalar((dt * 0.5) * (dt * 0.5));
    const speed2 = _vel.lengthSq();
    if (speed2 < 1e-10) return { signed: 0, magnitude: 0 };
    _cross.crossVectors(_vel, _acc);
    const denom = Math.pow(speed2, 1.5);
    return { signed: _cross.dot(upRef) / denom, magnitude: _cross.length() / denom };
  }

  return { pointAt, tangentAt, curvatureAt, waypointCount: n };
}

/* bankAngleFromCurvature(signedCurvature, speed, opts) — the aircraft coordinated-turn formula:
   tan(bank) = speed² · κ / turnGain. `turnGain` is NOT literal gravity (world units aren't meters) —
   it's the one tunable that sets how aggressively a given turn tightness banks; bigger turnGain = lazier
   banking for the same curve. Clamped to `maxBankRad` so a very tight turn caps at a believable max bank
   (an unclamped tan() blows up toward 90° as curvature/speed grow — no real aircraft banks that far). */
export function bankAngleFromCurvature(signedCurvature, speed, { maxBankRad = THREE.MathUtils.degToRad(35), turnGain = 9.8 } = {}) {
  const raw = Math.atan((speed * speed * signedCurvature) / turnGain);
  return THREE.MathUtils.clamp(raw, -maxBankRad, maxBankRad);
}
