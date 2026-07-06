/* ============================================================
   office.js — Lessons 19 → 23: the warm executive office interior (the dive destination).
   ------------------------------------------------------------
   John's game centerpiece: from the city you dive INTO a building window and resolve
   inside a cozy executive office, the living city glowing through the glass. This module
   owns the INTERIOR — its own little THREE.Scene + camera, lit warm — and exposes the seams
   the rest of the engine plugs into.

   LESSON HISTORY (each a commit):
     • L19 (Phase A) — the room shell + the living corner WINDOW (a render-to-texture of the
       REAL city, handed in via setCityTexture) + static desk props.
     • L22 (Phase B) — clickable props (laptop→game panel, phone→travel) + the pet CAT
       (a billboard-sprite state machine off the SunRig: asleep at night, awake by day).
     • L23 (Phase B-2, THIS lesson) — finishes the office "life":
         – a FISH TANK (fish on looping paths + rising bubbles + a night glow + click-to-feed),
         – the BASEMENT starter tier (no skyline; instead a DYNAMIC framed picture = a tiny
           render-to-texture vignette with its OWN day/night) selectable as a FITOUT,
         – fuller ambient life (dust motes in the lamp beam, a swaying plant, a wall clock
           whose hand tracks the SunRig time of day).

   TWO FITOUTS, ONE ROOM (the L23 "variant" idea). The desk + props + cat + fish tank are
   SHARED; only the SHELL differs — the warm walnut CORNER office (glass-wrapped skyline) vs
   the humbler concrete BASEMENT (a framed live vignette instead of a view). We don't rebuild
   the scene to switch: both shells are built once and `setFitout()` just toggles which group
   is visible (+ a light tweak). C++ ANALOGY: a factory that picks a layout by enum — except
   we instantiate BOTH layouts up front and flip a visibility flag, so the swap is instant.

   THE STYLE CONTRAST IS THE POINT (per John's refs): the city outside stays cool + stylized;
   the room inside is warm and LIT — walnut paneling, a desk lamp's amber pool, a ceiling
   downlight. We don't fork the renderer for it — it's just a separate scene with its own
   lights, drawn with the same renderer.

   THE RTT LINEAGE, ONCE MORE. Both "windows" are render-to-texture (the FBO family we've used
   since the water grab pass): the CORNER glass samples a texture of the live city (rendered in
   main.js); the BASEMENT picture samples a texture of a tiny self-contained vignette scene that
   lives RIGHT HERE (its camera/scene are exposed; main.js renders it into a small target each
   frame, exactly like the city window). Render a scene into a texture, hang it on the wall.
   ============================================================ */
import { THREE, makeContactShadow, makeVignette, createSeatedLook } from '@lgr/engine-core';
// L29/L59: the baked DIFFUSION SKINS (ComfyUI ControlNet-locked reinterprets of our own office).
// `?url` (the landmarks.js convention) makes Vite copy the PNG to a hashed asset path + hand us the URL.
// L59 wired 4 fresh ControlNet skins as the selectable set (the L29 smooth/charm were the first proof).
import skinDressed2Url from './assets/office-skin/office-dressed2.png?url';
import skinNight2Url    from './assets/office-skin/office-night2.png?url';
import skinModernUrl    from './assets/office-skin/office-modern.png?url';
import skinCharm2Url    from './assets/office-skin/office-charm2.png?url';

/* L46: a procedural WALNUT wood-grain texture (wavy vertical grain + a couple of plank seams) drawn to a
   canvas → CanvasTexture, so the walls/ceiling/desk read as warm WOOD, not flat single-colour blocks. Tiled
   per-surface via box()'s mapRepeat. (Cosmetic per-load grain — like the city's other procedural textures.) */
function makeWoodTexture() {
  const s = 256, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const x = cv.getContext('2d');
  // This texture is the surface's full ALBEDO (box() sets material colour to white when a map is given,
  // so the texture isn't double-darkened by a dark base colour). Hence a readable MID-WALNUT base here,
  // not a near-black one — it must look like wood on its own under the room's warm low light.
  x.fillStyle = '#6e4a2c'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 150; i++) {                          // wavy vertical grain streaks (lighter + darker)
    const gx = Math.random() * s, sh = 0.7 + Math.random() * 0.7;
    x.strokeStyle = `rgba(${Math.round(110 * sh)},${Math.round(74 * sh)},${Math.round(44 * sh)},${0.16 + Math.random() * 0.28})`;
    x.lineWidth = 0.5 + Math.random() * 1.6;
    x.beginPath(); x.moveTo(gx, 0);
    for (let y = 0; y <= s; y += 14) x.lineTo(gx + Math.sin(y * 0.05 + gx) * 3, y);
    x.stroke();
  }
  x.strokeStyle = 'rgba(30,18,8,0.5)'; x.lineWidth = 2;    // plank seams
  for (const py of [s * 0.34, s * 0.67]) { x.beginPath(); x.moveTo(0, py); x.lineTo(s, py); x.stroke(); }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/* small helpers — a lit box and a thin slab, so the body reads as furniture not boilerplate.
   L46: optional `map` (+ `mapRepeat` to tile it per-surface — the map is cloned so each box tiles solo). */
function box(w, h, d, color, { rough = 0.62, metal = 0.0, x = 0, y = 0, z = 0, emissive = null, emissiveIntensity = 1, map = null, mapRepeat = null } = {}) {
  let useMap = map;
  if (map && mapRepeat) {
    useMap = map.clone(); useMap.needsUpdate = true;
    useMap.wrapS = useMap.wrapT = THREE.RepeatWrapping;
    useMap.repeat.set(mapRepeat[0], mapRepeat[1]);
  }
  // When a map carries the albedo, force material colour WHITE so the texture shows at its true tone —
  // MeshStandardMaterial multiplies colour × map, so a dark `color` here would crush a dark wood map to
  // near-black (the L46 double-darkening bug). Unmapped boxes keep their flat `color` as before.
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: useMap ? '#ffffff' : color, roughness: rough, metalness: metal, ...(useMap ? { map: useMap } : {}), ...(emissive ? { emissive, emissiveIntensity } : {}) }),
  );
  m.position.set(x, y, z);
  return m;
}

/* L59 — the diffusion-skin WINDOW-APERTURE MASK (alphaMap for the backplate). White = opaque (the painted
   ROOM shows), black = transparent (the painted WINDOW/city is cut so only the live engine glass shows there).
   The window opening is the same across the 4 ControlNet-locked skins, so this one mask serves all. Soft edge
   (canvas blur) so the cut doesn't read as a hard rectangle. Region tuned to the skins' window footprint;
   CanvasTexture flipY means canvas-y=0 is UV v=1 (top), so the window's v[0.34..0.90] maps to y[0.10H..0.66H]. */
