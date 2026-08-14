/* ============================================================
   @lgr/engine-core — createCrowdTiers (A-CITIZENS, 2026-08-12): the tier A/B crowd renderer.
   ------------------------------------------------------------
   THE ABILITY (research doc §2, the tier plan): render a pooled agent population as SKINNED RIGS near
   the camera (tier A — createCharacterHorde, the expensive, legible representation) and INSTANCED
   CAPSULES far (tier B — one draw call for everyone else), with agents PROMOTED and DEMOTED between
   tiers by camera distance. The horde was designed index-addressed (`setActive(i,on)`) for exactly this
   seam — an agent record acquires/releases a horde slot; nothing else moves.

   WHY TIERS AND NOT MORE RIGS: the skinned rig is the binding constraint at scale (each clone owns a
   skeleton + mixer; the bench puts a hard ceiling on how many run at 60 fps), while instanced capsules
   are effectively free (a thousand is one draw call). The tier split is what buys "a populated city"
   at all — density lives in tier B, legibility lives in tier A.

   THE SEAM'S ANTI-POP RULES (cheap, no cross-fade):
     · HYSTERESIS — promote inside `tierRadius`, demote only past `tierRadius + hysteresis`, so an agent
       on the boundary doesn't strobe between representations;
     · COLOUR CONTINUITY — the capsule wears the SAME per-agent tint (and the same E-state green ramp)
       as the rig's material, so a swap reads as a detail change, not an identity change;
     · the swap happens at a distance where the silhouette is small; the bench + captures judge it.

   THE INFECTION AXIS IS THE RENDERER'S JOB HERE (hoard2's mirrorCivs pattern, lifted): S wears its
   street tint · E LERPS street→sickly green across the incubation window and stumbles on a tightening
   beat (THE TELEGRAPH — legibility is the outbreak's whole point) · I wears full infected green. Greens
   belong to the infection axis alone — keep them out of `palette` (the A-OUTBREAK capture lesson).

   Presentation ONLY: reads the sim's records (alive/x/z/vx/vz/state/incubT/incubDur), never writes,
   never rolls — the sim trace is unmoved by rendering (the determinism doctrine's render half).

   C++ anchor: tier assignment is a slot allocator over a fixed pool — `slotAgent[]`/`agentSlot[]` are
   the two sides of a bidirectional index map, and promote/demote is alloc/free with an LRU-ish policy
   (nearest wins) instead of malloc.

   ---- A-AERIAL (2026-08-13): THE STATE MARK, i.e. swing-ledger OPEN #25 ---------------------------
   OPEN #25, measured rather than asserted: at 150-civilian density the outbreak is unmistakable at
   street level and READS AT 61–75% FROM SWING HEIGHT (`tools/city-legibility.mjs`, two baseline runs,
   the fraction of infected with a clear line of sight that put a single infection-coloured pixel on
   their own patch of screen). Two independent causes, and naming both is what picks the cure:

     · LUMINANCE — a body in a shadowed canyon is dark, and the state colour is a DIFFUSE albedo, so
       everything that says "infected" is multiplied by whatever light is not reaching the street.
     · SOLID ANGLE — a 0.26 u body at 13 u is about eight device pixels tall, and it is the SAME eight
       pixels whether it is a civilian or a corpse-in-waiting.

   `mark` is the cure and it is one mechanism for both: an UNLIT (tone-mapping-exempt) marker above the
   head, at a CONSTANT APPARENT SIZE — `angular` world-units of radius per unit of camera distance, so
   the thing does not shrink as the rope carries you up. Unlit answers the shadow; constant apparent
   size answers the range. Both halves are measurable separately (`angular: 0` is the unlit-only arm)
   and the ablation is in the ledger, because "a combination" is a claim that owes two numbers.

   ONE EXTRA DRAW CALL, and only while there is an outbreak to see: it is a second InstancedMesh, and
   the mesh is hidden at count 0. Marks are worn by BOTH tiers — an agent does not change what it is
   when it changes how it is drawn (the colour-continuity rule above, applied to the mark).

   DEFAULT null = EXACT NO-OP: with `mark` unset the geometry, the material and the mesh are never
   constructed and `update` never enters the block. Every existing consumer renders byte-identically.

   Contract: createCrowdTiers({ rig, size, tierA, tierRadius, hysteresis, baseScale, groundY,
     capsule: { radius, height }, palette, eTint, iTint, speedRef, eBeatMax, eBeatMin,
     castShadow, motionLayers, lodDistance, lodHz, mark }) -> {
     group,                         // add to the scene (horde group + capsule mesh + marks)
     update(dt, camX, camY, camZ, src),   // src = the agent sim (forEach/get/max)
     counts,                        // { a, b, marks } — live tier populations after the last update
     ready,                         // the rig's own ready promise (capsules render before it lands)
     dispose(),
   }
   ============================================================ */
