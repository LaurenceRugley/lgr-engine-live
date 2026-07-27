/* ============================================================
   particle.frag — Lesson M6: shade each particle point as a soft round sprite (additive).
   ------------------------------------------------------------
   gl_PointCoord is the 0..1 coordinate within the point sprite; we make a soft disc from its distance to
   the centre and discard the corners. Output is colour pre-multiplied by the life-fade — with ADDITIVE
   blending (the material sets blending = ONE,ONE) that reads as glowing sparks/muzzle/dust against the
   dark dusk arena, and needs no depth sort.
   ============================================================ */
precision highp float;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  float soft = smoothstep(0.25, 0.0, r2);
  gl_FragColor = vec4(vColor * vAlpha * soft, 1.0);
}