function makeApertureMask() {
  const W = 512, H = 304, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);                 // opaque everywhere (room)
  const x0 = 0.13 * W, x1 = 0.87 * W, y0 = 0.10 * H, y1 = 0.66 * H, r = 14;
  x.filter = 'blur(7px)';                                       // feather the aperture edge
  x.fillStyle = '#000';                                         // transparent (the window cut)
  x.beginPath();
  x.moveTo(x0 + r, y0);
  x.arcTo(x1, y0, x1, y1, r); x.arcTo(x1, y1, x0, y1, r);
  x.arcTo(x0, y1, x0, y0, r); x.arcTo(x0, y0, x1, y0, r);
  x.closePath(); x.fill();
  x.filter = 'none';
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function createOffice({ tier = 'corner', layout: layout0 = 'straight-on' } = {}) {
  const scene = new THREE.Scene();

  /* The desk-view camera: behind the polished desk, looking past the laptop toward the
     corner glass. A gentle telephoto (fov 43) flattens it into that staged "boardroom"
     framing of the references. We add a whisper of idle sway in update() so it breathes. */
  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
  const camBase = new THREE.Vector3(0, 1.62, 4.35);
  const BASE_TARGET = new THREE.Vector3(0, 1.12, -1.0);
  camera.position.copy(camBase);
  camera.lookAt(BASE_TARGET);
  // L51 — a reusable SEATED FREE-LOOK (head-turn from the fixed seat). main.js feeds it drag/keys; update()
  // eases it; we apply the damped yaw/pitch as a LOCAL rotation on top of the base look each frame.
  const look = createSeatedLook({ yawLimit: 80, pitchUp: 34, pitchDown: 20 });
  const _eLook = new THREE.Euler(0, 0, 0, 'YXZ');
  const _qLook = new THREE.Quaternion();

  const root = new THREE.Group();
  scene.add(root);

  /* The two FITOUT shells. Built once, toggled by setFitout(). Shared furniture (desk, props,
     cat, fish tank, dust motes) lives on `root` directly, so it shows in BOTH. */
  const cornerGroup = new THREE.Group();
  const basementGroup = new THREE.Group();
  // L29: the live corner GLASS lives in its own group (not inside cornerGroup) so the diffusion skin
  // can hide the 3D room SHELL while KEEPING the live window — the real angled panes sit right over the
  // skin's painted window opening (the skin was generated from this exact view → structure-locked).
  const liveWindow = new THREE.Group();
  // L30: the hideable shared 3D FURNITURE lives in ONE group so a "painted-props" skin can hide it all
  // at once (the office then relies on the props PAINTED into the backplate); invisible HOTSPOTS keep
  // those painted props clickable. props3D is populated by reparenting the furniture once it's built.
  const props3D = new THREE.Group();
  const hotspots = new THREE.Group();
  root.add(cornerGroup, basementGroup, liveWindow, props3D, hotspots);

  /* clock hands collected here so setFitout-independent update can sweep them by SunRig time. */
  const clockHands = [];

  /* ---- PALETTE (warm walnut executive) ---- */
  const WALL = '#4a3322';        // walnut paneling
  const WALL_TRIM = '#3a2618';   // darker trim / mullions
  const FLOOR = '#3c2a1c';       // dark wood floor
  const DESK = '#5b3d27';        // desk body
  const DESK_TOP = '#6e4a30';    // polished desktop (lighter, lower roughness)
  const CEIL = '#3a2a1d';        // L45: warm wood ceiling (was near-black '#241a13' → read as a cave)
  /* ---- PALETTE (basement: cool concrete, warm clutter) ---- */
  const CONCRETE = '#5a5650';    // bare concrete wall
  const CONCRETE_D = '#403d38';  // darker concrete / floor
  const PIPE = '#6b6258';        // ceiling pipes
  const wood = makeWoodTexture();   // L46: shared walnut grain (cloned + tiled per surface via box mapRepeat)

  /* ============================================================
     CORNER FITOUT — the warm walnut office with the glass corner window (L19/L22).
     ============================================================ */
  // FLOOR + CEILING (corner). L46: warm walnut grain on both; ceiling gets a simple beam coffer below.
  cornerGroup.add(box(11, 0.2, 11, FLOOR, { rough: 0.5, y: -0.1, map: wood, mapRepeat: [5, 5] }));
  cornerGroup.add(box(11, 0.2, 11, CEIL, { rough: 0.9, y: 3.0, map: wood, mapRepeat: [4, 4] }));
  // L46 CEILING BEAMS — a few dark-walnut beams across the ceiling (a coffer read, exec-office feel).
  for (const bx of [-2.4, 0, 2.4]) cornerGroup.add(box(0.18, 0.16, 7.4, WALL_TRIM, { rough: 0.7, x: bx, y: 2.9, z: 0, map: wood, mapRepeat: [1, 4] }));
  for (const bz of [-2.0, 0.4] ) cornerGroup.add(box(7.4, 0.16, 0.18, WALL_TRIM, { rough: 0.7, x: 0, y: 2.88, z: bz, map: wood, mapRepeat: [4, 1] }));

  /* SIDE WALLS (wood paneling) with framed art. Near-camera side walls are solid walnut; the
     far corner is glass (below). Panel grooves are faked with thin inset trims. */
  function panelWall(side) {                       // side = -1 (left) | +1 (right)
    const g = new THREE.Group();
    // L46: warm walnut grain on the wall face (was flat single-colour). Tiled ~3× along the 8m run.
    g.add(box(0.2, 3.2, 8.0, WALL, { rough: 0.7, x: side * 3.6, y: 1.5, z: 0.0, map: wood, mapRepeat: [3, 1.4] }));
    /* L48b — proud WAINSCOTING that actually READS as depth. (Bug fix: the L46 moldings were placed at
       |x|≈3.585, which is INSIDE the 0.2-thick wall slab — behind the inner face at |x|=3.5 — so they were
       buried and barely visible. Now everything sits PROUD of the inner face toward the room at |x|≈3.45.) */
    const PX = side * 3.45;            // proud of the inner wall face (|x|=3.5), toward the room
    g.add(box(0.06, 0.22, 8.0, WALL_TRIM, { x: PX, y: 0.13, z: 0 }));     // baseboard (reads along the floor)
    g.add(box(0.08, 0.16, 8.0, WALL_TRIM, { x: PX, y: 2.84, z: 0 }));     // crown / cornice (reads at the wall-ceiling line)
    g.add(box(0.05, 0.05, 8.0, WALL_TRIM, { x: PX, y: 1.0, z: 0 }));      // chair rail (splits upper field / lower wainscot)
    // panel STILES (vertical) dividing each band into raised panels — kept clear of the framed art at z≈0.4.
    for (const zz of [-2.6, -1.3, 1.3, 2.6]) g.add(box(0.05, 1.6, 0.06, WALL_TRIM, { x: PX, y: 1.95, z: zz }));   // upper panels
    for (const zz of [-2.6, -1.3, 1.3, 2.6]) g.add(box(0.05, 0.7, 0.06, WALL_TRIM, { x: PX, y: 0.6, z: zz }));    // lower wainscot
    const art = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.0),
      new THREE.MeshStandardMaterial({ map: makeArtTexture(side), roughness: 0.8 }),
    );
    art.position.set(side * 3.49, 1.7, 0.4);
    art.rotation.y = -side * Math.PI / 2;
    g.add(box(0.06, 1.18, 1.68, '#2a1c10', { x: side * 3.52, y: 1.7, z: 0.4 }), art);
    /* L51b — dress the side wall now that look-around reveals it: a SECOND framed art piece + a wall
       SCONCE (fixture + warm glow). Art faces the room (∓X); the sconce glow is a billboard sprite. */
    const art2 = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 1.3),
      new THREE.MeshStandardMaterial({ map: makeArtTexture(-side), roughness: 0.8 }),
    );
    art2.position.set(side * 3.49, 1.78, -2.0); art2.rotation.y = -side * Math.PI / 2;
    g.add(box(0.06, 1.46, 1.16, '#2a1c10', { x: side * 3.52, y: 1.78, z: -2.0 }), art2);
    g.add(box(0.12, 0.3, 0.16, '#2a1c10', { x: side * 3.4, y: 2.2, z: 2.2 }));            // sconce fixture
    const sc = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeDotTexture(), color: '#ffcf8a', transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    sc.scale.set(0.6, 0.75, 1); sc.position.set(side * 3.32, 2.34, 2.2); sc.raycast = () => {};
    g.add(sc);
    return g;
  }
  cornerGroup.add(panelWall(-1), panelWall(1));

  /* L51b — a BOOKSHELF against the LEFT wall + a small accent SIDE CHAIR front-right + extra ceiling
     downlights: room dressing the seated free-look now reveals. Tasteful, warm — not cluttered. */
  const bookshelf = new THREE.Group();
  bookshelf.add(box(0.3, 1.9, 1.5, DESK, { rough: 0.5, y: 0.95 }));                         // case (depth along z)
  for (const sy of [0.4, 0.95, 1.5]) bookshelf.add(box(0.3, 0.04, 1.46, '#3a2c1e', { y: sy }));   // shelves
  const shelfBooks = ['#7a3a2a', '#2a4a6a', '#b08a3a', '#3a5a3a', '#6a2a4a', '#8a5a2a'];
  for (const sy of [0.6, 1.15, 1.7]) for (let i = 0; i < 7; i++) {
    bookshelf.add(box(0.18, 0.3, 0.11, shelfBooks[(i + Math.round(sy)) % shelfBooks.length], { x: 0.02, y: sy - 0.06, z: -0.6 + i * 0.17 }));
  }
  bookshelf.position.set(-3.34, 0, -1.9);
  cornerGroup.add(bookshelf);
  cornerGroup.add(makeContactShadow({ w: 1.0, d: 1.8, x: -3.2, y: 0.02, z: -1.9, opacity: 0.4 }));

  // a small accent SIDE CHAIR in the front-right corner (seat + back + 4 legs).
  const chair = new THREE.Group();
  chair.add(box(0.5, 0.1, 0.5, '#4a3526', { rough: 0.7, y: 0.45 }));            // seat
  chair.add(box(0.5, 0.55, 0.08, '#4a3526', { rough: 0.7, y: 0.72, z: -0.21 })); // back
  for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) chair.add(box(0.05, 0.45, 0.05, '#2a1c10', { x: lx, y: 0.22, z: lz }));
  chair.position.set(2.7, 0, 2.6); chair.rotation.y = -0.5;
  cornerGroup.add(chair);
  cornerGroup.add(makeContactShadow({ w: 0.7, d: 0.7, x: 2.7, y: 0.02, z: 2.6, opacity: 0.42 }));

  /* THE CORNER WINDOW (the showpiece). Two glass walls meeting at a vertical edge pointing AWAY
     from the camera. Each glass plane is mapped with the city RTT — MeshBasicMaterial so the city
     image shows UNLIT and bright (it already carries its own lighting). The planes splay at ±45°
     from the back-centre edge, so the skyline wraps the corner like the refs. The materials are
     captured so main.js can set their .map to the live city texture (setCityTexture). */
  /* L49 — TRUE CORNER. History: L45 fixed literal DOUBLING (both panes sampling the full city RTT → skyline
     twice) by UV-splitting ONE flat render (left pane → u0–0.5, right → 0.5–1). But that's still ONE flat
     camera folded at the post — a single vanishing point at the seam, NOT a real corner. L49 gives each pane
     its OWN directional render (two pane cameras 90° apart in main.js → two textures), so each pane samples
     its FULL own view (UV 0–1) and the city genuinely WRAPS the corner. So: full-UV planes, two materials. */
  const glassGeoL = new THREE.PlaneGeometry(3.0, 2.5);
  const glassGeoR = new THREE.PlaneGeometry(3.0, 2.5);
  const glassMatL = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const glassMatR = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const CORNER_Z = -3.7, GLASS_Y = 1.55;
  // L59 piece 3 — FLATTEN the corner: a SHALLOWER pane half-angle than the L58 45° (which needed ~90° h-fov
  // → curvy wide-angle). 30° → each pane camera needs only ~60° h-fov (derived in lockstep in main.js) = far
  // less distortion, while the panes' inner edges still MEET at the corner-forward ray, so the wrap stays
  // continuous (no reopened seam gap). The panes (and their frames below) derive their pos/rot from this one
  // angle so geometry + cameras can't drift apart.
  const CORNER_DEG = 30, PANE_W = 3.0;
  const _ca = THREE.MathUtils.degToRad(CORNER_DEG);
  const _px = (PANE_W / 2) * Math.cos(_ca), _pz = CORNER_Z + (PANE_W / 2) * Math.sin(_ca);
  const glassL = new THREE.Mesh(glassGeoL, glassMatL);
  glassL.position.set(-_px, GLASS_Y, _pz);
  glassL.rotation.y = _ca;
  const glassR = new THREE.Mesh(glassGeoR, glassMatR);
  glassR.position.set(_px, GLASS_Y, _pz);
  glassR.rotation.y = -_ca;
  // L49b — the STRAIGHT-ON flat pane (one flat window, the alternative layout). Lives in liveWindow too so
  // it composites under a skin like the corner panes; setLayout toggles which glass is visible.
  const glassMatS = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const glassS = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 2.6), glassMatS);
  glassS.position.set(0, GLASS_Y, CORNER_Z + 0.15);
  glassS.visible = false;
  liveWindow.add(glassL, glassR, glassS);          // L29: the live panes (kept visible under a skin)

  /* L49b — the CORNER window frames (post + angled frames + corner sill) wrapped in one group so the
     layout toggle can hide them for the straight-on wall. */
  const cornerFrames = new THREE.Group();
  // L59: the corner post + sill sit at the panes' shared seam line (derived from _pz); the angled frames
  // track each pane's pos/rot, so they all flatten in lockstep with the panes above.
  cornerFrames.add(box(0.08, 2.7, 0.08, WALL_TRIM, { x: 0, y: GLASS_Y, z: _pz + PANE_W / 2 * Math.sin(_ca) + 0.02 }));   // corner post (front seam)
  for (const [mx, mz, ry] of [[-_px, _pz, _ca], [_px, _pz, -_ca]]) {
    const fr = new THREE.Group();
    fr.add(box(3.05, 0.09, 0.09, WALL_TRIM, { y: 1.3 }));
    fr.add(box(3.05, 0.09, 0.09, WALL_TRIM, { y: -1.25 }));
    fr.add(box(0.09, 2.6, 0.09, WALL_TRIM, { x: -1.5 }));
    fr.position.set(mx, GLASS_Y, mz); fr.rotation.y = ry;
    cornerFrames.add(fr);
  }
  cornerFrames.add(box(5.4, 0.5, 0.3, DESK, { x: 0, y: 0.25, z: _pz + 0.5 }));   // sill / radiator cabinet
  cornerGroup.add(cornerFrames);

  /* L49b — the STRAIGHT-ON window wall: a flat wood wall filling the corner opening with a framed window
     (glassS sits just in front). Hidden until setLayout('straight-on'). */
  const straightGroup = new THREE.Group();
  straightGroup.add(box(11, 3.2, 0.2, WALL, { rough: 0.7, x: 0, y: 1.5, z: CORNER_Z - 0.05, map: wood, mapRepeat: [4, 1.4] })); // flat back wall
  straightGroup.add(box(5.8, 0.14, 0.12, WALL_TRIM, { x: 0, y: GLASS_Y + 1.35, z: CORNER_Z + 0.2 }));   // window head
  straightGroup.add(box(5.8, 0.14, 0.12, WALL_TRIM, { x: 0, y: GLASS_Y - 1.35, z: CORNER_Z + 0.2 }));   // window sill rail
  straightGroup.add(box(0.14, 2.84, 0.12, WALL_TRIM, { x: -2.8, y: GLASS_Y, z: CORNER_Z + 0.2 }));      // left jamb
  straightGroup.add(box(0.14, 2.84, 0.12, WALL_TRIM, { x: 2.8, y: GLASS_Y, z: CORNER_Z + 0.2 }));       // right jamb
  straightGroup.add(box(0.09, 2.6, 0.09, WALL_TRIM, { x: 0, y: GLASS_Y, z: CORNER_Z + 0.21 }));         // centre mullion
  straightGroup.add(box(5.4, 0.5, 0.3, DESK, { x: 0, y: 0.25, z: CORNER_Z + 0.35 }));                   // sill cabinet

  /* L50b — BEAUTIFY the straight-on hero: furnish the bare window wall (Laurence: "beautify everything
     around the desk and behind on the walls and artwork"). A CREDENZA left of the window with books on
     top, framed ART flanking the window, and warm WALL SCONCES. (Window-wall dressing → straightGroup, so
     it shows in the straight-on hero; the corner layout hides it with the rest of the flat wall.) */
  const cred = new THREE.Group();                                  // low walnut credenza, left of the window
  cred.add(box(2.4, 0.9, 0.55, DESK, { rough: 0.42, y: 0.45, z: 0 }));
  cred.add(box(2.46, 0.06, 0.58, DESK_TOP, { rough: 0.3, y: 0.91, z: 0 }));         // top (sheen)
  for (const dx of [-0.62, 0, 0.62]) cred.add(box(0.66, 0.72, 0.03, '#4a3120', { x: dx, y: 0.45, z: 0.285 })); // doors
  for (const dx of [-0.62, 0, 0.62]) cred.add(box(0.05, 0.04, 0.05, '#caa15a', { x: dx + 0.2, y: 0.45, z: 0.31, metal: 0.6 })); // handles
  const credBooks = ['#7a3a2a', '#2a4a6a', '#b08a3a', '#3a5a3a'];
  for (let i = 0; i < 4; i++) cred.add(box(0.1, 0.26 + (i % 2) * 0.05, 0.2, credBooks[i], { x: -0.95 + i * 0.13, y: 1.07, z: -0.06 }));
  cred.add(box(0.04, 0.34, 0.42, '#241a12', { x: 0.7, y: 1.12, z: -0.02 }));        // a small standing frame
  cred.position.set(-3.9, 0, CORNER_Z + 0.45);
  straightGroup.add(cred);
  straightGroup.add(makeContactShadow({ w: 2.8, d: 0.95, x: -3.9, y: 0.02, z: CORNER_Z + 0.45, opacity: 0.45 }));

  // framed ART flanking the window (a warm-toned piece each side), in the visible wall flank.
  for (const [ax, side] of [[-3.55, -1], [3.55, 1]]) {
    const g = new THREE.Group();
    const art = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.98), new THREE.MeshStandardMaterial({ map: makeArtTexture(side), roughness: 0.82 }));
    art.position.z = 0.05;
    g.add(box(0.06, 1.12, 0.92, '#241a10', {}), art);
    g.position.set(ax, 1.45, CORNER_Z + 0.13);
    straightGroup.add(g);
  }

  // warm WALL SCONCES flanking the window above the art (a small fixture + an additive glow).
  for (const sx of [-3.55, 3.55]) {
    straightGroup.add(box(0.16, 0.32, 0.13, '#2a1c10', { x: sx, y: 2.35, z: CORNER_Z + 0.2 }));
    const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeDotTexture(), color: '#ffcf8a', transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    g.scale.set(0.55, 0.7, 1); g.position.set(sx, 2.5, CORNER_Z + 0.28); g.raycast = () => {};
    straightGroup.add(g);
  }

  straightGroup.visible = false;
  cornerGroup.add(straightGroup);

  // the visible downlight fixture + its glow disc on the ceiling (corner only).
  cornerGroup.add(box(0.4, 0.06, 0.4, '#1a130c', { y: 2.94, z: 1.3 }));
  const glowDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.16, 20),
    new THREE.MeshBasicMaterial({ color: '#ffe6b0', toneMapped: false }),
  );
  glowDisc.position.set(0, 2.9, 1.3); glowDisc.rotation.x = Math.PI / 2;
  cornerGroup.add(glowDisc);
  /* L51b — a ROW of recessed ceiling downlights (read when you look UP), between the L46 beams. Each =
     a dark housing box + a warm glow disc facing down. Purely visual (the real key light is the spot). */
  for (const [lx, lz] of [[-1.6, -1.0], [1.6, -1.0], [-1.6, -2.6], [1.6, -2.6], [0, -2.6]]) {
    cornerGroup.add(box(0.28, 0.05, 0.28, '#1a130c', { y: 2.95, x: lx, z: lz }));
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), new THREE.MeshBasicMaterial({ color: '#ffe6b0', toneMapped: false }));
    d.position.set(lx, 2.915, lz); d.rotation.x = Math.PI / 2; d.raycast = () => {};
    cornerGroup.add(d);
  }

  // a wall clock on the left walnut wall (L23: its hand tracks the real time of day).
  cornerGroup.add(makeClock(clockHands, { x: -3.46, y: 2.15, z: 0.2, ry: Math.PI / 2, face: '#efe2c8', rim: '#2a1c10' }));

  /* L48c — a RUG under the desk: MATERIAL CONTRAST (matte deep-red fabric vs the polished walnut desk +
     wood floor) and it warms/anchors the foreground. A flat slab + a darker border for a woven read. */
  cornerGroup.add(box(3.4, 0.03, 2.4, '#3a1410', { rough: 0.98, x: 0, y: 0.012, z: 1.95 }));   // border
  cornerGroup.add(box(3.0, 0.04, 2.0, '#6e2a26', { rough: 0.96, x: 0, y: 0.02, z: 1.95 }));     // rug field

  /* L48c — a potted PLANT in the corner office (floor life beside the desk). Pot + a few tapered blades;
     static (the basement plant carries the swaying one). */
  const cPlant = new THREE.Group();
  cPlant.add(box(0.32, 0.32, 0.32, '#7a4a2a', { rough: 0.8, y: 0.16 }));
  for (let i = 0; i < 6; i++) {
    const blade = box(0.05, 0.55, 0.13, '#356a32', { rough: 0.7, y: 0.32 });
    blade.geometry.translate(0, 0.27, 0);
    blade.rotation.z = (i / 6 - 0.5) * 1.1; blade.rotation.x = Math.sin(i * 1.3) * 0.22;
    cPlant.add(blade);
  }
  cPlant.position.set(2.7, 0, 0.4);
  cornerGroup.add(cPlant);
  cornerGroup.add(makeContactShadow({ w: 0.7, d: 0.7, x: 2.7, y: 0.03, z: 0.4, opacity: 0.45 }));   // plant on floor

  /* ============================================================
     BASEMENT FITOUT — the humbler starter tier. No skyline: a DYNAMIC framed picture
     (a live RTT vignette) instead, plus warm clutter. Cozier, smaller-feeling, warmer.
     ============================================================ */
  basementGroup.add(box(11, 0.2, 11, CONCRETE_D, { rough: 0.85, y: -0.1 }));          // concrete floor
  basementGroup.add(box(11, 0.2, 11, '#1c1a17', { rough: 0.95, y: 2.8 }));            // low ceiling (lower → cozier)
  // concrete back wall + two short side walls (close in → snug).
  basementGroup.add(box(7.0, 3.0, 0.2, CONCRETE, { rough: 0.92, x: 0, y: 1.4, z: -2.9 }));
  basementGroup.add(box(0.2, 3.0, 6.0, CONCRETE, { rough: 0.92, x: -3.2, y: 1.4, z: -0.2 }));
  basementGroup.add(box(0.2, 3.0, 6.0, CONCRETE, { rough: 0.92, x: 3.2, y: 1.4, z: -0.2 }));
  // exposed ceiling pipes (two runs) — the basement read.
  for (const zz of [-1.6, -0.4]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 6.0, 10), new THREE.MeshStandardMaterial({ color: PIPE, roughness: 0.6, metalness: 0.4 }));
    pipe.rotation.z = Math.PI / 2; pipe.position.set(0, 2.62, zz);
    basementGroup.add(pipe);
  }

  /* THE DYNAMIC FRAMED PICTURE (John's "make the basement dynamic" ask). A plane on the back
     wall mapped with a render-to-texture of a tiny living vignette (built below) — its own little
     day/night. Basic material (unlit) so the vignette shows at its own authored brightness, like
     the corner glass. setVignetteTexture() points its .map at the target main.js renders into. */
  const picMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const picture = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.2), picMat);
  picture.position.set(0, 1.5, -2.79);
  basementGroup.add(picture);
  basementGroup.add(box(2.06, 1.36, 0.06, '#241a12', { x: 0, y: 1.5, z: -2.83 }));   // picture frame (behind the plane)

  // a warm hanging bulb (basement key light fixture) — a glow disc + a tiny pendant.
  basementGroup.add(box(0.04, 0.34, 0.04, '#1a1410', { x: -0.1, y: 2.45, z: -0.4 }));
  const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), new THREE.MeshBasicMaterial({ color: '#ffdb8a', toneMapped: false }));
  bulb.position.set(-0.1, 2.26, -0.4); bulb.rotation.x = Math.PI / 2;
  basementGroup.add(bulb);

  // a binder shelf with a few colourful books (clutter that says "starter office").
  const shelf = new THREE.Group();
  shelf.add(box(1.3, 0.05, 0.32, '#3a2c1e', { x: 0, y: 0, z: 0 }));
  const bookCols = ['#7a3a2a', '#2a4a6a', '#b08a3a', '#3a5a3a', '#6a2a4a'];
  for (let i = 0; i < 8; i++) shelf.add(box(0.12, 0.34, 0.24, bookCols[i % bookCols.length], { x: -0.55 + i * 0.14, y: 0.2, z: 0 }));
  shelf.position.set(-2.3, 1.5, -2.66);
  basementGroup.add(shelf);

  // a potted PLANT (its leaves sway in update — L23 ambient). Pot + a few tapered leaf blades.
  const plant = new THREE.Group();
  plant.add(box(0.34, 0.34, 0.34, '#7a4a2a', { y: 0.17 }));                 // terracotta pot
  const leaves = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const blade = box(0.05, 0.5, 0.14, '#3a7a3a', { rough: 0.7 });
    blade.geometry.translate(0, 0.25, 0);                                   // pivot at the pot rim
    blade.rotation.z = (i / 6 - 0.5) * 1.2; blade.rotation.x = Math.sin(i) * 0.25;
    leaves.add(blade);
  }
  leaves.position.y = 0.34; plant.add(leaves);
  plant.position.set(2.45, 0, -1.4);
  basementGroup.add(plant);

  // a basement wall clock (its hand also tracks the day).
  basementGroup.add(makeClock(clockHands, { x: 1.9, y: 2.1, z: -2.78, ry: 0, face: '#d8d2c4', rim: '#1a130c' }));

  /* ============================================================
     SHARED FURNITURE (both fitouts) — desk, lamp, laptop, phone, cat, fish tank, dust motes.
     ============================================================ */
  /* THE DESK (foreground) + drawers. */
  const desk = new THREE.Group();
  // L46: walnut grain on the polished top + the body (was flat). Top keeps its low roughness so the
  // grain reads as a SHEEN over wood, not matte; body tiles a touch denser.
  desk.add(box(3.4, 0.12, 1.5, DESK_TOP, { rough: 0.32, y: 0.86, z: 1.5, map: wood, mapRepeat: [3, 1.4] }));
  desk.add(box(3.2, 0.78, 1.36, DESK, { y: 0.46, z: 1.5, map: wood, mapRepeat: [3, 1] }));
  for (const yy of [0.66, 0.4, 0.14]) desk.add(box(0.9, 0.2, 0.04, '#4a3120', { x: 1.05, y: yy, z: 2.2 }));
  desk.add(box(0.12, 0.04, 0.04, '#caa15a', { x: 1.05, y: 0.66, z: 2.23, metal: 0.6 }));
  // L46 ambient touches (tasteful, not cluttered): a coffee mug + a small stack of papers on the desktop.
  const mug = new THREE.Mesh(                                       // a little ceramic cylinder + a handle ring
    new THREE.CylinderGeometry(0.05, 0.045, 0.1, 16),
    new THREE.MeshStandardMaterial({ color: '#d8cbb4', roughness: 0.6 }),
  );
  mug.position.set(-0.55, 0.97, 1.95);
  const mugHandle = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.012, 8, 14), new THREE.MeshStandardMaterial({ color: '#d8cbb4', roughness: 0.6 }));
  mugHandle.position.set(-0.61, 0.97, 1.95); mugHandle.rotation.y = Math.PI / 2;
  desk.add(mug, mugHandle);
  // L48e — a faint STEAM wisp rising from the mug (ambient micro-life; animated in update()).
  const steam = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeDotTexture(), color: '#fff4e0', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  steam.scale.set(0.12, 0.18, 1); steam.position.set(-0.55, 1.05, 1.95); steam.raycast = () => {};
  desk.add(steam);
  desk.add(box(0.26, 0.03, 0.34, '#efe7d4', { rough: 0.85, x: 0.5, y: 0.935, z: 1.9 }));   // a stack of papers
  root.add(desk);
  // (No visible exec chair: the camera IS the exec's seat — the desk-POV of John's refs, which show no
  //  chair. A chair-back here would only block the desk/laptop/window. The seat is implied by the POV.)

  /* LAMP (left): post + cone shade with a warm point light inside its mouth. */
  const lamp = new THREE.Group();
  lamp.add(box(0.06, 0.5, 0.06, '#2a1c10', { x: -1.15, y: 1.15, z: 1.6 }));
  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.26, 16, 1, true),
    new THREE.MeshStandardMaterial({ color: '#c2802e', roughness: 0.5, side: THREE.DoubleSide, emissive: '#3a2208', emissiveIntensity: 0.6 }),
  );
  shade.position.set(-1.15, 1.42, 1.6);
  lamp.add(shade);
  const lampLight = new THREE.PointLight('#ffb15a', 7.0, 7.0, 1.8);
  lampLight.position.set(-1.15, 1.34, 1.6);
  lamp.add(lampLight);
  // L48d — a soft warm GLOW halo at the lamp mouth (additive sprite) so the lamp visibly *casts* light,
  // not just lights the desk invisibly. (The point light does the work; this sells where it comes from.)
  const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeDotTexture(), color: '#ffcf8a', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  lampGlow.scale.set(0.85, 0.85, 1); lampGlow.position.set(-1.15, 1.35, 1.6); lampGlow.raycast = () => {};
  lamp.add(lampGlow);
  // L62 desk pass — the lamp shade (built at x=-1.15) overhung the tank's back-left corner (cleared by
  // only ~2 cm of height). Offset the whole lamp GROUP another 0.30 to the left so the shade clears the
  // (also-nudged) tank cleanly. One group offset moves the post + shade + point light + glow together;
  // the dust motes (MOTE_X) and the lamp contact shadow are shifted to match below.
  lamp.position.x = -0.30;
  root.add(lamp);

  /* LAPTOP (centre) — base + a faintly glowing screen (click → game panel; main owns the overlay). */
  const laptop = new THREE.Group();
  laptop.add(box(0.62, 0.03, 0.42, '#1c1c20', { y: 0.93, z: 1.5, metal: 0.4, rough: 0.4 }));
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.4, 0.025),
    new THREE.MeshStandardMaterial({ color: '#0a0c10', emissive: '#2a4a6a', emissiveIntensity: 0.7, roughness: 0.3 }),
  );
  screen.position.set(0, 1.14, 1.31); screen.rotation.x = -0.32;
  laptop.add(screen);
  laptop.userData.role = 'laptop';
  root.add(laptop);

  /* PHONE (right) — base + handset (click → travel: hot-swap the window city). L42: the handset gets a
     faint emissive that idle-PULSES (an "I'm clickable" affordance — the laptop glows + the cat breathes,
     this gives the phone its cue too). Captured so update() can breathe it. */
  const phone = new THREE.Group();
  phone.add(box(0.26, 0.07, 0.34, '#15151a', { x: 1.0, y: 0.93, z: 1.5 }));
  const phoneTop = box(0.3, 0.06, 0.08, '#101015', { x: 1.0, y: 1.0, z: 1.34, emissive: '#234a6a', emissiveIntensity: 0.4 });
  phone.add(phoneTop);
  phone.userData.role = 'phone';
  root.add(phone);

  /* ---- LIGHTS (warm preset) — a soft warm hemisphere fill, the lamp point light, and a ceiling
     downlight spot pooling on the desk. setFitout() retunes these per tier (basement = cozier). */
  // L45: warmer, fuller ambient so the walnut room reads cozy-lit (like John's refs), not a dark cave.
  const hemi = new THREE.HemisphereLight('#8a6a42', '#1c130a', 0.78);
  let hemiBase = 0.78;   // L106 (audit fix): the single source for the room-hemi base; setFitout sets it per tier, update() scales it by sun-height (kills the duplicated 0.78/0.82 constants + setFitout's previously-dead write)
  scene.add(hemi);
  const downlight = new THREE.SpotLight('#ffd9a0', 9.0, 9.0, 0.7, 0.5, 1.2);
  downlight.position.set(0, 2.95, 1.3);
  downlight.target.position.set(0, 0.86, 1.5);
  scene.add(downlight, downlight.target);

  /* ---- THE PET CAT (L22 headliner) — a billboard sprite that's a tiny SunRig state machine:
     curled ASLEEP at night, AWAKE + breathing by day, a PETTED bounce + floating heart on click. */
  const catAwake = makeCatTexture(false);
  const catSleep = makeCatTexture(true);
  const CAT_S = 0.62, CAT_X = 1.32, CAT_Y = 1.22, CAT_Z = 1.78;
  const cat = new THREE.Sprite(new THREE.SpriteMaterial({ map: catAwake, transparent: true, depthWrite: false }));
  cat.scale.set(CAT_S, CAT_S, 1);
  cat.position.set(CAT_X, CAT_Y, CAT_Z);
  cat.userData.role = 'cat';
  root.add(cat);
  const heart = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeHeartTexture(), transparent: true, depthWrite: false, opacity: 0 }));
  heart.scale.set(0.3, 0.3, 1); heart.raycast = () => {};
  root.add(heart);
  let pet = 0;
  function petCat() { pet = 1.3; }

  /* ============================================================
     THE FISH TANK (L23) — a small desk aquarium: fish on looping parametric paths (the agent/path
     pattern again, miniaturised — same idea as traffic/clouds, different scale), rising bubbles, a
     night GLOW that lights the room after dark, and click-to-FEED (drop a flake; the fish dart to it).
     C++ ANALOGY: each fish is a tiny particle whose position is a closed-form function of time
     (a parametric loop), nudged toward the flake while feeding — no physics, just a curve + a lerp.
     ============================================================ */
  // L62 desk pass — was -0.78; the tank's right edge then ran THROUGH the coffee mug (a true AABB
  // intersection: mug x∈[-0.6,-0.5] sat inside the tank footprint). Nudged left to -0.95 so the mug
  // clears the tank by ~4 cm. The tank is one group, so moving this one centre moves the glass, fish,
  // bubbles, glow + (below) its contact shadow + click hotspot together. C++: translate the parent node.
  const TANK_CX = -0.95, TANK_CY = 1.06, TANK_CZ = 1.95;   // tank centre, front-left of the desk
  const TANK_W = 0.62, TANK_H = 0.42, TANK_D = 0.34;
  const tank = new THREE.Group();
  tank.position.set(TANK_CX, TANK_CY, TANK_CZ);

  // gravel base, translucent water volume, and a thin frame at the edges.
  tank.add(box(TANK_W, 0.05, TANK_D, '#3a3026', { y: -TANK_H / 2 + 0.02 }));   // gravel
  const waterVol = new THREE.Mesh(
    new THREE.BoxGeometry(TANK_W - 0.04, TANK_H - 0.08, TANK_D - 0.04),
    new THREE.MeshStandardMaterial({ color: '#1f9fc0', transparent: true, opacity: 0.26, roughness: 0.1,
      emissive: '#0a3a4a', emissiveIntensity: 0.4, depthWrite: false }),
  );
  waterVol.position.y = 0.02;
  tank.add(waterVol);
  // frame: 4 vertical posts (cheap "glass tank" read). A faint hit-box carries the click role.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    tank.add(box(0.03, TANK_H, 0.03, '#20262c', { x: sx * (TANK_W / 2 - 0.015), z: sz * (TANK_D / 2 - 0.015), metal: 0.5 }));
  }
  const tankHit = new THREE.Mesh(new THREE.BoxGeometry(TANK_W, TANK_H, TANK_D), new THREE.MeshBasicMaterial({ visible: false }));
  tankHit.userData.role = 'tank';                         // raycast → feedFish()
  tank.add(tankHit);

  // the night GLOW: a point light inside the tank, brightening after dark (set in update by SunRig).
  const tankLight = new THREE.PointLight('#5fd8ff', 0.0, 3.0, 2.0);
  tank.add(tankLight);

  // FISH — billboard sprites on looping paths. Each has its own amplitude/speed/phase. The sprite
  // is flipped horizontally (scale.x sign) to "face" its travel direction. Local space (inside tank).
  const fishTex = [makeFishTexture('#e8a23c'), makeFishTexture('#d85a6a'), makeFishTexture('#6cc0e0')];
  const fish = [];
  const FAX = TANK_W / 2 - 0.1, FAY = TANK_H / 2 - 0.12, FAZ = TANK_D / 2 - 0.08;   // swim bounds
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: fishTex[i], transparent: true, depthWrite: false }));
    const sz = 0.15 - i * 0.015;
    f.userData = { sz, sp: 0.6 + i * 0.22, ph: i * 2.1, ax: FAX * (0.7 + 0.1 * i), ay: FAY, az: FAZ, prevx: 0 };
    f.scale.set(sz, sz, 1);
    fish.push(f); tank.add(f);
  }

  // BUBBLES — tiny sprites rising from a spot near the gravel, wrapping back down at the top.
  const dotTex = makeDotTexture();
  const bubbles = [];
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: '#cfeffb', transparent: true, opacity: 0.5, depthWrite: false }));
    b.userData = { ph: i / 5, sp: 0.16 + Math.random() * 0.06, x: -0.1 + (i % 3) * 0.07 };
    b.scale.setScalar(0.03 + (i % 2) * 0.015);
    b.raycast = () => {};
    bubbles.push(b); tank.add(b);
  }

  // FLAKE — the food you drop on click. Sinks while feeding; the fish target it.
  const flake = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: '#c8a24a', transparent: true, opacity: 0, depthWrite: false }));
  flake.scale.setScalar(0.04); flake.raycast = () => {};
  tank.add(flake);
  let feed = 0;                                           // feeding timer (seconds remaining)
  function feedFish() { feed = 3.0; flake.position.set(-0.05, FAY, 0); flake.material.opacity = 1; }

  root.add(tank);

  /* ---- DUST MOTES (L23 ambient) — a few faint specks drifting in the lamp's warm beam. Additive,
     low opacity, slow upward swirl; purely atmospheric (they catch the eye when the room is still). */
  const motes = new THREE.Group();
  const MOTE_X = -1.45, MOTE_Y = 1.2, MOTE_Z = 1.6;      // around the lamp (L62: follows the lamp's -0.30 nudge)
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: '#ffd9a0', transparent: true,
      opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.scale.setScalar(0.018);
    m.userData = { ph: i * 0.9, sp: 0.1 + (i % 3) * 0.04, r: 0.1 + (i % 4) * 0.03 };
    m.raycast = () => {};
    motes.add(m);
  }
  motes.position.set(MOTE_X, MOTE_Y, MOTE_Z);
  root.add(motes);

  /* L48a — soft CONTACT SHADOWS (fake ambient occlusion) under the props: the cheapest big realism
     gain (a real shadow map would cost a depth pass every frame on the mobile-sensitive office path).
     Reusable engine-core helper `makeContactShadow` so future interiors inherit it. One floor blob
     under the desk + small blobs under each desktop prop + the cat. */
  const shadows = new THREE.Group();
  const DESK_TOP_Y = 0.925;     // a hair above the polished desktop (top ≈ 0.92)
  shadows.add(makeContactShadow({ w: 4.0, d: 2.0, x: 0, y: 0.045, z: 1.55, opacity: 0.5 }));            // desk on floor (above the rug)
  shadows.add(makeContactShadow({ w: 0.95, d: 0.62, x: 0, y: DESK_TOP_Y, z: 1.42, opacity: 0.42 }));    // laptop
  shadows.add(makeContactShadow({ w: 0.3, d: 0.3, x: -0.55, y: DESK_TOP_Y, z: 1.95, opacity: 0.4 }));   // mug
  shadows.add(makeContactShadow({ w: 0.42, d: 0.46, x: 0.5, y: DESK_TOP_Y, z: 1.9, opacity: 0.35 }));   // papers
  shadows.add(makeContactShadow({ w: 0.42, d: 0.46, x: 1.0, y: DESK_TOP_Y, z: 1.5, opacity: 0.42 }));   // phone
  shadows.add(makeContactShadow({ w: 0.7, d: 0.42, x: TANK_CX, y: DESK_TOP_Y, z: 1.95, opacity: 0.42 })); // fish tank (L62: tracks TANK_CX)
  shadows.add(makeContactShadow({ w: 0.55, d: 0.4, x: 1.32, y: DESK_TOP_Y, z: 1.78, opacity: 0.4 }));   // cat
  shadows.add(makeContactShadow({ w: 0.34, d: 0.34, x: -1.45, y: DESK_TOP_Y, z: 1.6, opacity: 0.35 })); // lamp base (L62: follows the -0.30 nudge)
  root.add(shadows);

  /* L30 — reparent the hideable furniture into props3D (NOT the heart: it's the pet reaction, which we
     want visible over the PAINTED cat too). `.add` reparents, so this just moves them off `root`. */
  [desk, lamp, laptop, phone, cat, tank, motes, shadows].forEach((o) => props3D.add(o));

  /* L30 painted-props click HOTSPOTS — invisible boxes over the PAINTED laptop / phone / cat. Placed at
     the OLD 3D prop positions: the skin is structure-locked to this exact camera, so the painted props
     land where the 3D ones projected → these proxies sit right over them. Raycast-only (never drawn);
     used as the office's interactables when the 3D props are hidden. C++: a collision proxy, no mesh. */
  function hotspot(role, w, h, d, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
    m.position.set(x, y, z); m.userData.role = role;
    hotspots.add(m);
  }
  hotspot('laptop', 0.95, 0.6, 0.7, 0.0, 1.05, 1.40);
  hotspot('phone', 0.5, 0.4, 0.5, 1.0, 0.98, 1.42);
  hotspot('cat', 0.62, 0.74, 0.5, CAT_X, CAT_Y, CAT_Z);
  // L62 desk pass — THE BUG: this 4th hotspot was missing, so under a painted skin (interactables =
  // hotspots.children) the fish tank had NO raycast target → feed-fish was dead in BOTH entry paths
  // (city dive + standalone /office/). In plain 3D mode the live `tankHit` mesh covered it; a painted
  // skin hides that, so the click silently fell through. Sized to the tank, at its (nudged) centre.
  hotspot('tank', TANK_W, TANK_H, 0.5, TANK_CX, TANK_CY, TANK_CZ);

  /* ============================================================
     THE BASEMENT VIGNETTE — a tiny self-contained living scene (its OWN day/night), rendered to a
     texture by main.js and hung on the basement wall as the "dynamic picture". A miniature diorama:
     a sky that cycles, a sun/moon arcing over rolling hills, a tree, and a streetlamp that glows at
     dusk. All UNLIT (Basic materials) so it reads as a stylized little painting. Its clock is its
     OWN (faster than the city's), so the framed picture visibly breathes through a whole day.
     ============================================================ */
  const vignette = createVignette();

  /* ============================================================
     L29 DIFFUSION SKIN — a 2.5D BACKPLATE. Laurence's Draw-Things reinterpret of our office (smooth,
     realistic, richer than the flat-shaded boxes) is a flat image; we hang it on a big quad BEHIND
     everything so the room READS like the painting, while the live 3D props (desk/laptop/cat/tank) +
     the live glass window stay composited IN FRONT. The classic pre-rendered-backdrop trick (Resident
     Evil / FF7): blit a background bitmap, draw the interactive 3D over it. Off by default (the toggle
     /?officeskin selects it) so nothing changes unless asked.
     C++ ANALOGY: a framebuffer blit of a static background, then the sprite/mesh pass on top. ======= */
  // L59: the 4 selectable ControlNet skins. (No bottom-crop like the L29 Draw-Things pair needed — these
  // fresh ComfyUI renders have no baked HUD strip.)
  const skinTex = {
    dressed2: new THREE.TextureLoader().load(skinDressed2Url),
    night2:   new THREE.TextureLoader().load(skinNight2Url),
    modern:   new THREE.TextureLoader().load(skinModernUrl),
    charm:    new THREE.TextureLoader().load(skinCharm2Url),
  };
  const SKIN_KEYS = ['dressed2', 'night2', 'modern', 'charm'];
  for (const k of SKIN_KEYS) { skinTex[k].colorSpace = THREE.SRGBColorSpace; }
  // L59 ⭐ WINDOW-APERTURE MASK — the clash fix. Each skin render PAINTS a city in its windows; behind the
  // live glass that painted city bled around the angled corner panes = two cities ("double backdrops that
  // clash"). The skin must contribute ROOM ONLY. So an alphaMap cuts the backplate's WINDOW region to
  // TRANSPARENT — the painted city is gone; the live engine glass (in front) is the only city, and any sliver
  // the panes don't cover shows the scene's sky-blue background (natural). The window opening is the SAME
  // across all 4 skins (ControlNet-locked to one office geometry), so ONE mask serves them all. The alphaMap
  // rides the SAME UVs as the skin map, so it stays aligned through the per-frame frustum-fit scaling.
  const apertureMask = makeApertureMask();
  const backplate = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: skinTex.dressed2, alphaMap: apertureMask, transparent: true, toneMapped: false }),
  );
  backplate.position.set(0, 1.45, -5.0);            // behind the window (z=-3.7) → live glass draws over it
  backplate.visible = false; backplate.raycast = () => {};
  scene.add(backplate);

  /* L48d — a cinematic VIGNETTE: a reusable engine-core helper (makeVignette) parks a radial-darkening
     quad in front of the camera each frame (update calls .fit), darkening the screen edges so the eye
     settles on the desk/window. Cheap (one transparent quad, no post-pipeline) + reusable across scenes. */
  const vignetteFx = makeVignette({ strength: 0.5 });
  scene.add(vignetteFx);

  let skin = '3d';                                   // '3d' | 'dressed2' | 'night2' | 'modern' | 'charm' (L59)
  let propsMode = 'painted';                         // 'painted' | '3d' — only bites when a skin is on
  /* Show/hide the right shell for the current (tier, skin, props): a skin hides the 3D room SHELL
     (walls / floor / ceiling / frames) but keeps the live GLASS, with the painted backplate behind;
     painted-props additionally hides the 3D FURNITURE so the office is fully the painting. */
  function applyVisibility() {
    const corner = currentTier === 'corner';
    const on = skin !== '3d';
    const painted = on && propsMode === 'painted';   // fully-painted office (3D furniture hidden)
    cornerGroup.visible = corner && !on;
    basementGroup.visible = !corner && !on;
    liveWindow.visible = on || corner;               // live city shows in corner-3d AND under any skin
    backplate.visible = on;
    props3D.visible = !painted;                       // hide the 3D furniture only in painted-props mode
    applyWindowVisibility();                          // L59: re-evaluate glassS backstop now that `skin` changed
  }
  function setSkin(m) {
    skin = SKIN_KEYS.includes(m) ? m : '3d';
    if (skin !== '3d') { backplate.material.map = skinTex[skin]; backplate.material.needsUpdate = true; }
    applyVisibility();
    return skin;
  }
  function setProps(m) { propsMode = (m === '3d') ? '3d' : 'painted'; applyVisibility(); return propsMode; }

  /* ---- update: cat + fish tank + ambient (motes / plant / clock) + a breath of camera sway ---- */
  const flickerBase = lampLight.intensity;
  const screenBase = screen.material.emissiveIntensity;
  const moteCol = new THREE.Color();
  function update(dt, elapsed, sunRig) {
    const night = sunRig ? sunRig.windowGlow : 0;        // ~0 by day, ~1 at night
    // L105 — scale the room HEMISPHERE by SUN HEIGHT (mirror the L100 city midK): cut the flat ambient at NOON so the
    // downlight regains shadow/contrast (the room "misses the cut" — it's a separate scene the city pipeline never touches).
    // At golden/low sun (midK≈0) it stays at the warm base → golden UNTOUCHED. The office renders DIRECTLY (no pixel/toon
    // tier), so this only changes the office's own look — the city's stylized tiers are unaffected. Identity (warm hue) kept.
    const _midK = sunRig ? THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(sunRig.sunArc.y, 0, 1), 0.22, 0.8) : 0;
    hemi.intensity = hemiBase * (1 - 0.60 * _midK);   // L106: scale the per-tier base (set in setFitout) by sun-height
    // CAT state: asleep at night, awake by day; a pet bounce + heart on top.
    const asleep = night > 0.55;
    cat.material.map = asleep ? catSleep : catAwake;
    if (pet > 0) pet = Math.max(0, pet - dt);
    const petK = pet > 0 ? Math.sin((1.3 - pet) / 1.3 * Math.PI) : 0;
    const breathe = asleep ? 0.012 * Math.sin(elapsed * 1.2) : 0.03 * Math.sin(elapsed * 2.4);
    cat.scale.set(CAT_S, CAT_S * (1 + breathe + 0.12 * petK), 1);
    cat.position.y = CAT_Y + 0.06 * petK;
    heart.material.opacity = petK;
    heart.position.set(CAT_X, CAT_Y + 0.5 + 0.5 * (1 - pet / 1.3), CAT_Z);
    heart.scale.setScalar(0.22 + 0.1 * petK);

    // FISH TANK ----------------------------------------------------------------
    if (feed > 0) { feed = Math.max(0, feed - dt); flake.position.y = Math.max(-FAY, flake.position.y - dt * 0.06); flake.material.opacity = feed > 0.3 ? 1 : feed / 0.3; }
    for (const f of fish) {
      const u = f.userData;
      // the looping path (a Lissajous-ish curve inside the tank bounds)…
      const px = Math.sin(elapsed * u.sp + u.ph) * u.ax;
      const py = Math.sin(elapsed * u.sp * 0.8 + u.ph * 1.7) * u.ay * 0.7;
      const pz = Math.cos(elapsed * u.sp * 0.6 + u.ph) * u.az;
      // …toward the flake while feeding, else toward the path point. Ease (a damped follow).
      const tx = feed > 0 ? flake.position.x : px;
      const ty = feed > 0 ? flake.position.y : py;
      const tz = feed > 0 ? flake.position.z : pz;
      const k = feed > 0 ? 0.05 : 0.10;
      f.position.x += (tx - f.position.x) * k;
      f.position.y += (ty - f.position.y) * k;
      f.position.z += (tz - f.position.z) * k;
      f.scale.x = (f.position.x >= u.prevx ? 1 : -1) * u.sz;   // flip to face travel direction
      u.prevx = f.position.x;
    }
    for (const b of bubbles) {
      const yy = ((elapsed * b.userData.sp + b.userData.ph) % 1);     // 0→1 rise, wraps
      b.position.set(b.userData.x + Math.sin(elapsed * 2 + b.userData.ph * 9) * 0.015, -FAY + yy * (2 * FAY), 0.02);
      b.material.opacity = 0.5 * Math.sin(yy * Math.PI);             // fade in low, out near the top
    }
    // night glow: the tank lights the room after dark (and the water emissive lifts).
    tankLight.intensity = 2.6 * night;
    waterVol.material.emissiveIntensity = 0.4 + 0.9 * night;

    // AMBIENT: lamp flicker + laptop-screen breathing + dust motes + plant sway + clock hands.
    lampLight.intensity = flickerBase * (0.97 + 0.03 * Math.sin(elapsed * 7.0) * Math.sin(elapsed * 2.3));
    screen.material.emissiveIntensity = screenBase * (0.85 + 0.15 * Math.sin(elapsed * 3.1 + 1.0));
    phoneTop.material.emissiveIntensity = 0.4 * (0.65 + 0.35 * Math.sin(elapsed * 2.2));   // L42: clickable-affordance pulse
    // dust motes: slow upward swirl in the lamp beam; brighter when the lamp dominates (night).
    moteCol.setRGB(1, 0.85, 0.62);
    motes.children.forEach((m, i) => {
      const u = m.userData;
      const yy = ((elapsed * u.sp + u.ph) % 1);
      m.position.set(Math.cos(elapsed * 0.5 + u.ph * 5) * u.r, -0.15 + yy * 0.45, Math.sin(elapsed * 0.4 + u.ph * 5) * u.r);
      m.material.opacity = (0.10 + 0.18 * night) * Math.sin(yy * Math.PI);
    });
    // L48e mug steam: a slow rise + fade loop, with a faint drift (subtle, reads in the warm room).
    const sT = (elapsed * 0.4) % 1;
    steam.position.y = 1.04 + sT * 0.22;
    steam.position.x = -0.55 + Math.sin(elapsed * 1.5) * 0.02;
    steam.material.opacity = 0.26 * Math.sin(sT * Math.PI);
    steam.scale.set(0.1 + sT * 0.08, 0.16 + sT * 0.12, 1);

    // plant sway (basement) — a gentle breeze on the leaves.
    leaves.rotation.z = Math.sin(elapsed * 0.8) * 0.05;
    leaves.rotation.x = Math.sin(elapsed * 0.6 + 1.0) * 0.04;
    // wall clock hands sweep once per SunRig day (t: 0..1). 12 o'clock at midnight.
    const t = sunRig ? sunRig.t % 1 : 0;
    for (const hand of clockHands) hand.rotation.z = -t * Math.PI * 2;

    // the basement picture's little world advances on its OWN clock.
    vignette.update(dt);

    // L29 SKIN backplate: size it to overfill the camera frustum (fov + aspect, both live so it
    // survives a resize), and tint it by day/night so the painted room dims after dark with everything
    // else (MeshBasic colour multiplies the map).
    if (backplate.visible) {
      const d = camera.position.z - backplate.position.z;
      const h = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5) * d * 1.18;
      backplate.scale.set(h * camera.aspect, h, 1);
      const b = 0.55 + 0.45 * (1 - night);
      backplate.material.color.setRGB(b, b * 0.97, b * 0.92);
    }

    // idle parallax sway — a few millimetres, so the staged shot isn't frozen.
    camera.position.set(camBase.x + Math.sin(elapsed * 0.5) * 0.04, camBase.y + Math.sin(elapsed * 0.7) * 0.02, camBase.z);
    camera.lookAt(BASE_TARGET);                          // base orientation (looking at the windows)
    // L51 SEATED FREE-LOOK: ease the head-turn, then compose it as a LOCAL yaw/pitch on top of the base.
    look.update(dt);
    _eLook.set(look.pitch, look.yaw, 0, 'YXZ');
    camera.quaternion.multiply(_qLook.setFromEuler(_eLook));
    vignetteFx.fit(camera);                              // L48d: keep the edge vignette covering the frame
  }

  /* The corner glass takes the live city RTT(s) — main.js renders each pane's own directional view (L49).
     Two args = the TRUE-CORNER pair (left/right pane cameras). One arg = both panes share it (the
     STRAIGHT-ON / single-render fallback). */
  function setCityTexture(texL, texR = texL) {
    glassMatL.map = texL; glassMatR.map = texR;
    glassMatL.needsUpdate = true; glassMatR.needsUpdate = true;
  }
  /* The straight-on flat window's RTT (L49b — a single flat camera in main.js). */
  function setStraightCityTexture(tex) { glassMatS.map = tex; glassMatS.needsUpdate = true; }

  /* L49b — LAYOUT toggle: 'corner' (true-corner wrap, default) | 'straight-on' (one flat window wall).
     Toggles which glass + frames are visible; main.js renders only the active layout's camera(s). */
  let layout = 'corner';
  function applyWindowVisibility() {
    const corner = layout === 'corner';
    glassL.visible = glassR.visible = corner;
    // L59: glassS shows as the flat window in straight-on — AND as a LIVE-CITY BACKSTOP behind the corner
    // panes whenever a skin is on, so the masked-out backplate aperture is filled with the LIVE city (not
    // sky-blue gaps) and the painted city can never show. (No skin in corner → no backstop needed.)
    glassS.visible = !corner || (skin !== '3d');
    cornerFrames.visible = corner;
    straightGroup.visible = !corner;
  }
  function setLayout(l) {
    layout = (l === 'straight-on') ? 'straight-on' : 'corner';
    applyWindowVisibility();
    return layout;
  }
  /* The basement picture takes the vignette RTT (set by main.js, same machinery as the glass). */
  function setVignetteTexture(tex) { picMat.map = tex; picMat.needsUpdate = true; }

  /* FITOUT SWAP — toggle which shell is visible + retune the lights for the tier. Instant (both
     shells already built). C++: choosing which prop-set "level" is active by enum. */
  let currentTier = tier;
  function setFitout(t) {
    currentTier = (t === 'basement') ? 'basement' : 'corner';
    const corner = currentTier === 'corner';
    applyVisibility();                               // L29: honour the active skin when toggling tier
    // basement is cozier: dimmer downlight, warmer/stronger hemisphere fill (the bulb does the rest).
    downlight.intensity = corner ? 9.0 : 3.2;
    hemi.intensity = hemiBase = corner ? 0.78 : 0.82;   // L45 warmer corner fill; L106: hemiBase = the base update() scales by sun-height
    hemi.color.set(corner ? '#6a5238' : '#7a5a34');
    return currentTier;
  }
  setFitout(currentTier);
  setLayout(layout0);            // L50: apply the boot layout (straight-on is the hero default)

  return {
    scene, camera, update, setCityTexture, setStraightCityTexture, setVignetteTexture, setFitout, setSkin, setProps, setLayout, petCat, feedFish,
    look,                                     // L51: seated free-look (main.js feeds drag/keys: look.addDrag/addKeys/recenter)
    vignette,                                 // { scene, camera } — main.js renders this to a texture
    // L30: raycast targets — the invisible HOTSPOTS when the office is fully painted (3D props hidden),
    // else the real 3D props. A getter so a pick always tests the set that's actually on screen.
    get interactables() { return (skin !== '3d' && propsMode === 'painted') ? hotspots.children : [laptop, phone, cat, tankHit]; },
    get tier() { return currentTier; },
    get skin() { return skin; },              // L29: '3d' | 'smooth' | 'charm'
    get props() { return propsMode; },        // L30: 'painted' | '3d'
    get layout() { return layout; },          // L49b: 'corner' | 'straight-on'
  };
}