import * as THREE from 'three';
import { createCharacterHorde } from './createCharacterHorde.js';

export function createCrowdTiers({
  rig,
  size = 128,               // the agent pool size — tier B instancing is sized to ALL of it
  tierA = 12,               // skinned-rig budget (THE BENCH DIAL — see the city population bench)
  tierRadius = 7,           // promote inside this camera distance
  hysteresis = 1.5,         // demote only past tierRadius + hysteresis (the anti-strobe band)
  baseScale = 1,
  groundY = 0,
  capsule = { radius: 0.028, height: 0.2 },
  palette = [0xd9c8a6, 0x9db3d1, 0xc98f7d, 0x9a7f63, 0xcdb8c2, 0x8fa0a8], // hoard2 street clothes — NO GREENS
  eTint = 0x7fae4e,         // the sickly green every base tint ramps toward
  iTint = 0x4e7a2e,         // full infected — darker than eTint so a TURN still reads as an event
  speedRef = 0.6,           // full-run world speed for the locomotion blend (per-consumer scale)
  eBeatMax = 1.6, eBeatMin = 0.7, // the stumble beat: fires every eBeatMax s at k0, tightening to eBeatMin
  castShadow = true, motionLayers = true, lodDistance = 6, lodHz = 3,
  /* A-AERIAL — the outbreak's aerial read. null (the default) is an EXACT no-op: nothing below is
     constructed and no branch of `update` runs. See the header for why it is unlit AND scaled. */
  mark = null,
} = {}) {
  const group = new THREE.Group();
  group.name = 'crowd-tiers';

  /* ---- TIER A: the skinned horde, tierA slots, per-slot materials for the tint ramp. ----------
     CONSTRUCTED ONLY AFTER rig.ready — createCharacterHorde spawns its clones at construction and
     the rig throws "[M1a] rig not ready" on a synchronous spawn (measured: the first city boot died
     on exactly that line; hoard2's own mirror defers the same way). Until the promise lands — and
     FOREVER if the asset is missing — `horde` is null and tier B's capsules carry the whole crowd,
     so the sim and the page never wait on a GLB. */
  let horde = null;
  const _aMats = [], _aBase = [];    // per-SLOT material clone + its current street colour
  let _matsReady = false;
  const ready = rig.ready.then(() => {
    horde = createCharacterHorde(rig, { size: tierA, lodDistance, lodHz, baseScale, castShadow, motionLayers });
    group.add(horde.group);
    try {
      let base = null; horde.get(0).object.traverse((n) => { if (n.isMesh && !base) base = n.material; });
      if (base) {
        for (let i = 0; i < tierA; i++) {
          const m = base.clone();
          _aMats.push(m); _aBase.push(new THREE.Color(0xffffff));
          horde.setType(i, { material: m });
        }
        _matsReady = true;
      }
    } catch (_e) { /* tint is cosmetic — untinted rigs still read via silhouette + gait */ }
  }).catch(() => { /* asset missing → capsules carry the whole crowd; sim untouched */ });

  /* ---- TIER B: one InstancedMesh of capsules, per-instance colour, compact-written each frame ---- */
  const bGeo = new THREE.CapsuleGeometry(capsule.radius, Math.max(0.001, capsule.height - 2 * capsule.radius), 3, 8);
  const bMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, flatShading: true });
  const caps = new THREE.InstancedMesh(bGeo, bMat, Math.max(1, size));
  caps.castShadow = false;           // far bodies; the saved shadow pass is most of tier B being free
  caps.receiveShadow = false;
  caps.frustumCulled = false;        // one draw; the crowd surrounds the camera anyway
  caps.count = 0;
  group.add(caps);

  /* ---- A-AERIAL: THE STATE MARK — one more InstancedMesh, built only when asked for. -------------
     WHY AN OCTAHEDRON AND NOT A SPRITE. A billboard needs the camera QUATERNION, which `update` is
     not given (it takes a position, deliberately — the tier seam only ever needed a distance), and
     adding one would change the signature for every existing consumer. An octahedron reads as the
     same compact diamond from every direction including straight down, which is the direction the
     ledger's complaint is about, and it costs 8 triangles.
     WHY UNLIT (MeshBasicMaterial, toneMapped false). The first cause named in the header is that the
     state colour is an ALBEDO in a shadowed canyon. A lit marker would inherit exactly that problem;
     a tone-mapped one would inherit the scene's exposure. This is a SIGNAL, and a signal that dims
     with the sun is not one. depthTest stays ON: a mark behind a tower must not shine through it —
     "the outbreak is legible where you can see it" is the claim, not x-ray vision. */
  const MK = mark ? {
    states: 'ei',
    height: capsule.height + 0.09,   // a hand's breadth above the head, so it never hides the body
    minSize: 0.05,                   // world RADIUS floor — what the mark is worth up close
    angular: 0.0075,                 // world radius per unit of camera distance (constant apparent size)
    eColor: null, iColor: null,      // default: the state ramp, lifted toward full value (see below)
    opacity: 1,
    ...mark,
  } : null;
  let marks = null, mkGeo = null, mkMat = null;
  const _mkE = new THREE.Color(), _mkI = new THREE.Color(), _mkC = new THREE.Color();
  if (MK) {
    mkGeo = new THREE.OctahedronGeometry(1, 0);
    mkMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, toneMapped: false,
      transparent: MK.opacity < 1, opacity: MK.opacity,
    });
    marks = new THREE.InstancedMesh(mkGeo, mkMat, Math.max(1, size));
    marks.castShadow = false; marks.receiveShadow = false;
    marks.frustumCulled = false;
    marks.count = 0; marks.visible = false;
    marks.name = 'crowd-marks';
    group.add(marks);
    /* THE MARK'S COLOURS ARE THE STATE COLOURS AT FULL VALUE. Taking `eTint`/`iTint` verbatim would
       ship a marker that is darker than the body it labels once the body is lit — the ramp is an
       albedo and this is emission. `setHSL` with the hue/saturation kept and the lightness raised is
       the smallest change that keeps "green means infected" true across both representations. */
    const lift = (hex, l) => { const c = new THREE.Color(hex); const h = { h: 0, s: 0, l: 0 }; c.getHSL(h); c.setHSL(h.h, Math.min(1, h.s * 1.35), l); return c; };
    _mkE.copy(MK.eColor != null ? new THREE.Color(MK.eColor) : lift(eTint, 0.62));
    _mkI.copy(MK.iColor != null ? new THREE.Color(MK.iColor) : lift(iTint, 0.52));
  }

  /* ---- the slot map (fixed, no per-frame alloc) ---- */
  const agentSlot = new Int32Array(size).fill(-1);   // agent id → horde slot (or −1 = tier B)
  const slotAgent = new Int32Array(tierA).fill(-1);  // horde slot → agent id (or −1 = free)
  const _yaw = new Float32Array(tierA).fill(999);    // displayed yaw per SLOT (999 = snap on assign)
  const _d2 = new Float64Array(size);                // camera distance² per agent, this frame
  const _cand = new Int32Array(size);                // promote candidates (ids), partial-sorted
  const _col = new THREE.Color(), _base = new THREE.Color(), _eCol = new THREE.Color(eTint), _iCol = new THREE.Color(iTint);
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
  const counts = { a: 0, b: 0, marks: 0 };
  const promoteR2 = tierRadius * tierRadius;
  const demoteR2 = (tierRadius + hysteresis) * (tierRadius + hysteresis);
  const capsY = groundY + capsule.height / 2;

  const baseTint = (id) => _base.setHex(palette[id % palette.length]);
  /* state colour into _col: S = street tint · E = street→green by k · I = infected green. ONE ramp,
     worn by BOTH tiers — that identity is the anti-pop colour-continuity rule. */
  function stateColor(c) {
    if (c.state === 'i') { _col.copy(_iCol); return _col; }
    baseTint(c.id);
    if (c.state === 'e') { const k = Math.min(1, c.incubT / (c.incubDur || 1)); _col.lerpColors(_base, _eCol, k); }
    else _col.copy(_base);
    return _col;
  }

  function update(dt, camX, camY, camZ, src) {
    const n = src.max;
    /* 1 · distances + demote (dead, or past the hysteresis band) */
    for (let id = 0; id < n; id++) {
      const c = src.get(id);
      if (!c.alive) { _d2[id] = Infinity; continue; }
      const dx = c.x - camX, dz = c.z - camZ;
      _d2[id] = dx * dx + dz * dz;
    }
    /* tier A exists only once the rig has landed (see the construction note) — before that, and if
       the asset never arrives, every agent stays a capsule and steps 1b–3 never run. */
    if (horde) {
    for (let slot = 0; slot < tierA; slot++) {
      const id = slotAgent[slot];
      if (id < 0) continue;
      if (_d2[id] === Infinity || _d2[id] > demoteR2) {
        slotAgent[slot] = -1; agentSlot[id] = -1; _yaw[slot] = 999;
        horde.setActive(slot, false);
      }
    }
    /* 2 · promote: nearest unassigned agents inside tierRadius, into free slots (nearest wins) */
    let free = 0;
    for (let slot = 0; slot < tierA; slot++) if (slotAgent[slot] < 0) free++;
    if (free > 0) {
      let nc = 0;
      for (let id = 0; id < n; id++) if (agentSlot[id] < 0 && _d2[id] <= promoteR2) _cand[nc++] = id;
      // partial selection sort: only the `free` nearest matter (free ≤ tierA, small)
      const take = Math.min(free, nc);
      for (let t = 0; t < take; t++) {
        let bi = t;
        for (let j = t + 1; j < nc; j++) if (_d2[_cand[j]] < _d2[_cand[bi]]) bi = j;
        const tmp = _cand[t]; _cand[t] = _cand[bi]; _cand[bi] = tmp;
        const id = _cand[t];
        for (let slot = 0; slot < tierA; slot++) if (slotAgent[slot] < 0) {
          slotAgent[slot] = id; agentSlot[id] = slot;
          horde.setActive(slot, true);
          break;
        }
      }
    }
    /* 3 · tier A mirror: transform + yaw slew + locomotion + the E telegraph (hoard2 mirrorCivs, lifted) */
    counts.a = 0;
    for (let slot = 0; slot < tierA; slot++) {
      const id = slotAgent[slot];
      if (id < 0) continue;
      const c = src.get(id);
      counts.a++;
      const sp = Math.hypot(c.vx, c.vz);
      horde.setLocomotion(slot, Math.min(1, sp / speedRef));
      if (_matsReady && _aMats[slot]) {
        _aMats[slot].color.copy(stateColor(c));
        if (c.state === 'e') {
          // the stumble beat: every eBeatMax s at k0, tightening toward eBeatMin near the turn
          const k = Math.min(1, c.incubT / (c.incubDur || 1));
          const period = eBeatMax - (eBeatMax - eBeatMin) * k;
          if (c.incubT % period < dt) { horde.playAction(slot, 'hit'); horde.hitReact(slot, c.vx, c.vz); }
        }
      }
      // face the velocity with a capped slew (hoard2's A6-2 turn-in-place rule, same reason)
      let yaw = _yaw[slot];
      const tgt = sp > 0.04 * speedRef ? Math.atan2(c.vx, c.vz) : (yaw === 999 ? 0 : yaw);
      if (yaw === 999) yaw = tgt;
      else {
        let d = tgt - yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        const stp = 6 * dt; yaw += d > stp ? stp : d < -stp ? -stp : d;
      }
      _yaw[slot] = yaw;
      horde.setTransform(slot, c.x, groundY, c.z, yaw);
    }
    horde.update(dt, camX, camY, camZ);
    } else counts.a = 0;   // no rig yet — tier B below carries everyone
    /* 4 · tier B mirror: every live agent WITHOUT a slot becomes a capsule instance (compact write) */
    let j = 0;
    for (let id = 0; id < n; id++) {
      const c = src.get(id);
      if (!c.alive || agentSlot[id] >= 0) continue;
      _p.set(c.x, capsY, c.z);
      _m.compose(_p, _q, _s);
      caps.setMatrixAt(j, _m);
      caps.setColorAt(j, stateColor(c));
      j++;
    }
    caps.count = j;
    counts.b = j;
    if (j > 0) { caps.instanceMatrix.needsUpdate = true; if (caps.instanceColor) caps.instanceColor.needsUpdate = true; }

    /* 5 · A-AERIAL: the state marks. A SECOND pass over the same records rather than a branch inside
       steps 3 and 4, because the mark is worn by both tiers and its instance buffer is compact — one
       loop that writes indices 0..m is simpler than two loops sharing a cursor, and this whole block
       does not exist when `mark` is null. `_d2` was filled in step 1, so the distance is already paid
       for; `Math.sqrt` here is the only new arithmetic per marked agent. */
    if (MK) {
      let m = 0;
      for (let id = 0; id < n; id++) {
        const c = src.get(id);
        if (!c.alive || MK.states.indexOf(c.state) < 0) continue;
        const dist = Math.sqrt(_d2[id]);
        const sz = Math.max(MK.minSize, MK.angular * dist);
        _p.set(c.x, groundY + MK.height + sz, c.z);
        _s.set(sz, sz, sz);
        _m.compose(_p, _q, _s);
        marks.setMatrixAt(m, _m);
        /* E ramps toward the infected mark across the incubation window, exactly as the BODY does —
           the telegraph is the outbreak's whole point and a mark that only appeared at the turn would
           delete the warning the street-level read already gives. */
        if (c.state === 'i') _mkC.copy(_mkI);
        else _mkC.lerpColors(_mkE, _mkI, Math.min(1, c.incubT / (c.incubDur || 1)) * 0.5);
        marks.setColorAt(m, _mkC);
        m++;
      }
      _s.set(1, 1, 1);              // the shared scratch is the capsule pass's identity scale — restore it
      marks.count = m;
      counts.marks = m;
      marks.visible = m > 0;        // no outbreak, no mesh, no draw call
      if (m > 0) { marks.instanceMatrix.needsUpdate = true; if (marks.instanceColor) marks.instanceColor.needsUpdate = true; }
    }
  }

  return {
    group, update, counts, ready,
    dispose() {
      if (horde) { horde.dispose(); group.remove(horde.group); horde = null; }
      caps.dispose(); group.remove(caps);
      bGeo.dispose(); bMat.dispose();
      if (marks) { marks.dispose(); group.remove(marks); mkGeo.dispose(); mkMat.dispose(); marks = null; }
      for (const m of _aMats) m.dispose();
    },
  };
}
