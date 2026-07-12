/* ============================================================
   @lgr/engine-core — createEdgeField (Lesson K2): flowing-edge glow ribbons.
   ------------------------------------------------------------
   A SCENE-AGNOSTIC seam: given node POSITIONS and index PAIRS, it builds one
   feathered glow RIBBON per edge (a camera-facing quad — never a 1px GL_LINE)
   with energy flowing along each edge (edge-flow.vert/.frag). The Constellation
   hero scene is the first consumer; Mission Control's graph viz consumes the
   SAME seam — so nothing here knows about "constellation": positions + pairs in,
   a drop-in THREE.Mesh + update(elapsed) out.

   C++ anchor: a template<Graph> renderer — it takes the topology (vertices +
   edges) and owns the GPU buffers; the caller owns what the graph MEANS.

   GEOMETRY: per edge we emit 4 verts (a quad, 2 triangles). Each vert carries the
   two endpoints (aEndA/aEndB), its position ALONG the edge (0/1), and which SIDE
   of the ribbon it is (-1/+1). The vertex shader billboards + widens; the fragment
   shader feathers the width and flows a comet along the length. One draw call for
   the whole edge set — cheap.

   createEdgeField({ positions, pairs, color, width?, speed?, dash? }) →
     { mesh, material, update(elapsed), dispose() }
       positions : Float32Array | number[]  (xyz triples), OR array of THREE.Vector3
       pairs     : Array<[i, j]>             (indices into positions)
       color     : THREE.Color | hex         (linear-sRGB glow color)
   ============================================================ */
import * as THREE from 'three';
import edgeFlowVert from './shaders/edge-flow.vert';
import edgeFlowFrag from './shaders/edge-flow.frag';
import { buildEdgeStrip, buildEdgeEndpoints } from './hero/edge-geometry.js';

/* SLICE 14 — THE UNIFIED SEAM (LIB-README's convergence contract, executed). createEdgeField now builds
   on the INSTANCED-STRIP strategy Mission Control proved: one shared tessellated strip (per-vertex
   aAlong/aSide) × per-instance endpoints (aEndA/aEndB — InstancedBufferAttribute is transparent to GLSL,
   so edge-flow.vert is UNCHANGED). Defaults preserve the hero byte-for-byte (segments=1 emits exactly
   the old per-edge vertex data via instancing); the graph consumes the same seam with
   { segments: 24, dynamic: true, material } — one buffer-math implementation, two materials.
     segments: strip tessellation (1 = flat ribbon; 24 = smooth arcs for lift-curved shaders)
     dynamic:  endpoints will be rewritten per frame (sim-driven) — exposes endA/endB attribute handles
     material: inject a consumer ShaderMaterial (must consume aAlong/aSide/aEndA/aEndB); omit for the
               hero's comet-flow default. */
export function createEdgeField({ positions, pairs, color, width = 0.05, speed = 0.35, dash = 2.0,
                                  segments = 1, dynamic = false, material = null }) {
  const strip = buildEdgeStrip(segments);
  const { aEndA, aEndB, nEdges } = buildEdgeEndpoints({ positions, pairs });

  const geo = new THREE.InstancedBufferGeometry();
  geo.instanceCount = nEdges;
  geo.setAttribute('position', new THREE.BufferAttribute(strip.position, 3));
  geo.setAttribute('aAlong', new THREE.BufferAttribute(strip.aAlong, 1));
  geo.setAttribute('aSide',  new THREE.BufferAttribute(strip.aSide, 1));
  geo.setIndex(new THREE.BufferAttribute(strip.index, 1));
  const endA = new THREE.InstancedBufferAttribute(aEndA, 3);
  const endB = new THREE.InstancedBufferAttribute(aEndB, 3);
  if (dynamic) { endA.setUsage(THREE.DynamicDrawUsage); endB.setUsage(THREE.DynamicDrawUsage); }
  geo.setAttribute('aEndA', endA);
  geo.setAttribute('aEndB', endB);
  /* Positions live in aEndA/aEndB (unknown to Three's culler) — disable frustum
     culling so the field never vanishes when the dummy bounds fall offscreen. */

  const mat = material || new THREE.ShaderMaterial({
    vertexShader:   edgeFlowVert,
    fragmentShader: edgeFlowFrag,
    uniforms: {
      uWidth: { value: width },
      uColor: { value: new THREE.Color(color) },
      uTime:  { value: 0 },
      uSpeed: { value: speed },
      uDash:  { value: dash },
    },
    transparent: true,
    blending:    THREE.AdditiveBlending,   // capped in the frag → no blow-out
    depthWrite:  false,
    depthTest:   false,                    // background glow; order-independent
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;

  function update(elapsed) { if (mat.uniforms.uTime) mat.uniforms.uTime.value = elapsed; }
  /* Dynamic consumers (the graph's force sim) write endA/endB arrays directly per moving frame and call
     commitEndpoints() — the same zero-copy pattern graph-view used privately before the unification. */
  function commitEndpoints() { endA.needsUpdate = true; endB.needsUpdate = true; }
  function dispose() { geo.dispose(); mat.dispose(); }

  return { mesh, material: mat, geometry: geo, endA, endB, nEdges, update, commitEndpoints, dispose };
}
