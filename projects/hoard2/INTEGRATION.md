# hoard2 — INTEGRATION CONTRACT (lead-owned; every owner reads this FIRST)

The single source of cross-owner truth for the one-shot run. Your subsystem talks to the others ONLY
through the ctx registry + the event bus described here. If a facade method or event you need isn't
listed, it doesn't exist yet — flag it in your report, don't invent a cross-import. Governing law:
`docs/HOARD-CONTRACT.md` + `docs/hoard-oneshot-prompt-2026-07.md` + `docs/engine-invariants.md`.

## The `ctx` object your `create<Owner>(ctx)` receives
```
ctx = {
  THREE, engine, scene, renderer, rig, sunRig, CAM,   // engine handles (frozen — call, never edit)
  registry: { register(name,facade), get(name), has(name) },
  events:   { on(name,fn)->disposer, emit(name,payload), EVENTS:Set },
  rng:      { fork(name) -> ()=>[0,1) with .range(a,b)/.int(a,b)/.pick(arr)/.chance(p) },
  time:     { simDt(dt), realDt(dt), paused, scale, elapsed, setDived(bool) },
  config,   // namespace import of src/core/config.js — READ pinned knobs, never redefine
  capture:  bool, flags,
  renderWorld(dest),          // lead-owned pixel pipeline; you almost never call this
  probe: {},                  // attach your capture hooks here (see §Probe hooks)
  dive: { active, mode, setEyeSource(fn), focusUv, enter(), exit(), toggle(), present(dt) },
  worldReady: Promise,        // world sets this; lead drops the boot cover on it
}
```
Your `create<Owner>(ctx)` MUST `registry.register('<name>', facade)` and the facade MUST expose
`update(dt, t)` plus the pinned methods below. **Do not touch main.js** — it already imports and calls
you, and drives your `update` every frame in this order:
`world → sim → build → player → fx → ui → (dive eye) → engine.updateWorld → present`.