/* ============================================================
   The basement VIGNETTE scene factory — a tiny living landscape with its own day/night.
   Returns { scene, camera, update } so main.js renders it into a small target each frame.
   All Basic (unlit) materials: the framed picture should read as a glowing little painting.
   ============================================================ */
function createVignette() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#7fb0dd');
  // an orthographic lens framing a ~16:10 slice (matches the 1.9×1.2 picture plane).
  const camera = new THREE.OrthographicCamera(-1.4, 1.4, 0.9, -0.9, 0, 10);
  camera.position.set(0, 0, 5);

  const flat = (color, opts = {}) => new THREE.MeshBasicMaterial({ color, toneMapped: false, ...opts });
  const quad = (w, h, x, y, z, color, opts) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), flat(color, opts)); m.position.set(x, y, z); return m; };

  // rolling hills (two silhouettes, far→near) anchored to the bottom.
  scene.add(quad(3.2, 0.9, 0.5, -0.95, 1, '#2a4a30'));
  scene.add(quad(3.2, 0.7, -0.7, -1.05, 2, '#1d3724'));
  // a little tree (trunk + a round canopy) on the near hill.
  scene.add(quad(0.06, 0.3, -0.95, -0.55, 3, '#3a2a1a'));
  const canopy = new THREE.Mesh(new THREE.CircleGeometry(0.22, 18), flat('#234a2a'));
  canopy.position.set(-0.95, -0.32, 3); scene.add(canopy);
  // a streetlamp (post + a glow that comes on at dusk).
  scene.add(quad(0.04, 0.55, 0.9, -0.55, 3, '#20242a'));
  const lampGlow = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), flat('#ffd98a', { transparent: true, opacity: 0 }));
  lampGlow.position.set(0.9, -0.26, 3.1); scene.add(lampGlow);

  // the sun/moon disc (recoloured by phase) arcing across the sky.
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.16, 24), flat('#fff4d8'));
  scene.add(disc);
  // a sprinkle of stars (fade in at night).
  const stars = [];
  const starXY = [[-1.0, 0.5], [-0.6, 0.7], [0.2, 0.6], [0.7, 0.72], [1.05, 0.45], [-0.2, 0.78], [0.45, 0.4]];
  for (const [sx, sy] of starXY) {
    const s = new THREE.Mesh(new THREE.CircleGeometry(0.015, 8), flat('#ffffff', { transparent: true, opacity: 0 }));
    s.position.set(sx, sy, 0.5); stars.push(s); scene.add(s);
  }

  // colour scratch (no per-frame alloc) + the day/night keys.
  const NIGHT_SKY = new THREE.Color('#141d33'), DAY_SKY = new THREE.Color('#7fb6e0'), HORIZON = new THREE.Color('#d6824a');
  const SUN_WARM = new THREE.Color('#fff0cc'), MOON = new THREE.Color('#cdd8ef');
  let vigT = 0.34;                                  // start mid-morning so the boot frame is lit
  function update(dt) {
    vigT = (vigT + dt * 0.04) % 1;                  // OWN day — a full cycle every ~25s (visibly alive)
    const ang = vigT * Math.PI * 2;
    const up = -Math.cos(ang);                      // -1 at midnight … +1 at noon (height of the body)
    disc.position.set(Math.sin(ang) * 1.15, up * 0.66 + 0.06, 0);
    const dayK = THREE.MathUtils.smoothstep(up, -0.18, 0.5);          // 0 night … 1 day
    const horizonK = THREE.MathUtils.smoothstep(0.32, 0.0, Math.abs(up));  // warm glow near sunrise/sunset
    scene.background.copy(NIGHT_SKY).lerp(DAY_SKY, dayK).lerp(HORIZON, horizonK * 0.45);
    disc.material.color.copy(up > 0 ? SUN_WARM : MOON);
    lampGlow.material.opacity = 1 - dayK;
    const starA = (1 - dayK) * 0.85;
    for (const s of stars) s.material.opacity = starA;
  }
  return { scene, camera, update };
}

