/* ============================================================
   @lgr/engine-core — createDecals (Lesson M5: projected decals).
   ------------------------------------------------------------
   THE ABILITY: bullet holes, blood splats, and scorch marks that STICK to the world where a shot lands —
   projected onto whatever surface is there, wrapping around corners, all batched into ONE draw call with a
   GPU age-fade. Re-implemented from the brief's spec (NOT cloned from any repo).

   ── HOW a decal is made (project) ────────────────────────────────────────────
     1. Build a box PROJECTOR at the hit: forward = into the surface (−normal), a right/up frame, and a
        size×size footprint × a shallow depth. Its 6 inward planes come from decal-clip.boxPlanes.
     2. Gather candidate triangles from the REGISTERED receiver meshes (each stored as world-space
        triangles + an AABB). A cheap AABB pre-cull skips receivers the projector can't touch — no BVH at
        arena scale (a few hundred triangles total; the per-project cull cost is O(receivers·tris), stated
        in the report).
     3. Reject faces whose normal deviates too far from the projection normal (don't paint the far side of
        a wall).
     4. SUTHERLAND–HODGMAN clip each surviving triangle to the 6 box planes (decal-clip.clipToPlanes) →
        a convex polygon that hugs the surface. Triangulate it (a fan) and give each vertex a decal uv
        (its position in the projector's right/up frame → the atlas cell for this decal KIND).
     5. Append the triangles into a fixed VERTEX RING (oldest recycled; a decal never split across the
        seam — decal-clip.ringPlan). Nudge along the normal to beat z-fighting.

   ── RENDER: one Mesh, one ShaderMaterial (decal.vert/frag), one draw call. Each vertex carries aBorn;
   the fragment shader fades it by (uTime − aBorn). Un-written slots have aBorn 0 → huge age → discarded,
   so the whole fixed buffer draws in one call with the stale slots contributing nothing. NormalBlending
   (decals are dark marks on a lit surface, not glows — the opposite blend choice from M6's additive).

   ── ART: a small procedural atlas (a canvas — hole / blood / scorch), no Tier-2 forge dependency.

   The pure geometry (clip, planes, ring) lives in decal-clip.js (node-tested). This file is the THREE glue.

   Contract: createDecals(opts) -> {
     mesh, registerReceiver(mesh, opts), project(px,py,pz, nx,ny,nz, opts), update(dt), setTime(t),
     clear(), dispose(), get drawVertices(),
   }
   ============================================================ */
import * as THREE from 'three';
import decalVert from './shaders/decal.vert';
import decalFrag from './shaders/decal.frag';
import { boxPlanes, clipToPlanes, ringPlan } from './decal-clip.js';

