/* ============================================================
   image-transition.frag — Lesson X: the liquid MELT between two photographs.
   ------------------------------------------------------------
   A before/after slider is normally a hard CSS clip-path line: the two images are cut by a straight
   edge that follows your finger. It works, and it looks like every other one on the internet.

   This does the reveal as a FLUID instead. The boundary is still driven by your finger, but it is not
   a line — it is a warped, noisy front that pushes into the old image and drags its pixels with it, so
   the "before" appears to MELT into the "after" as you drag. Same interaction, completely different
   feeling, and it is only possible because we own the pixels.

   ── HOW THE MELT WORKS (three moves) ──────────────────────────────────────────
   1. A FRONT. Take the horizontal position (uv.x), push it around with a slow noise field, and compare
      it against uProgress. That gives a wobbling, organic boundary instead of a straight edge.
   2. A WIDTH. Rather than a hard cut, smoothstep across a band around the front — inside the band the
      two images are blended, so the seam is a soft melting zone, not an edge.
   3. A DISPLACEMENT. Inside (and just ahead of) that band, we OFFSET the UVs we sample from — pulling
      the before-image's pixels sideways as if the front were dragging them. That drag is what sells it
      as liquid rather than as a fade: things move, they don't just dissolve.

   ── COVER-FIT (the boring part that decides whether this is usable) ───────────
   A photo is never the shape of the box you put it in. CSS solves this with object-fit: cover — scale to
   fill, crop the overflow, never distort. There is no such thing in a shader, so we do it by hand: compare
   the image's aspect to the quad's, and scale the UVs on the axis that has slack (then re-centre). Get
   this wrong and every portrait photo in a landscape section is squashed, which is the one thing a
   hairstylist will notice immediately.

   ── COLOUR, AND THE TRAP THAT ACTUALLY BIT (measured, not theorised) ──────────
   The famous photo-in-WebGL bug is forgetting to tag the texture sRGB, which leaves it decoded as linear
   and renders everything WASHED OUT (mid-grey lands ~188 instead of 128). We tag it — and the probe still
   failed, in the OPPOSITE direction: mid-grey came out at 55, i.e. far too DARK. 55/255 = 0.216, which is
   exactly the LINEAR value of mid-grey. So the decode was right and the ENCODE was missing.

   Why: three auto-encodes linear→sRGB on output only for its BUILT-IN materials (which pull in the
   colorspace_fragment chunk). A custom ShaderMaterial writes gl_FragColor straight through, untouched.
   Every other shader in this engine already outputs DISPLAY-READY values (post-filmic ends with a raw
   gl_FragColor after ACES), so the convention here is "shaders emit what the screen shows". This shader
   is the one place that samples an sRGB-tagged texture — the GPU hands us LINEAR light — so it is the one
   place that has to encode on the way out. Doing the work in linear and encoding once at the end is also
   the correct order: mixing two photos in linear space is what makes the melt blend like light rather
   than like paint.
   ============================================================ */
precision highp float;

varying vec2 vUv;

uniform sampler2D uBefore;
uniform sampler2D uAfter;
uniform float uProgress;    // 0 = fully before, 1 = fully after — driven by the pointer
uniform float uTime;        // only animates the noise field; the FRONT is progress-driven
uniform vec2  uQuadRes;     // the box we're drawing into, in px
uniform vec2  uBeforeRes;   // the before image's natural size, in px
uniform vec2  uAfterRes;    // the after image's natural size, in px
uniform float uMelt;        // how far the front drags pixels (0 = a clean wipe, 1 = full liquid)
uniform float uWidth;       // the melting band's width

/* uMeltAmp — the MASTER "how liquid is this transition at all" scalar (Lesson Z).
   ------------------------------------------------------------
   Why this exists, and why it is a SEPARATE dial from uMelt: a real client finding. The liquid melt is
   gorgeous on dark, moody sets — but on LIGHT, high-contrast photographs (an elegant salon reel) the
   sideways UV displacement smears bright/dark edges into harsh HORIZONTAL STREAKING, and the photos never
   settle enough to read. The melt is not vibe-agnostic; elegant brands need a calm alternative.

   So uMeltAmp collapses the whole liquid apparatus toward a plain opacity crossfade:
     • 1.0 = the melt EXACTLY as before — every term below is multiplied by 1.0, a true no-op, so the
       default is byte-identical and no baseline is disturbed.
     • 0.0 = a pure cross-DISSOLVE: the blend becomes spatially UNIFORM (every pixel at the same opacity,
       = uProgress) instead of a wobbling wipe front, the drag displacement is scaled to nothing (no
       streak), and the wet-edge glow is switched off. Two stills fading through each other, nothing more.
   uMelt still exists and still tunes the drag WITHIN a melt; uMeltAmp decides whether there is a melt at
   all. When uMeltAmp is 0 the value of uMelt no longer matters — the crossfade overrides it, by design
   (we layer a master switch on top; we do not average the two into a muddy third thing). */
