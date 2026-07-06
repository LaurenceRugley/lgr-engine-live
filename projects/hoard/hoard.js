/* ============================================================
   hoard/hoard.js — Lessons 32→33: THE HOARD v1 — the playable game layer.
   ------------------------------------------------------------
   "The Hoard" is Laurence's zombie wave-survival game, recreated ON the lab engine. The engine gives
   us the world for free (iso render + seeded city ARENA + SunRig day/night + the agent idea for the
   horde); this module is the GAME.
     • Phase 1 (L32): a scene mode + an 8-dir survivor + a horde that seeks the player.
     • Phase 2 (L33, here): COMBAT (melee + a ranged gun), zombies with HP that DIE, the player takes
       contact damage, a WAVE DIRECTOR (3 zombie types scaling with wave + night), score, and
       death → restart. The playable loop.

   GAME-LAYER IDEAS, EACH ITS OWN C++ ANCHOR:
   - PLAYER CONTROLLER (L32): read input → integrate velocity → clamp to ground. `pos += vel*dt`.
   - STEERING / SEEK (L32): each zombie accelerates toward the player (boids-lite).
   - HITSCAN (L33): firing = a ray from the player along the aim; the first zombie within a thin
     angular tolerance + range takes damage instantly (a tracer draws the shot). C++: a ray query
     returning the nearest hit.
   - WAVE DIRECTOR (L33): a small state machine — spawning → fighting → wave-complete → next — with a
     data-driven enemy table so L34/L35 extend it (more types / weapons) without a rewrite.

   The horde is ONE InstancedMesh (one draw call), per-instance colour + size by type. The occlusion
   fade that keeps the survivor visible behind towers lives in main.js (it owns the city + camera).
   ============================================================ */
import { THREE, vectorize } from '@lgr/engine-core';

const GAME_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', ' ']);

/* ENEMY TABLE (the data-driven seam) — Walker common/tanky-slow, Runner fast-fragile, Tank rare/beefy.
   hp/speed scale up with the wave and at night; `p` is the spawn probability weight. */
const ZTYPE = {
  walker: { p: 0.60, hp: 26, speed: 0.85, dmg: 9, score: 10, size: 1.0, color: '#6f8a45' },
  runner: { p: 0.25, hp: 12, speed: 1.75, dmg: 7, score: 16, size: 0.82, color: '#a6d24c' },
  tank:   { p: 0.15, hp: 95, speed: 0.5, dmg: 20, score: 34, size: 1.5, color: '#39492a' },
};
function rollType() {
  const r = Math.random();
  return r < ZTYPE.walker.p ? 'walker' : r < ZTYPE.walker.p + ZTYPE.runner.p ? 'runner' : 'tank';
}
const WHITE = new THREE.Color('#ffffff');
const RED = new THREE.Color('#d83a2a');

/* L35 ITEMS (data-driven) — what a slot can hold. `consumable` items are used from the bag; scrap is
   crafting-only. Effects live in useItem() (a switch) so they can touch player/barrier state. */
const ITEMS = {
  food:      { name: 'Food', glyph: '🍖', color: '#c8782e', consumable: true },
  water:     { name: 'Water', glyph: '💧', color: '#3aa6dc', consumable: true },
  bandage:   { name: 'Bandage', glyph: '➕', color: '#e8e2d6', consumable: true },
  scrap:     { name: 'Scrap', glyph: '⚙️', color: '#8a8f96', consumable: false },
  medkit:    { name: 'Medkit', glyph: '✚', color: '#e0524a', consumable: true },
  repairkit: { name: 'Repair Kit', glyph: '🔧', color: '#caa05a', consumable: true },
};
const RECIPES = [
  { out: 'medkit', need: { bandage: 2 } },            // 2 bandages → a big-heal medkit
  { out: 'repairkit', need: { scrap: 3 } },           // 3 scrap → fully repair a barrier
];
const PICKUP_KINDS = ['food', 'water', 'bandage', 'scrap'];   // what drops/scatters in the world