// 3-cell horizontal atlas: 0 = hole, 1 = blood, 2 = scorch. u = kind/3 … +1/3.
const KIND_INDEX = { hole: 0, blood: 1, scorch: 2 };
function buildAtlas() {
  const W = 384, H = 128, cw = 128;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.clearRect(0, 0, W, H);
  let s = 1234567;                                          // tiny LCG so the art is deterministic
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const blob = (cx, cy, r, col) => { x.beginPath(); x.fillStyle = col; x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); };
  // cell 0 — bullet HOLE: a dark centre + a lighter cracked rim
  let ox = 0 * cw;
  let g = x.createRadialGradient(ox + 64, 64, 4, ox + 64, 64, 46);
  g.addColorStop(0, 'rgba(10,8,7,0.95)'); g.addColorStop(0.5, 'rgba(30,24,20,0.8)'); g.addColorStop(1, 'rgba(60,50,42,0)');
  x.fillStyle = g; x.fillRect(ox, 0, cw, H);
  for (let i = 0; i < 8; i++) { const a = rnd() * 6.28, r = 30 + rnd() * 12; blob(ox + 64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 2 + rnd() * 3, 'rgba(20,16,13,0.7)'); }
  // cell 1 — BLOOD: a spatter of dark-red blobs
  ox = 1 * cw;
  blob(ox + 64, 64, 30, 'rgba(120,14,10,0.85)');
  for (let i = 0; i < 26; i++) { const a = rnd() * 6.28, r = rnd() * 58; blob(ox + 64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 2 + rnd() * 9, `rgba(${100 + (rnd() * 40) | 0},${8 + (rnd() * 12) | 0},6,${0.5 + rnd() * 0.4})`); }
  // cell 2 — SCORCH: a soft dark smudge
  ox = 2 * cw;
  g = x.createRadialGradient(ox + 64, 64, 6, ox + 64, 64, 58);
  g.addColorStop(0, 'rgba(12,10,10,0.9)'); g.addColorStop(0.6, 'rgba(24,20,18,0.55)'); g.addColorStop(1, 'rgba(40,34,30,0)');
  x.fillStyle = g; x.fillRect(ox, 0, cw, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function createDecals(opts = {}) {
  const maxVerts = opts.maxVerts || 6144;               // ~ hundreds of decals; ring-recycled
  const life = opts.life != null ? opts.life : 9;       // seconds before a decal has fully faded
  const cosDev = Math.cos((opts.maxDeviationDeg != null ? opts.maxDeviationDeg : 75) * Math.PI / 180);
  const atlas = opts.atlas || buildAtlas();

  const position = new Float32Array(maxVerts * 3);
  const uv = new Float32Array(maxVerts * 2);
  const born = new Float32Array(maxVerts);
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage);
  const uvAttr = new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage);
  const bornAttr = new THREE.BufferAttribute(born, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr); geo.setAttribute('uv', uvAttr); geo.setAttribute('aBorn', bornAttr);
  geo.setDrawRange(0, maxVerts);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);

  const material = new THREE.ShaderMaterial({
    vertexShader: decalVert, fragmentShader: decalFrag,
    uniforms: { uAtlas: { value: atlas }, uTime: { value: 0 }, uLife: { value: life } },
    transparent: true, depthWrite: false, depthTest: true,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,   // sit on top of the receiver
    blending: THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false; mesh.raycast = () => {}; mesh.renderOrder = 6;

  // ---- receivers: extract world-space triangles + an AABB once at register time (static surfaces). ----
  const receivers = [];
  const _mA = new THREE.Vector3(), _mB = new THREE.Vector3(), _mC = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _n = new THREE.Vector3();
  function registerReceiver(recvMesh) {
    recvMesh.updateWorldMatrix(true, false);
    const g = recvMesh.geometry, pos = g.attributes.position, idx = g.index, m = recvMesh.matrixWorld;
    const tris = [];
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
      _mA.fromBufferAttribute(pos, ia).applyMatrix4(m); _mB.fromBufferAttribute(pos, ib).applyMatrix4(m); _mC.fromBufferAttribute(pos, ic).applyMatrix4(m);
      _e1.subVectors(_mB, _mA); _e2.subVectors(_mC, _mA); _n.crossVectors(_e1, _e2).normalize();
      tris.push({ ax: _mA.x, ay: _mA.y, az: _mA.z, bx: _mB.x, by: _mB.y, bz: _mB.z, cx: _mC.x, cy: _mC.y, cz: _mC.z, nx: _n.x, ny: _n.y, nz: _n.z });
      for (const v of [_mA, _mB, _mC]) { min[0] = Math.min(min[0], v.x); min[1] = Math.min(min[1], v.y); min[2] = Math.min(min[2], v.z); max[0] = Math.max(max[0], v.x); max[1] = Math.max(max[1], v.y); max[2] = Math.max(max[2], v.z); }
    }
    receivers.push({ tris, min, max });
  }

  // ---- project a decal ----
  let cursor = 0, time = 0;
  const _fwd = new THREE.Vector3(), _up = new THREE.Vector3(), _right = new THREE.Vector3(), _c = new THREE.Vector3(), _v = new THREE.Vector3();
  const scratch = [];   // gathered {x,y,z,u,v} this projection (project is an EVENT, not a per-frame loop)
  function project(px, py, pz, nx, ny, nz, o = {}) {
    const size = o.size || 0.6, depth = o.depth || 0.5, kind = o.kind || 'hole';
    const ki = KIND_INDEX[kind] != null ? KIND_INDEX[kind] : 0, cu0 = ki / 3, cus = 1 / 3;
    _fwd.set(-nx, -ny, -nz); if (_fwd.lengthSq() < 1e-9) _fwd.set(0, -1, 0); _fwd.normalize();
    _up.set(0, 1, 0); if (Math.abs(_fwd.y) > 0.95) _up.set(1, 0, 0);
    _right.crossVectors(_up, _fwd).normalize(); _up.crossVectors(_fwd, _right).normalize();
    _c.set(px, py, pz);
    const half = { x: size / 2, y: size / 2, z: depth / 2 };
    const planes = boxPlanes(_c, _right, _up, _fwd, half);
    // projector world AABB (from the 8 box corners) for the receiver pre-cull
    let pmnx = Infinity, pmny = Infinity, pmnz = Infinity, pmxx = -Infinity, pmxy = -Infinity, pmxz = -Infinity;
    for (let sx = -1; sx <= 1; sx += 2) for (let sy = -1; sy <= 1; sy += 2) for (let sz = -1; sz <= 1; sz += 2) {
      const cx = _c.x + _right.x * half.x * sx + _up.x * half.y * sy + _fwd.x * half.z * sz;
      const cy = _c.y + _right.y * half.x * sx + _up.y * half.y * sy + _fwd.y * half.z * sz;
      const cz = _c.z + _right.z * half.x * sx + _up.z * half.y * sy + _fwd.z * half.z * sz;
      pmnx = Math.min(pmnx, cx); pmny = Math.min(pmny, cy); pmnz = Math.min(pmnz, cz);
      pmxx = Math.max(pmxx, cx); pmxy = Math.max(pmxy, cy); pmxz = Math.max(pmxz, cz);
    }
    scratch.length = 0;
    for (const rc of receivers) {
      if (rc.max[0] < pmnx || rc.min[0] > pmxx || rc.max[1] < pmny || rc.min[1] > pmxy || rc.max[2] < pmnz || rc.min[2] > pmxz) continue;   // AABB pre-cull
      for (const tr of rc.tris) {
        if (tr.nx * nx + tr.ny * ny + tr.nz * nz < cosDev) continue;                 // normal-deviation reject
        const poly = clipToPlanes([{ x: tr.ax, y: tr.ay, z: tr.az }, { x: tr.bx, y: tr.by, z: tr.bz }, { x: tr.cx, y: tr.cy, z: tr.cz }], planes);
        if (poly.length < 3) continue;
        // decal uv from the projector frame; nudge out along the surface normal to beat z-fighting.
        for (const p of poly) {
          _v.set(p.x - _c.x, p.y - _c.y, p.z - _c.z);
          p.u = cu0 + (_v.dot(_right) / size + 0.5) * cus;
          p.w = _v.dot(_up) / size + 0.5;
          p.x += nx * 0.012; p.y += ny * 0.012; p.z += nz * 0.012;
        }
        for (let i = 1; i < poly.length - 1; i++) { scratch.push(poly[0], poly[i], poly[i + 1]); }   // fan triangulation
      }
    }
    const n = scratch.length;
    if (n === 0) return 0;
    const plan = ringPlan(cursor, n, maxVerts);
    if (plan.overflow) return 0;                                                       // single decal too big — skip (shouldn't happen)
    let w = plan.start;
    for (let i = 0; i < n; i++) {
      const p = scratch[i];
      position[w * 3] = p.x; position[w * 3 + 1] = p.y; position[w * 3 + 2] = p.z;
      uv[w * 2] = p.u; uv[w * 2 + 1] = p.w; born[w] = time;
      w = (w + 1) % maxVerts;
    }
    cursor = plan.next;
    posAttr.needsUpdate = true; uvAttr.needsUpdate = true; bornAttr.needsUpdate = true;
    return n;
  }

  function setTime(t) { time = t; material.uniforms.uTime.value = t; }
  function update(dt) { setTime(time + dt); }

  return {
    mesh, registerReceiver, project, update, setTime,
    clear() { born.fill(0); position.fill(0); cursor = 0; posAttr.needsUpdate = uvAttr.needsUpdate = bornAttr.needsUpdate = true; },
    get drawVertices() { return maxVerts; },
    get receiverCount() { return receivers.length; },
    dispose() { geo.dispose(); material.dispose(); atlas.dispose(); },
  };
}
