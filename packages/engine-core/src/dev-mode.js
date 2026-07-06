/* ============================================================
   dev-mode.js — Lesson 104 Phase 3: the OWNER-ONLY Developer Mode sandbox (spec §11).
   ------------------------------------------------------------
   A hidden, owner-gated dev panel with a per-toy ON/OFF toggle for each of 8 dev toys, persisted to
   localStorage so a setup sticks across reloads. ENGINE-FIRST: this seam lives in engine-core and mostly
   SURFACES data that already exists — the L77 pilot telemetry/axes, the L78 profiler, the L90 governor —
   plus a few dev-gated 3D gizmos. Every project inherits it by wiring createDevMode + ticking update().

   CLIENT-RENDER-SAFE (the byte-identical contract): the project only constructs this when owner-gated
   (?dev=1 / a hidden key) — NEVER in the ?preview/client path — so the shipped client tiers never see it.
   And even within dev, the in-world gizmos (heading/trajectory · ghost-trail · world-gizmos) default OFF
   and are added to a dedicated group; the DOM overlays (telemetry/g-force/perf/scrubber/inspector) never
   touch the render at all. (C++ anchor: a compile-time #ifdef DEBUG overlay — present only in the dev build,
   reading the same telemetry the release build computes but never drawing into the shipped frame.)
   ============================================================ */
import * as THREE from 'three';

const TOYS = [
  { key: 'telemetry', label: 'Telemetry',          d3: false },
  { key: 'perf',      label: 'Perf HUD',            d3: false },
  { key: 'gforce',    label: 'G-force / accel',     d3: false },
  { key: 'scrubber',  label: 'Style-morph scrubber', d3: false },
  { key: 'heading',   label: 'Heading + trajectory', d3: true },
  { key: 'ghost',     label: 'Ghost trail',         d3: true },
  { key: 'worldgiz',  label: 'World gizmos',        d3: true },
  { key: 'inspector', label: 'Entity inspector',    d3: false },
];
const LS = 'lgr_dev_';
const GHOST_N = 90;                                    // ghost-trail ring length (frames sampled)

const CSS = `
.lgr-dev-panel { position: fixed; left: 12px; top: 50%; transform: translateY(-50%); z-index: 9;
  background: rgba(10,12,16,0.92); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(184,153,104,0.4); border-radius: 12px; padding: 10px 12px; min-width: 188px;
  color: #d8dde6; font: 600 12px/1.4 ui-monospace, monospace; box-shadow: 0 8px 30px rgba(0,0,0,0.55); }
.lgr-dev-panel .dh { color: #e8c069; letter-spacing: .14em; font-size: 11px; margin: 0 0 8px; }
.lgr-dev-panel .dr { display: flex; align-items: center; gap: 8px; min-height: 30px; cursor: pointer; user-select: none; }
.lgr-dev-panel .dr input { width: 16px; height: 16px; accent-color: #b89968; cursor: pointer; }
.lgr-dev-ro { position: fixed; z-index: 9; background: rgba(10,12,16,0.86); border: 1px solid rgba(184,153,104,0.32);
  border-radius: 10px; padding: 8px 11px; color: #cdd3dc; font: 500 11px/1.5 ui-monospace, monospace;
  pointer-events: none; display: none; white-space: pre; box-shadow: 0 6px 22px rgba(0,0,0,0.5); }
.lgr-dev-ro.on { display: block; }
.lgr-dev-ro b { color: #e8c069; font-weight: 700; }
.lgr-dev-ro.tel { right: 12px; top: 76px; } .lgr-dev-ro.perf { right: 12px; top: 220px; }
.lgr-dev-ro.gforce { right: 12px; top: 360px; } .lgr-dev-ro.insp { right: 12px; top: 496px; }   /* L106: moved off the LEFT (was colliding with the toggle panel) into the right readout column */
.lgr-dev-bar { display: inline-block; height: 7px; background: #b89968; border-radius: 3px; vertical-align: middle; }
.lgr-dev-scrub { position: fixed; left: 50%; bottom: 64px; transform: translateX(-50%); z-index: 9; display: none;
  align-items: center; gap: 9px; background: rgba(10,12,16,0.9); border: 1px solid rgba(184,153,104,0.4);
  border-radius: 999px; padding: 8px 16px; color: #d8dde6; font: 600 11px/1 ui-monospace, monospace; }
.lgr-dev-scrub.on { display: flex; }
.lgr-dev-scrub input { width: 200px; accent-color: #b89968; }
.lgr-dev-scrub .lab { color: #e8c069; letter-spacing: .1em; }
`;

