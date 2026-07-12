// graph-node.frag — VIZ SLICE 5: the crisp node CORE. An SDF disc, lit from within, with a fake rim.
//
// "Nothing flat-shaded" is the one thing every premium reference agreed on (section 8). A node drawn as
// a flat disc of constant colour reads as a UI dot; the same node with a view-dependent term reads as an
// object. We buy that term for pennies, with no lights, no normals buffer and no texture:
//
//   FAKE NORMAL   Treat the unit disc as the silhouette of a unit SPHERE. At disc coordinate p, the
//                 sphere's surface normal is (p.x, p.y, sqrt(1 - |p|^2)). The z we reconstruct is the
//                 only piece missing from a flat quad -- and it is exactly what a real sphere's normal
//                 would be, so the shading is not an approximation of a sphere, it IS one.
//   INNER LIGHT   Brightness rises toward the disc's centre (where the fake normal points at the camera).
//                 Lit from within, not from a lamp -- these are glowing markers, not lit geometry.
//   FRESNEL RIM   pow(1 - n.z, k) peaks where the surface turns away from the eye, i.e. the silhouette.
//                 Under an orthographic camera the view direction IS (0,0,1), so n.z is already n dot v
//                 and the whole grazing-angle term collapses to one pow(). This is the single line that
//                 kills the "flat lit disc" look.
//
// ANALYTIC AA: fwidth(d) is how much the SDF changes across one pixel, so smoothstepping the last pixel
// before the rim gives a clean circle at any radius or zoom -- and, crucially, the circle stays a CIRCLE
// after the pixel post quantizes it, because we never relied on multisampling to round it off.

uniform float uRimPower;
uniform float uRimGain;
uniform float uPrint;   // slice 12 (STUDIO): 1 = PRINT mode -- solid publication fill, no sphere illusion.
                        // On paper the inner-light/fresnel read as a glassy button, not premium print;
                        // print keeps only the crisp fwidth edge + a thin darker ink outline.

varying vec2 vP;
varying vec3 vColor;

void main() {
  float d = length(vP);

  float aa    = fwidth(d);
  float alpha = 1.0 - smoothstep(1.0 - aa * 1.5, 1.0, d);
  if (alpha <= 0.0) discard;

  float nz    = sqrt(max(0.0, 1.0 - d * d));   // the reconstructed sphere normal's z component
  float inner = 0.55 + 0.45 * nz;              // lit from within: brightest facing the eye
  float rim   = pow(1.0 - nz, uRimPower) * uRimGain;

  // Rim adds a touch of achromatic light so it reads as a highlight rather than more of the same hue.
  vec3 glow = vColor * inner + vColor * rim + vec3(rim * 0.12);

  // PRINT: flat fill with a thin darker ink outline over the outer 6% of the radius.
  float outline = smoothstep(0.94 - aa, 0.94 + aa, d);
  vec3 print = mix(vColor, vColor * 0.55, outline);

  gl_FragColor = vec4(mix(glow, print, uPrint), alpha);
}
