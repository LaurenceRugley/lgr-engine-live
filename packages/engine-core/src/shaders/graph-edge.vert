// graph-edge.vert — VIZ SLICE 5 (Mission Control atlas): the KEYSTONE.
//
// Edges are no longer LineSegments. A GL line is locked to 1 device pixel -- every driver ignores
// gl_LineWidth -- and that single limitation blocks BOTH looks at once: Harbor wants taper and
// width-by-weight, and Pixel NEEDS a stroke at least one VIRTUAL pixel wide or the edges strobe and
// vanish the moment the camera moves. So each edge is now an instanced camera-facing RIBBON QUAD.
//
// One unit quad (PlaneGeometry) is drawn E times. Per instance we hand in the two endpoints, the two
// endpoint colours, and a width. Everything else -- the curve, the ribbon's cross-section, the
// anti-aliasing -- happens here. Still ONE draw call, still zero new geometry per edge.
//
// THE CURVE (section 8, ranked leverage #1): a dead-straight edge reads as a placeholder in every
// premium reference. We lift the chord perpendicular to the graph plane by sin(t*PI) * lift * length,
// so the edge bows out of the disc as an arc: zero at both endpoints, maximum at the midpoint. The
// same arc carries the flow band in the fragment shader, so light travels ALONG the curve.
//
// THE RIBBON: we need a screen-facing offset, so we take the curve's tangent in VIEW space and rotate
// it 90 degrees in the view XY plane. Under an orthographic camera view-space XY is screen space up to
// a uniform scale, so a world-unit width is a constant pixel width -- which is exactly what lets the
// consumer clamp the width to one virtual pixel in pixel mode (uMinWidth).
//
// aAlong is the along-edge parameter (the aT of the section 6 contract); aSide is the signed
// cross-axis coordinate the fragment shader anti-aliases against (the seam's strip attrs, slice 14).
//
// C++ anchor: instanced attributes are a per-instance struct handed to every vertex of the mesh --
// like a DrawElementsInstanced with a second, divisor-1 vertex buffer of Edge{from,to,colors,width}.

attribute float aAlong;   // 0..1 along the edge (the seam's shared strip, slice 14 — was uv.x)
attribute float aSide;    // -1/+1 across the ribbon (was uv.y*2-1)
attribute vec3  aEndA;
attribute vec3  aEndB;
attribute vec3  aColorA;
attribute vec3  aColorB;
attribute float aWidth;
// aDim — FOCUS-DIM, per edge. 1.0 normally; when a node is selected, every edge that does not touch it
// drops to a fraction. Without this the nodes fade on selection while 200-odd bright arcs keep shouting,
// and the graph gets LOUDER exactly when the user asked it to get quieter. Written once per selection,
// never per frame.
attribute float aDim;

uniform float uLift;        // arc height as a fraction of edge length (0 = flat chord)
uniform float uWidthScale;  // global width multiplier (the look switcher scales this)
uniform float uMinWidth;    // world-space floor: >= 1 virtual pixel in pixel mode. THE anti-strobe knob.
uniform float uTaper;       // 0 = constant width; >0 narrows the ribbon toward the midpoint

varying float vT;
varying float vCross;
varying vec3  vColor;
varying float vDim;

const float PI = 3.14159265;

// The arc: a straight chord lifted out of the graph plane (+Y) by a half-sine. Zero at both ends, so
// the ribbon still lands exactly on its nodes no matter how hard we bow it.
vec3 curvePoint(float t, float lift) {
  vec3 p = mix(aEndA, aEndB, t);
  p.y += sin(t * PI) * lift;
  return p;
}

void main() {
  float t     = aAlong;
  float cross = aSide;              // -1 .. +1 across the ribbon (the seam's per-vertex strip attrs)

  vT     = t;
  vCross = cross;
  vDim   = aDim;
  vColor = mix(aColorA, aColorB, t);   // gradient along the edge: from-colour bleeds into to-colour

  float lift = uLift * distance(aEndA, aEndB);   // long edges bow more; short ones stay nearly straight

  // Tangent by finite difference, sampled INSIDE the domain so the endpoints don't degenerate to a
  // zero-length difference (the classic ribbon bug: the last quad column collapses and the edge
  // develops a pinched, twitching tip).
  const float E = 0.01;
  float ta = max(t - E, 0.0);
  float tb = min(t + E, 1.0);

  vec4 mv  = modelViewMatrix * vec4(curvePoint(t,  lift), 1.0);
  vec4 mva = modelViewMatrix * vec4(curvePoint(ta, lift), 1.0);
  vec4 mvb = modelViewMatrix * vec4(curvePoint(tb, lift), 1.0);

  vec2 dir  = mvb.xy - mva.xy;
  vec2 side = length(dir) > 1e-6 ? normalize(vec2(-dir.y, dir.x)) : vec2(0.0, 1.0);

  // Taper first, THEN clamp: the minimum-width floor must survive the taper, or the pinched midpoint
  // is exactly where a pixel-mode edge would drop below one virtual pixel and start flickering.
  float w = aWidth * uWidthScale * (1.0 - uTaper * sin(t * PI));
  // EMPHASIS (slice 9): aDim carries three states -- dim (<1, non-incident under a selection), rest (1),
  // EMPHASIZED (>1, incident to the selection/hover). Above 1 it also WIDENS the ribbon (1.6 -> x1.45)
  // so the selected neighborhood reads at a glance; min-width still clamps LAST (pixel-mode floor holds).
  w *= 1.0 + max(aDim - 1.0, 0.0) * 0.75;
  w = max(w, uMinWidth);

  mv.xy += side * cross * w * 0.5;
  gl_Position = projectionMatrix * mv;
}
