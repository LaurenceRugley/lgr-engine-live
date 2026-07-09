/* ============================================================
   gyro-look.js — VIZ MOBILE: DeviceOrientation → cockpit head-turn
   ------------------------------------------------------------
   SEAM: `createGyroLook({ look })` wraps a `createSeatedLook` instance.
   Enable → async requestPermission (iOS 13+) → subscribe deviceorientation
   → capture calibration ZERO on the first event (the device pose when the
   chip was tapped) → feed RELATIVE Δyaw/Δpitch vs zero via `look.setTarget`.

   DESIGN DECISIONS (from HANDOFF brief):
   - ONE look state: gyro feeds the SAME pilotLook the desktop right-drag feeds.
     Never a parallel look path.
   - RELATIVE: zero is captured fresh on each `enable()` so the user's current
     phone pose is "straight ahead" — absolute compass heading not used (unreliable).
   - SCALE < 1: intentionally dampened to reduce nausea (0.8 deg per deg by default).
   - SCREEN ORIENTATION compensation: the same physical tilt means different yaw/pitch
     depending on whether the phone is in portrait vs landscape.

   EXPORTED PURE FUNCTION: `mapGyroToLook(event, zero, screenAngle)` is fully
   deterministic with no side effects → node-testable without any DOM/device.
   ============================================================ */

/* Maps a DeviceOrientationEvent + calibration zero to look angles.
   Returns { yawDeg, pitchDeg } where positive = looking right / up.
   `screenAngle`: screen.orientation.angle (0, 90, 180, 270 degrees).

   Physics: with the phone held upright in portrait (beta≈90, gamma≈0):
   - dBeta > 0: phone top tilts away from user → looking UP   (+ pitchDeg)
   - dGamma > 0: phone right-edge tilts down  → looking RIGHT (+ yawDeg)
   Landscape-right (screen rotated 90° clockwise): axes swap. */
export function mapGyroToLook(event, zero, screenAngle) {
  const dBeta  = _wrap((event.beta  ?? 0) - (zero.beta  ?? 0));
  const dGamma = _wrap((event.gamma ?? 0) - (zero.gamma ?? 0));
  const a = screenAngle ?? 0;
  if (a <  45 || a >= 315) return { yawDeg:  dGamma, pitchDeg:  dBeta  };   // portrait
  if (a < 135)             return { yawDeg:  dBeta,  pitchDeg: -dGamma };   // landscape-right (home button right)
  if (a < 225)             return { yawDeg: -dGamma, pitchDeg: -dBeta  };   // portrait-inverted
  return                          { yawDeg: -dBeta,  pitchDeg:  dGamma };   // landscape-left (home button left)
}

/* Wrap a degree delta to the [-180, 180] range so +179° → -181° doesn't read as a huge jump. */
function _wrap(d) { return ((d + 180) % 360) - 180; }

/* createGyroLook({ look, scale = 0.8 })
   ─────────────────────────────────────
   `look`: a createSeatedLook instance (must expose setTarget + recenter).
   `scale`: look degrees per orientation degree (default 0.8).

   API:
     .enable()  → Promise<{ ok: boolean, reason?: string }>
                  Requests permission (iOS 13+, inside a user gesture), subscribes
                  deviceorientation, captures the calibration zero on the first event.
     .disable() → void — unsubscribes, recenters, clears zero.
     .enabled   → boolean */
export function createGyroLook({ look, scale = 0.8 } = {}) {
  let _enabled  = false;
  let _zero     = null;
  let _captureFn = null;   // single-fire capture listener (cleared after first event)

  function _onOrientation(e) {
    if (!_enabled || !_zero || !look) return;
    const { yawDeg, pitchDeg } = mapGyroToLook(e, _zero, screen.orientation?.angle ?? 0);
    look.setTarget(yawDeg * scale, pitchDeg * scale);
  }

  async function enable() {
    if (_enabled) return { ok: true };

    // iOS 13+ gates DeviceOrientationEvent behind an async permission request that
    // MUST be called inside a user gesture (the chip TAP is that gesture).
    if (typeof DeviceOrientationEvent !== 'undefined'
        && typeof DeviceOrientationEvent.requestPermission === 'function') {
      let perm;
      try { perm = await DeviceOrientationEvent.requestPermission(); }
      catch (_) { return { ok: false, reason: 'denied' }; }
      if (perm !== 'granted') return { ok: false, reason: 'denied' };
    }

    if (typeof window === 'undefined') return { ok: false, reason: 'no-window' };

    // Capture zero on the NEXT event (not at enable time — gives a fresh reading
    // matching the device pose when the chip was tapped).
    _captureFn = (e) => {
      _zero = { beta: e.beta ?? 0, gamma: e.gamma ?? 0 };
      window.removeEventListener('deviceorientation', _captureFn);
      _captureFn = null;
      window.addEventListener('deviceorientation', _onOrientation);
    };
    window.addEventListener('deviceorientation', _captureFn);
    _enabled = true;
    return { ok: true };
  }

  function disable() {
    if (!_enabled) return;
    if (_captureFn) {
      window.removeEventListener('deviceorientation', _captureFn);
      _captureFn = null;
    }
    window.removeEventListener('deviceorientation', _onOrientation);
    _enabled = false;
    _zero    = null;
    if (look && look.recenter) look.recenter();
  }

  return { enable, disable, get enabled() { return _enabled; } };
}