uniform float uMeltAmp;

/* Cheap value noise — enough to make the front organic; a full fbm would be wasted here. */
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

/* object-fit: cover, in UV space. Scale the axis with slack, then recentre.
   The max(.,1.0) on BOTH numerators is the last line of defense (Lesson Z2b): if a degenerate box
   dimension (a 0-width container caught mid-layout) ever reaches boxRes.x, an unclamped 0 makes
   boxA = 0 → s.x = boxA/imgA = 0 → the whole x axis collapses to a horizontal-streak smear. Clamping
   to ≥1 turns that into a merely-wrong crop for the one bad frame instead of a full collapse, and is a
   true no-op for every real photo/box (all ≥1), so no rendered baseline shifts. */
vec2 coverUv(vec2 uv, vec2 imgRes, vec2 boxRes) {
  float imgA = max(imgRes.x, 1.0) / max(imgRes.y, 1.0);
  float boxA = max(boxRes.x, 1.0) / max(boxRes.y, 1.0);
  vec2 s = vec2(1.0);
  if (imgA > boxA) s.x = boxA / imgA;   // image is wider than the box → crop its sides
  else             s.y = imgA / boxA;   // image is taller → crop top/bottom
  return (uv - 0.5) * s + 0.5;
}

void main() {
  /* THE FRONT — a wobbling boundary, not a line. */
  float n = vnoise(vec2(vUv.y * 3.2, uTime * 0.10)) * 0.5
          + vnoise(vec2(vUv.y * 8.0 + 4.0, uTime * 0.16)) * 0.25;

  /* Bias the front so progress 0 and 1 are FULLY clean: at the ends the noise must not leave a stray
     sliver of the other image on screen. Remapping into a slightly over-scanned range does that. */
  float p = uProgress * (1.0 + uWidth * 2.0) - uWidth;
  float front = vUv.x + (n - 0.375) * 0.13 - p;

  /* THE BAND — how much of the picture is currently mid-melt (the wobbly wipe mask). */
  float m = 1.0 - smoothstep(-uWidth, uWidth, front);   // 0 = still 'before', 1 = fully 'after'

  /* THE MASTER LERP. Blend between a UNIFORM opacity (uProgress everywhere — a crossfade) and the wipe
     mask m, by uMeltAmp. At uMeltAmp = 1.0 this returns m exactly (mix(a,b,1.0) == b, bit-for-bit), so
     the melt is untouched; at 0.0 it returns uProgress, a flat cross-dissolve with no spatial front. */
  float mask = mix(uProgress, m, uMeltAmp);

  /* THE DRAG — strongest inside the band, zero at either end. This is the liquid part: we pull the
     sampled coordinates sideways (and a little vertically) so the front looks like it is physically
     pushing the old image out of the way. */
  float band = 1.0 - abs(front) / max(uWidth, 1e-4);
  band = clamp(band, 0.0, 1.0);
  /* uMeltAmp gates the drag too: at 1.0 this is band*band*uMelt unchanged; at 0.0 the drag is zero, so
     push is zero, so both images are sampled at the same cover-fit UV — a crossfade, no sideways smear. */
  float drag = band * band * uMelt * uMeltAmp;

  vec2 push = vec2(drag * 0.16, (n - 0.5) * drag * 0.10);

  vec2 uvB = coverUv(vUv + push,        uBeforeRes, uQuadRes);   // before gets shoved along
  vec2 uvA = coverUv(vUv - push * 0.45, uAfterRes,  uQuadRes);   // after settles in behind it

  vec3 before = texture2D(uBefore, clamp(uvB, 0.0, 1.0)).rgb;
  vec3 after  = texture2D(uAfter,  clamp(uvA, 0.0, 1.0)).rgb;

  vec3 col = mix(before, after, mask);

  /* A whisper of brightness right at the melting front — the wet edge where the two liquids meet.
     Kept subtle: this is a photo, and a glowing seam would look like a filter. (Added in LINEAR, before
     the encode below, so it behaves like light and not like a paint overlay.) uMeltAmp switches it off in
     crossfade mode — there is no front for it to trace, so at 1.0 it is times 1.0 (unchanged), at 0.0 gone. */
  col += vec3(1.0, 0.98, 0.96) * band * band * 0.10 * uMelt * uMeltAmp;

  /* ENCODE — see the header. Everything above is LINEAR light; the screen wants sRGB. This is the exact
     IEC 61966-2-1 transfer curve (not a lazy pow(1/2.2), which is visibly wrong in the deep shadows). */
  col = mix(col * 12.92,
            1.055 * pow(max(col, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
            step(vec3(0.0031308), col));

  gl_FragColor = vec4(col, 1.0);
}
