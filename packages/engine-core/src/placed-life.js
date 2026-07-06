/* ============================================================
   placed-life.js — Lesson 73: PLACE-ENTITIES — the world editor's "drop in life" pool.
   ------------------------------------------------------------
   The authoring loop so far: sculpt the land (L69) → paint the ground (L71) → paint objects (L72).
   This closes it: DROP IN LIFE — birds, boats, fish, clouds, and a wandering person — single, by
   drag, or N at a time. Each placed thing is alive (it flies / drifts / breaches / walks) and is
   INSPECTABLE the instant it's placed (the L63 lens reads our followables registry each frame).

   WHY A NEW POOL (a reconciliation note — Rule 7): the brief asked us to add a spawn seam to the
   EXISTING pools (water-life.js boats/gulls/fish, clouds.js). But `world.enter()` hides
   `waterLife.group` in WORLD mode — and the editor runs in world mode — so a boat/gull spawned into
   that pool would be INVISIBLE. So the placed life lives in its OWN group, which IS shown in world
   mode and registered as a 4th inspector source. This also dodges two traps: the harbor pools'
   origin-circular lanes would sail a placed boat through the terrain, and growing their fixed-size
   arrays would fight their capacity assumptions. Here every entity is DROP-ANCHORED — it behaves
   around the point you dropped it, on the right medium.

   THE SEAM (the lesson's reusable shape, a C++ anchor each):
   - spawn(kind,x,z,opts) → handle : a FACTORY METHOD on the pool. Build one entity's visual + state,
     push it to the live array + the GPU scene, push its descriptor to `followables`. Like a
     `std::vector::emplace_back` that also registers an observer. "Inspectable for free" = the lens
     reads the shared registry each tick, so registering == pushing to the array (no explicit subscribe).
   - despawn(handle) : remove from the array + scene + registry. removeNear(x,z,r) : nearest-wins delete.
   - update(dt) : each entity runs its own tiny behaviour (a polymorphic `e.update`) — the pool just
     iterates. New kinds = new factory cases, zero changes to the loop.
   - snapshot()/restore() : entities serialise to PURE DATA records {kind,x,z,opts} (no meshes), so
     undo (L70/L72) and a future save/load (L75) carry placed life as art-agnostic data.
   ============================================================ */
import * as THREE from 'three';
import { createSpriteAnim } from './sprite-anim.js';
import { vectorize } from './vector-style.js';
import { ATV_PROFILE, CRAFT_PROFILE } from './pilot.js';   // L76/L77: craft profiles (the pilot reads them; the entity exposes them)

// L76 — reusable scratch for the slope-orient maths (a parked ATV sits flush on the terrain). Module-level
// so seating an ATV allocates nothing per frame (same no-per-frame-`new` discipline as the sprite pools).
const _up = new THREE.Vector3(), _fwdv = new THREE.Vector3(), _rightv = new THREE.Vector3();
const _fwd2 = new THREE.Vector3(), _basis = new THREE.Matrix4();
const _YAXIS = new THREE.Vector3(0, 1, 0);   // L106: constant up-axis (never mutated, unlike _up) for the ambient-yaw → quat sync

/* ---- tiny shared art (kept minimal + self-contained; the catalog art-seam can swap richer assets
        later, exactly like the scatter/gull sheets). ---------------------------------------------- */

