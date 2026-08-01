/* ============================================================
   @lgr/engine-core — createContactShadows (A11 THE LIGHT CEILING): procedural contact grounding.
   ------------------------------------------------------------
   THE ABILITY: a soft dark radial patch on the GROUND under each object, so trees/buildings/props/characters
   read as GROUNDED (darkened where they meet the floor) instead of floating on it. This is the cheap,
   look-appropriate answer to the arc's grounding metric — chosen over SSAO by MEASUREMENT + cost:

     • SSAO would be a full-screen BEAUTY-tier pass (depth prepass + AO + blur, ~1–2 ms), it ENTANGLES the
       shared beauty present (a byte-identical risk for the city), it CANNOT ride the mobile M1 direct path,
       and it risks a mid-play shader compile. Heavy + entangled.
     • Contact patches are ONE InstancedMesh of radial-gradient quads (MeshBasicMaterial → renders on ANY
       path incl. the mobile direct Lambert), depth-write off, drawn just above the ground. Zero pipeline
       entanglement, zero compile risk, and — unlike the directional shadow — they ground an object
       regardless of the sun's direction (the measured "floats at night" case: contact darkening ≈ 0.02).

   Opt-in + default-inert: a project that never creates this is byte-identical. C++ anchor: a decal/billboard
   pool — preallocate, place by index, never new/delete in the hot loop.

   Contract: createContactShadows(opts) -> {
     group, setStatic(items), updateDynamic(list), setStrength(s), dispose()
   }
     items/list — [{ x, z, r }] object footprints (r = ground radius the patch should darken).
     setStatic   — build a fixed InstancedMesh for non-moving objects (trees/buildings/props/ruins) once.
     updateDynamic — per-frame place a POOL of patches under moving actors (characters); extra slots hidden.
   ============================================================ */
import * as THREE from 'three';

// One shared radial-gradient alpha texture: opaque-ish centre → transparent edge (the soft contact falloff).
let _tex = null;
function radialTex() {
  if (_tex) return _tex;
  if (typeof document === 'undefined') return null;
  const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  // darkest under the object, easing out — a soft AO-ish contact ring, not a hard disc.
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.72)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, s, s);
  _tex = new THREE.CanvasTexture(cv); _tex.colorSpace = THREE.SRGBColorSpace; return _tex;
}

export function createContactShadows({
  groundY = 0, color = 0x000000, strength = 0.5, softness = 1.6, yOffset = 0.015,
  renderOrder = 1, dynamicPool = 0,
} = {}) {
  const group = new THREE.Group();
  group.raycast = () => {};
  const tex = radialTex();
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);   // a unit ground quad (scaled per instance)
  const makeMat = () => new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity: strength, depthWrite: false, blending: THREE.NormalBlending, fog: true });
  const mat = makeMat();
  let staticMesh = null;
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

  // STATIC — one InstancedMesh for all non-moving footprints (built once, never stepped). softness scales the
  // patch past the footprint so the dark ring feathers out around the object rather than stopping at its edge.
  function setStatic(items) {
    if (staticMesh) { group.remove(staticMesh); staticMesh.geometry === geo || staticMesh.geometry.dispose(); staticMesh = null; }
    const list = (items || []).filter((o) => o && isFinite(o.x) && isFinite(o.z) && o.r > 0);
    if (!list.length) return;
    staticMesh = new THREE.InstancedMesh(geo, mat, list.length);
    staticMesh.raycast = () => {}; staticMesh.frustumCulled = false; staticMesh.renderOrder = renderOrder;
    for (let i = 0; i < list.length; i++) {
      const o = list[i]; const d = o.r * 2 * softness;
      _p.set(o.x, groundY + yOffset, o.z); _s.set(d, 1, d);
      _m.compose(_p, _q, _s); staticMesh.setMatrixAt(i, _m);
    }
    staticMesh.instanceMatrix.needsUpdate = true;
    group.add(staticMesh);
  }

  // DYNAMIC — a fixed pool of patches following moving actors. Placed by index each frame; unused slots are
  // scaled to 0 (hidden) so the draw stays one InstancedMesh with no per-frame allocation.
  let dynMesh = null;
  if (dynamicPool > 0) {
    dynMesh = new THREE.InstancedMesh(geo, makeMat(), dynamicPool);
    dynMesh.raycast = () => {}; dynMesh.frustumCulled = false; dynMesh.renderOrder = renderOrder;
    dynMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(dynMesh);
  }
  function updateDynamic(listArg) {
    if (!dynMesh) return;
    const list = listArg || [];
    const n = Math.min(list.length, dynamicPool);
    for (let i = 0; i < dynamicPool; i++) {
      if (i < n && list[i] && list[i].r > 0) {
        const o = list[i]; const d = o.r * 2 * softness;
        _p.set(o.x, groundY + yOffset, o.z); _s.set(d, 1, d);
      } else { _p.set(0, groundY - 1000, 0); _s.set(0, 0, 0); }   // parked far below + zero-scaled = invisible
      _m.compose(_p, _q, _s); dynMesh.setMatrixAt(i, _m);
    }
    dynMesh.instanceMatrix.needsUpdate = true;
  }

  return {
    group,
    setStatic,
    updateDynamic,
    setStrength(sVal) { mat.opacity = sVal; if (dynMesh) dynMesh.material.opacity = sVal; },
    dispose() {
      if (staticMesh) staticMesh.dispose();
      if (dynMesh) dynMesh.dispose();
      geo.dispose(); mat.dispose();
      if (group.parent) group.parent.remove(group);
    },
  };
}