/* a wall clock: a face disc + a rim + a single hand pivoting at the centre. The hand mesh is pushed
   onto `hands` so the office update can sweep it by the SunRig time. `ry` aims it off a side wall. */
function makeClock(hands, { x, y, z, ry = 0, face = '#efe2c8', rim = '#2a1c10' }) {
  const g = new THREE.Group();
  const rimMesh = new THREE.Mesh(new THREE.CircleGeometry(0.2, 28), new THREE.MeshStandardMaterial({ color: rim, roughness: 0.6 }));
  const faceMesh = new THREE.Mesh(new THREE.CircleGeometry(0.17, 28), new THREE.MeshStandardMaterial({ color: face, roughness: 0.7 }));
  faceMesh.position.z = 0.01;
  // a hand: a thin bar pivoting at the centre (geometry pushed up so it rotates about one end).
  const hand = new THREE.Mesh(new THREE.PlaneGeometry(0.018, 0.14), new THREE.MeshStandardMaterial({ color: '#1a130c', roughness: 0.5 }));
  hand.geometry.translate(0, 0.05, 0);
  hand.position.z = 0.02;
  hands.push(hand);
  g.add(rimMesh, faceMesh, hand);
  g.position.set(x, y, z); g.rotation.y = ry;
  return g;
}