// a 4-frame gull FLAP strip (white on transparent), windowed one frame at a time by the sprite-anim.
function makeGullStrip() {
  const F = 4, s = 64, cv = document.createElement('canvas'); cv.width = s * F; cv.height = s;
  const ctx = cv.getContext('2d');
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const peak = [14, 24, 36, 24];                       // wings raise → mid → lower → mid
  for (let i = 0; i < F; i++) {
    const ox = i * s, p = peak[i];
    ctx.beginPath();
    ctx.moveTo(ox + 8, 40); ctx.quadraticCurveTo(ox + 24, p, ox + 32, 36);
    ctx.quadraticCurveTo(ox + 40, p, ox + 56, 40); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
// a soft white puff for a cloud sprite (a couple of overlapping radial blobs).
function makePuff() {
  const S = 96, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  const blob = (cx, cy, r) => { const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); };
  blob(S * 0.42, S * 0.56, S * 0.26); blob(S * 0.60, S * 0.50, S * 0.30); blob(S * 0.50, S * 0.46, S * 0.22); blob(S * 0.70, S * 0.58, S * 0.18);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
function boatMesh() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.2, 1.1), vectorize(new THREE.MeshStandardMaterial({ color: '#5a6675', roughness: 0.6, metalness: 0.2, flatShading: true }), { color: '#5a6675' }));
  hull.position.y = 0.02;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.42), vectorize(new THREE.MeshStandardMaterial({ color: '#e7ecf2', roughness: 0.7, flatShading: true }), { color: '#e7ecf2' }));
  cabin.position.set(0, 0.18, 0.08);
  g.add(hull, cabin); g.traverse((o) => { if (o.isMesh) o.castShadow = true; o.raycast = () => {}; });
  return g;
}
function fishMesh() {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.18, 9, 7), vectorize(new THREE.MeshStandardMaterial({ color: '#5b6f86', roughness: 0.5, flatShading: true }), { color: '#5b6f86' }));
  m.scale.set(0.55, 0.5, 1.0); m.raycast = () => {}; return m;
}
function personMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.34, 0.14), vectorize(new THREE.MeshStandardMaterial({ color: '#3b6ea5', roughness: 0.8, flatShading: true }), { color: '#3b6ea5' }));
  body.position.y = 0.17;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.13), vectorize(new THREE.MeshStandardMaterial({ color: '#e3b98c', roughness: 0.8, flatShading: true }), { color: '#e3b98c' }));
  head.position.y = 0.41;
  g.add(body, head); g.traverse((o) => { if (o.isMesh) o.castShadow = true; o.raycast = () => {}; });
  return g;
}
/* L76 — a PLACEHOLDER all-terrain vehicle: a boxy chassis + 4 wheels (the catalog art-seam can swap a
   real model later, like the gull/scatter sheets). Authored NOSE ALONG +Z (matches the heading convention
   `forward = (sinθ, cosθ)`), wheels' bottoms at y≈0 so seating `position.y = heightAt` puts them on the ground. */
function atvMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.84), vectorize(new THREE.MeshStandardMaterial({ color: '#d2622e', roughness: 0.6, metalness: 0.2, flatShading: true }), { color: '#d2622e' }));
  body.position.y = 0.26;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.32), vectorize(new THREE.MeshStandardMaterial({ color: '#2b2f37', roughness: 0.8, flatShading: true }), { color: '#2b2f37' }));
  seat.position.set(0, 0.42, -0.06);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.22), vectorize(new THREE.MeshStandardMaterial({ color: '#e2e7ee', roughness: 0.7, flatShading: true }), { color: '#e2e7ee' }));
  nose.position.set(0, 0.28, 0.42);                  // a light "headlight" block at the nose, so heading reads at a glance
  const wheelGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.13, 10);
  for (const [wx, wz] of [[-0.27, 0.3], [0.27, 0.3], [-0.27, -0.3], [0.27, -0.3]]) {
    const w = new THREE.Mesh(wheelGeo, vectorize(new THREE.MeshStandardMaterial({ color: '#1c2026', roughness: 0.9, flatShading: true }), { color: '#1c2026' }));
    w.rotation.z = Math.PI / 2;                      // cylinder axis Y → X, so the wheel rolls about the axle
    w.position.set(wx, 0.14, wz);
    g.add(w);
  }
  g.add(body, seat, nose); g.traverse((o) => { if (o.isMesh) o.castShadow = true; o.raycast = () => {}; });
  return g;
}
/* L77 — a PLACEHOLDER all-medium SPACECRAFT: a saucer disc + a glassy dome + a nose fin (so its heading reads, since
   a disc is radially symmetric). Origin at its centre; it hovers a little above whatever surface it's over. */
