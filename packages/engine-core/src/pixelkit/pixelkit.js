/* ============================================================
   pixelkit.js — Lesson 10: the reusable pixel-art engine.
   ------------------------------------------------------------
   Shared by the live 3D scene (the `B`-key era looks) and the standalone image tool
   (tools/pixelate.html). Three exports:

     ERA_PRESETS    — named bit-era looks ({ gridWidth, dither, palette }).
     makePaletteTexture(hexes) — pack a palette into a 1×N texture (the GPU LUT the
                       post-pixelkit shader samples; lifts the old 8-colour cap to 64).
     medianCut(pixels, n)      — extract an n-colour palette that FITS an image, in
                       plain JS (the algorithm indexed-colour tools have used for decades).

   WHY ERAS ARE JUST PARAMETERS. "8-bit / 16-bit" named HARDWARE limits — how many
   palette registers, colours per tile, pixels on screen. The look everyone means is
   those limits. So an era is nothing but { resolution, palette size, dither }. Make
   the limits into knobs and you can dial any era — or invent new ones.
   ============================================================ */
import * as THREE from 'three';

/* DawnBringer 16 & 32 — famous, well-balanced general palettes (perceptually spread,
   not a flat RGB cube), so arbitrary art (photos, John's AI concepts) quantizes nicely. */
const DB16 = [
  '#140c1c', '#442434', '#30346d', '#4e4a4e', '#854c30', '#346524', '#d04648', '#757161',
  '#597dce', '#d27d2c', '#8595a1', '#6daa2c', '#d2aa99', '#6dc2ca', '#dad45e', '#deeed6',
];
const DB32 = [
  '#000000', '#222034', '#45283c', '#663931', '#8f563b', '#df7126', '#d9a066', '#eec39a',
  '#fbf236', '#99e550', '#6abe30', '#37946e', '#4b692f', '#524b24', '#323c39', '#3f3f74',
  '#306082', '#5b6ee1', '#639bff', '#5fcde4', '#cbdbfc', '#ffffff', '#9badb7', '#847e87',
  '#696a6a', '#595652', '#76428a', '#ac3232', '#d95763', '#d77bba', '#8f974a', '#8a6f30',
];

/* The era presets. Numbers are starting points — tuned by eye, reported in the handoff.
   `palette: null` ⇒ MODERN: no palette cap, full colour, just a fine grid + whisper dither. */
