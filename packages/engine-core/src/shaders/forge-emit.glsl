/* ============================================================
   forge-emit.glsl — the TEXTURE FORGE channel router (main()).
   ------------------------------------------------------------
   INCLUDED LAST by every surface family shader. The family defines surface(); this provides the
   entry point that evaluates it once and routes ONE of its outputs to gl_FragColor per bake pass.

   WHY route by a uniform instead of Multiple-Render-Targets: three's WebGLRenderTarget is one
   attachment; running the same surface() 3x into 3 targets (albedo / ORM / height) is three cheap
   fullscreen draws and keeps every family shader a plain single-output fragment program — no MRT
   plumbing, no extension probing. The forge picks the pass with uChannel.

   THE sRGB DATA-MAP INVARIANT (ship it): only the ALBEDO target is an sRGB texture; ORM and height
   are DATA and their targets are LINEAR (NoColorSpace). Baking a data value like roughness 0.5 into
   an sRGB texture would decode to 0.21 linear on sample and silently wreck the whole layer. The
   forge sets each target's colorSpace accordingly (createTextureForge.js); this shader just writes
   raw values and trusts that contract.
   ============================================================ */
void main() {
  vec3 albedo; vec3 orm; float height;
  surface(vUv, albedo, orm, height);

  if (uChannel == 0)      gl_FragColor = vec4(clamp(albedo, 0.0, 1.0), 1.0);   // -> sRGB albedo target
  else if (uChannel == 1) gl_FragColor = vec4(clamp(orm, 0.0, 1.0), 1.0);      // -> linear ORM target
  else                    gl_FragColor = vec4(vec3(clamp(height, 0.0, 1.0)), 1.0); // -> linear height scratch
}
