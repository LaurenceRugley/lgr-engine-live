/* ============================================================
   @lgr/engine-core — createCharacterHorde (Lesson M1b): pool + LOD over the character rig.
   ------------------------------------------------------------
   THE ABILITY: scale createCharacterRig (M1a) from ONE character to a HORDE. A fixed pool of rigged
   instances (spawned once, recycled by index — no per-spawn allocation in play), each animated
   independently, with a distance LOD that throttles far characters' mixers to a low rate so a big crowd
   stays cheap. The Hoard's zombies become these characters (same sim, new skin).

   ── POOL: `size` characters are spawned up front (SkeletonUtils clones — shared geometry, own skeleton),
   added to one group, and hidden. The game addresses them BY INDEX (setActive(i,on) / get(i)) so it can
   mirror its own fixed zombie array 1:1 — no acquire/free bookkeeping, no allocation when a zombie spawns
   or dies (just toggle visibility + animation).

   ── LOD: update(dt, camX,camY,camZ) steps each ACTIVE character's mixer — at full rate when near the
   camera, but ACCUMULATING dt and applying it in one lump at `lodHz` (default 2 Hz) beyond `lodDistance`.
   Far zombies still animate, just coarsely — the cheap version of the taxonomy's LOD advice. Inactive
   slots are skipped entirely. Zero per-frame allocation.

   ── VARIANCE: setType(i, {scale, material}) gives walker/runner/tank cheap visual distinction — a scale
   and a per-type material (the game pre-clones a few tinted copies of the shared GLB material). No
   geometry change; the sim is untouched (representation only).

   C++ anchor: an object pool — preallocate N, hand out by index, never new/delete in the hot loop; the LOD
   accumulator is a fixed-rate sampler that batches skipped ticks into one update.

   Contract: createCharacterHorde(rig, opts) -> {
     group, size, get active,
     setActive(i, on), get(i), setType(i, {scale, material}), setState(i, name, {fade}),
     setTransform(i, x, y, z, yaw), update(dt, camX, camY, camZ), dispose(),
   }
   ============================================================ */
import * as THREE from 'three';
import { applyNightFill } from './character-night-fill.js';

