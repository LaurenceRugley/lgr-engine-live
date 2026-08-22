/* ============================================================
   carried-weapon.js — A-GUN (2026-08-22): a body CARRIES a weapon, POINTS it where it looks,
   and keeps moving normally while holding it.
   ------------------------------------------------------------
   WHY THIS IS IN THE ENGINE AND NOT IN world-lab/main.js. Three things were about to be born
   project-local inside the walker, and not one of them is walker-specific:
     1. THE CARRY TRANSFORM — where a held object sits relative to a body, and how it turns to
        face an aim point. Any held thing wants it: a torch, a camera, a scanner, a fishing rod,
        the world editor's placement tool.
     2. HANDS ON THE OBJECT — the mount-IK socket wiring. The motorcycle rider already solved
        this shape (createCharacterRig.setMountIK, A-WHIP); this is the same ability pointed at
        a thing the body holds rather than a thing the body sits on.
     3. A SHOT WITH A RECEIPT — origin, direction, hit-or-miss, counted. `createBallistics` has
        owned the projectile since B4; what was missing was the seam that fires it FROM a
        weapon's own muzzle along that weapon's own axis.
   The project supplies the camera, the aim point, the world query and the body; this supplies
   the ability. (Project CLAUDE.md, "engine-first": the ABILITY goes in core, the project WIRES.)

   THE ONE ARCHITECTURAL RULE THIS FILE ENFORCES: the weapon does NOT own the body, and the body
   does NOT own the weapon's aim. The consumer hands over a body pose and an aim point; this
   module decides where the weapon hangs and which way it faces, and publishes SOCKETS. The rig
   then solves the hands onto those sockets — which is why the hands follow the gun and never the
   other way round. Reversing that (gun parented to the hand bone) is the obvious first idea and
   it is wrong: a gun on the hand points where the ANIMATION put the hand, so it cannot point
   where you look, which is the whole requirement.

   ── WHY THE PIVOT IS THE BORE LINE ──────────────────────────────────────────────────────────
   `sidearm.glb`'s origin sits ON the barrel axis at the grip's station (build_sidearm.py says so
   and prints the socket offsets that prove it). Rotating there is the only choice for which the
   MUZZLE STAYS ON THE AIM RAY at every pitch: rotate about the bore and the barrel sweeps along
   its own axis. Pivoting at the hand — 0.054 m below the bore — would throw the muzzle off the
   aim line by that offset × sin(pitch), i.e. the shot would miss the crosshair by more the
   harder you looked up. That is the kind of error a straight-ahead-only check never sees, which
   is why the probe sweeps up, down and behind.

   ── WHY THE ANCHOR COMES FROM THE CONTROLLER AND NOT FROM A BONE ────────────────────────────
   The obvious "nicer" choice is to hang the weapon off the chest BONE so it breathes with the
   gait. It creates a one-frame lag that cannot be removed: the rig solves the hands to the
   weapon's sockets INSIDE `rig.update()`, so the weapon transform must already be final when
   that runs — which means it was computed from the PREVIOUS frame's bones. Taking the anchor
   from the controller's own position and yaw (both exact before `hero.update`) makes the whole
   chain single-frame-coherent: aim → weapon → hands, no lag anywhere, and a probe can assert the
   angle instead of tolerating a smear. The body's bob still reaches the weapon — through the
   ARMS, which is the correct direction of travel: a trained shooter holds the weapon steady and
   lets the body move under it.

   C++ anchor: `createCarriedWeapon` is a small RAII-ish object with an explicit dispose(); the
   per-frame `aim()` writes through preallocated scratch (no allocation on the frame path, the
   no-hot-alloc invariant), and the SoA projectile arrays it reads from `createBallistics` are
   plain float buffers — `std::vector<float>` in all but name.
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createBallistics } from './createBallistics.js';

/* THE AUTHORED BODY. build_sidearm.py models the pistol in REAL METRES against a 1.75 m human,
   so every consumer scales by its own body height / this. Authoring at human scale (rather than
   baking one room's numbers into the GLB) is what lets the same asset serve a 0.30 u walker and
   a 1.68 u survivor without a second export — the createVehicleGlbMesh `scale` argument's own
   argument, applied to a held object. */
