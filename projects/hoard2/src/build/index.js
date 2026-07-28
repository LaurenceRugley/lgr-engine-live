/* ============================================================
   hoard2 · src/build — the `build` owner: fortification + harvesting + obstacle registration.
   ------------------------------------------------------------
   OWNS: placeable barriers with HP that zombies breach and the player repairs; materials from BOTH
   zombie drops AND environment harvesting (wood from the forest, scrap from the ruins — DONE #4,
   both must matter); and obstacle registration for sim's flow field + the player's walker + the
   player's ballistics castWorld.

   The LOGIC (geometry, economy, HP model) lives in barrier-core.js — pure, THREE-free, unit-tested.
   THIS file is the WIRING: it owns the THREE mesh mirror of each barrier, the material stock, the
   event emissions (build is the SOLE emitter of `barrier:*` + `harvest:gain`), the lazy cross-owner
   reads (player pose, world harvest nodes), and the probe hooks the harness drives.

   Cross-owner talk is registry + events ONLY (no cross-dir imports). We resolve `player` and `world`
   LAZILY inside handlers/update — never at construction — because all six owners register before the
   first frame but not necessarily before this factory runs (INTEGRATION §Rule).

   FACADE: register('build', { castBarriers(seg), aabbs(), hitBarrier(id,amount), materials(), update }).
     • castBarriers(seg): seg = { o:{x,y,z}, e:{x,y,z} } (SAME shape as sim.queryTargets, for the
       player to fold into castWorld). Returns nearest barrier hit { point, normal, id, t } or null.
   EMITS: harvest:gain {material,amount,source} · barrier:place/damage/breach/repair {id,seg,hp,cx,cz}.
   PROBE: placeBarrier · breachNearest · repairNearest · harvestWood · harvestScrap.

   C++ anchor: the factory closes over its state like a class instance; the returned facade is its
   vtable of public methods, and probe.* are friend hooks the test harness reaches in through.
   ============================================================ */
import { createBarrierField, canAfford, BARRIER_COST, HARVEST } from './barrier-core.js';
import * as config from '../core/config.js';

