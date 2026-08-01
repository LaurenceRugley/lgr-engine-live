/* ============================================================
   @lgr/engine-core — createDebugOverlay (A10): the FIELD-DEBUG INSTRUMENT, lifted to core.
   ------------------------------------------------------------
   THE ABILITY (docs/field-debug-doctrine.md, owner-ratified): a screenshot-able GL-stack overlay so any
   project — the game, a client site, the showcase — answers the SAME one-tap question when it renders wrong
   on a real device. Born hoard2-local (its `?debug=gl` banner overturned three rounds of confident-wrong
   diagnosis); this is that exact instrument, generalised so every project inherits it.

   THE STANDARD it prints (the doctrine's four demands):
     • CAPS   — renderer/vendor, WebGL version, precision (frag/vert highp), and the FILTERING extensions,
                not just the render-target ones (the 2026-07-29 half-float-linear lesson).
     • STATE  — which tier/path is active (caller-supplied chips + getPath), light counts by type,
                env/tonemapping/exposure, DPR.
     • LIVE   — a canvas LUMINANCE reading + a getError count: the difference between "looks broken" and
                `lum 0.6/255`, a measurement a screenshot can carry.
     • BIG    — an unmissable top-of-screen verdict (FRAG highp OK / p0 NO HIGHP), zero interaction to reveal.

   DEFAULT-INERT: nothing here runs unless the caller creates the overlay (behind its own `?debug=gl` gate),
   so a project's shipped look is byte-identical when the flag is off. C++ anchor: a diagnostic HUD you
   compile in behind an `#ifdef DEBUG` — pure instrumentation, no effect on the render when disabled.

   Contract: createDebugOverlay({ renderer, scene?, chips?, getPath?, pollMs?, mount? }) -> {
     el, update(), snapshot(), dispose(),
   }
     chips   — [{ label, on, color }] tier chips (e.g. [{label:'MOBILE ON', on:true, color:'#66ccff'}]).
     getPath — () => string, the active render-path/tier label for the LIVE line (null → window.__renderPath).
   ============================================================ */

