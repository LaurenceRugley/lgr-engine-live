/* ============================================================
   @lgr/engine-core — createHeroBody (ARC A-BODY, 2026-08-13): the PLAYER gets a body.
   ------------------------------------------------------------
   THE ABILITY: give `createCharacterController` a real skinned body instead of a capsule — one rigged
   character that reads a controller state each frame and poses itself: idle/walk/sprint from a
   continuous gait blend, and held poses for jump, fall, swing and cling. Third person AND first person.
   The engine already knew how to render a CROWD of skinned humans (createCharacterRig → the horde →
   createCrowdTiers); it did not know how to render the ONE human the player is. That gap is why every
   project in this repo — swing-lab, metropolis, the city — still hangs a `CapsuleGeometry` off the
   controller and calls it "an accepted stand-in".

   ── WHY THIS IS A CORE MODULE AND NOT A LAB FILE (project CLAUDE.md, engine-first) ──────────────
   Nothing below is specific to a swing lab. The controller state it consumes is the engine's own
   (`character.js`), the rig it drives is the engine's own, and every number that IS level-specific —
   the body's height, the walk/sprint speeds, which bones to hide in first person — is a parameter. A
   second consumer wires it by naming its own numbers, which is the no-pretending doctrine's
   second-consumer test applied before the second consumer exists.

   ── THE COLLIDER DOES NOT MOVE, and this is the load-bearing invariant ──────────────────────────
   This module is PRESENTATION ONLY. It reads `state` and writes bone matrices; it never writes a
   position, never touches the grapple, never rolls a random. The controller's collider is a capsule
   before this module and a capsule after it — the body is a costume on the physics, exactly as the
   crowd tiers are a costume on the agent sim. A determinism trace is unmoved by adding a body.

   ── THE POSES, AND WHICH ONE IS AN HONEST ANIMATION vs A HELD FRAME (Rule 12) ────────────────────
   The shipped survivor.glb (CC0, Quaternius "Animated Human") carries EXACTLY these clips:
       Idle · Walk · Run · Jump · Punch · Death · Working · ArmatureAction.002
   So:
     · idle / walk / sprint  — REAL animation. Three looping clips cross-blended by `gaitBlend`, with
       optional stride-rate scaling so the planted foot grips instead of skating.
     · jump / fall           — a HELD FRAME of the Jump clip (see createCharacterRig.poseHold). The
       clip passes through a genuine airborne pose; freezing it at two different times gives a rising
       body and a falling body that are recognisably different, and neither is a walk cycle playing in
       mid-air. It does not breathe. An authored fall clip would be better and is follow-up work.
     · swing                 — a held air frame PLUS the rig's existing aim-IK layer pointed at the
       anchor, so the arm genuinely extends toward the thing the rope is tied to and tracks it through
       the arc. The arm is real IK; the rest of the body is a held frame.
     · cling                 — a held frame plus the arm reaching at the wall. THE HONEST GAP: there is
       no splayed-against-a-wall clip and no second aimable arm in the rig's layer set, so a cling
       reads as "reaching at the wall", not as "spread-eagled on it". Named here rather than papered
       over; the fix is an authored clip (tools/blender, the build_reload.py precedent), not more code.

   ── FIRST PERSON: THE BODY STAYS ON, THE HEAD COMES OFF ─────────────────────────────────────────
   The eye sits INSIDE the head at `state.y + eyeHeight`, so a first-person camera on a full body
   renders the inside of its own skull across the whole frame — and at near 0.02 in a world whose
   bodies are 0.30 u tall, the skull's near wall is inside the near plane, which is the frustum bug
   this repo already ate once (ledger A-CLIMB: the eye was clear on 260/260 frames while the near
   plane's CORNERS were inside on 52 of them). The standard cure, and the one here: collapse the head
   bone while first person is active, so you look down at your own chest, arms and legs and there is
   nothing between the eye and the near plane. Configurable (`firstPerson.hideBones`), reversible, and
   applied AFTER the mixer step every frame so a clip can never fight it back.

   C++ anchor: a view/presentation component that observes a physics component by const reference. It
   owns a skeleton (the pose) and borrows a transform (the truth). One-way data flow, no ownership of
   the thing it draws.

   Contract: createHeroBody(opts) -> {
     group,                                  // add to the scene ONCE; holds the fallback + the rig
     ready,                                  // resolves when the GLB has landed and the body is real
     update(dt, state, opts),                // opts: { view, lookYaw, anchor }
     webAnchorPoint(out),                    // the throwing hand in world space (rope origin)
     setVisible(on), dispose(),
     get object(), get pose(), get gait(), get gaitLabel(), get scale(), get bodyHeight(), get rigged(),
   }
   ============================================================ */