export const ERA_PRESETS = {
  '1-bit':  { gridWidth: 110, dither: 0.6,  palette: ['#15120c', '#c8b486'] }, // ink↔gold mono (tool)
  'gb':     { gridWidth: 130, dither: 0.4,  palette: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'] }, // 4-shade DMG
  '8-bit':  { gridWidth: 160, dither: 0.55, palette: DB16 },
  '16-bit': { gridWidth: 280, dither: 0.30, palette: DB32 },
  'modern': { gridWidth: 460, dither: 0.6,  palette: null },                   // 32-bit feel
};
/* The TOOL lists the canonical bit-eras (1-bit shines on photos). The SCENE's `B` key
   uses a 4-shade GAME-BOY ramp for its coarsest step instead of 2-colour, so the
   low-contrast district still reads at the coarsest era (DESIGN's L10-review call). */
export const ERA_ORDER = ['1-bit', '8-bit', '16-bit', 'modern'];        // tool dropdown order
export const SCENE_ERA_ORDER = ['gb', '8-bit', '16-bit', 'modern'];     // scene B-key order

/* The palettes the tool offers alongside "extract from image" / "auto". Kept here so the tool
   page, the scene, AND the headless asset-factory crunch can all reach them by KEY without
   importing main.js — a palette is just a small fixed colour LUT (look-up table). Authored as
   sRGB hex; makePaletteTexture converts to the linear values the shader compares against.
   C++ ANALOGY: a `const Color LUT[]` table handed to the quantizer kernel.

   Two groups: the HOUSE brand looks (L10) and a GENERAL-PURPOSE set (L47) — "all types of
   colour palettes, not just our LGR one" — neutral/photoreal, cool/noir, warm/sunset,
   vibrant/pop, mono/ink. More entries (6–8) than the brand 5s, so arbitrary art quantizes
   with more headroom. Every key works in BOTH the live post-pixelkit shader and the crunch. */
export const LGR_PALETTES = {
  // — house brand —
  'ink-gold (day)':   ['#16100A', '#3A2F1E', '#6B563A', '#937B54', '#B89968'],
  'ink-gold (night)': ['#0A0C16', '#1C2236', '#3A3A52', '#5A5A78', '#8A92B0'],
  'terminal (day)':   ['#050805', '#0E2912', '#1E6B2F', '#3CF06A', '#FFB000'],
  'terminal (night)': ['#020604', '#06180E', '#10401E', '#1E9040', '#7FE0FF'],
  // — L47 general-purpose —
  'neutral (photoreal)': ['#1B1B1E', '#3D3A3A', '#5E5750', '#867C70', '#A99C8A', '#C8BCAB', '#E3DCCF', '#F5F1E8'],
  'cool (noir)':         ['#0A0E14', '#16202E', '#243447', '#3A536B', '#5A7D96', '#86A6BD', '#B6CDDA', '#E6EEF2'],
  'warm (sunset)':       ['#190B0A', '#3B150F', '#6E2A17', '#A8421F', '#DB702F', '#F2A23E', '#F9CF76', '#FDF0C4'],
  'vibrant (pop)':       ['#1A1A2E', '#E43F5A', '#F9A826', '#FFE05D', '#2EC4B6', '#3A86FF', '#8338EC', '#FFFFFF'],
  'mono (ink)':          ['#0C0C0C', '#2A2A2A', '#474747', '#666666', '#8A8A8A', '#B0B0B0', '#D6D6D6', '#F5F5F5'],
};

/* Pack a hex palette into a 1×N FloatType texture — the LUT the shader samples. Float
   (not 8-bit) so the stored LINEAR values match the linear render/image exactly, with no
   rounding banding. NearestFilter: we index discrete entries, never blend between them. */
export function makePaletteTexture(hexes) {
  const w = Math.max(hexes.length, 1);
  const data = new Float32Array(w * 4);
  hexes.forEach((hex, i) => {
    const c = new THREE.Color(hex);            // hex → linear RGB (Three colour management)
    data[i * 4 + 0] = c.r;
    data[i * 4 + 1] = c.g;
    data[i * 4 + 2] = c.b;
    data[i * 4 + 3] = 1.0;
  });
  const tex = new THREE.DataTexture(data, w, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/* MEDIAN CUT — extract an n-colour palette that fits a set of pixels.
   The picture: drop every pixel into the RGB COLOUR CUBE. Find the box's longest axis
   (the channel with the widest spread), SORT along it, and SPLIT at the median — two
   boxes, each with half the pixels. Repeat on whichever boxes are biggest until you have
   n boxes, then average each box → one palette colour. Result: more palette entries land
   where the image actually has colours (unlike a uniform cube). ~plain JS, no deps.

   `pixels` = flat [r,g,b, r,g,b, …] in 0..255 (caller subsamples for speed). Returns an
   array of '#rrggbb'. */
export function medianCut(pixels, n) {
  // pack into [r,g,b] triples
  const pts = [];
  for (let i = 0; i + 2 < pixels.length; i += 3) pts.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
  if (pts.length === 0) return ['#000000'];

  const longestAxis = (box) => {
    const lo = [255, 255, 255], hi = [0, 0, 0];
    for (const p of box) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], p[c]); hi[c] = Math.max(hi[c], p[c]); }
    const r = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const ax = r[0] >= r[1] && r[0] >= r[2] ? 0 : r[1] >= r[2] ? 1 : 2;
    return { ax, range: r[ax] };
  };

  let boxes = [pts];
  while (boxes.length < n) {
    // split the box with the widest spread (stop if none can be split further)
    let bi = -1, best = -1;
    boxes.forEach((b, i) => { if (b.length > 1) { const { range } = longestAxis(b); if (range > best) { best = range; bi = i; } } });
    if (bi < 0) break;
    const box = boxes[bi];
    const { ax } = longestAxis(box);
    box.sort((a, b) => a[ax] - b[ax]);
    const mid = box.length >> 1;
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }

  // average each box, format as hex
  return boxes.map((box) => {
    const s = [0, 0, 0];
    for (const p of box) for (let c = 0; c < 3; c++) s[c] += p[c];
    const avg = s.map((v) => Math.round(v / box.length));
    return '#' + avg.map((v) => v.toString(16).padStart(2, '0')).join('');
  });
}
