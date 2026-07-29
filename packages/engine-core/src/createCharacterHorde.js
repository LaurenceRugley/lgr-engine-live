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
  const lod2 = lodDistance * lodDistance;

  const group = new THREE.Group();
  const slots = [];
  for (let i = 0; i < size; i++) {
    const handle = rig.spawn();
    handle.object.visible = false;
    handle.scale.setScalar(baseScale);
    group.add(handle.object);
    slots.push({ handle, active: false, acc: 0 });
  }
  let activeCount = 0;
  const _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const _nfSeen = new Set();   // A2: dedup scratch for setNightFill (cleared each call, never re-alloc)

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
        if (d2 > lod2) {
          s.acc += dt; const iv = 1 / lodHz;
          if (s.acc >= iv) { s.handle.mixer.update(s.acc); s.handle._applyLayers(s.acc); s.acc = 0; }
        } else {
          if (s.acc > 0) { s.handle.mixer.update(s.acc); s.acc = 0; }
          s.handle.mixer.update(dt);
          s.handle._applyLayers(dt);
        }
      }
    },
    // ---- B3 procedural-layer forwarding (the game drives these; a rig without the bones no-ops) ----
    setLookTarget(x, y, z) { for (let i = 0; i < size; i++) if (slots[i].active) slots[i].handle.setLookTarget(x, y, z); },
    clearLookTargets() { for (let i = 0; i < size; i++) slots[i].handle.clearLookTarget(); },
    hitReact(i, dx, dz) { slots[i].handle.hitReact(dx, dz); },
    setLayerParams(i, params) { slots[i].handle.setLayerParams(params); },
    setLocomotion(i, speed01) { slots[i].handle.setLocomotion(speed01); },   // A1: velocity-driven idle/walk/run blend
    playAction(i, name) { slots[i].handle.playAction(name); },               // A1: one-shot (hit/attack) over the blend
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