import * as THREE from 'three';
import { createCharacterRig } from './createCharacterRig.js';
import { gaitBlend, gaitName, heroPose } from './hero-body-pose.js';

// The clip map for the shipped survivor.glb. A different GLB overrides `states`; a key whose clip is
// absent degrades to a no-op inside the rig (findClip returns null), never a throw.
export const SURVIVOR_STATES = {
  idle: 'Idle', walk: 'Walk', run: 'Run', jump: 'Jump', attack: 'Punch', death: 'Death', work: 'Working',
};

/* WHERE IN THE JUMP CLIP EACH AIR POSE IS FROZEN, as a fraction of its duration. These are the only
   hand-picked numbers in this module and they were picked by LOOKING at captures (ledger technique
   #4), because "which frame of this clip reads as falling" is not derivable from anything. Defaults
   are for survivor.glb's 1.0 s Jump; a different rig names its own. */
export const HERO_AIR_POSE = { jump: 0.28, fall: 0.60, swing: 0.52, cling: 0.44 };

const _v = new THREE.Vector3();
const _box = new THREE.Box3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

export function createHeroBody({
  url, gltf, states = SURVIVOR_STATES, extraClips = [],
  height = 1.8,                 // the body's WORLD height; the GLB is auto-measured and scaled to it
  walkSpeed = 1, sprintSpeed = 2,
  airPose = null,               // overrides for HERO_AIR_POSE (merged, so a caller may name one key)
  castShadow = true,
  idleRelax = true,             // survivor.glb's idle is a braced 'lunge' — soften it when truly still
  footIK = null,                // pass a cfg to enable plant-and-hold (scale-aware: caller's numbers)
  walkStride = 0, runStride = 0, // A6-2 stride-rate reference speeds (0 = the speed01 heuristic)
  riseEps = 0.05,
  /* FIRST PERSON — three honest options, because THERE IS NO FREE ONE and the repo should be able to
     A/B them rather than argue. Measured on the shipped survivor at 0.30 u with near 0.02 (see
     docs/captures/swing-lab/a-body/):
       mode 'body'   — the whole body renders. Nothing is nearer than `near` (measured: closest bone
                       0.031 u vs near 0.02), so the frustum does NOT cut it; you look down at your own
                       chest, arms and legs. The cost is that the eye sits at the head's own centre, so
                       looking straight down the shoulders are large in frame. That is what a
                       first-person body looks like; it is not a bug.
       mode 'nohead' — 'body' plus the head bone collapsed. REJECTED BY CAPTURE, and worth recording
                       rather than deleting: scaling a bone to zero drags every vertex that is PARTLY
                       weighted to it toward the bone origin, and the bone origin is exactly where the
                       camera is — so it does not remove the head, it turns it into a spray of shards
                       centred on the eye. The standard trick is standard for engines that hide the head
                       MESH, not the head BONE. Kept as an option because a rig with a separable head
                       submesh would use it correctly.
       mode 'off'    — no body in first person at all (hoard2's dive does this). The safe floor.
     `hideBones` is the bone list mode 'nohead' collapses. `backOff` slides the body BACKWARD along its
     own facing in first person only — the third lever, and the one that actually attacks the cause: the
     eye sits at the head's centre, so the neck is at distance ~0 and the near plane cuts it no matter
     which bones are hidden. Pushing the body back buys real clearance at the price of a body whose
     rendered position no longer matches its collider (in first person only, where nothing but the
     shadow can show the difference). 0 = off. */
  firstPerson = { mode: 'body', hideBones: ['Head'], backOff: 0 },
  handBone = 'RightHand',
  fallback = { radius: 0.06, length: 0.16, color: '#d8482f' },
  /* THE CHEAP TIER, and it is not scaffolding — it is the same shape as every other tier knob in this
     engine (the horde's `motionLayers:false`, the crowd's tier B). `skinned:false` never fetches the
     GLB and never builds a mixer: the fallback capsule IS the body, forever. Two uses, one of them
     immediate: a mobile/low tier that cannot afford a skinned rig, and the CONTROL ARM for measuring
     what the rig costs — with this the before/after is two URLs of ONE build, so the only variable is
     the body (a cross-build comparison also moves the bundler's output, the GLB fetch and the page). */
  skinned = true,
} = {}) {
  const AIR = airPose ? { ...HERO_AIR_POSE, ...airPose } : HERO_AIR_POSE;
  const fpMode = (firstPerson && firstPerson.mode) || 'body';
  const hideBones = fpMode === 'nohead' ? ((firstPerson && firstPerson.hideBones) || ['Head']) : [];
  const fpBackOff = (firstPerson && firstPerson.backOff) || 0;

  const group = new THREE.Group();
  group.name = 'hero-body';

  /* ---- THE FALLBACK, and why it is not optional-by-default. The GLB is a fetch: on a cold load there
     are ~1–2 s in which the controller is running, the camera is chasing something, and the probe is
     already driving keys. A frame with no body at all is a worse regression than a capsule, and it is
     the frame a capture is most likely to catch. So the capsule stays until the rig lands, then goes.
     Same shape as the tier renderer's rule (capsules carry the crowd until the rig arrives). ---- */
  let fb = null;
  if (fallback) {
    fb = new THREE.Mesh(
      new THREE.CapsuleGeometry(fallback.radius, fallback.length, 4, 10),
      new THREE.MeshStandardMaterial({ color: fallback.color || '#d8482f', roughness: 0.55, flatShading: true }),
    );
    fb.castShadow = castShadow;
    group.add(fb);
  }
  const fbYOff = fallback ? fallback.radius + fallback.length / 2 : 0;   // capsule origin is its CENTRE

  const rig = skinned ? createCharacterRig({ url, gltf, states, extraClips, walkStride, runStride }) : null;

  let handle = null, bodyScale = 1, footY = 0, hand = null;
  const hidden = [];             // { bone, scale } — the first-person head-collapse set
  let hiddenOn = null;           // tri-state: null = never applied, so the first update always writes
  let visible = true;
  let pose = 'ground', gait = 0;

  const ready = !rig ? Promise.resolve(null) : rig.ready.then(() => {
    handle = rig.spawn({ castShadow });
    /* MEASURE, DON'T ASSUME (Rule 15, and this one has a receipt in the repo already): two comments in
       this codebase state two different raw heights for THIS FILE — hoard2's player says "~5.26 units
       tall", swing-lab's civilian block says "≈ 4.7 raw units tall". Both are eyeballed, they disagree
       by 12%, and each one is baked into a magic scale constant. So the body measures its own bind-pose
       bounding box and derives the scale from the height the CALLER asked for. A consumer states a
       height in world units — a thing it actually knows — and never a scale factor. */
    handle.object.scale.setScalar(1);
    handle.object.position.set(0, 0, 0);
    handle.object.quaternion.identity();
    handle.object.updateMatrixWorld(true);
    _box.setFromObject(handle.object);
    const raw = Math.max(1e-6, _box.max.y - _box.min.y);
    bodyScale = height / raw;
    footY = -_box.min.y * bodyScale;      // so the FEET land on state.y, not the model's origin
    handle.object.scale.setScalar(bodyScale);
    group.add(handle.object);
    if (idleRelax) handle.setIdleRelax(true);
    if (footIK) handle.setFootIK(footIK);
    handle.setLocomotion(0);              // arm the idle/walk/run blend from frame one
    for (const name of hideBones) {
      const b = handle.findBone(name);
      if (b) hidden.push({ bone: b, s: b.scale.x || 1 });
    }
    hand = handBone ? handle.findBone(handBone) : null;
    if (fb) { group.remove(fb); fb.geometry.dispose(); fb.material.dispose(); fb = null; }
    return handle;
  });

  /* THE FIRST-PERSON HEAD COLLAPSE. Applied AFTER the mixer has posed the skeleton, and re-applied on
     every first-person frame rather than once on the transition. The shipped survivor's clips carry no
     scale track on Head (verified against the GLB's animation channels — Head/Neck are rotation-only),
     so a single write would hold today; a future rig WITH a scale track would silently defeat that, and
     the whole failure would be "the player can see the inside of their own skull", which is not a
     failure worth being clever about. Writing one bone's scale per frame costs nothing. */
  function applyHide(on) {
    if (!hidden.length) return;
    if (on) { for (const h of hidden) h.bone.scale.setScalar(1e-4); hiddenOn = true; }
    else if (hiddenOn !== false) { for (const h of hidden) h.bone.scale.setScalar(h.s); hiddenOn = false; }
  }

  return {
    group, ready,
    get object() { return handle ? handle.object : fb; },
    get rigged() { return !!handle; },
    get scale() { return bodyScale; },
    get bodyHeight() { return height; },
    get pose() { return pose; },
    get gait() { return gait; },
    get gaitLabel() { return gaitName(gait); },
    get handle() { return handle; },      // escape hatch: the raw rig handle for consumer-specific beats

    setVisible(on) {
      visible = !!on;
      if (fb) fb.visible = visible;
      if (handle) handle.object.visible = visible;
    },

    /* ONE CALL PER FRAME, AFTER the controller has stepped. `s` is the controller state; `view` decides
       the head collapse; `lookYaw` is used INSTEAD of the state's motion-derived yaw in first person
       (character.js only writes `state.yaw = lookYaw` while MOVING, so a body standing still in first
       person would keep whatever direction it last walked and you would look down at your own hip). */
    update(dt, s, { view = 'third', lookYaw = null, anchor = null } = {}) {
      if (!s) return;
      const first = view === 'first';
      const hs = Math.hypot(s.vx || 0, s.vz || 0);
      gait = gaitBlend(hs, walkSpeed, sprintSpeed);
      pose = heroPose(s, riseEps);

      if (!handle) {                                   // pre-GLB: keep the placeholder honest
        if (fb) { fb.position.set(s.x, s.y + fbYOff, s.z); if (s.quat) fb.quaternion.copy(s.quat); fb.visible = visible && !first; }
        return;
      }

      const o = handle.object;
      o.position.set(s.x, s.y + footY, s.z);
      /* FIRST-PERSON BACK-OFF (see `firstPerson.backOff`). The facing convention is the engine's own:
         yaw 0 = +z, forward = (sin yaw, cos yaw). Applied along the LOOK yaw, so it slides the body
         straight away from where the eye is pointed regardless of which way the feet are walking. */
      if (first && fpBackOff) {
        const y = lookYaw != null ? lookYaw : (s.yaw || 0);
        o.position.x -= Math.sin(y) * fpBackOff;
        o.position.z -= Math.cos(y) * fpBackOff;
      }
      /* ORIENTATION. While roped, `state.quat` carries the grapple's pitch and bank — the body leans
         into its own arc, which is most of what makes a swing read as a swing — so it is copied whole.
         Free, it is a plain yaw, and first person overrides it with the LOOK yaw (see above). */
      if (first && lookYaw != null && !s.swinging) { _e.set(0, lookYaw, 0, 'YXZ'); o.quaternion.setFromEuler(_e); }
      else if (s.quat) o.quaternion.copy(s.quat);
      o.visible = visible && !(first && fpMode === 'off');

      /* THE GAIT ALWAYS RUNS, even in the air. It is what the body returns TO when the held pose
         releases, and feeding it the real horizontal speed is also what drives the stride rate. */
      handle.setLocomotion(gait, hs);

      /* THE HELD POSE. One call, every frame: `poseHold` is idempotent for the same (clip, time) pair
         and eases its own weight, so there is no edge to detect and no state machine here — the pose
         is a pure function of the controller's mode. Grounded releases it (weight 0). */
      if (pose === 'ground') handle.poseHold(null, 0, 0);
      else handle.poseHold('jump', AIR[pose], 1);

      /* THE ARM. The rig's aim-IK layer already knows how to point the right arm at a world point and
         track it — the same layer the survivor aims a gun with — so a swing costs one call rather than
         a new layer: the arm extends toward the ANCHOR and follows it round the arc. Cleared the moment
         the rope cuts, so the arm eases back into the clip pose instead of staying stuck out. */
      if (pose === 'swing' && (anchor || s.anchor)) handle.setAim(anchor || s.anchor);
      else if (pose === 'cling') { _v.set(s.x + Math.sin(s.yaw || 0), s.y + (height * 0.9), s.z + Math.cos(s.yaw || 0)); handle.setAim(_v); }
      else handle.setAim(null);

      rig.update(dt);          // steps the mixer + the procedural layers for this one body
      applyHide(first);        // …then take the head off, so no clip can put it back
    },

    /* A NAMED BONE IN WORLD SPACE. `out` is returned UNCHANGED when the bone does not exist (or the GLB
       has not landed), so every caller's fallback is simply "whatever it pre-filled" — no null branch,
       no frame with an undefined point. The world matrix is refreshed first because the mixer posed the
       skeleton this frame and three does not flush world matrices until render. */
    bonePoint(name, out) {
      if (!handle || !name) return out;
      const b = name === handBone ? hand : handle.findBone(name);
      if (!b) return out;
      b.updateWorldMatrix(true, false);
      return b.getWorldPosition(out);
    },
    /* THE ROPE'S ORIGIN. A web that leaves the chest of a body whose arm is extended at the anchor is
       the kind of near-miss that reads as "the animation is not connected to the mechanic". Falls back
       to whatever the caller pre-filled when the rig has not landed or the bone is absent. */
    webAnchorPoint(out) {
      if (hand) { hand.updateWorldMatrix(true, false); return hand.getWorldPosition(out); }
      return out;
    },
    get hasHand() { return !!hand; },

    dispose() {
      if (fb) { group.remove(fb); fb.geometry.dispose(); fb.material.dispose(); fb = null; }
      if (handle) { group.remove(handle.object); handle.dispose(); handle = null; }
      if (rig) rig.dispose();
    },
  };
}
