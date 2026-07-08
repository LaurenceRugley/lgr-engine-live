/* @lgr/engine-core — street-lights.js
   Warm streetlamp glow sprites placed along the city street graph.
   Gated on `windowGlow` (the SunRig's night signal, 0 at noon) so the lamps are
   INVISIBLE at noon (byte-identical-safe) and glow warm amber from dusk through night.

   BYTE-IDENTICAL CONTRACT (two layers):
     1. `group.visible = windowGlow > 0.01` — at noon (windowGlow=0) the group is
        entirely skipped by the renderer; not just opacity-zero but NOT DRAWN.
     2. PointsMaterial: `transparent, blending: AdditiveBlending, depthWrite: false` —
        even if visible accidentally, zero opacity = zero fragment contribution.

   ARCHITECTURE (mirrors the car-headlight pattern in agents.js):
     • ONE THREE.Points — all lamp positions in one geometry, one draw call.
     • Additive blending, sizeAttenuation — glows overlap softly without z-fighting.
     • Positions computed once at boot from the street-graph edges; no per-frame alloc.
     • Only `mat.opacity` is mutated each frame (one scalar write).

   C++ anchor: BufferGeometry ≈ a fixed-size vertex buffer (positions uploaded once to
   the GPU); PointsMaterial ≈ a point-sprite shader with distance-based size scaling;
   AdditiveBlending ≈ glBlendFunc(GL_ONE, GL_ONE) — colour = src + dst (glow sums).

   API:
     createStreetLights({ graph, spacing? })
       → { group, update(windowGlow), dispose() }
   `graph` must be the same object returned by buildGraph() in agents.js (shared structure).
   Call `scene.add(group)` once and `streetLights.update(sunRig.windowGlow)` every frame. */

import * as THREE from 'three';
import { LAYOUT } from './citygen.js';

const { clamp } = THREE.MathUtils;

/* White→transparent soft-disc sprite. The material's `color` property (warm amber) is
   multiplied in by the GPU — so the texture stays white and the tint lives in one place. */
function _makeGlowTex() {
  const S = 64;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.0,  'rgba(255,255,255,1)');
  g.addColorStop(0.40, 'rgba(255,255,255,0.5)');
  g.addColorStop(1.0,  'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createStreetLights({ graph, spacing = LAYOUT.PITCH / 3 } = {}) {
  const { nodes, edges, y: roadY } = graph;
  const LAMP_Y = roadY + 0.28;   // hover above road slab — reads as glow from above, not embedded

  /* Sample lamp positions along each edge, skipping the node endpoints (intersections already
     get cross-street overlap from adjacent edges; skipping prevents a double-bright cluster).
     Each edge spans exactly LAYOUT.PITCH, so count = round(PITCH / step) gives even spacing. */
  const step   = Math.max(0.25, spacing);
  const posArr = [];                              // flat [x, y, z, x, y, z, ...] — no alloc in update
  for (const e of edges) {
    const A  = nodes[e.a], B = nodes[e.b];
    const dx = B.x - A.x, dz = B.z - A.z;
    const n  = Math.max(1, Math.round(e.len / step));   // positions PER edge
    for (let k = 1; k < n; k++) {               // k from 1..n-1: skip endpoints (node positions)
      const t = k / n;
      posArr.push(A.x + dx * t, LAMP_Y, A.z + dz * t);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));

  const mat = new THREE.PointsMaterial({
    size             : 1.35,
    sizeAttenuation  : true,
    map              : _makeGlowTex(),
    color            : new THREE.Color('#ffca64'),   // warm amber — streets gold at night
    transparent      : true,
    opacity          : 0,
    blending         : THREE.AdditiveBlending,
    depthWrite       : false,
  });

  const pts  = new THREE.Points(geo, mat);
  pts.frustumCulled = false;   // all lamps in the city grid — culling by box is never worth it
  pts.raycast = () => {};      // not pickable

  const group = new THREE.Group();
  group.add(pts);
  group.visible = false;       // noon safe: renderer skips the group entirely

  /* update(windowGlow) — call once per frame alongside cityLife.update().
     Only mutates `group.visible` (bool gate) and `mat.opacity` (1 scalar). No alloc. */
  function update(windowGlow) {
    const on = windowGlow > 0.01;
    group.visible = on;
    if (on) mat.opacity = clamp(windowGlow * 2.0, 0, 1);
  }

  function dispose() {
    geo.dispose();
    if (mat.map) mat.map.dispose();
    mat.dispose();
  }

  return { group, update, dispose };
}
