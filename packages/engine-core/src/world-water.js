/* ============================================================
   world-water.js — Lesson 68: LAKES in the procedural worlds (the WOW-arc foundation, water pt.1).
   ------------------------------------------------------------
   The SEA is free: the engine's wave-sim water plane sits at y=0 = the terrain's sea level (terrain.js
   maps normalised height `sea` → y=0), so the coastline falls out of the heightfield. This module adds
   the OTHER water: interior LAKES — depressions in the LAND (above sea level) that hold a pool.

   FINDING A LAKE = a heightfield BASIN. A basin is a local minimum the water can't drain out of: flood
   from the low cell, raise the water a little, and if every cell on the pool's boundary is HIGHER than
   the water (an enclosing rim) and the pool never touches the world edge or the ocean, it's a lake. (The
   research's Priority-Flood is the rigorous O(n) version; a bounded flood from local minima is plenty for
   pt.1.) C++ anchor: a BFS/flood over the 2-D height grid from the low point, stopping at the rim — like
   finding a catchment cell's pool.

   The lake SURFACE is one shared reflective material placed as many instances at different planes (the
   material is the "type", each lake an object of it — the brief's reuse anchor). On the L67 beauty tier
   it reflects the sky via the IBL env map → a still mountain lake; flat-tinted on the stylized tiers.
   (Animated wave-sim ripples + live FLOW are the next lesson; pt.1 lakes are static + still.)
   ============================================================ */
import * as THREE from 'three';

/* detectLakes(terrain, { worldSize, baseY, maxLakes }) → [{ cx, cz, y, radius, area }] in WORLD coords.
   Deterministic (the heightfield is) — no RNG. Walks a COARSE downsample of the grid for speed. */
export function detectLakes(terrain, { worldSize = 26, baseY = 0, maxLakes = 3 } = {}) {
  const { size, height, sea, relief, maxH } = terrain;
  const S = 3;                                            // coarse step (≈53×53 over a 160 grid)
  const gw = Math.floor((size - 1) / S);
  const cell = worldSize / (size - 1), half = worldSize / 2;
  const H = (gi, gj) => height[(gj * S) * size + (gi * S)];       // coarse height sample
  const wx = (gi) => (gi * S) * cell - half, wz = (gj) => (gj * S) * cell - half;
  const land = (h) => h > sea + 0.02;
  const lowMid = sea + 0.55 * Math.max(0.001, maxH - sea);        // lakes form in LOW/MID terrain, not on peaks

  // 1) local-minimum candidates (a land cell lower than all 8 coarse neighbours)
  const cands = [];
  for (let gj = 2; gj < gw - 2; gj++) for (let gi = 2; gi < gw - 2; gi++) {
    const h = H(gi, gj);
    if (!land(h) || h > lowMid) continue;
    let isMin = true;
    for (let dj = -1; dj <= 1 && isMin; dj++) for (let di = -1; di <= 1; di++) {
      if ((di || dj) && H(gi + di, gj + dj) < h) { isMin = false; break; }
    }
    if (isMin) cands.push({ gi, gj, h });
  }
  cands.sort((a, b) => a.h - b.h);                        // deepest first → deterministic order

  // 2) bounded flood-fill each candidate; keep the ENCLOSED ones (don't reach the edge or the sea)
  const DEPTH = 0.045, MAXPOOL = 520;
  const used = new Uint8Array(gw * gw);
  const lakes = [];
  for (const c of cands) {
    if (lakes.length >= maxLakes) break;
    if (used[c.gj * gw + c.gi]) continue;
    const level = c.h + DEPTH;
    const stack = [[c.gi, c.gj]], seen = new Set();
    let enclosed = true, sumX = 0, sumZ = 0, n = 0;
    const poolKeys = [];
    while (stack.length) {
      const [gi, gj] = stack.pop();
      const key = gj * gw + gi;
      if (seen.has(key)) continue; seen.add(key);
      if (gi <= 0 || gi >= gw - 1 || gj <= 0 || gj >= gw - 1) { enclosed = false; continue; }  // hit the edge → drains out
      const h = H(gi, gj);
      if (h < sea) { enclosed = false; continue; }       // drains to the ocean → not a lake
      if (h >= level) continue;                            // the rim → stop here
      poolKeys.push(key); sumX += gi; sumZ += gj; n++;
      if (n > MAXPOOL) { enclosed = false; break; }
      stack.push([gi + 1, gj], [gi - 1, gj], [gi, gj + 1], [gi, gj - 1]);
    }
    if (!enclosed || n < 5) continue;
    for (const k of poolKeys) used[k] = 1;                // don't reseed inside this pool
    const cgi = sumX / n, cgj = sumZ / n;
    const cellW = S * cell;
    const area = n * cellW * cellW;
    const radius = 0.82 * Math.sqrt(area / Math.PI);      // an AREA-matched circle (slightly inscribed)
    lakes.push({ cx: wx(cgi), cz: wz(cgj), y: baseY + (level - sea) * relief, radius, area });
  }
  return lakes;
}

/* buildLakeGroup(lakes, { material }) → a THREE.Group of flat reflective discs at each lake's fill height.
   ONE shared material across all lakes (reuse anchor); low roughness so the L67 sky-IBL reflects on the
   beauty tier (a still lake), flat-tinted on the stylized tiers. */
export function buildLakeGroup(lakes, { material } = {}) {
  const group = new THREE.Group();
  group.raycast = () => {};
  const mat = material || new THREE.MeshStandardMaterial({ color: '#3f6f8c', roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.88 });
  for (const lk of lakes) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(lk.radius, 28), mat);
    m.rotation.x = -Math.PI / 2;                          // lie flat
    m.position.set(lk.cx, lk.y + 0.012, lk.cz);           // a hair above the basin floor
    m.receiveShadow = false; m.castShadow = false; m.raycast = () => {};
    group.add(m);
  }
  // shared material → dispose geometries only (the caller owns the material across rerolls)
  group.userData.dispose = () => group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  group.userData.count = lakes.length;
  return group;
}

/* Convenience for the world lifecycle: detect + build in one call (same seed → identical lakes). */
export function createWorldLakes(terrain, opts = {}) {
  const lakes = detectLakes(terrain, opts);
  const group = buildLakeGroup(lakes, opts);
  group.userData.lakes = lakes;
  return group;
}
