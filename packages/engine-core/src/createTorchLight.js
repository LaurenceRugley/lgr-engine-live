/* ============================================================
   @lgr/engine-core — createTorchLight (Lesson HOARD-1: a flickering warm light pool).
   ------------------------------------------------------------
   The engine-first ability born in The Hoard's torchlit cavern: a warm PointLight whose intensity
   GUTTERS like a real flame — the cheapest way to make a pool of light feel alive against darkness.
   It generalizes far past the cavern (a tavern hearth, a campfire, a dungeon sconce, a candle), so it
   lives in the CORE and every scene inherits it; the project just places it and calls update(dt).

   ── WHY A DEDICATED FLICKER, NOT Math.random() ──
   A flame's brightness wobble is not white noise — it is a few overlapping slow-and-fast wobbles (the
   flame body sways slowly; the tip snaps fast). We sum three incommensurate sines (frequencies with no
   common period) so the pattern never audibly repeats, exactly like layered Perlin octaves. Crucially it
   is DETERMINISTIC in `t`: the same time always yields the same intensity. That matters for two engine
   invariants — the ?capture path replays a fixed timestep and must be reproducible, and there is NO hot
   allocation here (Math.random would still be allocation-free, but it would make capture non-reproducible
   and couldn't be unit-tested). See docs/engine-invariants.md (sentinels · no-hot-alloc · deterministic sim).

   C++ anchor: `torchFlicker` is a pure `float f(float base, float t, ...)` — a free function you could
   drop in a header and unit-test with no GPU; `createTorchLight` is a tiny RAII object owning a light +
   an accumulated clock, whose update(dt) is the per-frame tick.
   ============================================================ */
import * as THREE from 'three';

/* torchFlicker(base, t, seed, amp) — PURE. Returns a flickered intensity for base intensity `base` at
   time `t` (seconds), phase-shifted by `seed` (so several torches in one scene flicker out of step),
   with peak swing `amp` (0..1 fraction of base). The three sine weights sum to 1, so the noise term is
   bounded to [-1, 1] and the result to [base·(1-amp), base·(1+amp)] — with amp < 1 it can never reach 0,
   so a consumer's lighting never blacks out mid-flame. Node-tested (createTorchLight.test.mjs). */
export function torchFlicker(base, t, seed = 0, amp = 0.3) {
  // Three octaves: a slow body sway, a mid wobble, a fast tip snap. Incommensurate freqs → no repeat.
  const n = 0.6 * Math.sin(11.0 * t + seed)
          + 0.3 * Math.sin(17.3 * t + seed * 1.7)
          + 0.1 * Math.sin(29.1 * t + seed * 2.3);   // n ∈ [-1, 1]
  return base * (1 + amp * n);
}

/* createTorchLight(opts) — a warm PointLight that flickers. Add `.light` to your scene; call `.update(dt)`
   each frame. Returns the light + a `.flame` handle (null unless you asked for one) you can place a mesh at.
     color/intensity/distance/decay — standard PointLight params (intensity is the FLICKER BASELINE).
     position   — [x,y,z] world placement.
     amp        — flicker swing as a fraction of intensity (0.3 ⇒ ±30%).
     speed      — time scale (1 = natural; >1 = frantic, <1 = lazy).
     seed       — phase offset so multiple torches don't pulse in lockstep.
     castShadow — opt into point-light shadows (OFF by default — six-face cube shadow maps are costly). */
export function createTorchLight({
  color = 0xffb562,          // warm amber — the brand-gold family
  intensity = 6,
  distance = 12,
  decay = 2,                 // physically-correct inverse-square falloff (three's default)
  position = [0, 2, 0],
  amp = 0.3,
  speed = 1,
  seed = 0,
  castShadow = false,
} = {}) {
  const light = new THREE.PointLight(color, intensity, distance, decay);
  light.position.set(position[0], position[1], position[2]);
  light.castShadow = castShadow;

  const base = intensity;
  let _t = seed * 0.123;     // start each torch at a different clock so frame-1 isn't uniform

  function update(dt) {
    _t += dt * speed;
    light.intensity = torchFlicker(base, _t, seed, amp);
    return light.intensity;
  }

  return {
    light,
    update,
    get intensity() { return light.intensity; },
    dispose() { light.parent && light.parent.remove(light); light.dispose?.(); },
  };
}