const AUTHORED_BODY_M = 1.75;

/* CARRY GEOMETRY, as FRACTIONS OF BODY HEIGHT so the pose is scale-free. The shoulder joint sits
   at ~0.80 of standing height and ~0.075 out from the midline (human proportions, and the survivor
   rig measures out at 0.803 / 0.078 — close enough that these serve both).

   HOLD_DIST IS THE ONE THAT WAS MEASURED RATHER THAN LOOKED UP, and it is worth the paragraph.
   0.26 is the honest anthropometric number for a two-handed ready position, and it was WRONG here:
   the survivor's arm measures 0.0841 u shoulder-to-wrist on a 0.30 u body (0.280 of height), so a
   socket 0.26 of height away sits at 93% of full extension. `_solveTwoBone` is ill-conditioned
   there — the elbow angle goes to zero, the bend plane degenerates, and the sign choice that keeps
   the elbow near its clip pose stops being well-defined — and it showed up as an asymmetric
   residual that no tolerance could honestly cover: 0.0004 u on the left arm against 0.0070 on the
   right, in the SAME frame, on the same mechanism the rider hits 0.000 u with. The rider's sockets
   sit at a comfortable mid-range bend; that, not luck, is why his hands land exactly.
   0.195 puts the socket at ~70% extension — elbows visibly bent, which is also what a two-handed
   pistol hold actually looks like — and the residual falls to the numbers in the arc report.
   The lesson generalises: a two-bone IK socket wants to live inside ~80% of the chain, and a
   "correct" real-world offset that lands outside it will be paid for in a limp arm. */
const SHOULDER_Y = 0.80, SHOULDER_SIDE = 0.075, HOLD_DIST = 0.195;

/* BALLISTIC FEEL, CARRIED AS A RATIO FROM THE ONE TUNED GUN IN THIS REPO (Rule 6 — follow the
   dominant existing pattern; do not invent a third feel). hoard2's player gun went through a
   real feel pass (projects/hoard2/src/player/index.js, "FEEL-PASS (playtest #1 — gun connect)"):
   speed 72 u/s, projectile gravity 2, cooldown 0.15 s, life 1.2 s — on a survivor measured
   ~1.68 u tall. Divided through by that body, its numbers are 42.9 body-heights/s and 1.19
   body-heights/s², and those RATIOS are what transfer: world-lab's walker is 0.30 u with a
   0.55 u/s walk (1.83 body-heights/s) against hoard2's 3.0 u/s on 1.68 u (1.79) — the two rooms
   move at almost exactly the same body-relative speed, so a shot carried across as a ratio
   arrives feeling the same. The seconds are seconds and do not scale. */
const SHOT_SPEED_PER_BODY = 42.9, SHOT_GRAVITY_PER_BODY = 1.19;
const SHOT_COOLDOWN_S = 0.15, SHOT_LIFE_S = 1.2, SHOT_MAX_LIVE = 32;