/* a charming little cat, drawn with canvas shapes (a billboard sprite). `sleep` = the curled night
   pose; otherwise an upright sitting cat. Orange tabby. */
function makeCatTexture(sleep) {
  const S = 128; const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const O = '#e08a3c', Od = '#b96a26', belly = '#f3c98a', dk = '#3a2410';
  x.lineJoin = 'round';
  if (sleep) {
    x.fillStyle = O; x.beginPath(); x.ellipse(64, 78, 44, 26, 0, 0, 7); x.fill();
    x.fillStyle = Od; x.beginPath(); x.ellipse(64, 86, 44, 16, 0, 0, 7); x.fill();
    x.fillStyle = O; x.beginPath(); x.arc(36, 70, 20, 0, 7); x.fill();
    x.fillStyle = O; tri(x, 24, 56, 34, 44, 42, 58); tri(x, 40, 54, 50, 44, 54, 60);
    x.strokeStyle = Od; x.lineWidth = 7; x.lineCap = 'round';
    x.beginPath(); x.moveTo(100, 70); x.quadraticCurveTo(112, 90, 88, 96); x.stroke();
    x.strokeStyle = dk; x.lineWidth = 2.5;
    x.beginPath(); x.arc(30, 70, 5, 0.1, Math.PI - 0.1); x.stroke();
    x.strokeStyle = Od; x.lineWidth = 3;
    for (const sx of [60, 74, 88]) { x.beginPath(); x.moveTo(sx, 58); x.lineTo(sx, 70); x.stroke(); }
  } else {
    x.fillStyle = O; x.beginPath(); x.ellipse(64, 86, 30, 34, 0, 0, 7); x.fill();
    x.fillStyle = belly; x.beginPath(); x.ellipse(64, 92, 14, 22, 0, 0, 7); x.fill();
    x.strokeStyle = Od; x.lineWidth = 8; x.lineCap = 'round';
    x.beginPath(); x.moveTo(92, 100); x.quadraticCurveTo(116, 86, 104, 60); x.stroke();
    x.fillStyle = O; x.beginPath(); x.arc(64, 48, 24, 0, 7); x.fill();
    x.fillStyle = O; tri(x, 44, 34, 50, 18, 60, 34); tri(x, 84, 34, 78, 18, 68, 34);
    x.fillStyle = '#f0b0c0'; tri(x, 47, 30, 50, 22, 56, 32); tri(x, 81, 30, 78, 22, 72, 32);
    x.fillStyle = dk; x.beginPath(); x.arc(55, 47, 3.4, 0, 7); x.arc(73, 47, 3.4, 0, 7); x.fill();
    x.fillStyle = '#e06a7a'; tri(x, 61, 54, 67, 54, 64, 58);
    x.strokeStyle = dk; x.lineWidth = 1.6;
    for (const dy of [-2, 3]) { x.beginPath(); x.moveTo(50, 55 + dy); x.lineTo(34, 53 + dy); x.moveTo(78, 55 + dy); x.lineTo(94, 53 + dy); x.stroke(); }
    x.strokeStyle = Od; x.lineWidth = 3;
    for (const sy of [78, 90, 102]) { x.beginPath(); x.moveTo(50, sy); x.lineTo(78, sy); x.stroke(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function tri(x, ax, ay, bx, by, cx, cy) { x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.lineTo(cx, cy); x.closePath(); x.fill(); }

/* a little pink heart that pops over the cat when you pet it. */
function makeHeartTexture() {
  const S = 64; const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'); x.fillStyle = '#ff5a8a';
  x.beginPath(); x.moveTo(32, 52);
  x.bezierCurveTo(6, 32, 14, 10, 32, 24); x.bezierCurveTo(50, 10, 58, 32, 32, 52); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* a simple side-on fish (body + tail + eye), drawn facing RIGHT (+x). The sprite is flipped by the
   tank update to face its travel direction. `col` tints the body. */
function makeFishTexture(col) {
  const S = 64; const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = col;
  x.beginPath(); x.ellipse(30, 32, 18, 11, 0, 0, 7); x.fill();          // body
  x.beginPath(); x.moveTo(46, 32); x.lineTo(60, 22); x.lineTo(60, 42); x.closePath(); x.fill();   // tail
  x.fillStyle = 'rgba(255,255,255,0.35)';                               // belly sheen
  x.beginPath(); x.ellipse(28, 36, 12, 5, 0, 0, 7); x.fill();
  x.fillStyle = '#15212a'; x.beginPath(); x.arc(20, 30, 2.6, 0, 7); x.fill();   // eye
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* a soft round dot (radial alpha) — reused for bubbles, the fish flake, and dust motes. */
function makeDotTexture() {
  const S = 32; const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.6, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.beginPath(); x.arc(16, 16, 16, 0, 7); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* a warm abstract canvas for the framed wall art (corner office side walls). Two variants by side. */
function makeArtTexture(side) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 256, 256);
  if (side < 0) { g.addColorStop(0, '#6a3b1c'); g.addColorStop(1, '#caa15a'); }
  else { g.addColorStop(0, '#3a4a6a'); g.addColorStop(1, '#a86a3a'); }
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  x.globalAlpha = 0.5;
  for (let i = 0; i < 5; i++) { x.fillStyle = i % 2 ? '#2a1c10' : '#e0c080'; x.fillRect(30 + i * 36, 40 + (i % 3) * 30, 26, 150); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