// sample the mean luminance of the drawing buffer (32×32 downscale) — the "is it actually black" number.
function sampleLuminance(canvas) {
  try {
    const w = 32, h = 32, oc = document.createElement('canvas'); oc.width = w; oc.height = h;
    const cx = oc.getContext('2d'); cx.drawImage(canvas, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data;
    let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return (s / (w * h)).toFixed(1);
  } catch (e) { return 'err ' + e.message; }
}

export function createDebugOverlay({ renderer, scene = null, chips = [], getPath = null, pollMs = 500, mount = null } = {}) {
  if (!renderer || !renderer.getContext) throw new Error('createDebugOverlay: a THREE.WebGLRenderer is required');
  if (typeof document === 'undefined') return { el: null, update() {}, snapshot: () => '', dispose() {} };
  const host = mount || document.body;
  const gl = renderer.getContext();
  const de = gl.getExtension('WEBGL_debug_renderer_info');
  const exts = gl.getSupportedExtensions() || [];
  const ex = (n) => (exts.includes(n) ? '✓' : '✗');
  const P = (sh, t) => { const f = gl.getShaderPrecisionFormat(sh, t); return f ? `p${f.precision} [${f.rangeMin},${f.rangeMax}]` : 'null'; };
  const attrs = gl.getContextAttributes() || {};
  const fragHighp = (() => { const f = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT); return f ? f.precision : 0; })();
  const bootErrs = []; for (let i = 0; i < 4; i++) { const e = gl.getError(); if (e) bootErrs.push('0x' + e.toString(16)); }

  // ── CAPS (static, read once at boot) ──────────────────────────
  const capLines = [
    `RENDERER ${de ? gl.getParameter(de.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)}`,
    `VENDOR   ${de ? gl.getParameter(de.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)}`,
    `${gl.getParameter(gl.VERSION)} · WebGL2=${renderer.capabilities.isWebGL2}`,
    `FRAG highp ${P(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)}  (p0 = NO highp)`,
    `FRAG medp ${P(gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT)} · VERT highp ${P(gl.VERTEX_SHADER, gl.HIGH_FLOAT)}`,
    // the FILTERING extensions, not just the render-target ones (the half-float-LINEAR blind-spot lesson).
    `ext colorBufFloat ${ex('EXT_color_buffer_float')} · halfFloatLinear ${ex('OES_texture_half_float_linear')} · colorBufHalf ${ex('EXT_color_buffer_half_float')}`,
    `ctx alpha=${attrs.alpha} depth=${attrs.depth} stencil=${attrs.stencil} aa=${attrs.antialias} preMult=${attrs.premultipliedAlpha} preserve=${attrs.preserveDrawingBuffer}`,
    `getError@boot ${bootErrs.length ? bootErrs.join(',') : 'clean'} · outColorSpace ${renderer.outputColorSpace} · DPR ${(+ (renderer.getPixelRatio ? renderer.getPixelRatio() : (typeof window !== 'undefined' ? window.devicePixelRatio : 1))).toFixed(2)}`,
  ];

  // ── DOM ───────────────────────────────────────────────────────
  const div = document.createElement('div');
  div.id = 'lgr-debug-overlay';
  div.style.cssText = 'position:fixed;left:0;top:0;right:0;z-index:100;background:rgba(0,0,0,0.85);color:#3f6;font:11px/1.35 ui-monospace,monospace;padding:8px;white-space:pre-wrap;word-break:break-word;pointer-events:none;';
  const okCol = '#3fdd6a', badCol = '#ff5566';
  const chipHtml = (label, on, onCol) => `<span style="display:inline-block;margin:2px 6px 2px 0;padding:3px 9px;border-radius:6px;font-weight:700;background:${on ? (onCol || '#66ccff') : '#333'};color:${on ? '#000' : '#aaa'}">${label}</span>`;
  const head = document.createElement('div');
  head.style.cssText = 'font:800 22px/1.25 ui-monospace,monospace;color:#fff;margin-bottom:6px;';
  head.innerHTML =
    `FRAG highp: <span style="color:${fragHighp === 0 ? badCol : okCol}">${fragHighp === 0 ? 'p0 — NO HIGHP' : 'p' + fragHighp + ' OK'}</span><br>` +
    (chips || []).map((c) => chipHtml(c.label, !!c.on, c.color)).join('');
  div.appendChild(head);
  const detail = document.createElement('div');
  detail.textContent = capLines.join('\n') + '\n';
  div.appendChild(detail);
  const live = document.createElement('div'); live.style.color = '#ffdd66';
  div.appendChild(live);
  host.appendChild(div);

  // ── LIVE (per-tick) ───────────────────────────────────────────
  function liveLine() {
    const lum = sampleLuminance(renderer.domElement);
    let L = 0, hemi = 0, dirl = 0, pt = 0, amb = 0;
    if (scene) scene.traverse((o) => { if (o.isLight) { L++; if (o.isHemisphereLight) hemi++; else if (o.isDirectionalLight) dirl++; else if (o.isPointLight) pt++; else if (o.isAmbientLight) amb++; } });
    const ge = gl.getError();
    const path = getPath ? getPath() : (typeof window !== 'undefined' ? window.__renderPath : null);
    const env = scene ? (scene.environment ? 'SET' : 'null') : 'n/a';
    return `LIVE: lum ${lum}/255 · path ${path || '?'} · lights ${L}(H${hemi} D${dirl} P${pt} A${amb}) · env ${env} · tone ${renderer.toneMapping}/${(+renderer.toneMappingExposure).toFixed(2)} · err ${ge ? '0x' + ge.toString(16) : 'clean'}`;
  }
  function update() { live.textContent = liveLine(); }
  update();
  const timer = (typeof setInterval !== 'undefined') ? setInterval(update, pollMs) : null;

  // convenience: a single-string snapshot for a harness/console readout (the old window.__gldbg contract).
  const snapshot = () => capLines.join(' | ') + ' || ' + liveLine();
  if (typeof window !== 'undefined') window.__gldbg = snapshot;

  return {
    el: div,
    update,
    snapshot,
    dispose() { if (timer) clearInterval(timer); if (div.parentNode) div.parentNode.removeChild(div); if (typeof window !== 'undefined' && window.__gldbg === snapshot) delete window.__gldbg; },
  };
}