export function createHoard({ extent = 8, plinthTop = 0.3 } = {}) {
  const group = new THREE.Group();
  group.visible = false;
  group.raycast = () => {};
  const GROUND_Y = plinthTop + 0.02;
  const ARENA = Math.max(3, extent - 0.7);
  const coarse = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  /* ---- L34 TUNING (data-driven, for balance + L35). Characters are scaled UP and the arena centre is
     opened into a base PLAZA (main.js hides the downtown towers there) so it reads as a character-scale
     zombie game, not a city flythrough. ---- */
  const PLAYER_SCALE = 1.6, ZSCALE = 1.25;
  // survival meters — slow drain over minutes; empty → chip damage + no regen; well-fed/hydrated → regen.
  const HUNGER_DRAIN = 0.9, THIRST_DRAIN = 1.15, STARVE_DMG = 3.5, FED_REGEN = 2.0, FED_LEVEL = 55, RESTORE = 38;
  // a ring of defendable BARRIERS around the base: zombies pile up + attack them; a broken one opens a gap.
  const BARRIER_R = 4.4, N_BARRIERS = 8, BARRIER_HP = 150, BARRIER_ATTACK = 15, REPAIR_RATE = 30, REPAIR_RANGE = 1.4, ATTACK_STOP = 0.5;

  /* ---- PLAYER (body + head + facing nub) ---- */
  const player = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.34, 4, 10),
    vectorize(new THREE.MeshStandardMaterial({ color: '#3f7fd0', roughness: 0.6, flatShading: true }), { color: '#3f7fd0' }));
  body.position.y = 0.33;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 9),
    vectorize(new THREE.MeshStandardMaterial({ color: '#e9caa1', roughness: 0.75, flatShading: true }), { color: '#e9caa1' }));
  head.position.y = 0.66;
  const nub = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.16),
    vectorize(new THREE.MeshStandardMaterial({ color: '#ffd54a', roughness: 0.5, flatShading: true }), { color: '#ffd54a' }));
  nub.position.set(0, 0.38, 0.18);
  player.add(body, head, nub);
  player.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } o.raycast = () => {}; });
  player.scale.setScalar(PLAYER_SCALE);
  player.position.y = GROUND_Y;
  group.add(player);

  // a melee SWING arc (a flat wedge that flashes in front on a melee), reused.
  const swing = new THREE.Mesh(new THREE.CircleGeometry(0.95, 16, -0.9, 1.8),
    new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  swing.rotation.x = -Math.PI / 2; swing.position.y = GROUND_Y + 0.06; swing.raycast = () => {};
  group.add(swing);
  // a gun TRACER (a 2-point line) flashed on each shot.
  const tracerGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const tracer = new THREE.Line(tracerGeo, new THREE.LineBasicMaterial({ color: '#fff3c0', transparent: true, opacity: 0, depthWrite: false }));
  tracer.raycast = () => {}; group.add(tracer);

  // player state (+ L34 survival meters)
  const P = { x: 0, z: 0, vx: 0, vz: 0, hp: 100, stamina: 100, hunger: 100, thirst: 100, facing: 0, iframe: 0 };
  const WALK = 3.0, SPRINT = 5.2, ACCEL = 14, STAM_DRAIN = 34, STAM_REGEN = 22;
  const GUN_DMG = 16, GUN_RANGE = 9, GUN_CD = 0.16, GUN_TOL = 0.7;     // hitscan
  const MELEE_DMG = 34, MELEE_RANGE = 1.05, MELEE_CD = 0.42;
  const CONTACT_R = 0.52, IFRAME = 0.6;

  /* ---- HORDE — one InstancedMesh, per-instance colour (by type) + size; CPU-stepped. ---- */
  const MAXZ = 48;
  const zombies = new THREE.InstancedMesh(
    new THREE.CapsuleGeometry(0.15, 0.3, 4, 8),
    vectorize(new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true })),   // colour set per-instance
    MAXZ,
  );
  zombies.castShadow = true; zombies.receiveShadow = false;
  zombies.frustumCulled = false; zombies.raycast = () => {};
  zombies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(zombies);
  const zs = [];
  for (let i = 0; i < MAXZ; i++) zs.push({ x: 0, z: 0, vx: 0, vz: 0, alive: false, in: false, type: 'walker', hp: 1, maxhp: 1, speed: 1, dmg: 0, score: 0, size: 1, phase: 0, flash: 0 });
  const _col = new THREE.Color();

  /* ---- L34 BARRIERS — a ring of fence segments around the base. Each is a wall mesh with HP; zombies
     pile up and attack the nearest segment, and a broken one (hp 0) flattens into a GAP they pour through.
     Standing near a damaged segment slowly REPAIRS it. Functionally a closed palisade (nearest-segment
     by angle), so the 8 wide segments read as enclosing the base. ---- */
  const barriers = [];
  const barrierMat = vectorize(new THREE.MeshStandardMaterial({ color: '#7a5a36', roughness: 0.9, flatShading: true }), { color: '#7a5a36' });
  for (let i = 0; i < N_BARRIERS; i++) {
    const ang = (i / N_BARRIERS) * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.7, 0.24), barrierMat.clone());
    m.position.set(Math.cos(ang) * BARRIER_R, GROUND_Y + 0.35, Math.sin(ang) * BARRIER_R);
    m.rotation.y = -ang + Math.PI / 2;               // tangent to the ring
    m.castShadow = true; m.raycast = () => {};
    group.add(m);
    barriers.push({ mesh: m, ang, hp: BARRIER_HP, alive: true, baseColor: new THREE.Color('#7a5a36') });
  }
  function nearestBarrier(x, z) {
    let a = Math.atan2(z, x); if (a < 0) a += Math.PI * 2;
    return barriers[Math.round(a / (Math.PI * 2 / N_BARRIERS)) % N_BARRIERS];
  }

  /* ---- L34 PICKUPS — food + water on the ground (scattered at start + dropped from kills). Walk over →
     restore the matching meter. A small pooled set of meshes. ---- */
  const NPICK = 14;
  const pickups = [];
  for (let i = 0; i < NPICK; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26),
      vectorize(new THREE.MeshStandardMaterial({ roughness: 0.6, flatShading: true })));
    m.castShadow = true; m.visible = false; m.raycast = () => {};
    group.add(m);
    pickups.push({ mesh: m, x: 0, z: 0, kind: 'food', active: false });
  }
  const _pcol = new THREE.Color();
  function dropKind() { const r = Math.random(); return r < 0.36 ? 'food' : r < 0.72 ? 'water' : r < 0.88 ? 'bandage' : 'scrap'; }
  function spawnPickup(x, z, kind) {
    const p = pickups.find((q) => !q.active); if (!p) return;
    p.x = x; p.z = z; p.kind = kind || dropKind(); p.active = true;
    p.mesh.position.set(x, GROUND_Y + 0.18, z); p.mesh.visible = true;
    p.mesh.material.color.copy(_pcol.set(ITEMS[p.kind].color));
  }

  /* ---- L35 INVENTORY + CRAFTING — pickups now go INTO a slot bag instead of auto-consuming; you USE
     items from a slot, and CRAFT a couple of recipes. C++ anchors: a fixed-cap slot array (add/remove/
     use); a recipe = an inputs→output check over slot counts (a pure function); item-use = a switch. */
  const INV_SLOTS = 8;
  const inv = [];                                     // [{ id, n }]
  function invCount(id) { const s = inv.find((x) => x.id === id); return s ? s.n : 0; }
  function addItem(id, n = 1) {
    const s = inv.find((x) => x.id === id);
    if (s) { s.n += n; return true; }
    if (inv.length < INV_SLOTS) { inv.push({ id, n }); return true; }
    return false;                                     // bag full → leave the pickup in the world
  }
  function removeItem(id, n) { const s = inv.find((x) => x.id === id); if (!s || s.n < n) return false; s.n -= n; if (s.n <= 0) inv.splice(inv.indexOf(s), 1); return true; }
  function useItem(id) {
    if (invCount(id) <= 0) return false;
    if (id === 'food') P.hunger = Math.min(100, P.hunger + 38);
    else if (id === 'water') P.thirst = Math.min(100, P.thirst + 38);
    else if (id === 'bandage') P.hp = Math.min(100, P.hp + 40);
    else if (id === 'medkit') P.hp = Math.min(100, P.hp + 90);
    else if (id === 'repairkit') { let w = null; for (const b of barriers) if (!w || b.hp < w.hp) w = b; if (w) { w.hp = BARRIER_HP; w.alive = true; } }
    else return false;                               // scrap: crafting only
    removeItem(id, 1); refreshBag(); return true;
  }
  function craft(rec) {
    for (const k in rec.need) if (invCount(k) < rec.need[k]) return false;
    for (const k in rec.need) removeItem(k, rec.need[k]);
    addItem(rec.out, 1); refreshBag(); return true;
  }

  // game state
  let active = false, dead = false;
  let wave = 1, kills = 0, score = 0, runTime = 0;
  let waveState = 'spawning', waveTimer = 0, toSpawn = 0;
  let fireCd = 0, meleeCd = 0, firing = false;
  let aim = null;                                     // {x,z} desktop cursor aim; null → auto-nearest

  function freeSlot() { for (let i = 0; i < MAXZ; i++) if (!zs[i].alive) return zs[i]; return null; }
  function spawnOne(night) {
    const z = freeSlot(); if (!z) return;
    const t = ZTYPE[rollType()]; z.type = Object.keys(ZTYPE).find((k) => ZTYPE[k] === t) || 'walker';
    const a = Math.random() * Math.PI * 2;
    z.x = Math.cos(a) * ARENA; z.z = Math.sin(a) * ARENA; z.vx = 0; z.vz = 0;
    const waveScale = 1 + wave * 0.08;
    z.maxhp = t.hp * waveScale; z.hp = z.maxhp;
    z.speed = t.speed * (1 + 0.4 * night) * (1 + wave * 0.015) * (wave === 1 ? 0.85 : 1);   // L35: slower wave-1 grace
    z.dmg = t.dmg; z.score = t.score; z.size = t.size; z.phase = Math.random() * 6.28; z.flash = 0; z.in = false; z.alive = true;
  }

  function nearestZombie() {
    let best = null, bd = Infinity;
    for (const z of zs) { if (!z.alive) continue; const d = (z.x - P.x) ** 2 + (z.z - P.z) ** 2; if (d < bd) { bd = d; best = z; } }
    return best;
  }
  function killZombie(z) { z.alive = false; kills++; score += z.score; if (Math.random() < 0.3) spawnPickup(z.x, z.z); }   // L34/35: chance to drop an item
  function damageZombie(z, dmg) { z.hp -= dmg; z.flash = 0.12; if (z.hp <= 0) killZombie(z); }

  function fire() {
    if (dead || fireCd > 0) return;
    fireCd = GUN_CD;
    let ax, az;
    if (aim) { ax = aim.x - P.x; az = aim.z - P.z; }
    else { const n = nearestZombie(); if (n) { ax = n.x - P.x; az = n.z - P.z; } else { ax = Math.sin(P.facing); az = Math.cos(P.facing); } }
    const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
    P.facing = Math.atan2(ax, az);
    // hitscan: the nearest live zombie within range + a thin angular corridor of the aim ray.
    let best = null, bestT = Infinity;
    for (const z of zs) {
      if (!z.alive) continue;
      const dx = z.x - P.x, dz = z.z - P.z; const t = dx * ax + dz * az;
      if (t < 0 || t > GUN_RANGE) continue;
      const perp = Math.abs(dx * az - dz * ax);
      if (perp < GUN_TOL * (0.4 + 0.6 * z.size) && t < bestT) { bestT = t; best = z; }
    }
    const endT = best ? bestT : GUN_RANGE;
    // L40: write the tracer's two endpoints straight into the existing position attribute — no per-shot
    // `new Vector3()` x2 + no `setFromPoints` array realloc (the gun fires fast; don't churn the GC).
    const tp = tracerGeo.attributes.position;
    tp.setXYZ(0, P.x, GROUND_Y + 0.5, P.z);
    tp.setXYZ(1, P.x + ax * endT, GROUND_Y + 0.5, P.z + az * endT);
    tp.needsUpdate = true; tracer.material.opacity = 0.95;
    if (best) damageZombie(best, GUN_DMG);
  }
  function melee() {
    if (dead || meleeCd > 0) return;
    meleeCd = MELEE_CD; swing.material.opacity = 0.85;
    const fx = Math.sin(P.facing), fz = Math.cos(P.facing);
    for (const z of zs) {
      if (!z.alive) continue;
      const dx = z.x - P.x, dz = z.z - P.z; const d = Math.hypot(dx, dz);
      if (d > MELEE_RANGE + z.size * 0.2) continue;
      if ((dx * fx + dz * fz) / (d || 1) > 0.2) damageZombie(z, MELEE_DMG);
    }
  }

  /* ---- INPUT (movement keys + space-melee; the touch sticks/buttons below) ---- */
  const keys = {};
  const stick = { x: 0, y: 0 };
  function onKey(e, down) {
    if (!active) return;
    const k = e.key.toLowerCase();
    if (down && k === 'i') { e.stopImmediatePropagation(); toggleBag(); return; }       // L35: open/close the bag
    if (down && k === 'escape' && paused) { e.stopImmediatePropagation(); closeBag(); return; }  // bag closes before exiting Hoard
    if (!GAME_KEYS.has(k)) return;
    e.stopImmediatePropagation();
    if (k.startsWith('arrow')) e.preventDefault();
    if (k === ' ') { if (down) melee(); return; }     // space = melee (edge-triggered)
    keys[k] = down;
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => onKey(e, true));
    window.addEventListener('keyup', (e) => onKey(e, false));
  }

  /* ---- DOM: thumbstick + FIRE/MELEE buttons (mobile) + HUD + wave banner + death screen ---- */
  let thumb = null, knob = null, hud = null, hpFill = null, stamFill = null, hungerFill = null, thirstFill = null, statEl = null, banner = null, deathEl = null, fireBtn = null, meleeBtn = null, bagBtn = null, bagEl = null;
  let paused = false;                                 // L35: true while the inventory/craft panel is open
  if (typeof document !== 'undefined') {
    const css = document.createElement('style');
    css.textContent = `
      .hoard-stick{position:fixed;left:22px;bottom:22px;width:124px;height:124px;border-radius:50%;
        background:rgba(16,18,24,0.5);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
        border:1px solid rgba(255,255,255,0.18);z-index:4;display:none;touch-action:none;pointer-events:auto;}
      .hoard-stick .knob{position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;
        border-radius:50%;background:rgba(120,160,220,0.85);box-shadow:0 3px 12px rgba(0,0,0,0.4);}
      .hoard-btn{position:fixed;z-index:4;display:none;width:84px;height:84px;border-radius:50%;border:0;
        color:#fff;font:800 13px/1 ui-monospace,monospace;letter-spacing:.08em;pointer-events:auto;
        box-shadow:0 4px 16px rgba(0,0,0,0.4);touch-action:none;transition:transform .07s ease,filter .07s;}
      .hoard-btn:active{transform:scale(0.9);filter:brightness(1.35);}
      @media (prefers-reduced-motion: reduce){.hoard-btn{transition:filter .07s;}.hoard-btn:active{transform:none;}}
      .hoard-fire{right:24px;bottom:96px;background:rgba(210,70,60,0.9);}
      .hoard-melee{right:118px;bottom:30px;background:rgba(70,110,170,0.9);width:70px;height:70px;font-size:12px;}
      .hoard-hud{position:fixed;left:16px;top:14px;z-index:4;font:700 10px/1.1 ui-monospace,monospace;
        letter-spacing:.1em;color:#e7ecf4;display:none;pointer-events:none;text-shadow:0 1px 2px #000;}
      .hoard-hud .bar{width:140px;height:8px;border-radius:5px;background:rgba(255,255,255,0.16);margin:3px 0 7px;overflow:hidden;}
      .hoard-hud .bar i{display:block;height:100%;border-radius:5px;transition:width .08s;}
      .hoard-hud .stat{opacity:.92;font-size:11px;letter-spacing:.14em;}
      .hoard-banner{position:fixed;left:50%;top:34%;transform:translateX(-50%);z-index:5;display:none;
        padding:10px 20px;border-radius:12px;background:rgba(16,18,24,0.8);color:#ffe08a;
        font:800 18px/1 ui-monospace,monospace;letter-spacing:.18em;text-shadow:0 2px 6px #000;pointer-events:none;}
      .hoard-death{position:fixed;inset:0;z-index:6;display:none;flex-direction:column;align-items:center;justify-content:center;
        gap:14px;background:rgba(8,6,10,0.78);backdrop-filter:blur(3px);color:#f2e9e0;pointer-events:auto;
        font:600 14px/1.5 ui-monospace,monospace;letter-spacing:.06em;text-align:center;}
      .hoard-death h2{font-size:30px;letter-spacing:.22em;color:#e0524a;margin:0;}
      .hoard-death button{margin-top:8px;min-width:160px;min-height:48px;border:0;border-radius:12px;
        background:#3a7bd5;color:#fff;font:800 15px/1 ui-monospace,monospace;letter-spacing:.1em;cursor:pointer;}
    `;
    document.head.appendChild(css);
    // thumbstick
    thumb = document.createElement('div'); thumb.className = 'hoard-stick';
    knob = document.createElement('div'); knob.className = 'knob'; thumb.appendChild(knob);
    document.body.appendChild(thumb);
    const R = 44; let touching = false;
    const setStick = (ev) => { const r = thumb.getBoundingClientRect(); let dx = ev.clientX - (r.left + r.width / 2), dy = ev.clientY - (r.top + r.height / 2); const d = Math.hypot(dx, dy) || 1; if (d > R) { dx *= R / d; dy *= R / d; } knob.style.transform = `translate(${dx}px,${dy}px)`; stick.x = dx / R; stick.y = -dy / R; };
    thumb.addEventListener('pointerdown', (e) => { touching = true; thumb.setPointerCapture(e.pointerId); setStick(e); });
    thumb.addEventListener('pointermove', (e) => { if (touching) setStick(e); });
    const rel = () => { touching = false; stick.x = 0; stick.y = 0; knob.style.transform = 'translate(0,0)'; };
    thumb.addEventListener('pointerup', rel); thumb.addEventListener('pointercancel', rel);
    // fire (hold) + melee (tap) buttons
    fireBtn = document.createElement('button'); fireBtn.className = 'hoard-btn hoard-fire'; fireBtn.textContent = 'FIRE'; document.body.appendChild(fireBtn);
    meleeBtn = document.createElement('button'); meleeBtn.className = 'hoard-btn hoard-melee'; meleeBtn.textContent = 'MELEE'; document.body.appendChild(meleeBtn);
    // L42: guarded haptic on the touch combat buttons (the game controls deserve the tactile feedback).
    fireBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); navigator.vibrate?.(12); firing = true; });
    fireBtn.addEventListener('pointerup', () => { firing = false; });
    fireBtn.addEventListener('pointercancel', () => { firing = false; });
    meleeBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); navigator.vibrate?.(18); melee(); });
    // HUD
    hud = document.createElement('div'); hud.className = 'hoard-hud';
    hud.innerHTML = 'HP<div class="bar"><i style="background:#e0524a"></i></div>'
      + 'STAMINA<div class="bar"><i style="background:#4ad08a"></i></div>'
      + 'HUNGER<div class="bar"><i style="background:#d89a3a"></i></div>'
      + 'THIRST<div class="bar"><i style="background:#3aa6dc"></i></div><div class="stat"></div>';
    document.body.appendChild(hud);
    const fills = hud.querySelectorAll('i');
    hpFill = fills[0]; stamFill = fills[1]; hungerFill = fills[2]; thirstFill = fills[3]; statEl = hud.querySelector('.stat');
    // wave banner + death screen
    banner = document.createElement('div'); banner.className = 'hoard-banner'; document.body.appendChild(banner);
    deathEl = document.createElement('div'); deathEl.className = 'hoard-death';
    deathEl.innerHTML = '<h2>YOU DIED</h2><div class="ds"></div><button>RESTART</button>';
    document.body.appendChild(deathEl);
    deathEl.querySelector('button').addEventListener('click', () => restart());
    // L35 INVENTORY/CRAFT — a bag button (top-right) + a modal slot panel (pauses while open).
    const bagCss = document.createElement('style');
    bagCss.textContent = `
      .hoard-bagbtn{position:fixed;right:16px;top:14px;z-index:4;display:none;width:48px;height:48px;border:0;border-radius:12px;
        background:rgba(16,18,24,0.72);color:#fff;font-size:22px;cursor:pointer;pointer-events:auto;box-shadow:0 4px 14px rgba(0,0,0,0.4);}
      .hoard-bag{position:fixed;inset:0;z-index:6;display:none;align-items:center;justify-content:center;
        background:rgba(8,8,12,0.6);backdrop-filter:blur(3px);pointer-events:auto;}
      .hoard-bag.open{display:flex;}
      .hoard-bag .panel{background:rgba(20,22,28,0.96);border-radius:16px;padding:18px 20px;color:#e7ecf4;
        font:700 12px/1.2 ui-monospace,monospace;letter-spacing:.05em;max-width:calc(100vw - 32px);box-shadow:0 8px 30px rgba(0,0,0,0.5);}
      .hoard-bag h3{margin:0 0 10px;font-size:14px;letter-spacing:.16em;}
      .hoard-bag .slots{display:grid;grid-template-columns:repeat(4,58px);gap:8px;}
      .hoard-bag .slot{width:58px;height:58px;border:1px solid rgba(255,255,255,0.14);border-radius:10px;background:rgba(255,255,255,0.05);
        display:flex;align-items:center;justify-content:center;font-size:24px;cursor:pointer;position:relative;}
      .hoard-bag .slot.empty{opacity:.35;cursor:default;}
      .hoard-bag .slot .n{position:absolute;right:4px;bottom:3px;font-size:11px;background:#000a;padding:0 3px;border-radius:4px;}
      .hoard-bag .craft{margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;}
      .hoard-bag .craft button{min-height:44px;border:0;border-radius:10px;padding:0 13px;color:#fff;font:700 11px/1 ui-monospace,monospace;
        letter-spacing:.04em;cursor:pointer;background:#3a7bd5;}
      .hoard-bag .craft button:disabled{opacity:.32;cursor:default;}
      .hoard-bag .close{margin-top:14px;width:100%;min-height:46px;border:0;border-radius:10px;background:#444b57;color:#fff;
        font:700 12px/1 ui-monospace,monospace;letter-spacing:.1em;cursor:pointer;}
    `;
    document.head.appendChild(bagCss);
    bagBtn = document.createElement('button'); bagBtn.className = 'hoard-bagbtn'; bagBtn.textContent = '🎒'; bagBtn.title = 'Inventory (I)';
    document.body.appendChild(bagBtn);
    bagBtn.addEventListener('click', () => toggleBag());
    bagEl = document.createElement('div'); bagEl.className = 'hoard-bag';
    document.body.appendChild(bagEl);
  }
  let bannerT = 0;
  function showBanner(text, t = 1.8) { if (banner) { banner.textContent = text; banner.style.display = 'block'; } bannerT = t; }

  let camAz = Math.PI / 4;
  function setAzimuth(a) { camAz = a; }
  function setAim(x, z) { aim = { x, z }; }            // desktop cursor aim (cleared on touch via setActive)
  function setFiring(on) { firing = on; }

  /* L35 bag panel — rebuild the slot grid + craft buttons from the live inventory each time it opens or
     changes (cheap; ≤8 slots). Opening PAUSES the sim (the zombies freeze) so you can manage the bag. */
  function refreshBag() {
    if (typeof window !== 'undefined') window.__hoardBag = Object.fromEntries(inv.map((s) => [s.id, s.n]));
    if (!bagEl) return;
    let h = '<div class="panel"><h3>INVENTORY</h3><div class="slots">';
    for (let i = 0; i < INV_SLOTS; i++) {
      const s = inv[i];
      if (s) h += `<button class="slot" data-id="${s.id}" title="${ITEMS[s.id].name}">${ITEMS[s.id].glyph}<span class="n">${s.n}</span></button>`;
      else h += '<div class="slot empty"></div>';
    }
    h += '</div><div class="craft">';
    RECIPES.forEach((rec, r) => {
      const ok = Object.keys(rec.need).every((k) => invCount(k) >= rec.need[k]);
      const need = Object.entries(rec.need).map(([k, v]) => `${v}${ITEMS[k].glyph}`).join('+');
      h += `<button data-rec="${r}" ${ok ? '' : 'disabled'}>Craft ${ITEMS[rec.out].name} (${need})</button>`;
    });
    h += '</div><button class="close">CLOSE (I)</button></div>';
    bagEl.innerHTML = h;
    bagEl.querySelectorAll('.slot[data-id]').forEach((b) => b.addEventListener('click', () => { if (ITEMS[b.dataset.id].consumable) useItem(b.dataset.id); }));
    bagEl.querySelectorAll('[data-rec]').forEach((b) => b.addEventListener('click', () => craft(RECIPES[+b.dataset.rec])));
    bagEl.querySelector('.close').addEventListener('click', () => closeBag());
  }
  function openBag() { if (!active || dead) return; paused = true; if (bagEl) bagEl.classList.add('open'); refreshBag(); }
  function closeBag() { paused = false; if (bagEl) bagEl.classList.remove('open'); }
  function toggleBag() { if (paused) closeBag(); else openBag(); }

  function startWave(w) { wave = w; toSpawn = 5 + w * 2; waveState = 'spawning'; }
  function reset() {
    P.x = 0; P.z = 0; P.vx = 0; P.vz = 0; P.hp = 100; P.stamina = 100; P.hunger = 100; P.thirst = 100; P.facing = 0; P.iframe = 0;
    for (const z of zs) z.alive = false;
    kills = 0; score = 0; runTime = 0; dead = false; firing = false; aim = null;
    // barriers back to full
    for (const b of barriers) { b.hp = BARRIER_HP; b.alive = true; b.mesh.scale.set(1, 1, 1); }
    // pickups: clear, then scatter a few food/water in the open arena
    for (const p of pickups) { p.active = false; p.mesh.visible = false; }
    inv.length = 0;                                   // L35: empty the bag
    const startKinds = ['food', 'water', 'food', 'water', 'bandage', 'scrap'];
    for (let i = 0; i < 6; i++) { const a = Math.random() * Math.PI * 2, r = 1.6 + Math.random() * (ARENA - 2); spawnPickup(Math.cos(a) * r, Math.sin(a) * r, startKinds[i]); }  // some inside the base, some out
    if (deathEl) deathEl.style.display = 'none';
    player.position.set(0, GROUND_Y, 0); player.visible = true;
    startWave(1);
    refreshBag();                                     // L35: clear the bag UI + __hoardBag snapshot
  }
  function restart() { reset(); }
  function setActive(on) {
    active = on; group.visible = on;
    const showStick = on && coarse;
    if (thumb) thumb.style.display = showStick ? 'block' : 'none';
    if (fireBtn) fireBtn.style.display = showStick ? 'block' : 'none';
    if (meleeBtn) meleeBtn.style.display = showStick ? 'block' : 'none';
    if (hud) hud.style.display = on ? 'block' : 'none';
    if (banner && !on) banner.style.display = 'none';
    if (deathEl && !on) deathEl.style.display = 'none';
    if (bagBtn) bagBtn.style.display = on ? 'block' : 'none';
    closeBag();                                       // L35: never leave the bag open across enter/exit
    for (const k in keys) keys[k] = false; stick.x = stick.y = 0; firing = false;
    if (on) reset();
  }

  const dummy = new THREE.Object3D();
  function update(dt, elapsed, sunRig) {
    if (!active) return;
    if (paused) return;                                // L35: bag open → the sim freezes (a clean pause)
    const night = sunRig ? sunRig.windowGlow : 0;
    fireCd = Math.max(0, fireCd - dt); meleeCd = Math.max(0, meleeCd - dt);
    tracer.material.opacity = Math.max(0, tracer.material.opacity - dt * 8);
    swing.material.opacity = Math.max(0, swing.material.opacity - dt * 6);

    if (!dead) {
      runTime += dt;
      P.iframe = Math.max(0, P.iframe - dt);

      // PLAYER move (camera-relative)
      let ix = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0) + stick.x;
      let iy = (keys.w || keys.arrowup ? 1 : 0) - (keys.s || keys.arrowdown ? 1 : 0) + stick.y;
      const il = Math.hypot(ix, iy); if (il > 1) { ix /= il; iy /= il; }
      const moving = il > 0.05;
      const wantSprint = (keys.shift || stick.y > 0.95) && P.stamina > 2 && moving;
      const ca = Math.cos(camAz), sa = Math.sin(camAz);
      const dirX = ca * ix + (-sa) * iy, dirZ = (-sa) * ix + (-ca) * iy;
      const sp = wantSprint ? SPRINT : WALK;
      const k = 1 - Math.exp(-ACCEL * dt);
      P.vx += (dirX * sp - P.vx) * k; P.vz += (dirZ * sp - P.vz) * k;
      P.x += P.vx * dt; P.z += P.vz * dt;
      const pr = Math.hypot(P.x, P.z); if (pr > ARENA) { P.x *= ARENA / pr; P.z *= ARENA / pr; P.vx = 0; P.vz = 0; }
      if (moving) P.facing = Math.atan2(dirX, dirZ);
      P.stamina = THREE.MathUtils.clamp(P.stamina + (wantSprint ? -STAM_DRAIN : STAM_REGEN) * dt, 0, 100);

      // SURVIVAL: hunger/thirst drain; empty → chip damage + no regen; well-fed AND hydrated → slow regen.
      P.hunger = Math.max(0, P.hunger - HUNGER_DRAIN * dt);
      P.thirst = Math.max(0, P.thirst - THIRST_DRAIN * dt);
      if (P.hunger <= 0 || P.thirst <= 0) P.hp = Math.max(0, P.hp - STARVE_DMG * dt);
      else if (P.hunger > FED_LEVEL && P.thirst > FED_LEVEL && P.hp < 100) P.hp = Math.min(100, P.hp + FED_REGEN * dt);
      // PICKUPS (L35): walk over → goes INTO the bag (if there's room), not auto-consumed.
      for (const p of pickups) {
        if (p.active && (p.x - P.x) ** 2 + (p.z - P.z) ** 2 < 0.30 && addItem(p.kind)) { p.active = false; p.mesh.visible = false; refreshBag(); }
      }
      // REPAIR: stand near a damaged barrier → it slowly rebuilds (no extra button; mobile-friendly).
      for (const b of barriers) {
        if (b.hp >= BARRIER_HP) continue;
        const bx = Math.cos(b.ang) * BARRIER_R, bz = Math.sin(b.ang) * BARRIER_R;
        if ((bx - P.x) ** 2 + (bz - P.z) ** 2 < REPAIR_RANGE * REPAIR_RANGE) { b.hp = Math.min(BARRIER_HP, b.hp + REPAIR_RATE * dt); if (b.hp > 0) b.alive = true; }
      }
      if (P.hp <= 0) die();

      player.position.set(P.x, GROUND_Y, P.z);
      player.rotation.y = P.facing;
      // a small i-frame blink
      player.visible = !(P.iframe > 0 && Math.floor(elapsed * 20) % 2 === 0);

      if (firing) fire();
      swing.position.set(P.x, GROUND_Y + 0.06, P.z); swing.rotation.z = -P.facing;
    }

    // WAVE DIRECTOR
    let aliveCount = 0;
    if (!dead) {
      if (waveState === 'spawning') {
        if (toSpawn > 0 && Math.random() < dt * (wave === 1 ? 3.5 : 6)) { spawnOne(night); toSpawn--; }   // trickle in (slower wave 1)
        if (toSpawn <= 0) waveState = 'fighting';
      }
    }

    // HORDE step + contact damage + draw
    let nearestContactDmg = 0, znear = Infinity;
    for (let i = 0; i < MAXZ; i++) {
      const z = zs[i];
      if (!z.alive) { dummy.position.set(0, -60, 0); dummy.scale.setScalar(0); dummy.updateMatrix(); zombies.setMatrixAt(i, dummy.matrix); continue; }
      aliveCount++;
      const dx = P.x - z.x, dz = P.z - z.z, td = Math.hypot(dx, dz) || 1;
      if (td < znear) znear = td;
      if (!dead) {
        const desX = (dx / td) * z.speed, desZ = (dz / td) * z.speed;
        const zk = 1 - Math.exp(-6 * dt);
        z.vx += (desX - z.vx) * zk; z.vz += (desZ - z.vz) * zk;
        if (td > CONTACT_R) {
          let nx = z.x + z.vx * dt, nz = z.z + z.vz * dt;
          // BARRIER: a zombie still OUTSIDE the wall line (radius ≥ BARRIER_R) that would step inside the
          // ring is held at + attacks the nearest ALIVE segment (clamped each frame until it breaks); once
          // a segment is dead the zombie pours through the gap and is "inside" for good (z.in).
          const rNow = Math.hypot(z.x, z.z), rNew = Math.hypot(nx, nz);
          if (!z.in && rNow >= BARRIER_R && rNew < BARRIER_R + ATTACK_STOP) {
            const b = nearestBarrier(nx, nz);
            if (b.alive) {
              const ang = Math.atan2(nz, nx), rr = BARRIER_R + ATTACK_STOP;
              nx = Math.cos(ang) * rr; nz = Math.sin(ang) * rr;
              b.hp -= BARRIER_ATTACK * dt; if (b.hp <= 0) { b.hp = 0; b.alive = false; }
            }
          }
          if (rNew < BARRIER_R - 0.1) z.in = true;          // made it inside the ring
          z.x = nx; z.z = nz;
        } else if (P.iframe <= 0) { nearestContactDmg = Math.max(nearestContactDmg, z.dmg); }   // bite
      }
      z.flash = Math.max(0, z.flash - dt);
      const bob = Math.sin(elapsed * 6 + z.phase) * 0.04;
      dummy.position.set(z.x, GROUND_Y + 0.3 * z.size * ZSCALE + bob, z.z);
      dummy.rotation.set(0, Math.atan2(z.vx, z.vz), Math.sin(elapsed * 3 + z.phase) * 0.12);
      dummy.scale.setScalar(z.size * ZSCALE);
      dummy.updateMatrix(); zombies.setMatrixAt(i, dummy.matrix);
      // colour: type tint, flashed white on a hit, reddened when low HP
      _col.set(ZTYPE[z.type].color);
      if (z.flash > 0) _col.lerp(WHITE, 0.7);
      else _col.lerp(RED, 0.35 * (1 - z.hp / z.maxhp));
      zombies.setColorAt(i, _col);
    }
    zombies.instanceMatrix.needsUpdate = true;
    if (zombies.instanceColor) zombies.instanceColor.needsUpdate = true;

    // BARRIERS: a damaged segment shrinks + reddens; a broken one flattens into rubble (the gap).
    let barriersUp = 0;
    for (const b of barriers) {
      if (b.alive) barriersUp++;
      const f = Math.max(0, b.hp / BARRIER_HP);
      b.mesh.scale.y = b.alive ? Math.max(0.18, f) : 0.12;
      b.mesh.position.y = GROUND_Y + 0.35 * b.mesh.scale.y;
      b.mesh.material.color.copy(b.baseColor).lerp(RED, (1 - f) * 0.55);
    }

    // apply contact damage + check death — L35: a gentle wave-1 GRACE so a curious viewer isn't
    // instakilled before grasping the controls (full difficulty from wave 2).
    if (!dead && nearestContactDmg > 0) { P.hp = Math.max(0, P.hp - nearestContactDmg * (wave === 1 ? 0.5 : 1)); P.iframe = IFRAME; if (P.hp <= 0) die(); }

    // wave complete?
    if (!dead && waveState === 'fighting' && aliveCount === 0 && toSpawn <= 0) {
      waveState = 'complete'; waveTimer = 2.2; showBanner(`WAVE ${wave} CLEAR`, 2.0);
    }
    if (!dead && waveState === 'complete') { waveTimer -= dt; if (waveTimer <= 0) { startWave(wave + 1); showBanner(`WAVE ${wave}`, 1.4); } }
    if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0 && banner) banner.style.display = 'none'; }

    // HUD + probe
    if (hpFill) hpFill.style.width = `${P.hp}%`;
    if (stamFill) stamFill.style.width = `${P.stamina}%`;
    if (hungerFill) hungerFill.style.width = `${P.hunger}%`;
    if (thirstFill) thirstFill.style.width = `${P.thirst}%`;
    if (statEl) statEl.textContent = `WAVE ${wave}   KILLS ${kills}   SCORE ${score}`;
    if (typeof window !== 'undefined') window.__hoard = { active, dead, paused, hp: Math.round(P.hp), stamina: Math.round(P.stamina), hunger: Math.round(P.hunger), thirst: Math.round(P.thirst), zombies: aliveCount, barriers: barriersUp, pickups: pickups.filter((p) => p.active).length, inv: Object.fromEntries(inv.map((s) => [s.id, s.n])), wave, kills, score, weapon: 'gun', znear: +znear.toFixed(2), px: +P.x.toFixed(2), pz: +P.z.toFixed(2) };
  }

  function die() {
    dead = true; firing = false;
    if (deathEl) {
      deathEl.querySelector('.ds').innerHTML = `Wave reached: ${wave}<br>Kills: ${kills}<br>Score: ${score}<br>Survived: ${runTime.toFixed(0)}s`;
      deathEl.style.display = 'flex';
    }
  }

  return {
    group, update, setActive, setAzimuth, setAim, setFiring, melee, reset, restart,
    openBag, closeBag, toggleBag, addItem,             // L35 (addItem exposed for tests/seeding)
    get player() { return P; },
    get dead() { return dead; },
    get active() { return active; },
    get paused() { return paused; },
    get inv() { return inv.map((s) => ({ ...s })); },
    get nearestPickup() { let b = null, bd = 1e9; for (const p of pickups) { if (!p.active) continue; const d = (p.x - P.x) ** 2 + (p.z - P.z) ** 2; if (d < bd) { bd = d; b = p; } } return b ? { x: b.x, z: b.z } : null; },
    setTarget() {},                                    // sim-ready seam (target = player for v1)
  };
}