function craftMesh() {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.64, 0.16, 18), vectorize(new THREE.MeshStandardMaterial({ color: '#8a93a8', roughness: 0.4, metalness: 0.5, flatShading: true }), { color: '#8a93a8' }));
  disc.position.y = 0.3;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), vectorize(new THREE.MeshStandardMaterial({ color: '#9fe6ff', roughness: 0.25, metalness: 0.3, flatShading: true, transparent: true, opacity: 0.85 }), { color: '#9fe6ff' }));
  dome.position.y = 0.38;
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.34), vectorize(new THREE.MeshStandardMaterial({ color: '#ff7a4d', roughness: 0.6, flatShading: true }), { color: '#ff7a4d' }));
  fin.position.set(0, 0.3, 0.52);                     // a warm marker at the +Z nose
  g.add(disc, dome, fin); g.traverse((o) => { if (o.isMesh) o.castShadow = true; o.raycast = () => {}; });
  return g;
}
/* L104 — a PLACEHOLDER HELICOPTER (the CITY flyover craft): cabin + cockpit glass + tapering tail boom + fin +
   skids + a spinning main rotor and tail rotor. Same flat-shaded / vectorize() placeholder language as the saucer
   so it reads across the beauty/toon/pixel tiers. Authored NOSE ALONG +Z (the heading convention). The rotor groups
   are stashed on `userData` so the entity's update() can spin them every frame. Origin at the skids' centre. */
function heliMesh() {
  const g = new THREE.Group();
  const body = '#5b6680', glass = '#9fe6ff', dark = '#2b2f3a', blade = '#3a4150', warm = '#ff7a4d';
  const std = (color, extra) => vectorize(new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.25, flatShading: true, ...extra }), { color });
  const cabin = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), std(body));
  cabin.scale.set(0.82, 0.78, 1.28); cabin.position.y = 0.5;                    // ellipsoid, longer along the nose
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), std(glass, { roughness: 0.2, transparent: true, opacity: 0.8 }));
  cockpit.scale.set(0.82, 0.7, 0.92); cockpit.position.set(0, 0.58, 0.32);
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.14, 1.05, 10), std(body));
  boom.rotation.x = Math.PI / 2; boom.position.set(0, 0.54, -0.86);             // tapering tail boom toward -Z
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.22), std(body));
  fin.position.set(0, 0.68, -1.3);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.12), std(warm, { roughness: 0.6 }));
  nose.position.set(0, 0.46, 0.74);                                            // warm heading marker at the +Z nose
  const skidGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.92, 8);
  const skidL = new THREE.Mesh(skidGeo, std(dark, { roughness: 0.7 })); skidL.rotation.x = Math.PI / 2; skidL.position.set(-0.28, 0.1, 0);
  const skidR = new THREE.Mesh(skidGeo, std(dark, { roughness: 0.7 })); skidR.rotation.x = Math.PI / 2; skidR.position.set(0.28, 0.1, 0);
  // MAIN ROTOR — a hub + two crossed blades on a mast, spins around Y.
  const mainRotor = new THREE.Group(); mainRotor.position.set(0, 0.96, 0.06);
  mainRotor.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 8), std(dark)));
  const bladeGeo = new THREE.BoxGeometry(2.5, 0.02, 0.13);
  const b1 = new THREE.Mesh(bladeGeo, std(blade, { roughness: 0.6 })); mainRotor.add(b1);
  const b2 = new THREE.Mesh(bladeGeo, std(blade, { roughness: 0.6 })); b2.rotation.y = Math.PI / 2; mainRotor.add(b2);
  // TAIL ROTOR — small, side-mounted on the fin, spins around X.
  const tailRotor = new THREE.Group(); tailRotor.position.set(0.11, 0.68, -1.34);
  const tbGeo = new THREE.BoxGeometry(0.04, 0.52, 0.06);
  const tb1 = new THREE.Mesh(tbGeo, std(blade, { roughness: 0.6 })); tailRotor.add(tb1);
  const tb2 = new THREE.Mesh(tbGeo, std(blade, { roughness: 0.6 })); tb2.rotation.x = Math.PI / 2; tailRotor.add(tb2);
  g.add(cabin, cockpit, boom, fin, nose, skidL, skidR, mainRotor, tailRotor);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; o.raycast = () => {}; });
  g.userData.mainRotor = mainRotor; g.userData.tailRotor = tailRotor;
  return g;
}

