/* ============================================================
   @lgr/engine-core — createWeaponKit (Beauty B4: COMBAT FEEL — the gun becomes ART).
   ------------------------------------------------------------
   A hard-surface weapon built from CHAMFERED PRIMITIVES — the proven doctrine (claude-of-duty
   src/weapons/geometry.js, MIT): "there is no such thing as a 90-degree edge on a real firearm." Every
   part is a RoundedBoxGeometry with a sub-mm chamfer, because the chamfer catches the specular highlight
   line and THAT is what separates a MODELLED gun from a blocked-out box. Parts are authored at real-ish
   metre scale, merged into ONE geometry (a whole gun in a handful of draw calls), and SKINNED by a forge
   gunmetal material — skins are just bake-param sets (fresh / worn) at zero asset cost.

   HARD CONSTRAINT (the known quality wall): NO detailed hands/fingers. The kit is the RECEIVER only; the
   survivor's existing rigged hands hold it via the hand bone (createCharacterRig). Hands are where every
   procedural-weapon effort fails the blind A/B; we do not go there.

   Contract: createWeaponKit({ THREE, material, kind }) -> { group, muzzle, dispose }.
     • group  — a THREE.Group: one merged Mesh (the receiver) + the `muzzle` anchor. Add it to a hand bone
                (iso) or position it in front of the FP camera (viewmodel).
     • muzzle — an empty Object3D at the barrel tip (+Z forward): the muzzle-flash / tracer origin.
   The gun points +Z (forward), +Y up, grip toward -Y — the wielder orients the group.

   C++ anchor: a static mesh assembled from a parts table, baked once — like compiling a handful of structs
   into one contiguous vertex buffer. No per-frame cost; the feel comes from how it is WIELDED (B4 wiring).
   ============================================================ */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// The pistol parts table — [w,h,d] size (metres) · [x,y,z] centre · rotX (radians). Chamfer = the doctrine.
const PISTOL_PARTS = [
  { s: [0.030, 0.055, 0.115], p: [0, 0.000, 0.010], rx: 0 },   // frame / receiver
  { s: [0.032, 0.030, 0.140], p: [0, 0.043, 0.018], rx: 0 },   // slide (top) — the big specular-catching face
  { s: [0.026, 0.022, 0.028], p: [0, 0.043, 0.095], rx: 0 },   // muzzle block at the front of the slide
  { s: [0.028, 0.095, 0.034], p: [0, -0.055, -0.028], rx: 0.28 }, // grip — angled back
  { s: [0.020, 0.008, 0.040], p: [0, -0.020, 0.006], rx: 0 },   // trigger-guard underbar
];
const MUZZLE_Z = 0.112, MUZZLE_Y = 0.043;   // barrel tip (the flash/tracer anchor)
const CHAMFER = 0.004;                       // 4 mm — catches the specular line, reads as machined steel

// merge a set of transformed RoundedBox parts into ONE non-indexed geometry (position/normal/uv concat —
// the createForest.mergeParts pattern, generalised to bake each part's matrix in first). A pistol is a
// handful of parts → a couple hundred verts → one draw call.
function buildReceiver() {
  const _m = new THREE.Matrix4(), _e = new THREE.Euler();
  const geos = [];
  for (const part of PISTOL_PARTS) {
    const g = new RoundedBoxGeometry(part.s[0], part.s[1], part.s[2], 2, CHAMFER).toNonIndexed();
    _e.set(part.rx, 0, 0); _m.makeRotationFromEuler(_e); _m.setPosition(part.p[0], part.p[1], part.p[2]);
    g.applyMatrix4(_m);
    geos.push(g);
  }
  let n = 0; for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

export function createWeaponKit({ material, kind = 'pistol' } = {}) {
  const group = new THREE.Group();
  group.name = 'weaponKit:' + kind;
  const geo = buildReceiver();
  const mat = material || new THREE.MeshStandardMaterial({ color: 0x24262d, roughness: 0.42, metalness: 1.0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.frustumCulled = false;
  group.add(mesh);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, MUZZLE_Y, MUZZLE_Z);
  group.add(muzzle);

  return {
    group, muzzle, mesh,
    setMaterial(m) { if (m) mesh.material = m; },   // hot-swap a skin variant
    dispose() { geo.dispose(); /* material is the caller's (forge-owned) — not disposed here */ },
  };
}
