/* @lgr/engine-core — aircraft-lights.js (Lesson L-C / flight-polish-v2-2026-07-06)
   Aviation-correct position lights for the helicopter.
   - RED port (left/−X), GREEN starboard (right/+X), WHITE tail (−Z aft)  — steady
   - RED anti-collision beacon (belly)                                       — ~1 Hz pulse
   All four are tiny self-lit MeshBasicMaterial spheres (ZERO scene-light cost).
   Driven by the SunRig-derived `nightK` scalar (same formula as celestials.js:311).
   THE byte-identical gate: `group.visible = nightK > 0.001` (mirrors night-sky.js:188).
   A black quad at emissive=0 still draws (writes depth, changes draw order) and would
   perturb the noon tier-guard snapshot → use visible=false, which makes it genuinely absent.
   Beacon pulse: animate the MeshBasicMaterial color intensity only (uniform scalar, never a
   #define / material-type flag → no shader recompile). Steady under reduced-motion. */

import * as THREE from 'three';

/* createAircraftLights() → { group, update(nightK, elapsed, reduced) }
   Call once, parent `group` to the heli's seize object. */
export function createAircraftLights() {
  const group = new THREE.Group();
  group.visible = false;   // hidden by day until first update() call sets it

  /* Heli model reference (placed-life.js heliMesh, nose at +Z):
     cabin y=0.5, skids at x=±0.28 y=0.1, fin at z=−1.3.
     Port  = pilot's left = −X;  Starboard = +X. */
  function dot(color, x, y, z, r = 0.065) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(r, 6, 4),
      new THREE.MeshBasicMaterial({ color, toneMapped: false })
    );
    m.position.set(x, y, z);
    m.raycast = () => {};   // invisible to raycaster (no click interference)
    group.add(m);
    return m.material;
  }

  /* Steady lights — position matches the ICAO convention (FAR 23/27 inspired) */
  dot(0xff1111, -0.44, 0.50,  0.20);   // port     — red,   left cabin side
  dot(0x00ee44,  0.44, 0.50,  0.20);   // starboard — green, right cabin side
  dot(0xffffff,  0.00, 0.65, -1.30);   // tail      — white, fin tip

  /* Beacon — red, belly centre; its material is returned so we can pulse the color. */
  const beaconMat = dot(0xff0000, 0.00, 0.18,  0.00, 0.08);

  /* update() is called from the engine's per-frame updateCity().
     nightK: 0 at noon → 1 at night (celestials.js formula: smoothstep(−sunArc.y, −0.05, 0.18))
     elapsed: total scene time in seconds (same source as celestials)
     reduced: true when prefers-reduced-motion is active */
  function update(nightK, elapsed, reduced) {
    group.visible = nightK > 0.001;   // absent by day — byte-identical noon tier guard holds
    if (!group.visible) return;

    /* Beacon pulse: ~1 Hz smooth sine, clamped to [0..1]. Steady-on under reduced-motion. */
    const k = reduced ? 1.0 : 0.5 + 0.5 * Math.sin(elapsed * Math.PI * 2.0);
    beaconMat.color.setRGB(k, 0, 0);
  }

  return { group, update };
}
