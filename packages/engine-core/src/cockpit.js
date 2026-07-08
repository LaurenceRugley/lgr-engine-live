/* ============================================================
   cockpit.js — L-cockpit QUICK WIN: the bare canopy-frame ring.
   ------------------------------------------------------------
   A minimal THREE.Group: two A-pillars + a roof header arc + a low dark dash bar.
   Built from the SAME vectorize()/MeshStandardMaterial primitives that heliMesh()
   uses — all-tiers geometry, zero gate, zero byte-identical impact (tier-guard is
   noon/no-craft; the cockpit never renders there).

   SEAM: parented to the craft's root group at profile.eye (local craft frame), so
   it rotates with the craft's yaw automatically. placed-life.js attaches it, stashes
   it on g.userData.cockpitFrame; pilot.js toggles visible on fpBlend transitions.

   GEOMETRY RULES (art direction: docs/guides/cockpit-art-direction.md):
   - All offsets ≥ 0.15u from the eye (origin of this group) — clears the 0.1u near-plane.
   - OPEN CHIN: no bottom bar. The heli-defining downward view must stay unobstructed.
   - Frame + low dash → "enclosed cockpit" read without boxing the lower-forward view.

   Blender→glTF upgrade path: swap the meshes for a loaded GLTFLoader result behind this
   same signature — no project edits needed (the seam absorbs the swap).
   ============================================================ */
import * as THREE from 'three';
import { vectorize } from './vector-style.js';

export function createCockpit(profile) {
  const g = new THREE.Group();
  // Position the group at the eye anchor in the craft's local frame.
  // Craft yaw rotates g → the group rides the heading for free.
  const eye = (profile && profile.eye) || { x: 0, y: 0.3, z: 0 };
  g.position.set(eye.x, eye.y, eye.z);

  // Local std() — same idiom as heliMesh() so this compiles through EVERY tier.
  const dark = '#1c2026';
  const std = (color, ex = {}) => vectorize(
    new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, flatShading: true, ...ex }),
    { color },
  );

  // All mesh positions are relative to the eye (origin of this group).
  // Forward in this local frame = +Z (the craft's heading direction after yaw).

  // A-PILLARS: thin vertical bars flanking the field-of-view.
  // Nearest corner distance from eye: sqrt(0.14² + 0.22²) ≈ 0.26u — well clear of near-plane.
  const pillarGeo = new THREE.BoxGeometry(0.04, 0.20, 0.05);
  const pillarL = new THREE.Mesh(pillarGeo, std(dark));
  pillarL.position.set(-0.14, 0.04, 0.22);
  const pillarR = new THREE.Mesh(pillarGeo, std(dark));
  pillarR.position.set( 0.14, 0.04, 0.22);

  // ROOF HEADER ARC: thin horizontal bar connecting the two A-pillars at the top.
  // Distance from eye: sqrt(0.14² + 0.22²) ≈ 0.26u.
  const roofGeo = new THREE.BoxGeometry(0.32, 0.045, 0.05);
  const roof = new THREE.Mesh(roofGeo, std(dark));
  roof.position.set(0, 0.14, 0.22);

  // DASH BAR: low bar below eye level. OPEN CHIN below this bar — no boxing of
  // the lower-forward view (the heli chin-window downward read depends on it).
  // Subtended angle: arctan(0.11/0.22) ≈ 26° below horizontal. Chin = open below that.
  // Distance from eye: sqrt(0.11² + 0.22²) ≈ 0.25u — safe.
  const dashGeo = new THREE.BoxGeometry(0.34, 0.05, 0.04);
  const dash = new THREE.Mesh(dashGeo, std(dark, { roughness: 0.9 }));
  dash.position.set(0, -0.11, 0.22);

  g.add(pillarL, pillarR, roof, dash);
  // No shadows: the cockpit is inside the craft, shadowing nothing, casting nothing useful.
  // raycast = () => {} keeps these out of the inspector's hit tests.
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.raycast = () => {}; } });
  // Starts hidden; pilot.js calls setCockpitVisible(true) on setView('cockpit').
  g.visible = false;
  return g;
}
