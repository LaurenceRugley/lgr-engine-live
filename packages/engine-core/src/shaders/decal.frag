/* ============================================================
   decal.frag — Lesson M5: sample the decal atlas + GPU age-fade.
   ------------------------------------------------------------
   The atlas holds a few procedural marks (bullet hole, blood, scorch); the projection already baked the
   right cell into uv. Alpha = the mark's own alpha × a life fade: full until 60% of life, then smoothstep
   to nothing. Un-written / long-dead vertices carry aBorn 0 (huge age) → alpha 0, so the fixed-size buffer
   can be drawn whole in one call with the stale slots contributing nothing.
   ============================================================ */
precision highp float;
uniform sampler2D uAtlas;
uniform float uLife;
varying vec2 vUv;
varying float vAge;

void main() {
  if (vAge < 0.0 || vAge > uLife) discard;              // not yet born / fully expired
  vec4 tex = texture2D(uAtlas, vUv);
  float fade = 1.0 - smoothstep(uLife * 0.6, uLife, vAge);
  float a = tex.a * fade;
  if (a < 0.01) discard;
  gl_FragColor = vec4(tex.rgb, a);
}