## Registry facades (the pinned cross-owner surface)
| name | method | returns / effect | who calls it |
|---|---|---|---|
| **sim** | `state` | READ-ONLY snapshot: `{ wave, kills, score, alive, hp, hunger, stamina, dead, cause, runTime }` | ui, build, fx |
| | `queryTargets(seg)` | zombies a world-space segment `{o:{x,y,z}, e:{x,y,z}}` could hit → `[{id,x,y,z,type,hp}]` | player (gun/melee) |
| | `trySpendStamina(cost)` | `bool` — deduct if available (melee/sprint pricing) | player |
| | `damagePlayer(amount, from)` | apply injury (barriers breached, zombie contact resolved in sim) | sim-internal / build |
| | `probe()` | `{ rt, wave, kills, score, alive, hp, hunger, night, px, pz }` (px,pz = horde centroid, deterministic) | harness |
| **player** | `player` | live `{ x, z, facing }` (the survivor's ground pose) | sim (targeting), fx |
| **build** | `castBarriers(seg)` | nearest barrier hit `{ point:{x,y,z}, normal:{x,y,z}, id, t }` or `null` | player (ballistics castWorld) |
| | `aabbs()` | barrier blockers `[{ id, minx, minz, maxx, maxz }]` | sim (field), player (walker) |
| | `hitBarrier(id, amount)` | apply damage to a barrier (build stays the SOLE emitter of `barrier:*`) | sim (zombie attack) |
| | `materials()` | `{ wood, scrap }` current stock | ui |
| **world** | `groundAt(x,z)` | `config.GROUND_Y` (play area is FLAT — ratified) | anyone needing ground height |
| | `nightFactor()` | `nf ∈ [0,1]` (0 day … 1 deep night) — THE canonical night value | sim (difficulty), fx (torches) |
| | `obstacles()` | world blockers `[{ x, z, r }]` (trees + ruins) | sim (field), player (walker) |
| | `harvestNodes()` | `{ wood:[{x,z,amount}], scrap:[{x,z,amount}] }` scavengeable nodes | build |
| **fx** | `counts()` | `{ particles, decals, corpses }` | harness, ui |
| **ui** | (update only) | — | — |

**Rule:** resolve other owners LAZILY inside your `update`/handlers via `registry.get('name')` (all six
register before the first frame), never at construction time. `get` of a missing name throws (fail loud).

## Event bus (vocabulary is FROZEN — `docs/HOARD-CONTRACT.md §Event vocabulary`)
Emit with a reused payload object in hot paths (no per-frame alloc, engine-invariants #7). Who emits what:
- **sim**: `wave:start`/`wave:clear {n,count,night}` · `zombie:spawn`/`zombie:death {id,type,pos,drops?}` · `player:damage {amount,from,hp}` · `player:death {cause}` · `item:pickup {kind}`
- **player**: `weapon:fire {origin,dir,weapon,seed}` · `weapon:hit {point,normal,target?,damage}` · `weapon:reload {}` (A8-3: the mag emptied → the reload beat began; a named SFX hook, no listener required) · `melee:swing {origin,arc}` · `melee:hit {target,damage}` · `dive:enter`/`dive:exit {mode:'walk'}` (lead emits these via ctx.dive — you just call toggle)
- **build**: `harvest:gain {material,amount,source}` · `barrier:place`/`barrier:damage`/`barrier:breach`/`barrier:repair {id,seg,hp}`
- **ui**: `game:pause`/`game:resume {source}` (core executes) · `craft {recipe,cost}` · `item:consume {kind,effect}`
- **world**: `daynight:phase {t,night}`

Cross-owner reactions you can rely on: fx listens to weapon/melee/zombie/barrier/wave/item; ui reads
sim.state + build.materials; sim reads player.player + build.aabbs + world.nightFactor/obstacles; build
listens to craft (repair-kit → hitBarrier(-hp)) and reads world.harvestNodes; player reads
sim.queryTargets + build.castBarriers + world.obstacles.

## Determinism (DONE #10)
Seeded rolls ONLY via `ctx.rng.fork('<yourstream>')` — sim→`'sim'`, world→`'world'`, fx→`'fx'`. NEVER
`Math.random()` in sim/world/fx. Same seed → identical sim trace regardless of world/fx activity (the
forks are decorrelated — proven in `src/core/core.test.mjs`). The world clock is `ctx.time` — no
`performance.now()` animation. sim advances its `runTime` by `ctx.time.simDt(dt)` each frame.

## Probe hooks (attach to `ctx.probe.<name>`; the harness drives them — no silent caps)
- **sim**: `spawnWave(n)` (force-start wave n), `starve()` (hunger→0 fast), `hurt(amount)` (injury). Expose `px,pz` in `probe()`.
- **player**: `fire()` (one shot forward), `melee()` (one swing).
- **build**: `placeBarrier()`, `breachNearest()`, `repairNearest()`, `harvestWood()`, `harvestScrap()`.
- **world**: `setNight(nf)` (override the canonical nightFactor — drives BOTH sim difficulty and visuals).
- **fx**: (expose counts via facade `counts()` — harness reads it for corpse persistence).

## Your hard rules (all owners)
1. Own ONLY `projects/hoard2/src/<owner>/`. Never edit main.js, src/core/, other owners' dirs, or
   `packages/engine-core/` (FROZEN — call exported factories, never edit; a missing ability → flag it).
2. Cross-owner talk ONLY via registry + events. No cross-directory imports except `src/core/` + `@lgr/engine-core`.
3. **Do NOT run `npm run build` or the harness** (siblings share this dist — concurrent builds race).
   Verify with `node --test projects/hoard2/src/<owner>/*.test.mjs` ONLY. The lead integrates + builds +
   runs the harness after you return.
4. No per-frame allocation in `update` (hoist scratch). GLSL stays in engine files (you write none).
5. Tests encode WHY (Rule 9): assert the balance/behavior the DONE criteria rest on, not just "it runs".
