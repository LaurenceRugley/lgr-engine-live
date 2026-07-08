/* ============================================================
   cell-field.js — VIZ SLICE 2: labeled cell / node visualization
   ------------------------------------------------------------
   A row (or arbitrary layout) of N cells backed by a THREE.InstancedMesh.
   Each cell has a DOM overlay label (Opus-refute fallback: DOM labels, not troika,
   because it's simpler and N ≤ 16 — labeled as such in the report).

   PREALLOC CONTRACT (Opus-refute correction 4):
     - Preallocate max N + ONE dummy Object3D + ONE Color scratch.
     - setColorAt() at init; then `instanceColor.needsUpdate = true` after EVERY per-op recolor.
     - Never rebuild geometry or create new Color/Object3D per frame.

   API:
     createCellField(values, opts) → { group, setColor, setPosition, lerpPosition,
                                        updateLabels, dispose }
       values:    initial display values (determines N)
       opts.spacing:  x-spacing between cells (default 1.0)
       opts.offsetX:  horizontal center offset (default 0 = centred)
       opts.offsetY:  y position (default 0)
       opts.container: DOM element for label divs (required for labels)
   ============================================================ */
import * as THREE from 'three';

// Base colors (same role vocabulary as THEME.ACCENT)
export const CELL_COLORS = {
  neutral:   '#3a4150',   // resting state
  comparing: '#f5a623',   // amber pulse: cells being compared
  swap:      '#ff7a4d',   // in-flight swap
  sorted:    '#4aaa66',   // confirmed sorted / done
  frontier:  '#3a8fcf',   // BFS frontier
  visited:   '#7a566a',   // BFS visited (dim plum)
};

export function createCellField(values, opts = {}) {
  const N          = values.length;
  const spacing    = opts.spacing ?? 1.0;
  const offsetX    = opts.offsetX ?? -(N - 1) * spacing * 0.5;
  const offsetY    = opts.offsetY ?? 0;
  const container  = opts.container ?? null;    // DOM parent for label divs

  // ---- InstancedMesh (cells as flat boxes) ----------------------------
  const geo  = new THREE.BoxGeometry(0.80, 0.80, 0.10);
  const mat  = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 });
  // +1 dummy slot per contract (the dummy is never rendered — its transform is a NaN sentinel)
  const mesh = new THREE.InstancedMesh(geo, mat, N + 1);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = false;
  mesh.raycast = () => {};

  // ONE dummy Object3D + ONE Color scratch — never re-created.
  const _dummy = new THREE.Object3D();
  const _col   = new THREE.Color();

  // Precomputed home positions (centred on offsetX, offsetY)
  const _homeX = new Float32Array(N);
  const _homeY = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    _homeX[i] = offsetX + i * spacing;
    _homeY[i] = offsetY;
  }

  // Initialise all instance matrices + the dummy.
  for (let i = 0; i < N; i++) {
    _dummy.position.set(_homeX[i], _homeY[i], 0);
    _dummy.updateMatrix();
    mesh.setMatrixAt(i, _dummy.matrix);
  }
  // Dummy slot: park it far offscreen so it never intersects the frustum.
  _dummy.position.set(0, 9999, 0); _dummy.updateMatrix(); mesh.setMatrixAt(N, _dummy.matrix);
  mesh.instanceMatrix.needsUpdate = true;

  // Initial colors.
  for (let i = 0; i < N; i++) { _col.set(CELL_COLORS.neutral); mesh.setColorAt(i, _col); }
  _col.set('#000'); mesh.setColorAt(N, _col);    // dummy slot
  mesh.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.add(mesh);

  // ---- DOM overlay labels -----------------------------------------------
  const labelEls = [];
  if (container) {
    for (let i = 0; i < N; i++) {
      const div = document.createElement('div');
      div.className = 'cell-label';
      div.textContent = String(values[i]);
      div.style.cssText = `
        position:absolute; pointer-events:none;
        font:700 12px/1 ui-monospace,monospace;
        color:#e8d5b8; text-align:center; white-space:nowrap;
        text-shadow:0 0 3px #0e0b07,0 0 6px #0e0b07;
        transform:translate(-50%,-50%);
      `;
      container.appendChild(div);
      labelEls.push(div);
    }
  }

  // Scratch matrix for reading back instance transforms.
  const _readMat = new THREE.Matrix4();

  // ---- Public API -------------------------------------------------------

  function setColor(i, colorKey) {
    if (i < 0 || i >= N) return;
    const hex = CELL_COLORS[colorKey] ?? colorKey;  // accept key string or direct hex
    _col.set(hex); mesh.setColorAt(i, _col);
    mesh.instanceColor.needsUpdate = true;
  }

  // Snap cell i to position (x, y).
  function setPosition(i, x, y) {
    if (i < 0 || i >= N) return;
    _dummy.position.set(x, y, 0); _dummy.updateMatrix();
    mesh.setMatrixAt(i, _dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }

  // Lerp cell i between (x0,y0) and (x1,y1) at fractional t. Y arc for swap animation:
  // `arcHeight` lifts the cell in a parabola — yt = y0+t*(y1-y0) + arcHeight*sin(π*t).
  function lerpPosition(i, x0, y0, x1, y1, t, arcHeight = 0) {
    if (i < 0 || i >= N) return;
    const tc = Math.max(0, Math.min(1, t));
    const x  = x0 + tc * (x1 - x0);
    const y  = y0 + tc * (y1 - y0) + arcHeight * Math.sin(Math.PI * tc);
    setPosition(i, x, y);
  }

  // Read the current world x,y of cell i (from its instance matrix).
  function getPosition(i) {
    if (i < 0 || i >= N) return { x: 0, y: 0 };
    mesh.getMatrixAt(i, _readMat);
    return { x: _readMat.elements[12], y: _readMat.elements[13] };
  }

  // Reset cell i to its home position.
  function resetPosition(i) { setPosition(i, _homeX[i], _homeY[i]); }

  // Update DOM label text for cell i.
  function setLabel(i, text) {
    if (labelEls[i]) labelEls[i].textContent = String(text);
  }

  // Project all label positions to screen. Call every frame in the render loop.
  // `cam`: THREE.Camera; `rect`: canvasMount.getBoundingClientRect().
  const _proj = new THREE.Vector3();
  function updateLabels(cam, rect) {
    for (let i = 0; i < N; i++) {
      if (!labelEls[i]) continue;
      mesh.getMatrixAt(i, _readMat);
      _proj.set(_readMat.elements[12], _readMat.elements[13], _readMat.elements[14]);
      _proj.project(cam);
      const sx = (_proj.x + 1) * 0.5 * rect.width;
      const sy = (1 - _proj.y) * 0.5 * rect.height;
      labelEls[i].style.left = `${sx}px`;
      labelEls[i].style.top  = `${sy}px`;
    }
  }

  function dispose() {
    geo.dispose(); mat.dispose();
    for (const el of labelEls) el.remove();
  }

  return {
    group, mesh, setColor, setPosition, lerpPosition, getPosition,
    resetPosition, setLabel, updateLabels, dispose,
    get N() { return N; },
    get homeX() { return _homeX; },
    get homeY() { return _homeY; },
  };
}