export function createCharacterHorde(rig, opts = {}) {
  const size = opts.size || 48;
  const lodDistance = opts.lodDistance != null ? opts.lodDistance : 18;
  const lodHz = opts.lodHz != null ? opts.lodHz : 2;
  const baseScale = opts.baseScale != null ? opts.baseScale : 1;
  // M1 MOBILE TRUTH — two tier knobs (both default to the full desktop behaviour):
  //  • castShadow:false → this whole horde stops casting sun shadows (mobile: characters opt out of the
  //    shadow pass so the map's caster set stays STATIC and cheap — see createCityWorld's shadow throttle).
  //  • motionLayers:false → skip the per-character procedural layer pass (A1 loco-blend refinement + B3
  //    head-look IK / flinch). The base mixer still steps (walk/death clips play), but the extra per-bone
  //    IK math — a real cost across ~48 mixers on a phone — is dropped. The clips carry the read alone.
  const castShadow = opts.castShadow !== false;
  const motionLayers = opts.motionLayers !== false;
  const lod2 = lodDistance * lodDistance;
  // A7-2 FOOT IK — the distance beyond which the plant-and-hold solver is skipped (far feet aren't legible
  // and the solve costs a few updateWorldMatrix + quats per leg). Defaults to the LOD distance so the two
  // budgets line up. IK also rides motionLayers: on mobile (motionLayers:false) _applyLayers never runs, so
  // the whole horde has no foot IK for free (mobile keeps its M1 clip-only class).
  const ikDistance = opts.ikDistance != null ? opts.ikDistance : lodDistance;
  const ikDist2 = ikDistance * ikDistance;

  const group = new THREE.Group();
  const slots = [];
  for (let i = 0; i < size; i++) {
    const handle = rig.spawn({ castShadow });
    handle.object.visible = false;
    handle.scale.setScalar(baseScale);
    group.add(handle.object);
    slots.push({ handle, active: false, acc: 0 });
  }
  let activeCount = 0;
  const _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const _nfSeen = new Set();   // A2: dedup scratch for setNightFill (cleared each call, never re-alloc)

  /* ── A-CENSUS (2026-08-20): THE POOL'S GROUND RECEIPT — the aggregate of every slot's own
     `groundReport` (createCharacterRig.js). A-GROUND shipped `surfaceProbedCount` so a probe could verify
     the fan-out LANDED, and it did land — 96/96 — while zero of those 96 rigs ever took the measured
     branch, because the Quaternius zombie is a flat rig and the branch is gated on an articulated chain
     length. POSSESSION IS NOT CONSUMPTION: `surfaceProbedCount` answers "who holds a probe", this answers
     "who can and does use one". `measuredFrames 0` beside `probed 96` is the exact reading that was
     missing. Computed on demand over `size` slots (a config-time / probe-time call, never per frame). */
  function _groundReport() {
    let requested = 0, reachable = 0, probed = 0, okN = 0, frames = 0, measuredFrames = 0, measuredNow = 0;
    let reason = size ? 'ok — requested, probed, and this skeleton can take the measured branch' : 'empty pool';
    for (let i = 0; i < size; i++) {
      const r = slots[i].handle.groundReport;
      if (!r) continue;
      if (r.requested) requested++;
      if (r.reachable) reachable++;
      if (r.probed) probed++;
      if (r.ok) okN++; else if (r.reason) reason = r.reason;   // the first slot NOT ok explains the pool
      frames += r.frames; measuredFrames += r.measuredFrames;
      if (r.measured) measuredNow++;
    }
    return { slots: size, requested, reachable, probed, ok: size > 0 && okN === size, okSlots: okN,
      frames, measuredFrames, measuredNow, reason };
  }

  return {
    group,
    get size() { return size; },
    get active() { return activeCount; },
    get(i) { return slots[i].handle; },
    setActive(i, on) {
      const s = slots[i]; if (s.active === !!on) return;
      s.active = !!on; s.handle.object.visible = !!on; s.acc = 0;
      if (!on) { s.handle.mixer.stopAllAction(); s.handle.resetAnim(); }   // A1: re-arm the loco blend on recycle (see resetAnim)
      activeCount += on ? 1 : -1;
    },
    setType(i, { scale, material } = {}) {
      const h = slots[i].handle;
      if (scale != null) h.scale.setScalar(scale);
      if (material) h.object.traverse((n) => { if (n.isMesh) n.material = material; });
    },
    setState(i, name, o) { slots[i].handle.setState(name, o); },
    setTransform(i, x, y, z, yaw) {
      const h = slots[i].handle;
      h.position.set(x, y, z);
      _e.set(0, yaw, 0); h.quaternion.setFromEuler(_e);
    },
    // Step active mixers with a distance LOD (far → lodHz, accumulated). Zero alloc. B3: the procedural
    // layer pass (_applyLayers) runs right after each real mixer step, at the SAME dt, so far characters
    // get their head-look/flinch throttled with their mixer (and offsets never accumulate across skips).
    update(dt, camX, camY, camZ) {
      for (let i = 0; i < size; i++) {
        const s = slots[i]; if (!s.active) continue;
        const p = s.handle.object.position;
        const d2 = (p.x - camX) * (p.x - camX) + (p.y - camY) * (p.y - camY) + (p.z - camZ) * (p.z - camZ);
        if (motionLayers) s.handle.setFootIKActive(d2 <= ikDist2);   // A7-2: solve foot IK only on near rigs
        if (d2 > lod2) {
          s.acc += dt; const iv = 1 / lodHz;
          if (s.acc >= iv) { s.handle.mixer.update(s.acc); if (motionLayers) s.handle._applyLayers(s.acc); s.acc = 0; }
        } else {
          if (s.acc > 0) { s.handle.mixer.update(s.acc); s.acc = 0; }
          s.handle.mixer.update(dt);
          if (motionLayers) s.handle._applyLayers(dt);
        }
      }
    },
    // ---- B3 procedural-layer forwarding (the game drives these; a rig without the bones no-ops) ----
    setLookTarget(x, y, z) { for (let i = 0; i < size; i++) if (slots[i].active) slots[i].handle.setLookTarget(x, y, z); },
    clearLookTargets() { for (let i = 0; i < size; i++) slots[i].handle.clearLookTarget(); },
    hitReact(i, dx, dz) { slots[i].handle.hitReact(dx, dz); },
    setLayerParams(i, params) { slots[i].handle.setLayerParams(params); },
    setLocomotion(i, speed01, worldSpeed = null) { slots[i].handle.setLocomotion(speed01, worldSpeed); },   // A1 blend + A6-2 stride-rate m/s
    // A7-2 FOOT IK: enable plant-and-hold on the WHOLE pool (cfg) or disable (false). Applied to every pooled
    // handle so recycled slots inherit it; the per-frame distance gate (update) skips far rigs. no-op on a rig
    // whose skeleton isn't a resolvable biped.
    /* A-CENSUS (2026-08-20): RETURNS the pool's aggregated ground receipt (see `groundReport` below).
       Additive — every existing call site ignores the value and is byte-identical — but a horde can no
       longer accept `groundProbe:true` and stay silent about a pool that structurally cannot honour it. */
    setFootIK(cfg) { for (let i = 0; i < size; i++) slots[i].handle.setFootIK(cfg); return _groundReport(); },
    /* A-GROUND (2026-08-20): THE MISSING HALF OF THE FAN-OUT, and its absence is why A-CONTACT's ground
       ability could not run in any shipped build. `setFootIK` was forwarded to the pool; `setSurfaceProbe`
       was not — and the rig needs BOTH to take the measured path (createCharacterRig.js:834 tests
       `_footIK.groundProbe && _surfaceProbe`). A horde could therefore ask for a measured floor and
       silently keep the inferred one, with nothing anywhere reporting a problem: the config was accepted,
       the flag was true, and the probe it depended on had no way in. Forwarded to EVERY slot, not just
       the active ones, so a recycled slot inherits it exactly as it inherits setFootIK. */
    setSurfaceProbe(probe) { for (let i = 0; i < size; i++) slots[i].handle.setSurfaceProbe(probe); },
    /* Read-back so a probe can verify the wiring landed rather than assuming it did — the count of slots
       that actually hold a probe. A number, not a boolean, because "some slots wired" is a real failure
       mode (a fan-out that ran before the pool finished spawning) and a boolean would hide it. */
    get surfaceProbedCount() { let n = 0; for (let i = 0; i < size; i++) if (slots[i].handle.surfaceProbed) n++; return n; },
    get groundReport() { return _groundReport(); },   // A-CENSUS: possession (`surfaceProbedCount`) vs consumption — read this one for "is the measured floor actually running?"
    playAction(i, name, timeScale) { slots[i].handle.playAction(name, timeScale); },   // A1: one-shot (hit/attack) over the blend · A8-4: per-type rate
    lunge(i) { slots[i].handle.lunge(); },                                    // A5: forward attack lunge (procedural layer; no-op if motionLayers off)
    // A2 NIGHT FILL: lift the swarm off black at night. The project OVERRIDES slot materials (setType tints),
    // so we can't use the rig's source materials — walk the ACTIVE slots' actual mesh materials, deduped, and
    // apply the night emissive to each unique one (~4 tinted materials, not 42 meshes). Cheap, zero lights.
    setNightFill(nf, opts) {
      _nfSeen.clear();
      for (let i = 0; i < size; i++) {
        if (!slots[i].active) continue;
        const mesh = slots[i].handle.object;
        mesh.traverse((n) => {
          if (!n.isMesh || !n.material) return;
          const m = n.material;
          if (_nfSeen.has(m)) return; _nfSeen.add(m);
          applyNightFill(m, nf, opts);
        });
      }
    },
    dispose() { for (const s of slots) s.handle.dispose(); },
  };
}