/* createDevMode({ engine, getCraft, getAxes, setPostMode }) — owner-gated dev sandbox.
   engine     : the engine handle (scene · profiler · governor · sunRig · rig · pilot).
   getCraft() : the live craft followable to read (piloted ∪ seize ∪ inspector focus) or null.
   getAxes()  : the live pilot axis bundle { throttle, steer, lift }.
   setPostMode(m) : drive the REAL post pipeline for the style scrubber. */
export function createDevMode({ engine, getCraft = () => null, getAxes = () => ({}), setPostMode = () => {} } = {}) {
  if (typeof document === 'undefined' || !engine) return { update() {}, destroy() {}, setToy() {}, get state() { return {}; } };
  const scene = engine.scene;
  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

  // ── state + localStorage ────────────────────────────────────────────────────
  const state = {};
  TOYS.forEach((t) => { let v = false; try { v = localStorage.getItem(LS + t.key) === '1'; } catch (e) {} state[t.key] = v; });

  // ── CSS + the toggle panel ──────────────────────────────────────────────────
  const style = el('style'); style.textContent = CSS; document.head.appendChild(style);
  const panel = el('div', 'lgr-dev-panel'); panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', 'Developer mode toys');
  panel.appendChild(Object.assign(el('div', 'dh'), { textContent: '⚙ DEV MODE' }));
  const checks = {};
  TOYS.forEach((t) => {
    const row = el('label', 'dr'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = state[t.key];
    cb.addEventListener('change', () => setToy(t.key, cb.checked));
    row.append(cb, document.createTextNode(' ' + t.label)); panel.appendChild(row); checks[t.key] = cb;
  });
  document.body.appendChild(panel);

  // ── DOM readouts (the no-render toys) ───────────────────────────────────────
  const telRO = el('div', 'lgr-dev-ro tel'); const perfRO = el('div', 'lgr-dev-ro perf');
  const gRO = el('div', 'lgr-dev-ro gforce'); const inspRO = el('div', 'lgr-dev-ro insp');
  document.body.append(telRO, perfRO, gRO, inspRO);
  const scrub = el('div', 'lgr-dev-scrub'); const slider = el('input'); slider.type = 'range'; slider.min = '0'; slider.max = '1'; slider.step = '0.01'; slider.value = '0';
  slider.setAttribute('aria-label', 'Style morph — beauty to toon to pixel');   // L106 a11y (WCAG 4.1.2): the range had no accessible name
  slider.setAttribute('aria-valuetext', 'BEAUTY');   // L110 (audit B13): initial value-text (applyScrub keeps it synced as the slider moves)
  const scrubLab = el('span', 'lab'); scrubLab.textContent = 'BEAUTY';
  slider.addEventListener('input', () => applyScrub(parseFloat(slider.value)));
  scrub.append(Object.assign(el('span', 'lab'), { textContent: 'STYLE' }), slider, scrubLab); document.body.appendChild(scrub);

  // ── 3D gizmos (dev-gated draws — added to a dedicated group, default invisible) ──
  const giz = new THREE.Group(); giz.name = 'lgr-dev-gizmos'; giz.raycast = () => {}; scene.add(giz);
  // heading velocity arrow + a faint predicted-trajectory arc
  const headArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 3, 0xffe2b0, 0.8, 0.5);
  const trajPos = new Float32Array(24 * 3);
  const trajLine = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(trajPos, 3)),
    new THREE.LineBasicMaterial({ color: 0xe8c069, transparent: true, opacity: 0.5 }));
  const headGiz = new THREE.Group(); headGiz.add(headArrow, trajLine); headGiz.visible = false; giz.add(headGiz);
  // ghost trail
  const ghostPos = new Float32Array(GHOST_N * 3); let ghostHead = 0, ghostFill = 0;
  const ghostLine = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(GHOST_N * 3), 3) /* L106 audit fix: the Line owns its OWN buffer (distinct from the ghostPos ring) — the rebuild reads the ring, writes here; aliasing both corrupted the polyline once the ring wrapped */),
    new THREE.LineBasicMaterial({ color: 0x7fe0ff, transparent: true, opacity: 0.55 }));
  ghostLine.visible = false; giz.add(ghostLine);
  // world gizmos: axes · sun-direction arrow · camera frustum · ground grid
  const worldGiz = new THREE.Group(); worldGiz.visible = false; giz.add(worldGiz);
  const axes = new THREE.AxesHelper(6);
  const sunArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.2, 0), 10, 0xffd27f, 1.4, 0.9);
  const grid = new THREE.GridHelper(60, 30, 0x4a5366, 0x2a3140); grid.position.y = 0.02;
  const camHelper = engine.rig && engine.rig.camera ? new THREE.CameraHelper(engine.rig.camera) : null;
  worldGiz.add(axes, sunArrow, grid); if (camHelper) worldGiz.add(camHelper);
  [headArrow, trajLine, ghostLine, axes, sunArrow, grid].forEach((o) => { o.raycast = () => {}; });

  // ── per-toy visibility ──────────────────────────────────────────────────────
  function refresh() {
    telRO.classList.toggle('on', state.telemetry); perfRO.classList.toggle('on', state.perf);
    gRO.classList.toggle('on', state.gforce); inspRO.classList.toggle('on', state.inspector);
    scrub.classList.toggle('on', state.scrubber);
    headGiz.visible = state.heading; ghostLine.visible = state.ghost; worldGiz.visible = state.worldgiz;
    if (camHelper) camHelper.visible = state.worldgiz;
  }
  function setToy(key, on) {
    if (!(key in state)) return; state[key] = on;
    try { localStorage.setItem(LS + key, on ? '1' : '0'); } catch (e) {}
    if (checks[key]) checks[key].checked = on;
    if (key === 'ghost' && on) { ghostHead = ghostFill = 0; }     // reset the trail when re-armed
    refresh();
  }
  refresh();

  // ── the style-morph scrubber → drives the REAL post pipeline (owner pose tool) ──
  const SCRUB_LABELS = ['BEAUTY', 'TOON', 'PIXEL'];
  function applyScrub(v) {
    const tier = v < 0.34 ? 0 : v < 0.67 ? 1 : 2;   // beauty | toon | pixel
    scrubLab.textContent = SCRUB_LABELS[tier];
    slider.setAttribute('aria-valuetext', SCRUB_LABELS[tier]);   // L110 (audit B13): announce the discrete TIER (not the raw 0–1), else AT reads a meaningless "0.42". (The backlog wrongly ticked this done.)
    setPostMode([2, 8, 7][tier]);                   // 2 filmic-beauty · 8 toon · 7 pixel (the REAL tiers)
  }

  // ── per-frame update ────────────────────────────────────────────────────────
  const _e = new THREE.Euler(), _v = new THREE.Vector3(), _p = new THREE.Vector3();
  let prevSpeed = 0, accel = 0, _frame = 0;
  const deg = (r) => (r * 180 / Math.PI).toFixed(0);
  const bar = (val, max, w = 46) => `<span class="lgr-dev-bar" style="width:${Math.round(Math.abs(val) / max * w)}px"></span>`;

  function update(dt) {
    const craft = getCraft();
    const t = craft && craft.pilot ? craft.pilot.getTransform() : null;
    const telem = engine.pilot ? engine.pilot.telemetry : null;
    const ax = getAxes() || {};
    const _domTick = (++_frame % 6) === 0;   // L106 perf: throttle the DOM readouts to ~10Hz (they were rebuilding innerHTML every frame); the 3D gizmos below still update every frame.

    // accel / g-force (smoothed) — from the speed delta
    if (t && dt > 0) { const a = (Math.abs(t.speed) - prevSpeed) / dt; accel += (a - accel) * Math.min(1, dt * 6); prevSpeed = Math.abs(t.speed); }

    // 1) TELEMETRY (DOM)
    if (state.telemetry && _domTick) {
      if (t) {
        _e.setFromQuaternion(t.quat, 'YXZ');
        telRO.innerHTML = `<b>TELEMETRY</b>\n`
          + `pos  ${t.x.toFixed(1)} ${t.y.toFixed(1)} ${t.z.toFixed(1)}\n`
          + `alt  ${(telem ? telem.altitude : 0).toFixed(1)}   medium ${t.medium || '—'}\n`
          + `hdg  ${deg(t.yaw)}°   pitch ${deg(_e.x)}°  roll ${deg(_e.z)}°\n`
          + `spd  ${Math.abs(t.speed).toFixed(1)} m/s   vY ${(t.vy || 0).toFixed(1)}\n`
          + `thr  ${bar(ax.throttle || 0, 1)} ${(ax.throttle || 0).toFixed(2)}\n`
          + `str  ${bar(ax.steer || 0, 1)} ${(ax.steer || 0).toFixed(2)}\n`
          + `lft  ${bar(ax.lift || 0, 1)} ${(ax.lift || 0).toFixed(2)}`;
      } else telRO.innerHTML = `<b>TELEMETRY</b>\n(no craft — press F to fly)`;
    }

    // 2) PERF HUD (DOM) — L78 profiler + L90 governor rung
    if (state.perf && _domTick) {
      const s = engine.profiler ? engine.profiler.sample() : null;
      const q = (typeof window !== 'undefined' && window.__quality) || null;
      if (s) {
        const i = s.info || {};
        perfRO.innerHTML = `<b>PERF</b>\n`
          + `fps  ${s.fps}   cpu p95 ${s.cpuMs.p95}ms\n`
          + `gpu  ${s.gpuMs != null ? s.gpuMs + 'ms' : (s.gpuTimer ? '…' : 'n/a')}\n`
          + `draws ${i.calls || 0}   tris ${((i.tris || 0) / 1000).toFixed(0)}k\n`
          + `geo ${i.geo || 0}  tex ${i.tex || 0}  prog ${i.programs || 0}\n`
          + `gov  rung ${engine.governor ? engine.governor.level : 0}/${q ? q.of : 4}${s.leak ? '  ⚠ LEAK' : ''}`;
      } else perfRO.innerHTML = `<b>PERF</b>\n(profiler idle)`;
    }

    // 3) G-FORCE (DOM)
    if (state.gforce && _domTick) {
      gRO.innerHTML = `<b>G-FORCE</b>\naccel ${accel >= 0 ? '+' : ''}${accel.toFixed(1)} m/s²\n`
        + `g     ${(accel / 9.81).toFixed(2)} g   ${bar(accel, 12)}`;
    }

    // 4) ENTITY INSPECTOR (DOM) — surfaces the active entity (craft ∪ inspector focus)
    if (state.inspector && _domTick) {
      const f = (engine.inspector && engine.inspector.focus) || craft;
      if (f && (f.info || f.pilot)) {
        inspRO.innerHTML = `<b>INSPECT</b>\nkind  ${f.kind || f.label || '—'}\n`
          + `${f.pilot ? 'pilot ' + f.pilot.model + '\n' : ''}`
          + `${typeof f.info === 'function' ? f.info() : ''}`
          + (t ? `\nxyz  ${t.x.toFixed(1)} ${t.y.toFixed(1)} ${t.z.toFixed(1)}` : '');
      } else inspRO.innerHTML = `<b>INSPECT</b>\n(fly a craft, or use Inspect (I) to pick an entity)`;
    }

    // 5) HEADING + TRAJECTORY (3D) — velocity arrow + a short predicted arc
    if (state.heading && t) {
      _p.set(t.x, t.y, t.z);
      const s = Math.sin(t.yaw), c = Math.cos(t.yaw), sp = t.speed || 0;
      _v.set(s * sp, (t.vy || 0), c * sp);
      const len = Math.max(1.2, _v.length() * 0.8);
      headArrow.position.copy(_p);
      headArrow.setDirection(_v.lengthSq() > 1e-4 ? _v.clone().normalize() : new THREE.Vector3(s, 0, c));
      headArrow.setLength(len, 0.7, 0.45);
      // predicted arc: extrapolate the current velocity forward ~1.6s in 8 steps (visual estimate, no integration)
      const arr = trajLine.geometry.attributes.position.array; let k = 0;
      for (let n = 0; n < 8; n++) { const tt = n / 7 * 1.6; arr[k++] = t.x + _v.x * tt; arr[k++] = t.y + _v.y * tt; arr[k++] = t.z + _v.z * tt; }
      trajLine.geometry.attributes.position.needsUpdate = true; trajLine.geometry.setDrawRange(0, 8);
    }

    // 6) GHOST TRAIL (3D) — append the craft position to a ring, redraw the polyline
    if (state.ghost && t) {
      ghostPos[ghostHead * 3] = t.x; ghostPos[ghostHead * 3 + 1] = t.y; ghostPos[ghostHead * 3 + 2] = t.z;
      ghostHead = (ghostHead + 1) % GHOST_N; ghostFill = Math.min(GHOST_N, ghostFill + 1);
      // rebuild oldest→newest into a scratch so the Line draws a continuous path
      const a = ghostLine.geometry.attributes.position.array;
      for (let n = 0; n < ghostFill; n++) { const src = ((ghostHead - ghostFill + n) % GHOST_N + GHOST_N) % GHOST_N; a[n * 3] = ghostPos[src * 3]; a[n * 3 + 1] = ghostPos[src * 3 + 1]; a[n * 3 + 2] = ghostPos[src * 3 + 2]; }
      ghostLine.geometry.attributes.position.needsUpdate = true; ghostLine.geometry.setDrawRange(0, ghostFill);
    }

    // 7) WORLD GIZMOS (3D) — keep the sun-direction arrow + camera frustum live
    if (state.worldgiz) {
      if (engine.sunRig && engine.sunRig.sunArc) sunArrow.setDirection(_v.copy(engine.sunRig.sunArc).normalize());
      if (camHelper) camHelper.update();
    }
  }

  function destroy() {
    [panel, telRO, perfRO, gRO, inspRO, scrub, style].forEach((n) => n && n.remove());
    scene.remove(giz);
    giz.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { const m = o.material; (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose && x.dispose()); } });
  }

  if (typeof window !== 'undefined') window.__dev = { get state() { return { ...state }; }, setToy };
  return { update, setToy, destroy, get state() { return { ...state }; } };
}
