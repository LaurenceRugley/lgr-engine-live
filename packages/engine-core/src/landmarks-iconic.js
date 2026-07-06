/* ============================================================
   landmarks-iconic.js — Lesson 14: ICONIC landmarks, built from primitives.
   ------------------------------------------------------------
   Lesson 13 dropped generic Kenney heroes into the city's core lots. But a city reads as a
   PLACE through its silhouette: the Empire State's setbacks, the Eiffel's curve, a pagoda's
   eaves. So we BUILD those icons — not from downloaded models (license bookkeeping, and they'd
   never match our flat-vector style), but from a handful of boxes / cylinders / cones / lathes.
   At dimetric zoom a landmark is small on screen → we're in the "SILHOUETTE-ONLY regime":
   get the outline right and the brain fills the rest. Each builder is ~30–80 lines.

   They flow through the SAME adoption as every other building: `vectorizeTower` (flat tiers +
   windows) for the windowed shafts, `vectorize` (flat tiers, optional night GLOW) for the
   sculptural parts. So they inherit vector/pixel/toon + day/night for free.

   GEOMETRY NOTES (new this lesson):
   - LatheGeometry — spins a 2-D profile (an array of points) around the Y axis into a solid of
     revolution. With a CONCAVE profile + 4 segments it gives the Eiffel/Tokyo-Tower taper.
     (C++ analogy: like sweeping a polyline to build a mesh — a tiny CSG-free modeller.)
   - ExtrudeGeometry — takes a 2-D Shape (which can have HOLES) and pushes it through depth.
     We cut an arch hole in a rectangle → the Arc de Triomphe.

   LEGAL: see docs/LANDMARKS-NOTES.md. We deliberately abstract; some real towers are
   trademarked/copyrighted and are NOT here (Skytree, Sagrada Família, Merlion). The Eiffel is
   UNLIT at night ON PURPOSE — its night lighting design is copyrighted until ~2091.
   ============================================================ */
import * as THREE from 'three';
import { vectorize, vectorizeTower } from './vector-style.js';

export const ICONIC_KEYS = [
  'empireState', 'chrysler', 'liberty',          // Manhattan
  'eiffel', 'arcDeTriomphe', 'sacreCoeur',       // Paris
  'tokyoTower', 'pagoda', 'neonBillboard',       // Neo-Tokyo
];

/* FIX(L14): how tall each icon stands as a MULTIPLE OF THE PROFILE'S hMax (the tallest generic
   building). A uniform hero boost made Liberty/Tokyo-Tower/pagoda colossal on tall skylines; now
   each icon is authored to sit IN its skyline. >1 = towers over the generic blocks (Empire,
   Eiffel, Tokyo Tower); <1 = a landmark that should read SMALL-and-precious (Liberty is a statue,
   the pagoda a low temple among towers, Arc/Sacré-Cœur squat monuments). Tuned by eye. */
export const ICONIC_HEIGHT = {
  empireState: 1.25, chrysler: 1.10, liberty: 0.55,
  eiffel: 3.2, arcDeTriomphe: 1.5, sacreCoeur: 1.75,   // Paris (hMax 1.5): keep eiffel towering,
  tokyoTower: 1.35, pagoda: 0.50, neonBillboard: 0.90, // arc/sacré visible above the flat blocks
};

/* a small modelling kit bound to one landmark instance's adoption context. Each helper RETURNS
   a positioned-at-origin mesh; the builder moves it. `o.windows` → window grid; `o.glow` → a
   night-emissive colour (ramps with windowGlow: glowDay by day → glowNight at full night). */
function kit(ctx) {
  const std = () => new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.7, metalness: 0.1 });
  const mat = (color, o = {}) => o.windows
    ? vectorizeTower(std(), { color, id: ctx.id(), windowGlow: ctx.windowGlow, winColors: ctx.winColors, litFrac: ctx.litFrac })
    : vectorize(std(), { color, glow: o.glow ?? null, glowDay: o.glowDay ?? 0, glowNight: o.glowNight ?? 1, windowGlow: o.glow ? ctx.windowGlow : null });
  return {
    box: (w, h, d, color, o = {}) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, o)),
    cyl: (rt, rb, h, color, o = {}) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, o.seg || 12), mat(color, o)),
    cone: (r, h, color, o = {}) => new THREE.Mesh(new THREE.ConeGeometry(r, h, o.seg || 8), mat(color, o)),
    sphere: (r, color, o = {}) => new THREE.Mesh(new THREE.SphereGeometry(r, o.seg || 12, o.seg2 || 8), mat(color, o)),
    lathe: (pts, color, o = {}) => new THREE.Mesh(new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), o.seg || 4), mat(color, o)),
  };
}
const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };   // position helper

/* date easter-egg: the Empire State crown changes colour by month (it really does, for
   holidays/causes). new Date() in the browser app is fine — it's not a workflow script. */
const CROWN_BY_MONTH = ['#7FB0E0', '#E07FB0', '#7FE0A0', '#E0C97F', '#9FE07F', '#7FE0E0',
  '#FF8C42', '#E0E07F', '#C97FE0', '#E07F7F', '#7F9FE0', '#E0483A'];