export function createPlacedLife({ heightAt, seaSurfaceY = 0, waterY = 0.06 } = {}) {
  const group = new THREE.Group();
  group.raycast = () => {};
  const H = heightAt || (() => 0);                     // live terrain sampler (world-Y at x,z)

  const ents = [];                                     // live placed entities (the std::vector)
  const followables = [];                              // parallel L63 descriptors (inspector reads each frame)
  const seq = { gull: 0, boat: 0, fish: 0, cloud: 0, person: 0, atv: 0, craft: 0 };   // per-kind label counters

  const gullAnim = createSpriteAnim({ frames: 4, fps: 7 });
  const gullStrip = makeGullStrip();
  const puff = makePuff();
  const GULL_TINT = ['#ffffff', '#cfd4da', '#c8a06a'];

  // --- per-kind FACTORY: build the object + attach a tiny behaviour (e.update) + an info() string ---
  function makeEntity(kind, x, z, opts) {
    const phase = (seq[kind] || 0) * 1.7 + (opts.phase || 0);
    if (kind === 'gull') {
      const map = gullAnim.makeInstanceTexture(gullStrip);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: new THREE.Color(GULL_TINT[(seq.gull) % 3]), transparent: true, opacity: 0.9, depthWrite: false, fog: true }));
      sp.scale.setScalar(0.5); sp.raycast = () => {};
      const cx = x, cz = z, R = 1.4 + Math.random() * 0.6, baseY = H(x, z) + 2.4, speed = 0.5 + Math.random() * 0.3;
      return { kind, obj: sp, x, z,
        update(dt, elapsed, sunRig) {
          const a = phase + elapsed * speed;
          sp.position.set(cx + Math.cos(a) * R, baseY + Math.sin(elapsed * 1.4 + phase) * 0.12, cz + Math.sin(a) * R);
          gullAnim.step(sp.material.map, elapsed, phase);
          const day = sunRig ? 1 - sunRig.windowGlow : 1;
          sp.material.opacity = THREE.MathUtils.clamp(0.25 + day * 0.7, 0, 0.95);
        },
        info: () => 'gull · circling', dispose() { map.dispose(); } };
    }
    if (kind === 'cloud') {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, transparent: true, opacity: 0.85, depthWrite: false, fog: true }));
      sp.scale.set(3.4, 1.9, 1); sp.raycast = () => {};
      const cx = x, cz = z, hiY = 5.0 + Math.random() * 1.4, drift = 0.12 + Math.random() * 0.1;
      return { kind, obj: sp, x, z,
        update(dt, elapsed, sunRig) {
          sp.position.set(cx + Math.sin(elapsed * 0.18 + phase) * 1.2, hiY + Math.sin(elapsed * 0.3 + phase) * 0.18, cz + drift * Math.cos(elapsed * 0.1 + phase));
          if (sunRig && sunRig.sky) sp.material.color.copy(sunRig.sky).lerp(WHITE, 0.62);
        },
        info: () => 'cloud · drifting' };
    }
    if (kind === 'boat') {
      const g = boatMesh(); g.position.set(x, waterY, z);
      // drift: a slow heading that wanders, with a soft spring back toward the drop so it stays on its water.
      let hx = x, hz = z, head = Math.random() * Math.PI * 2;
      return { kind, obj: g, x, z,
        update(dt, elapsed) {
          head += (Math.sin(elapsed * 0.3 + phase) * 0.4) * dt;        // gentle wander
          const sp = 0.6;
          hx += Math.sin(head) * sp * dt; hz += Math.cos(head) * sp * dt;
          hx += (x - hx) * 0.4 * dt; hz += (z - hz) * 0.4 * dt;        // spring home (keeps it near its water)
          const bob = Math.sin(elapsed * 1.1 + phase) * 0.025;
          g.position.set(hx, waterY + bob, hz);
          g.rotation.set(Math.sin(elapsed * 0.9 + phase) * 0.04, head, 0);
        },
        info: () => 'boat · drifting' };
    }
    if (kind === 'fish') {
      const m = fishMesh(); m.position.set(x, -5, z);
      const period = 6 + Math.random() * 5, arcH = 0.5, heading = Math.random() * Math.PI * 2;
      let t = Math.random() * period;
      const ent = { kind, obj: m, x, z, active: true,
        update(dt) {
          t += dt; const arcDur = 1.3;
          if (t >= period) {
            const k = (t - period) / arcDur;
            if (k >= 1) { t = 0; m.position.set(x, -5, z); ent.active = false; return; }
            const arc = Math.sin(Math.PI * k);
            m.position.set(x + Math.sin(heading) * (k - 0.5) * 1.0, waterY - 0.1 + arc * arcH, z + Math.cos(heading) * (k - 0.5) * 1.0);
            m.rotation.set(Math.cos(Math.PI * k) * 0.9, heading, 0); ent.active = true;
          } else { ent.active = false; }
        },
        info: () => (ent.active ? 'fish · breaching!' : 'fish · below') };
      return ent;
    }
    if (kind === 'person') {
      const g = personMesh(); g.position.set(x, H(x, z), z);
      let head = Math.random() * Math.PI * 2;
      return { kind, obj: g, x, z,
        update(dt, elapsed) {
          head += (Math.random() - 0.5) * 1.4 * dt;                    // random-walk heading
          const sp = 0.55, nx = g.position.x + Math.sin(head) * sp * dt, nz = g.position.z + Math.cos(head) * sp * dt;
          // soft leash to the drop + turn away from water (stay on land)
          let tx = nx + (x - nx) * 0.25 * dt, tz = nz + (z - nz) * 0.25 * dt;
          if (H(tx, tz) < seaSurfaceY + 0.02) { head += Math.PI; tx = g.position.x; tz = g.position.z; }   // would step into water → about-face
          g.position.set(tx, H(tx, tz), tz); g.rotation.y = head;
        },
        info: () => 'person · wandering' };
    }
    if (kind === 'atv') {
      // L76 — the ALL-TERRAIN VEHICLE. Unlike the other placed life (each runs an autonomous loop), the ATV
      // is PILOTABLE: when not driven it just PARKS (reseats on the terrain so it sits flush after a sculpt/
      // load); when possessed, the PilotController owns its transform and `update` steps aside (the `piloted`
      // autonomy gate — the wiring-drift point the research flagged: every autonomous loop must check it).
      const g = atvMesh();
      const state = { x, y: H(x, z), z, yaw: opts.yaw ?? Math.random() * Math.PI * 2, speed: 0, quat: new THREE.Quaternion() };
      let piloted = false;
      const orientToSlope = () => {
        const e = 0.45;
        const hL = H(state.x - e, state.z), hR = H(state.x + e, state.z), hD = H(state.x, state.z - e), hU = H(state.x, state.z + e);
        _up.set(hL - hR, 2 * e, hD - hU).normalize();
        _fwdv.set(Math.sin(state.yaw), 0, Math.cos(state.yaw));
        _rightv.crossVectors(_up, _fwdv).normalize();
        _fwd2.crossVectors(_rightv, _up).normalize();
        _basis.makeBasis(_rightv, _up, _fwd2);
        state.quat.setFromRotationMatrix(_basis);
      };
      const seatParked = () => { state.y = H(state.x, state.z); orientToSlope(); g.position.set(state.x, state.y, state.z); g.quaternion.copy(state.quat); };
      seatParked();                                   // place it on the terrain the instant it's dropped
      return { kind, obj: g, x, z, get piloted() { return piloted; },
        update() { if (!piloted) seatParked(); },     // parked → stay seated on the (possibly edited) terrain
        info: () => (piloted ? 'ATV · piloted' : 'ATV · parked'),
        // ⭐ THE PILOTABLE DESCRIPTOR (the L76 seam) — a followable becomes pilotable by carrying this. The
        //    PilotController binds `model`+`profile`, reads/writes the transform, and gates autonomy via it.
        pilot: {
          model: 'ground', profile: ATV_PROFILE,
          controlHints: 'W/S throttle · A/D steer · Esc to exit',
          getWorldPos: (o) => o.copy(g.position),
          getTransform: () => state,                  // the live, mutable movement state (the model integrates it in place)
          setTransform: (s) => { g.position.set(s.x, s.y, s.z); g.quaternion.copy(s.quat); },
          suspendAutonomy: () => { piloted = true; },
          resumeAutonomy: () => { piloted = false; state.speed = 0; },   // hand back parked, at rest
        },
      };
    }
    if (kind === 'craft') {
      // L77 — the ALL-MEDIUM SPACECRAFT. Like the ATV it's pilotable (the same controller), but its model
      // (`spacecraft`) probes the medium and flows air↔water↔ground. When not driven it HOVERS (bob + slow spin).
      const g = craftMesh();
      const HOVER = 1.3;                                  // idle hover height above the surface
      const ph = Math.random() * Math.PI * 2;
      const state = { x, y: H(x, z) + HOVER, z, yaw: opts.yaw ?? Math.random() * Math.PI * 2, speed: 0, vy: 0, quat: new THREE.Quaternion(), medium: 'air', crossing: null, crossingT: 0 };
      let piloted = false;
      return { kind, obj: g, x, z, get piloted() { return piloted; },
        update(dt, elapsed) {
          if (piloted) return;                            // PilotController owns it while driven
          state.yaw += 0.3 * dt;                          // slow idle spin
          const target = H(state.x, state.z) + HOVER + Math.sin((elapsed || 0) * 0.8 + ph) * 0.08;   // gentle bob
          state.y += (target - state.y) * Math.min(1, dt * 3);   // EASE to hover height (so a release at altitude settles, doesn't snap)
          g.position.set(state.x, state.y, state.z); g.rotation.set(0, state.yaw, 0);
          state.quat.setFromAxisAngle(_YAXIS, state.yaw);   // L106: keep state.quat in sync with the ambient yaw so a mid-air SEIZE inherits the right orientation (was stale identity → orientation snap on takeover)
        },
        info: () => (piloted ? 'spacecraft · piloted' : 'spacecraft · hovering'),
        pilot: {
          model: 'spacecraft', profile: CRAFT_PROFILE,
          controlHints: 'W/S thrust · A/D steer · Space/Shift climb/dive · Esc exit',
          getWorldPos: (o) => o.copy(g.position),
          getTransform: () => state,
          setTransform: (s) => { g.position.set(s.x, s.y, s.z); g.quaternion.copy(s.quat); },
          suspendAutonomy: () => { piloted = true; },
          resumeAutonomy: () => { piloted = false; state.speed = 0; state.vy = 0; },
        },
      };
    }
    if (kind === 'heli') {
      // L104 — the HELICOPTER (the city-flyover craft). Pilotable via the SAME `spacecraft` model (all-medium air;
      // over the flat city ground it just stays in AIR). Rotors spin ALWAYS (idle + flying); when not piloted it
      // HOVERS at a high `hover` (rooftop height over the flat city → reads as flying over the skyline). Heading-steady
      // idle (a real heli holds its nose, unlike the saucer's idle spin).
      const g = heliMesh();
      const mainRotor = g.userData.mainRotor, tailRotor = g.userData.tailRotor;
      const HOVER = opts.hover ?? 11;                    // idle hover height above the surface (city ground = 0 → ~11 = over rooftops)
      const SPIN = 26;                                   // rad/s main-rotor spin
      const ORBIT_R = opts.orbit ?? 8;                   // L104 attract-loop: idle ambient-flight orbit radius (0 = hover in place)
      const ph = Math.random() * Math.PI * 2;
      // orbit centre placed so the heli STARTS at its spawn (x,z) then circles — no first-frame jump.
      const state = { x, y: H(x, z) + HOVER, z, yaw: opts.yaw ?? 0, speed: 0, vy: 0, quat: new THREE.Quaternion(), medium: 'air', crossing: null, crossingT: 0, _cx: x - ORBIT_R, _cz: z, _at: 0 };
      let piloted = false;
      return { kind, obj: g, x, z, get piloted() { return piloted; },
        update(dt, elapsed) {
          mainRotor.rotation.y += SPIN * dt;             // rotors spin whether idle OR piloted
          tailRotor.rotation.x += SPIN * 1.6 * dt;
          if (piloted) return;                           // PilotController owns the transform while driven
          // AMBIENT FLIGHT (the attract-loop look): a slow wide circle over the city, nose along the travel direction —
          // "a helicopter flying over your city" the instant the page loads. ORBIT_R 0 → falls back to a fixed hover.
          if (ORBIT_R > 0) {
            state._at += dt;
            const a = state._at * 0.14;                  // ~0.14 rad/s → a lazy ~45s lap
            state.x = state._cx + Math.cos(a) * ORBIT_R;
            state.z = state._cz + Math.sin(a) * ORBIT_R;
            state.yaw = Math.atan2(-Math.sin(a), Math.cos(a));   // face the tangent (direction of travel)
          }
          const target = H(state.x, state.z) + HOVER + Math.sin((elapsed || 0) * 0.7 + ph) * 0.1;   // gentle bob
          state.y += (target - state.y) * Math.min(1, dt * 2);
          g.position.set(state.x, state.y, state.z); g.rotation.set(0, state.yaw, 0);
          state.quat.setFromAxisAngle(_YAXIS, state.yaw);   // L106: keep state.quat in sync with the ambient yaw so a mid-air SEIZE inherits the right orientation (was stale identity → orientation snap on takeover)
        },
        info: () => (piloted ? 'helicopter · piloted' : 'helicopter · hovering'),
        pilot: {
          model: 'spacecraft', profile: CRAFT_PROFILE,
          controlHints: 'W/S thrust · A/D steer · Space/Shift climb/dive · Esc exit',
          getWorldPos: (o) => o.copy(g.position),
          getTransform: () => state,
          setTransform: (s) => { g.position.set(s.x, s.y, s.z); g.quaternion.copy(s.quat); },
          suspendAutonomy: () => { piloted = true; },
          resumeAutonomy: () => { piloted = false; state.speed = 0; state.vy = 0; },
        },
      };
    }
    return null;
  }

  function labelFor(kind) { seq[kind] = (seq[kind] || 0) + 1; return `${kind} ${seq[kind]}`; }

  function spawn(kind, x, z, opts = {}) {
    const e = makeEntity(kind, x, z, opts);
    if (!e) return null;
    e.opts = opts;
    // L110 (audit B12): an EPHEMERAL entity (the engine-owned seize craft) is ticked + followable like any other, but
    // is EXCLUDED from snapshot() and clear() — so world save / undo / a shared ?world= link never serialize it (the
    // "duplicate heli embedded in the link" bug) or orphan the engine's handle to it when the user clears the world.
    e.ephemeral = !!opts.ephemeral;
    ents.push(e); group.add(e.obj);
    const f = { kind, label: labelFor(kind), getWorldPos: (o) => o.copy(e.obj.position), active: () => e.active !== false, info: () => e.info() };
    if (e.pilot) f.pilot = e.pilot;                      // L76: an ATV's followable is also PILOTABLE (one registry, two verbs)
    e.followable = f; followables.push(f);
    return e;
  }
  // L110 (audit B12): free an entity's GPU memory on teardown. Every entity builds FRESH per-instance geometry +
  // material (verified — no module-shared geo), so disposing them is safe; and Three's material.dispose() does NOT
  // free referenced TEXTURES, so a shared sprite map (the module-level cloud `puff`) is untouched here — the gull's
  // own dispose() frees its per-instance instance-texture. Dedup within the entity (skid/blade geos are reused).
  function disposeObject(obj) {
    const geos = new Set(), mats = new Set();
    obj.traverse((o) => {
      if (o.geometry) geos.add(o.geometry);
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
    });
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
  }
  function despawn(e) {
    if (!e) return false;
    const i = ents.indexOf(e); if (i < 0) return false;
    group.remove(e.obj);
    if (e.dispose) e.dispose();     // entity-specific teardown (frees per-instance textures, e.g. the gull's map)
    disposeObject(e.obj);           // L110 (audit B12): + the per-instance geometry/material GPU handles (was a leak on every despawn/undo/world-rebuild)
    ents.splice(i, 1);
    const fi = followables.indexOf(e.followable); if (fi >= 0) followables.splice(fi, 1);
    return true;
  }
  // nearest placed entity within `r` → despawn it; returns its record (for undo) or null.
  function removeNear(x, z, r = 2.5) {
    let best = null, bd = r * r;
    for (const e of ents) { const dx = e.obj.position.x - x, dz = e.obj.position.z - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = e; } }
    if (!best) return null;
    const rec = { kind: best.kind, x: best.x, z: best.z, opts: best.opts };
    despawn(best); return rec;
  }

  function update(dt, elapsed, sunRig) {
    for (let i = 0; i < ents.length; i++) ents[i].update(dt, elapsed, sunRig);
    if (typeof window !== 'undefined') window.__placedLife = counts();
  }

  function counts() { const c = { gull: 0, boat: 0, fish: 0, cloud: 0, person: 0, atv: 0, craft: 0, total: ents.length }; for (const e of ents) c[e.kind]++; return c; }
  function getFollowables() { return followables; }
  function snapshot() { return ents.filter((e) => !e.ephemeral).map((e) => ({ kind: e.kind, x: e.x, z: e.z, opts: e.opts })); }   // PURE DATA — ephemeral engine craft excluded (audit B12)
  function clear() { for (const e of [...ents]) if (!e.ephemeral) despawn(e); }   // keep the ephemeral engine-owned craft across world load/clear (audit B12)
  // L90 H11 — `entities` rides the attacker-controllable `?world=` link. Cap the count (a corrupt/oversized
  // save must not hang or OOM the tab) + skip non-finite x/z (a NaN spawn breaks the entity + its bounds).
  function restore(records) {
    clear();
    if (!Array.isArray(records)) return;
    for (const r of records.slice(0, 2000)) {
      if (!r || typeof r.kind !== 'string' || !Number.isFinite(r.x) || !Number.isFinite(r.z)) continue;
      spawn(r.kind, r.x, r.z, (r.opts && typeof r.opts === 'object') ? r.opts : {});
    }
  }

  return { group, update, spawn, despawn, removeNear, getFollowables, snapshot, restore, clear, counts, get count() { return ents.length; } };
}
const WHITE = new THREE.Color('#ffffff');
