/* ============================================================
   inspect.js — Lesson 63: the INSPECTION LENS (free-fly + click-to-follow any world object).
   ------------------------------------------------------------
   Laurence wants to fly through the living city and LOCK the camera onto things — a car, a
   pedestrian, a gull, a boat, a cloud — to watch their loops + agent behaviour and "get a feel
   for the environments our engine can create." This module is the reusable lens: a small
   FOLLOWABLES REGISTRY + a picker + a target cycler. It drives the camera-rig's L63 follow seam
   (`rig.setFollow`); the rig owns the buttery damped tracking, this owns "which object, and what
   is it doing right now."

   THE REGISTRY = a polymorphic list of followables. Each entity module (agents.js cars/people,
   water-life.js boats/gulls/fish, clouds.js) exposes `getFollowables()` returning descriptors:

       { kind, label, getWorldPos(outVec3), info(), active?() }

   - `kind`  ∈ car | person | boat | gull | fish | cloud  (extensible: heli/plane just register too)
   - `getWorldPos(out)` writes the object's LIVE world position (read fresh every frame)
   - `info()` returns a short live behaviour string ("car · main ave → N", "gull · circling pier")
   - `active?()` optional — false when the object is currently hidden (rush-hour-thinned car, a
     recycled cloud) so we never pick or follow something invisible.
   C++ anchor: `std::vector<IFollowable*>` assembled from each subsystem — the inspector calls the
   same tiny interface on every kind without knowing their internals.

   PICKING IS SCREEN-SPACE NEAREST, not mesh raycasting. We project each followable's world point
   to NDC and take the nearest to the tap within a small radius. This is uniform across wildly
   different entity types — INSTANCED cars (no per-instance mesh to hit), billboard sprites, Groups
   — because all we need from each is one world position. (A mesh raycast would need per-kind
   instanceId/▒geometry handling; nearest-point is simpler AND forgiving on touch.)
   ============================================================ */
import * as THREE from 'three';

/* Auto-frame inspection DISTANCE per kind (perspective dolly, world units): how close the rig
   pulls in when you lock on. Small things get a tight frame; a whole cloud needs room. */
const FRAME_BY_KIND = { person: 4.5, car: 6, gull: 6, fish: 8, boat: 9, cloud: 16 };

export function createInspector({ rig, getCamera, sources = [] }) {
  let focus = null;
  const _w = new THREE.Vector3(), _s = new THREE.Vector3();

  // flatten the registry fresh each call (entity modules return STABLE descriptor objects, so
  // identity holds across frames — that's what lets `cycle` find the current focus in the list).
  const all = () => {
    const out = [];
    for (const s of sources) if (s && s.getFollowables) { const fs = s.getFollowables(); if (fs) out.push(...fs); }
    return out;
  };
  const isActive = (f) => !f.active || f.active();

  function follow(f) {
    if (!f) return null;
    focus = f;
    rig.setFollow((out) => f.getWorldPos(out), { frame: f.frame ?? FRAME_BY_KIND[f.kind] ?? 8 });
    return f;
  }
  function release() { focus = null; rig.clearFollow(); }

  /* pickAt(ndcX, ndcY): the nearest ACTIVE followable to a tap, in screen space, within `maxR`
     (NDC units; the viewport is 2 wide, so 0.14 ≈ 7% of the screen — a forgiving touch target).
     Returns + follows it, or null on a miss (caller treats a miss as "click empty" → release). */
  function pickAt(ndcX, ndcY, maxR = 0.14) {
    const cam = getCamera();
    let best = null, bestD = maxR;
    for (const f of all()) {
      if (!isActive(f)) continue;
      f.getWorldPos(_w); _s.copy(_w).project(cam);
      if (_s.z > 1 || _s.z < -1) continue;          // outside the frustum depth (behind / beyond)
      const d = Math.hypot(_s.x - ndcX, _s.y - ndcY);
      if (d < bestD) { bestD = d; best = f; }
    }
    return best ? follow(best) : null;
  }

  /* cycle(dir, kind?): hop to the next/prev followable. With no `kind` filter we INTERLEAVE the list by
     kind (car, person, boat, gull, fish, cloud, then the 2nd of each, …) so Tab samples VARIETY instead
     of stepping through all 12 cars first — you hop car→person→boat→gull without hunting. Wraps around. */
  function cycle(dir = 1, kind = null) {
    let list = all().filter((f) => (!kind || f.kind === kind) && isActive(f));
    if (!kind) list = interleaveByKind(list);
    if (!list.length) return null;
    let i = focus ? list.indexOf(focus) : -1;
    i = (((i + dir) % list.length) + list.length) % list.length;
    return follow(list[i]);
  }

  /* The city calls this each frame: if the focused object went inactive (its car got thinned out at
     night, its cloud recycled off-screen), release so the camera doesn't track a ghost underground. */
  function prune() { if (focus && focus.active && !focus.active()) release(); }

  return {
    pickAt, cycle, follow, release, prune,
    get focus() { return focus; },
    get count() { return all().length; },
    // the live behaviour readout for the focused object (null if free) — the inspect overlay reads this.
    get readout() { return focus ? { kind: focus.kind, label: focus.label, info: focus.info ? focus.info() : '' } : null; },
  };
}

/* Round-robin a flat followable list by kind: [car1,car2,boat1,gull1] → [car1,boat1,gull1,car2].
   So a plain Tab-cycle samples the variety of the living world instead of marching through one kind. */
function interleaveByKind(list) {
  const byKind = new Map();
  for (const f of list) { if (!byKind.has(f.kind)) byKind.set(f.kind, []); byKind.get(f.kind).push(f); }
  const groups = [...byKind.values()], out = [];
  for (let i = 0, more = true; more; i++) {
    more = false;
    for (const g of groups) if (i < g.length) { out.push(g[i]); more = true; }
  }
  return out;
}
