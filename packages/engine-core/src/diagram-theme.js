/* ============================================================
   diagram-theme.js — Slice 0: dusk-harbor OKLCH token set
   ------------------------------------------------------------
   One hardcoded theme for all LGR visualizations: a 5-step warm-dark OKLCH neutral ramp,
   4 semantic accents derived from sun-rig's dusk keyframe (t=0.75), a 1.2× type scale,
   a 4-role stroke kit (axis/guide/ihat/jhat), and label-substrate params (halo/scrim).

   Design derivation — sun-rig.js KEYFRAMES[3] (dusk):
     sun: '#ff6b35', hemiSky: '#7a566a', hemiGround: '#281a18',
     horizon: '#b0432a', sky: '#ff8a5a'

   ENGINE-FIRST: lives in engine-core; lessons import and wire.
   FREE-FIRST: pure first-party OKLCH→sRGB (Ottosson 2020, CSS-style L in 0-100).
   ============================================================ */

/* --- OKLCH → sRGB conversion (Ottosson 2020) ---
   L: [0,100] (CSS oklch percent), C: [0,0.4+], H: [0,360) degrees.
   Returns a '#rrggbb' hex string, channels clamped to [0,255].
   Reference: https://bottosson.github.io/posts/oklab/ */
function oklch(L, C, H) {
  // Step 1: OKLCH → OKLab
  const Ln = L / 100;  // normalize CSS L% to math [0,1]
  const h  = H * Math.PI / 180;
  const a  = C * Math.cos(h);
  const b  = C * Math.sin(h);

  // Step 2: OKLab → LMS (cube roots)
  const l_ = Ln + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = Ln - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = Ln - 0.0894841775 * a - 1.2914855480 * b;
  const l  = l_ * l_ * l_;
  const m  = m_ * m_ * m_;
  const s  = s_ * s_ * s_;

  // Step 3: LMS → linear sRGB
  const rl =  4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gl = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  // Step 4: linear → gamma (sRGB TRC)
  const gm = (c) => {
    const v = Math.max(0, Math.min(1, c));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  };

  const r = Math.round(gm(rl) * 255);
  const g = Math.round(gm(gl) * 255);
  const bv = Math.round(gm(bl) * 255);
  return '#' + [r, g, bv].map((n) => n.toString(16).padStart(2, '0')).join('');
}

/* --- Token sets --- */

// 5-step neutral ramp — warm dark, OKLCH designed (dusk-harbor mood):
//   hue ~40-52° (yellow-orange undertone) keeps the darks feeling like night harbor, not cold stone.
const NEUTRAL = {
  bg:      oklch(10, 0.022, 40),   // near-black, warm dark background
  surface: oklch(18, 0.026, 40),   // panel / card surface
  border:  oklch(36, 0.030, 42),   // dividers, guide-line color base — BRIGHTENED from L28 (legibility pass)
  dim:     oklch(56, 0.028, 46),   // secondary text, muted annotations — BRIGHTENED from L48 (legibility pass)
  text:    oklch(85, 0.018, 52),   // primary labels (warm off-white, like lamplight)
};

// 4 semantic accents — fixed roles derived from sun-rig.js KEYFRAMES[3] (dusk, t=0.75):
//   Every visualization inherits these roles; a viewer learns once, reads anywhere.
const ACCENT = {
  axis:  '#b0432a',          // = dusk.horizon — structural coordinate axes (terracotta)
  guide: '#7a566a',          // = dusk.hemiSky — guide/grid lines (muted plum)
  ihat:  '#ff8a5a',          // = dusk.sky — i-hat basis vector (warm orange)
  jhat:  oklch(65, 0.13, 235), // cool blue complementary to ihat — j-hat basis vector
};

// 1.2× type scale — base 11px (diagram labels are smaller than UI text)
const TYPE = {
  xs:   '9px',    // tick marks, footnotes
  sm:   '11px',   // axis labels
  md:   '13px',   // body, formula
  lg:   '16px',   // subheading
  xl:   '19px',   // heading
  font: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
  lh:   1.5,
};

// 4-role stroke kit (width in canvas units / px)
const STROKE = {
  axis:  { color: ACCENT.axis,  width: 2.0  },
  guide: { color: ACCENT.guide, width: 0.75 },
  ihat:  { color: ACCENT.ihat,  width: 2.5  },
  jhat:  { color: ACCENT.jhat,  width: 2.5  },
};

// Label substrate — halo (SDF label glow-out) and scrim (HUD panel backing)
const SUBSTRATE = {
  halo:  { color: NEUTRAL.bg, blur: 2, spread: 1 },
  scrim: { color: NEUTRAL.bg, opacity: 0.75 },
};

export const THEME = Object.freeze({ NEUTRAL, ACCENT, TYPE, STROKE, SUBSTRATE });

/* applyThemeToRoot — writes all token values as CSS custom properties to :root.
   Call once on page load; every styled element can then reference var(--lgr-*).
   Pure side-effect: the THEME object is the source of truth, CSS is the projection. */
export function applyThemeToRoot(root = document.documentElement) {
  const vars = [
    ['--lgr-bg',      NEUTRAL.bg],
    ['--lgr-surface', NEUTRAL.surface],
    ['--lgr-border',  NEUTRAL.border],
    ['--lgr-dim',     NEUTRAL.dim],
    ['--lgr-text',    NEUTRAL.text],

    ['--lgr-axis',    ACCENT.axis],
    ['--lgr-guide',   ACCENT.guide],
    ['--lgr-ihat',    ACCENT.ihat],
    ['--lgr-jhat',    ACCENT.jhat],

    ['--lgr-type-xs', TYPE.xs],
    ['--lgr-type-sm', TYPE.sm],
    ['--lgr-type-md', TYPE.md],
    ['--lgr-type-lg', TYPE.lg],
    ['--lgr-type-xl', TYPE.xl],
    ['--lgr-font',    TYPE.font],
    ['--lgr-lh',      String(TYPE.lh)],

    ['--lgr-stroke-axis',  String(STROKE.axis.width)],
    ['--lgr-stroke-guide', String(STROKE.guide.width)],
    ['--lgr-stroke-ihat',  String(STROKE.ihat.width)],
    ['--lgr-stroke-jhat',  String(STROKE.jhat.width)],

    ['--lgr-scrim-opacity', String(SUBSTRATE.scrim.opacity)],
  ];
  for (const [k, v] of vars) root.style.setProperty(k, v);
}