export function createCarriedWeapon({
  url,
  bodyHeight = 1.75,
  /* THE HOUSE WORLD BAG — the object with `segmentHit(ox,oy,oz, ex,ey,ez, r) -> t∈[0,1]`, the same
     seam the aim reticle and the chase arm already use. Null → shots fly and expire, never hit, and
     `report.hits` stays 0 HONESTLY rather than pretending.
     THE ADAPTER LIVES HERE, and that is the whole reason this takes a `world` and not a `castWorld`.
     `createBallistics` wants `castWorld(ox,oy,oz,ex,ey,ez) -> { t, point, normal } | null`; the house
     bag answers a bare `t`. Handing `segmentHit` straight across type-checks in nobody's head and
     throws `Cannot read properties of undefined` inside the projectile step — measured, not
     imagined: it is exactly what the first run of this module did, four times a second, while the
     shot counter still incremented and the receipt still looked plausible. The mismatch is a
     property of the two seams, so the translation belongs in the engine between them, once. */
  world = null,
  onHit = null,
  shotSpeed = null, shotGravity = null, cooldown = SHOT_COOLDOWN_S,
} = {}) {
  if (!url) throw new Error('createCarriedWeapon: `url` is required — import it from \'@lgr/engine-core/assets/models/sidearm.glb?url\' (a ?url inside the lib would inline the asset into every bundle; see createVehicleMesh.js)');

  const scale = bodyHeight / AUTHORED_BODY_M;
  const group = new THREE.Group();
  group.name = 'carriedWeapon';
  group.scale.setScalar(scale);          // set ONCE — a property of the model, not of the frame
  group.visible = false;                 // stowed until the consumer arms it

  let mode = 'loading';
  let gripNode = null, foreNode = null, muzzleNode = null;

  const ready = new Promise((res) => {
    new GLTFLoader().loadAsync(url).then((gltf) => {
      const root = gltf.scene;
      gripNode = root.getObjectByName('sidearm_grip');
      foreNode = root.getObjectByName('sidearm_fore');
      muzzleNode = root.getObjectByName('sidearm_muzzle');
      /* ALL THREE OR NONE, loudly. A weapon with a muzzle but no grip socket would aim correctly
         and be held by nobody — it would LOOK broken in exactly the way a still screenshot hides.
         Same all-or-none rule createBikeGlbMesh applies to the rider sockets. */
      if (!gripNode || !foreNode || !muzzleNode) {
        throw new Error('sidearm.glb is missing a socket node (sidearm_grip/sidearm_fore/sidearm_muzzle) — re-run tools/blender/build_sidearm.py and read its RECEIPT lines');
      }
      root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; } });
      group.add(root);
      mode = 'glb';
      res(mode);
    }).catch((e) => {
      /* NO SILENT FALLBACK BODY HERE, deliberately, and it is a departure from
         createVehicleGlbMesh's box worth stating: a missing vehicle still has to drive, so a
         massing box is better than nothing. A missing WEAPON has no such duty — a box in the
         hands would pass every geometric check in the probe (sockets, angles, hand distance)
         while looking like a brick, which is precisely the "instrument counts an unanswered
         question as green" failure this arc was told to avoid. Stay unloaded and let `armed`
         refuse; the consumer's HUD says so. */
      console.error(`carried weapon GLB failed to load — the walker stays unarmed: ${url}`, e);
      mode = 'failed';
      res(mode);
    });
  });

  /* segmentHit → castWorld. `t` is the fraction along the segment, 1 meaning "clear"; a hit point is
     that fraction of the way down the ray. THE NORMAL IS NOT A SURFACE NORMAL and is labelled so
     rather than quietly faked: the bag answers a distance, not an orientation, so the best honest
     answer is the reversed ray — correct for "which way did this come from", wrong for "which way
     does the surface face". Nothing in this arc reads it; a consumer that needs a real normal needs
     a richer world query, and should find this comment rather than a plausible-looking lie. */
  const _castPoint = { x: 0, y: 0, z: 0 }, _castNormal = { x: 0, y: 0, z: 0 };
  const _cast = { t: 1, point: _castPoint, normal: _castNormal };
  const castWorld = world && world.segmentHit ? (ox, oy, oz, ex, ey, ez) => {
    const t = world.segmentHit(ox, oy, oz, ex, ey, ez, 0.01);
    if (!(t < 1)) return null;                       // clear (also catches undefined/NaN)
    _cast.t = t;
    _castPoint.x = ox + (ex - ox) * t; _castPoint.y = oy + (ey - oy) * t; _castPoint.z = oz + (ez - oz) * t;
    const dx = ox - ex, dy = oy - ey, dz = oz - ez;
    const l = Math.hypot(dx, dy, dz) || 1;
    _castNormal.x = dx / l; _castNormal.y = dy / l; _castNormal.z = dz / l;
    return _cast;
  } : null;

  const ballistics = createBallistics({
    gravity: shotGravity != null ? shotGravity : SHOT_GRAVITY_PER_BODY * bodyHeight,
    maxLive: SHOT_MAX_LIVE,
    maxLife: SHOT_LIFE_S,
    castWorld,
    onHit: (hit) => { report.hits++; _lastHit.x = hit.point.x; _lastHit.y = hit.point.y; _lastHit.z = hit.point.z; report.lastHit = _lastHit; if (onHit) onHit(hit); },
  });
  const speed = shotSpeed != null ? shotSpeed : SHOT_SPEED_PER_BODY * bodyHeight;

  /* THE VISIBLE SHOT — one InstancedMesh of tiny bright bullets driven straight off the
     ballistics pool's SoA arrays. Instanced rather than a mesh each because the pool is fixed at
     32 and a draw call per bullet is a draw call wasted; unused slots are parked at a huge
     negative Y rather than resized, so the buffer never reallocates mid-fight. */
  const bulletR = 0.012 * bodyHeight;
  const bullets = new THREE.InstancedMesh(
    new THREE.SphereGeometry(bulletR, 6, 4),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
    SHOT_MAX_LIVE,
  );
  bullets.frustumCulled = false;
  bullets.name = 'carriedWeapon:bullets';
  bullets.count = SHOT_MAX_LIVE;
  bullets.visible = false;            // nothing is in the air at boot — no draw call until there is

  /* scratch, reused every frame — the no-hot-alloc invariant (docs/engine-invariants.md) */
  const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _e = new THREE.Euler();
  const _q = new THREE.Quaternion(), _muz = new THREE.Vector3(), _fwd = new THREE.Vector3();
  const _lastHit = { x: 0, y: 0, z: 0 };
  const _PARKED = new THREE.Matrix4().makeTranslation(0, -1e6, 0);

  let cool = 0, armedNow = false, _wasLive = false;
  const report = {
    armed: false, loaded: false, fired: 0, hits: 0, misses: 0,
    lastHit: null, lastShot: null, aimYaw: 0, aimPitch: 0, live: 0,
    aimDir: null,
  };
  const _lastShot = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1 };   // written ONLY by fire()
  const _aimDir = { x: 0, y: 0, z: 1 };                             // the live aim — never a receipt

  return {
    group, bullets, ready,
    get mode() { return mode; },
    get loaded() { return mode === 'glb'; },
    get armed() { return armedNow; },
    report,

    /* MOUNT TARGETS — the two socket nodes, in the shape `createCharacterRig.setMountIK` wants.
       ONLY HANDS. Passing feet as well would pin the legs and that is exactly the regression this
       arc is forbidden to cause: the walk and run are the owner's favourite, they live in the LEG
       chains, and a null foot target leaves those chains untouched by construction (the mount pass
       skips a limb whose target is absent — createCharacterRig.js, `if (!tgt || …) continue`).
       Returns null until the GLB lands, so a consumer cannot arm a weapon that has no sockets. */
    get mountTargets() { return mode === 'glb' ? { handR: gripNode, handL: foreNode } : null; },
    get muzzle() { return muzzleNode; },

    setArmed(on) {
      armedNow = !!on && mode === 'glb';       // a failed load can never report itself armed
      group.visible = armedNow;
      report.armed = armedNow;
      report.loaded = mode === 'glb';
      return armedNow;
    },

    /* ---------------------------------------------------------------------------------------
       aim(body, target) — place and orient the weapon for THIS frame. Call BEFORE the rig's
       update, so the hands solve to a socket that is already where it belongs (see the header).
         body   — { x, y, z } the body's FEET position (character.state's own convention)
         target — { x, y, z } the world point to point at, or null for "straight along `yaw`"
         yaw    — the look yaw, radians, used only when `target` is null and to place the shoulder
       Returns the report. A no-op when unarmed or unloaded — one failed `if`, zero cost stowed.
       ------------------------------------------------------------------------------------- */
    aim(body, target, yaw = 0) {
      if (!armedNow || mode !== 'glb') return report;
      /* 1 · THE AIM DIRECTION. From the SHOULDER, not from the camera: the weapon must point at
         the point under the crosshair, and in third person the camera sits metres behind the
         body, so "parallel to the camera ray" and "at the aim point" are different lines. The
         second is the one that makes the bullet arrive where the crosshair was. */
      const sy = body.y + SHOULDER_Y * bodyHeight;
      const side = SHOULDER_SIDE * bodyHeight;
      /* TWO PASSES, and the second one is not a refinement — it is the difference between the
         weapon pointing at the target and pointing PARALLEL to it. The shoulder is offset to the
         firing side, so a direction resolved from the body's MIDLINE aims a line that misses the
         target by that offset. Measured on the first cut: a flat 0.41° error at every station,
         which is exactly atan(0.0225 / ~3 u) — the lateral offset over the aim distance, a
         systematic bias masquerading as noise. So: pass 1 gets a provisional yaw (needed at all
         only because the anchor's own position depends on which way we end up facing), pass 2
         places the anchor and resolves the REAL direction from it. One iteration is enough — the
         yaw shift between the passes is milliradians and does not move the anchor meaningfully. */
      let dx, dy, dz;
      const resolve = (ox, oy, oz) => {
        dx = target.x - ox; dy = target.y - oy; dz = target.z - oz;
        const l = Math.hypot(dx, dy, dz);
        if (l > 1e-6) { dx /= l; dy /= l; dz /= l; } else { dx = Math.sin(yaw); dy = 0; dz = Math.cos(yaw); }
      };
      let ax, az, ay;
      if (target) {
        resolve(body.x, sy, body.z);                       // pass 1 — provisional, midline
        const ay0 = Math.atan2(dx, dz);
        /* THE AIM'S RIGHT VECTOR — `(−cos, sin)`, the basis character.js:825 already uses for the
           walker's own strafe ("camera RIGHT (same basis the walker strafes on)"). Verified against
           the rig rather than reasoned: at yaw 0 the survivor's RightArm bone measures x = −0.034
           and LeftArm x = +0.032, so the body's right IS −X, which is what this returns. */
        ax = body.x + -Math.cos(ay0) * side;
        az = body.z + Math.sin(ay0) * side;
        resolve(ax, sy, az);                               // pass 2 — the real direction, from the anchor
        ay = Math.atan2(dx, dz);
      } else {
        dx = Math.sin(yaw); dy = 0; dz = Math.cos(yaw);
        ay = yaw;
        ax = body.x + -Math.cos(ay) * side;
        az = body.z + Math.sin(ay) * side;
      }

      /* 3 · ORIENTATION — yaw about world Y, then pitch about the weapon's own right, as Euler
         'YXZ'. NOT `lookAt`: lookAt derives its basis from an up vector and DEGENERATES when the
         aim is vertical, which is exactly the case the probe is required to sample. With
         forward = +Z, the pair (pitch = −asin(dy), yaw = atan2(dx, dz)) reproduces any unit
         direction exactly, straight up and straight down included, and never rolls the weapon. */
      const pitch = -Math.asin(Math.max(-1, Math.min(1, dy)));
      _e.set(pitch, ay, 0, 'YXZ');
      _q.setFromEuler(_e);
      group.quaternion.copy(_q);
      group.position.set(ax + dx * HOLD_DIST * bodyHeight,
        sy + dy * HOLD_DIST * bodyHeight,
        az + dz * HOLD_DIST * bodyHeight);
      report.aimYaw = ay; report.aimPitch = pitch; report.aimDir = _aimDir;
      /* THE AIM DIRECTION GOES IN ITS OWN FIELD, and this is a correction worth stating. The first
         cut wrote it into `_lastShot.d*` — the same object `report.lastShot` points at — so a
         "receipt" of the direction a shot left along was silently overwritten by the LIVE aim on the
         very next frame. Its origin was truthful and its direction was current telemetry wearing a
         receipt's name, which is worse than having no field at all: it would agree with any check
         that asked it. `lastShot` is now written ONLY by fire(). */
      _aimDir.x = dx; _aimDir.y = dy; _aimDir.z = dz;
      return report;
    },

    /* fire() — one shot from the MUZZLE along the WEAPON'S OWN forward axis, both read out of the
       scene graph rather than recomputed from the aim. That is deliberate and it is what makes the
       receipt worth having: if the transform above were wrong, or something else overwrote it, the
       shot would leave along the wrong line and the probe's angle check and this origin would BOTH
       move. Recomputing from `_lastShot.d*` would hide exactly that class of bug.
       Returns false when stowed, unloaded, or still on cooldown — the caller may spam it. */
    fire() {
      if (!armedNow || mode !== 'glb' || cool > 0) return false;
      muzzleNode.getWorldPosition(_muz);
      group.updateWorldMatrix(true, false);
      const el = group.matrixWorld.elements;
      // matrixWorld columns are [right, up, backward, position]; forward = +Z = column 2.
      _fwd.set(el[8], el[9], el[10]).normalize();
      if (!ballistics.fire(_muz.x, _muz.y, _muz.z, _fwd.x, _fwd.y, _fwd.z, speed, 1)) return false;
      cool = cooldown;
      report.fired++;
      _lastShot.ox = _muz.x; _lastShot.oy = _muz.y; _lastShot.oz = _muz.z;
      _lastShot.dx = _fwd.x; _lastShot.dy = _fwd.y; _lastShot.dz = _fwd.z;
      report.lastShot = _lastShot;
      return true;
    },

    update(dt) {
      if (cool > 0) cool -= dt;
      ballistics.update(dt);
      report.live = ballistics.liveCount;
      /* MISSES ARE COUNTED AS "expired without a hit" — derived, so `fired = hits + misses + live`
         balances and a probe can assert the identity rather than trust two independent tallies. */
      report.misses = report.fired - report.hits - report.live;
      /* ZERO COST WITH NOTHING IN THE AIR, and the first cut was not. It rewrote 32 instance
         matrices and set `needsUpdate` EVERY frame from page load — a ~2 KB buffer re-upload per
         frame for a weapon that may never be drawn — and left the InstancedMesh visible with
         `frustumCulled = false`, which issues a draw call every frame forever. Parked instances made
         it invisible, so nothing looked wrong; it was pure waste in the render path of a room that
         counts its draws on the HUD. Now the pool is only walked while something is live, plus the
         ONE frame after the last projectile dies (to park them), and the mesh hides itself in
         between so the draw call goes away with it. */
      const live = ballistics.liveCount;
      if (live > 0 || _wasLive) {
        const { px, py, pz, alive } = ballistics;
        for (let i = 0; i < SHOT_MAX_LIVE; i++) {
          if (alive[i]) { _m.makeTranslation(px[i], py[i], pz[i]); bullets.setMatrixAt(i, _m); }
          else bullets.setMatrixAt(i, _PARKED);
        }
        bullets.instanceMatrix.needsUpdate = true;
        bullets.visible = live > 0;
        _wasLive = live > 0;
      }
    },

    /* THE WEAPON'S ACTUAL WORLD FORWARD, read off the applied transform — the number a probe
       compares against the aim direction. Allocates nothing; writes into the caller's out-param
       (the resolveAimPoint convention, so a probe can hand it straight across a seam). */
    forward(out) {
      group.updateWorldMatrix(true, false);
      const el = group.matrixWorld.elements;
      const l = Math.hypot(el[8], el[9], el[10]) || 1;
      out.x = el[8] / l; out.y = el[9] / l; out.z = el[10] / l;
      return out;
    },
    muzzlePoint(out) {
      if (mode !== 'glb') return null;
      muzzleNode.getWorldPosition(_v);
      out.x = _v.x; out.y = _v.y; out.z = _v.z;
      return out;
    },
    socketPoint(which, out) {
      const n = which === 'fore' ? foreNode : which === 'muzzle' ? muzzleNode : gripNode;
      if (!n) return null;
      n.getWorldPosition(_v);
      out.x = _v.x; out.y = _v.y; out.z = _v.z;
      return out;
    },

    dispose() {
      ballistics.dispose();
      bullets.geometry.dispose(); bullets.material.dispose();
      group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); const m = o.material; for (const mm of Array.isArray(m) ? m : [m]) mm && mm.dispose(); } });
    },
  };
}

/* the constants a consumer or a probe may want to quote rather than re-derive */
export const CARRY_GEOMETRY = { SHOULDER_Y, SHOULDER_SIDE, HOLD_DIST, AUTHORED_BODY_M };
