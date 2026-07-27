/* ============================================================
   hoard2 · src/player/combat.js — PURE combat resolution (THREE-free, node-testable).
   ------------------------------------------------------------
   The gun and melee are DEPENDENCY-INVERTED: createBallistics (engine) owns the projectile integration
   and calls back into "what does this segment hit?"; the SIM owns the zombies and the barriers live in
   BUILD. So the player's real job is to ADAPT the cross-owner facades into the shapes each side expects.
   This module is those adapters, kept pure so the intent is testable with fakes (Rule 9):

     • makeCastWorld(groundY, castBarriers)  → the ballistics `castWorld` provider: nearest of the ground
       plane and BUILD's barriers along a segment → { t, point, normal } | null.
     • makeCastTargets(queryTargets, radius) → the ballistics `castTargets` provider: SIM hands back the
       zombies a segment COULD hit (a broadphase list); we resolve the NEAREST precise sphere hit →
       { t, target, point } | null. (NEVER rasterize actors into a grid — createBallistics' FORBIDDEN note.)
     • meleeArcHits(...)                      → the stamina-priced melee: zombies inside a short forward arc.
     • gateMelee(sim, cost)                   → the pure gate: melee only lands if SIM can afford the stamina.

   ZERO per-frame alloc on the ballistics path: makeCast* reuse a single scratch record + a single segment
   object (the engine reads the record synchronously, like its own `_scratch` returns). Melee alloc is fine
   — it fires on a discrete keypress behind a cooldown, not every frame.
   ============================================================ */

// Build the ballistics castWorld(ox,oy,oz,ex,ey,ez) provider. `castBarriers(seg)` is BUILD's facade,
// seg = { o:{x,y,z}, e:{x,y,z} }, returning { point, normal, id, t } | null. The ground is the flat play
// plane at `groundY`; a dropping bullet buries into the dirt there (v1 hoard.js:277).
export function makeCastWorld(groundY, castBarriers) {
  const rec = { t: 0, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 } };
  const seg = { o: { x: 0, y: 0, z: 0 }, e: { x: 0, y: 0, z: 0 } };
  return function castWorld(ox, oy, oz, ex, ey, ez) {
    let bestT = Infinity, hx = 0, hy = 0, hz = 0, nx = 0, ny = 1, nz = 0;
    // ground plane at groundY — only when the segment descends through it (oy above, ey at/below).
    if (oy > groundY && ey <= groundY && oy !== ey) {
      const tg = (oy - groundY) / (oy - ey);
      if (tg >= 0 && tg <= 1) { bestT = tg; hx = ox + (ex - ox) * tg; hy = groundY; hz = oz + (ez - oz) * tg; nx = 0; ny = 1; nz = 0; }
    }
    if (castBarriers) {
      seg.o.x = ox; seg.o.y = oy; seg.o.z = oz; seg.e.x = ex; seg.e.y = ey; seg.e.z = ez;
      const hb = castBarriers(seg);
      if (hb && hb.t < bestT) { bestT = hb.t; hx = hb.point.x; hy = hb.point.y; hz = hb.point.z; nx = hb.normal.x; ny = hb.normal.y; nz = hb.normal.z; }
    }
    if (bestT === Infinity) return null;
    rec.t = bestT; rec.point.x = hx; rec.point.y = hy; rec.point.z = hz; rec.normal.x = nx; rec.normal.y = ny; rec.normal.z = nz;
    return rec;
  };
}

// Build the ballistics castTargets(...) provider. `queryTargets(seg)` is SIM's broadphase → an array of
// { id, x, y, z, type, hp }. We do the precise segment-vs-sphere sweep here (the entry root of the
// quadratic, v1 hoard.js:306) and return the NEAREST as { t, target, point } — `target` is the sim record
// so the game can name it in weapon:hit and SIM can match it by id.
export function makeCastTargets(queryTargets, radius = 0.45) {
  const rec = { t: 0, target: null, point: { x: 0, y: 0, z: 0 } };
  const seg = { o: { x: 0, y: 0, z: 0 }, e: { x: 0, y: 0, z: 0 } };
  return function castTargets(ox, oy, oz, ex, ey, ez) {
    const dx = ex - ox, dy = ey - oy, dz = ez - oz, a = dx * dx + dy * dy + dz * dz;
    if (a < 1e-9) return null;
    seg.o.x = ox; seg.o.y = oy; seg.o.z = oz; seg.e.x = ex; seg.e.y = ey; seg.e.z = ez;
    const cands = queryTargets(seg) || [];
    // A zombie is an UPRIGHT CYLINDER (foot→head at c.x,c.z), NOT a sphere at its centre. The player aims
    // at the cursor's GROUND point, so a centre-sphere test (y≈0.9) let every shot pass BENEATH and hit
    // the ground. We test the HORIZONTAL cylinder and return the ENTRY point (nearer quadratic root) — the
    // t where the descending projectile FIRST pierces the body column, which is ABOVE (earlier than) the
    // ground point directly under the zombie, so the zombie beats the co-located ground hit in ballistics'
    // nearest-t compare. (Closest-approach t == the ground point → ground won the tie → 4% connect.)
    const axz = dx * dx + dz * dz;
    let bestT = Infinity, best = null, hx = 0, hy = 0, hz = 0;
    const FOOT = 0.1;
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      const headY = (c.y != null ? c.y : 0.3) + 1.4;     // upright body column top (~1.4 tall)
      const fx = ox - c.x, fz = oz - c.z;
      if (axz < 1e-9) continue;                           // a purely vertical shot can't sweep a column
      // Closest x,z approach of this sub-step to the body axis (clamped into the sub-step). Catches both
      // the pass-through case AND a shot ending at the body's feet — the entry-only root missed the latter
      // (its t fell beyond the short sub-step). The flat body-height shot means py is already in-column.
      let t = -(fx * dx + fz * dz) / axz;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const px = ox + dx * t, pz = oz + dz * t, py = oy + dy * t;
      if (Math.hypot(px - c.x, pz - c.z) > radius) continue;   // horizontal miss of the body cylinder
      if (py < FOOT - radius || py > headY + radius) continue; // above head / below feet
      if (t < bestT) { bestT = t; best = c; hx = px; hy = py; hz = pz; }
    }
    if (!best) return null;
    rec.t = bestT; rec.target = best; rec.point.x = hx; rec.point.y = hy; rec.point.z = hz;
    return rec;
  };
}

// Zombies inside a short forward melee arc from (px,pz) facing `facing`. `candidates` = SIM's queryTargets
// list for the melee segment. A hit needs to be within `range` (+ a little for body size) AND within the
// wedge (dot of the to-target unit vector with the facing dir ≥ arcCosMin). Returns a fresh array (melee is
// a discrete, cooldown-gated verb — not a per-frame path — so this small alloc is fine).
export function meleeArcHits(px, pz, facing, range, arcCosMin, candidates) {
  const fx = Math.sin(facing), fz = Math.cos(facing);
  const hits = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const dx = c.x - px, dz = c.z - pz, d = Math.hypot(dx, dz);
    if (d > range) continue;
    if (((dx * fx + dz * fz) / (d || 1)) >= arcCosMin) hits.push(c);
  }
  return hits;
}

// The stamina gate for melee: a swing only RESOLVES if SIM can afford the cost. Returns true when the
// stamina was spent (and the caller should resolve the arc), false when the swing is refused (too tired).
// Isolated so the "risk = you can be caught mid-swing with no stamina" intent is testable with a fake sim.
export function gateMelee(sim, cost) {
  return !!(sim && typeof sim.trySpendStamina === 'function' && sim.trySpendStamina(cost));
}