export function createBuild(ctx) {
  const { registry, events, THREE, scene } = ctx;

  const field = createBarrierField();
  const stock = { wood: 0, scrap: 0 }; // material inventory (fed by harvest + drops)

  // Depletion ledger for world harvest nodes, keyed by position. World's harvestNodes() is the
  // source of truth for WHERE + how much; we track what WE'VE taken so a node empties out.
  const nodeLedger = new Map(); // "x,z" -> remaining amount

  // ---- THREE mesh mirror (runtime only; absent in node tests since ctx has no THREE there) ----
  const meshes = new Map(); // barrier id -> THREE.Mesh
  let barrierGeo = null, barrierMat = null;
  if (THREE && scene) {
    // One shared geometry/material; per-barrier meshes are scaled/posed. FORGE wood-plank material
    // (Beauty B1) when the world baked it (ctx.surfaces.wood); flat decay-wood fallback otherwise
    // (node tests / iOS-p0). Engine-first: the barrier just WIRES a core-baked material.
    barrierGeo = new THREE.BoxGeometry(1, 1, 1);
    barrierMat = (ctx.surfaces && ctx.surfaces.wood)
      || new THREE.MeshStandardMaterial({ color: 0x7a5a36, roughness: 0.92, metalness: 0.0, flatShading: true });
  }
  function spawnMesh(b) {
    if (!barrierGeo) return;
    const m = new THREE.Mesh(barrierGeo, barrierMat);
    m.position.set(b.cx, (b.miny + b.maxy) / 2, b.cz);
    m.scale.set(b.maxx - b.minx, b.maxy - b.miny, b.maxz - b.minz);
    scene.add(m);
    meshes.set(b.id, m);
  }
  function refreshMesh(b) {
    const m = meshes.get(b.id);
    if (!m) return;
    m.visible = b.alive;
    // Sag toward the ground as HP drops (weight/feel; mutate in place — no per-frame alloc).
    const frac = b.hp / b.hpMax;
    m.scale.y = (b.maxy - b.miny) * (0.35 + 0.65 * frac);
  }
  function removeMesh(id) {
    const m = meshes.get(id);
    if (m) { scene.remove(m); meshes.delete(id); }
  }

  // ---- reused event payloads (engine-invariants #7: no per-frame/hot alloc for repeat emits) ----
  const dmgPayload = { id: 0, seg: 0, hp: 0, cx: 0, cz: 0 };
  const gainPayload = { material: '', amount: 0, source: '' };

  function emitBarrier(name, b) {
    // One-shot-ish barrier events; reuse the scratch to stay alloc-free even under a breach storm.
    dmgPayload.id = b.id; dmgPayload.seg = 0; dmgPayload.hp = b.hp; dmgPayload.cx = b.cx; dmgPayload.cz = b.cz;
    events.emit(name, dmgPayload);
  }
  function emitGain(material, amount, source) {
    if (amount <= 0) return;
    if (material === 'wood') stock.wood += amount; else if (material === 'scrap') stock.scrap += amount;
    gainPayload.material = material; gainPayload.amount = amount; gainPayload.source = source;
    events.emit('harvest:gain', gainPayload);
  }

  // ---- placement ----
  // Where to place: in front of the player if the player facade is up, else a fixed fallback spot.
  // dir is chosen so the wall face is broadside to the player's facing (a wall you hide behind).
  const scratchPose = { x: 0, z: 0, facing: 0 };
  function placementPose() {
    if (registry.has('player')) {
      const p = registry.get('player').player;
      if (p) { scratchPose.x = p.x; scratchPose.z = p.z; scratchPose.facing = p.facing || 0; return scratchPose; }
    }
    scratchPose.x = 0; scratchPose.z = 3; scratchPose.facing = 0;
    return scratchPose;
  }
  function place({ free = false } = {}) {
    if (!free) {
      if (!canAfford(stock)) return null; // can't afford → no-op (ui gates this; guard anyway)
      stock.wood -= BARRIER_COST.wood; stock.scrap -= BARRIER_COST.scrap;
    }
    const pose = placementPose();
    // Drop the wall ~2.2m ahead of the survivor, broadside to facing (facing 0 = +z → wall runs x).
    const ahead = 2.2;
    const cx = pose.x + Math.sin(pose.facing) * ahead;
    const cz = pose.z + Math.cos(pose.facing) * ahead;
    const dir = Math.abs(Math.sin(pose.facing)) > Math.abs(Math.cos(pose.facing)) ? 'z' : 'x';
    const b = field.place(cx, cz, dir);
    spawnMesh(b);
    emitBarrier('barrier:place', b);
    return b;
  }

  // ---- harvest ----
  function nodeKey(n) { return `${n.x},${n.z}`; }
  function remainingOf(n) {
    const k = nodeKey(n);
    if (!nodeLedger.has(k)) nodeLedger.set(k, n.amount ?? 0);
    return nodeLedger.get(k);
  }
  function takeFromNode(n, want) {
    const k = nodeKey(n);
    const rem = remainingOf(n);
    const got = Math.max(0, Math.min(rem, want));
    nodeLedger.set(k, rem - got);
    return got;
  }
  function harvest(material) {
    if (!registry.has('world')) return 0;
    const nodes = registry.get('world').harvestNodes();
    const list = (material === 'wood' ? nodes.wood : nodes.scrap) || [];
    const pose = placementPose();
    // nearest node with anything left
    let best = null, bestD = Infinity;
    for (const n of list) {
      if (remainingOf(n) <= 0) continue;
      const dx = n.x - pose.x, dz = n.z - pose.z, d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = n; }
    }
    if (!best) return 0;
    const want = material === 'wood' ? HARVEST.woodPerAction : HARVEST.scrapPerAction;
    const got = takeFromNode(best, want);
    emitGain(material, got, material === 'wood' ? 'forest' : 'ruins');
    return got;
  }

  // ---- facade method: hitBarrier (sim calls this when a zombie attacks a wall) ----
  function hitBarrier(id, amount) {
    const r = field.hit(id, amount);
    if (!r) return; // unknown/already-gone id → no-op (fail soft; the wall is already down)
    emitBarrier('barrier:damage', r.b);
    if (r.breached) { emitBarrier('barrier:breach', r.b); removeMesh(r.b.id); }
    refreshMesh(r.b);
  }

  // ---- repair (craft repair-kit → restore a wall) ----
  function repairNearest(amount = config.BUILD.repairKitHp) {
    const b = field.mostDamaged();
    if (!b) return null;
    const wasDead = !b.alive;
    field.repair(b.id, amount);
    if (wasDead && b.alive) spawnMesh(b); // breached wall stands back up
    refreshMesh(b);
    emitBarrier('barrier:repair', b);
    return b;
  }

  // ---- event wiring ----
  const disposers = [];
  // ui → build: crafting a barrier places one; crafting/using a repair kit repairs the worst wall.
  disposers.push(events.on('craft', (p) => {
    const recipe = p && p.recipe;
    if (recipe === 'barrier') place();
    else if (recipe === 'repairkit' || recipe === 'repair') repairNearest();
  }));
  // sim → build: a dead zombie may drop scrap (and/or wood). drops = { scrap?, wood?, ... }.
  disposers.push(events.on('zombie:death', (p) => {
    const drops = p && p.drops;
    if (!drops) return;
    if (drops.scrap) emitGain('scrap', drops.scrap, 'drop');
    else emitGain('scrap', HARVEST.dropScrap, 'drop'); // default: every kill sheds a little scrap
    if (drops.wood) emitGain('wood', drops.wood, 'drop');
  }));

  const facade = {
    // player folds this into castWorld: nearest barrier segment hit or null.
    castBarriers(seg) {
      if (!seg || !seg.o || !seg.e) return null;
      return field.cast(seg.o, seg.e);
    },
    aabbs: () => field.aabbs(),
    hitBarrier,
    materials: () => ({ wood: stock.wood, scrap: stock.scrap }),
    // Extra (supplementary to the pinned surface): let ui/player trigger placement/repair directly.
    place: () => place(),
    repair: () => repairNearest(),
    update(_dt, _t) {
      // No hot work: barriers are event-driven. Nothing to allocate or poll per frame.
    },
  };
  registry.register('build', facade);

  // ---- probe hooks (the harness drives these; DONE #4 reads materials() after harvest) ----
  ctx.probe.placeBarrier = () => place({ free: true }); // geometry probe: place regardless of stock
  ctx.probe.breachNearest = () => {
    const b = field.nearestBarrier(0, 0) || field.barriers.find((x) => x.alive);
    if (!b) return null;
    hitBarrier(b.id, b.hpMax + 1); // drive hp→0 → breach in one call
    return b.id;
  };
  ctx.probe.repairNearest = () => { const b = repairNearest(); return b ? b.id : null; };
  ctx.probe.harvestWood = () => harvest('wood');
  ctx.probe.harvestScrap = () => harvest('scrap');

  facade._dispose = () => { for (const d of disposers) d(); };
  return facade;
}
