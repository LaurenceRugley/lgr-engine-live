// graph-star.vert -- VIZ SLICE 15: the starfield gets a per-star TWINKLE.
//
// The slice-5 stars were a THREE.PointsMaterial (static by design). Twinkle needs a per-star phase and
// a clock, so the points move to this tiny ShaderMaterial. Two deliberate compatibilities:
//   - uTwinkle = 0 reproduces the old material exactly (vTw = 1 -> same color * opacity, additive),
//     which is what keeps harbor/observatory effectively where slice 12 left them (their amplitude is
//     a whisper; pixel turns it UP).
//   - gl_PointSize = uSize matches PointsMaterial's sizeAttenuation:false path verbatim (raw device
//     pixels, no DPR scaling -- three's own quirk, preserved rather than "fixed").
//
// The oscillation is a SUM OF TWO SINES at incommensurate rates: one sine reads as a metronome blink,
// two slightly-detuned sines beat against each other and read as atmospheric scintillation -- the same
// trick as the FBM octave step of 2.02 (never let periodic things align). aPhase seeds both the phase
// offset AND the rate spread, so no two stars breathe together.
//
// C++ anchor: aPhase is a per-vertex float attribute -- a second VBO the vertex shader indexes in
// lockstep with positions, like a parallel float array handed to a compute kernel.

precision highp float;

attribute float aPhase;    // 0..1, seeded per star (its OWN LCG stream -- star POSITIONS must not move)
attribute float aSize;     // slice 16 (variety): per-star size -- uniform-filled when variety is off
attribute vec3  aColor;    // slice 16 (variety): per-star tint -- ditto

uniform float uTime;
uniform float uTwinkle;    // amplitude: 0 = static (reduced motion / the slice-5 look), ~0.5 = pixel sparkle

varying float vTw;
varying vec3  vColor;

void main() {
  float w = uTime * (0.9 + aPhase * 1.3) + aPhase * 6.28318;
  // Two detuned sines, each +-1, averaged -> +-1; scaled by the amplitude around a resting 1.0.
  vTw = 1.0 + uTwinkle * 0.5 * (sin(w) + sin(w * 1.618 + aPhase * 4.0));
  vColor = aColor;
  gl_PointSize = aSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