const BUILDERS = {
  /* ---- MANHATTAN ---- */
  empireState(g, k) {
    const stone = '#E8E0CF';
    g.add(at(k.box(0.42, 0.18, 0.42, stone, { windows: true }), 0, 0.09, 0));   // wide base
    g.add(at(k.box(0.34, 0.16, 0.34, stone, { windows: true }), 0, 0.26, 0));   // setback 1
    g.add(at(k.box(0.26, 0.14, 0.26, stone, { windows: true }), 0, 0.41, 0));   // setback 2
    g.add(at(k.box(0.19, 0.34, 0.19, stone, { windows: true }), 0, 0.65, 0));   // the slab shaft
    g.add(at(k.box(0.13, 0.06, 0.13, stone, { windows: true }), 0, 0.85, 0));   // crown setback
    const crown = CROWN_BY_MONTH[new Date().getMonth()];
    g.add(at(k.cyl(0.03, 0.045, 0.12, stone, { seg: 10, glow: crown, glowNight: 1.85 }), 0, 0.94, 0)); // lit mast (boosted)
    g.add(at(k.cone(0.012, 0.07, stone, { seg: 8 }), 0, 1.04, 0));              // needle
  },
  chrysler(g, k) {
    const steel = '#C9CED4';
    g.add(at(k.box(0.22, 0.55, 0.22, '#9AA7B4', { windows: true }), 0, 0.275, 0)); // shaft
    // the terraced sunburst crown: 5 nested shrinking tiers tapering to a point (deco arcs).
    let y = 0.55;
    for (let i = 0; i < 5; i++) {
      const r = 0.14 - i * 0.024, h = 0.07;
      g.add(at(k.cyl(r * 0.7, r, h, steel, { seg: 8, glow: '#dfeaff', glowNight: 0.5 }), 0, y + h / 2, 0));
      y += h;
    }
    g.add(at(k.cone(0.018, 0.16, steel, { seg: 8 }), 0, y + 0.08, 0));          // spire needle
  },
  liberty(g, k) {
    const stone = '#B9B4A6', verde = '#4FA890';
    g.add(at(k.box(0.42, 0.16, 0.42, stone), 0, 0.08, 0));                      // pedestal base
    g.add(at(k.box(0.30, 0.20, 0.30, stone), 0, 0.26, 0));                      // pedestal
    g.add(at(k.cyl(0.10, 0.15, 0.42, verde, { seg: 10 }), 0, 0.57, 0));         // robed body (taper)
    g.add(at(k.box(0.11, 0.10, 0.11, verde), 0, 0.83, 0));                      // head
    for (let i = 0; i < 7; i++) {                                              // 7-spike crown
      const a = (i / 6 - 0.5) * Math.PI * 1.1;
      g.add(at(k.cone(0.012, 0.10, verde, { seg: 5 }), Math.sin(a) * 0.10, 0.92, Math.cos(a) * 0.06 - 0.02));
    }
    const arm = at(k.cyl(0.025, 0.03, 0.34, verde, { seg: 8 }), 0.14, 0.98, 0); // raised arm
    arm.rotation.z = 0.35; g.add(arm);
    g.add(at(k.box(0.06, 0.06, 0.06, verde, { glow: '#ffd060', glowDay: 0.6, glowNight: 1.2 }), 0.20, 1.16, 0)); // torch
    g.add(at(k.cone(0.04, 0.09, '#ffcf66', { seg: 6, glow: '#ffd060', glowDay: 0.7, glowNight: 1.3 }), 0.20, 1.24, 0));
  },

  /* ---- PARIS ---- */
  eiffel(g, k) {
    const iron = '#6E5C4C';
    // Lathe of the iconic CONCAVE profile (radius, height) → the A-curve silhouette.
    const prof = [[0.20, 0], [0.13, 0.16], [0.085, 0.33], [0.055, 0.5], [0.035, 0.66], [0.02, 0.85], [0.0, 0.92]];
    g.add(k.lathe(prof, iron, { seg: 4 }));
    const t = k.lathe(prof, iron, { seg: 4 }); t.rotation.y = Math.PI / 4; g.add(t);  // 8-point lattice feel
    g.add(at(k.box(0.26, 0.025, 0.26, iron), 0, 0.33, 0));                     // lower deck
    g.add(at(k.box(0.14, 0.02, 0.14, iron), 0, 0.66, 0));                      // upper deck
    g.add(at(k.cone(0.01, 0.1, iron, { seg: 6 }), 0, 0.97, 0));                // antenna (UNLIT at night)
  },
  arcDeTriomphe(g, k) {
    const stone = '#D9D0C1';
    // ExtrudeGeometry: a rectangle with an arch-topped HOLE → the gateway.
    const W = 0.58, H = 0.5, t = 0.34;
    const s = new THREE.Shape();
    s.moveTo(-W / 2, 0); s.lineTo(W / 2, 0); s.lineTo(W / 2, H); s.lineTo(-W / 2, H); s.lineTo(-W / 2, 0);
    const hole = new THREE.Path();
    const hw = 0.15, hh = 0.22;
    hole.moveTo(-hw, 0); hole.lineTo(-hw, hh); hole.absarc(0, hh, hw, Math.PI, 0, true); hole.lineTo(hw, 0); hole.lineTo(-hw, 0);
    s.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
    geo.translate(0, 0, -t / 2); geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, vectorize(new THREE.MeshStandardMaterial({ color: stone, flatShading: true }), { color: stone })));
    g.add(at(k.box(W * 1.06, 0.08, t * 1.06, stone), 0, H + 0.04, 0));          // attic slab on top
  },
  sacreCoeur(g, k) {
    const white = '#F1EEE6';
    g.add(at(k.box(0.5, 0.26, 0.4, white), 0, 0.13, 0));                        // body
    const dome = (x, drumH, domeR, y) => {
      g.add(at(k.cyl(domeR * 0.9, domeR, drumH, white, { seg: 12 }), x, y, 0)); // drum
      const d = at(k.sphere(domeR, white, { seg: 12 }), x, y + drumH / 2, 0); d.scale.y = 1.5; g.add(d); // egg dome
    };
    dome(0, 0.22, 0.15, 0.4);                                                   // central elongated dome
    dome(-0.2, 0.1, 0.07, 0.33); dome(0.2, 0.1, 0.07, 0.33);                    // flanking mini-domes
  },

  /* ---- NEO-TOKYO ---- */
  tokyoTower(g, k) {
    // 4-leg taper like the Eiffel, BUT alternating international-orange / white BANDS — the bands
    // ARE the identity. Stacked thin tapered drums alternating colour; whole thing glows orange at night.
    const orange = '#F25822', white = '#EDEDED';
    const N = 9; let y = 0;
    for (let i = 0; i < N; i++) {
      const f0 = i / N, f1 = (i + 1) / N;
      const rb = 0.19 * (1 - f0) + 0.03 * f0, rt = 0.19 * (1 - f1) + 0.03 * f1, h = 0.085;
      const col = i % 2 ? white : orange;
      g.add(at(k.cyl(rt, rb, h, col, { seg: 4, glow: orange, glowDay: 0, glowNight: 0.7 }), 0, y + h / 2, 0));
      y += h;
    }
    g.add(at(k.box(0.22, 0.02, 0.22, orange, { glow: orange, glowNight: 0.7 }), 0, 0.28, 0));  // lower deck
    g.add(at(k.box(0.12, 0.02, 0.12, white), 0, 0.5, 0));                       // upper deck
    g.add(at(k.cone(0.012, 0.16, white, { seg: 6, glow: '#ff6a2a', glowNight: 0.9 }), 0, y + 0.08, 0)); // antenna
  },
  pagoda(g, k) {
    const red = '#B23A2C', wood = '#7A3B2A';
    let y = 0;
    for (let i = 0; i < 5; i++) {                                              // 5 stacked tiers
      const w = 0.42 - i * 0.06, bodyH = 0.11;
      g.add(at(k.box(w, bodyH, w, red, { windows: i < 4 }), 0, y + bodyH / 2, 0));
      g.add(at(k.box(w * 1.34, 0.03, w * 1.34, wood), 0, y + bodyH + 0.015, 0)); // WIDE flaring eave
      y += bodyH + 0.06;
    }
    g.add(at(k.cyl(0.012, 0.012, 0.1, '#E0C040', { seg: 6 }), 0, y + 0.05, 0)); // finial pole
    g.add(at(k.sphere(0.03, '#E0C040', { seg: 8, glow: '#ffe680', glowNight: 0.8 }), 0, y + 0.12, 0));
  },
  neonBillboard(g, k) {
    const dark = '#20242C';
    g.add(at(k.box(0.30, 1.0, 0.30, dark, { windows: true }), 0, 0.5, 0));      // dark host tower
    const neon = ['#5AE8E0', '#E85AA0', '#E8E06A'];
    // big emissive billboard panels on the faces (on day AND night — billboards never sleep).
    const panel = (w, h, color, x, y, z, rot) => {
      const p = at(k.box(w, h, 0.02, color, { glow: color, glowDay: 0.6, glowNight: 1.1 }), x, y, z);
      p.rotation.y = rot; g.add(p);
    };
    panel(0.22, 0.34, neon[0], 0, 0.75, 0.16, 0);
    panel(0.16, 0.5, neon[1], 0.16, 0.5, 0, Math.PI / 2);
    panel(0.2, 0.22, neon[2], 0, 0.34, -0.16, 0);
    g.add(at(k.cone(0.01, 0.14, dark, { seg: 6, glow: '#E85AA0', glowDay: 0.4, glowNight: 1.0 }), 0, 1.08, 0)); // beacon
  },
};

/* Build one icon's primitive group at natural scale (base at y≈0). The factory normalizes it
   to a slot exactly like a GLTF model. `ctx` carries the adoption context (window palette,
   night-glow level, a unique window-id source). */
export function buildIconic(key, ctx) {
  const g = new THREE.Group();
  BUILDERS[key](g, kit(ctx));
  return g;
}
