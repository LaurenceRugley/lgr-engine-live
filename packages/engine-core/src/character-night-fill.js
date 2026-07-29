/* ============================================================
   @lgr/engine-core — character-night-fill (Arc A2: ALIVE AT NIGHT — the money-shot unlock).
   ------------------------------------------------------------
   THE ABILITY: make characters READ at night WITHOUT a light per character. R1 proved the gap — the engine
   hero-lights the survivor (its lantern) but the 38-strong horde renders invisible black at night (the moon
   KEY directional alone is too weak, and it can't touch a back-facing zombie's silhouette). The cheap fix is
   a night-keyed EMISSIVE fill on the character material: a cool "moonlight bounce" that rises with the night
   factor so a dark-albedo actor lifts off pure black into a readable cool silhouette. Emissive is FREE (added
   after lighting, no shadow/second-pass cost), so this scales to a whole swarm at zero light-count cost — the
   moon KEY still rakes the moon-side edge for SHAPE, the fill just stops the rest going to black.

   Pure (no THREE import — takes a material-like object with a THREE.Color `emissive` + `emissiveIntensity`),
   so it's node-testable. The curve eases IN (gamma) so dusk stays moody and only deep night lifts to `max`.

   C++ anchor: a post-process add — like adding a constant ambient term to a fragment's lit colour, gated by
   a uniform (nightFactor). No new light in the scene graph; one scalar drives the whole horde.
   ============================================================ */

/* Cool moonlight tint + how hard the fill pushes at full night. `gamma` > 1 delays the lift (dusk stays
   dark); `max` is the emissiveIntensity at nightFactor 1. Tuned against the R1 nf-sweep (see the arc). */
export const NIGHT_FILL = Object.freeze({ tint: 0x35507e, max: 0.62, gamma: 1.35 });

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* applyNightFill(material, nf, opts) — set the material's night emissive from the night factor (0..1).
   nf 0 → emissiveIntensity 0 (byte-identical to day: no glow). nf 1 → `max`. Returns the intensity used
   (for tests / debug). A material without an `emissive` colour is a no-op (a non-Standard material). */
export function applyNightFill(material, nf, opts = {}) {
  if (!material || !material.emissive || typeof material.emissive.setHex !== 'function') return 0;
  const o = { tint: opts.tint ?? NIGHT_FILL.tint, max: opts.max ?? NIGHT_FILL.max, gamma: opts.gamma ?? NIGHT_FILL.gamma };
  const k = Math.pow(clamp01(nf), o.gamma) * o.max;
  material.emissive.setHex(o.tint);
  material.emissiveIntensity = k;
  return k;
}

/* Collect the UNIQUE mesh materials under an Object3D (dedup — instances share materials, so the fill is a
   handful of set calls per frame, not one per mesh). Returns an array. */
export function collectMaterials(root, out = new Set()) {
  root.traverse((n) => {
    if (!n.isMesh || !n.material) return;
    const m = n.material;
    (Array.isArray(m) ? m : [m]).forEach((x) => out.add(x));
  });
  return [...out];
}
