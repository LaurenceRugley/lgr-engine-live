/* ============================================================
   createConstellations.js — @lgr/engine-core (ARC A20 lift, from lgr-live-sky/src/constellations.js).
   Stick-figure lines connecting REAL stars, with names.
   ------------------------------------------------------------
   Draws the 88 western constellations (assets/astronomy/constellations.json — source + licence
   chain in constellations.SOURCE.md) by resolving each line segment's two HR (Harvard Revised) star
   numbers against createTrueStars.js's ALREADY-COMPUTED live position buffer — no second alt/az pass
   for the same stars; this module only reads positions createTrueStars.js wrote this frame.

   REAL-LOCATION ONLY: constellation shapes are only meaningful against real star positions, so this
   only ever draws while real-location mode is on (a genuine place + date) — independent of whether
   the visible star POINTS are a procedural field or the 'true sky' (a consumer can want the accurate
   lines over a prettier procedural field). A consumer should keep createTrueStars.js's position
   buffer fresh (call its update()) whenever real-location mode is active, even when its own point
   sprites are hidden, for exactly this reason.

   SUBTLE BY DESIGN: low line opacity + small muted-colour name labels (projected DOM overlay, not
   in-scene text — simplest for a consumer's own HUD) so turning constellations on doesn't clutter
   either star mode. A consumer wires the toggle; off by default here (an intentional reveal, not
   noise) is the caller's choice — this module just draws when told to.

   ⛔ NO-OP BY CONSTRUCTION: group.visible starts false; nothing draws until `resolve()` has run
   (needs both this module's `ready` AND the star catalog's hrToIndex) and a consumer calls update()
   with visible=true.
   ============================================================ */
import * as THREE from 'three';
import constellationsUrl from '../assets/astronomy/constellations.json?url';

const LINE_COLOR = new THREE.Color('#7fa0d8');
const LINE_OPACITY = 0.4;         // subtle — a hint of the figure, not a video-game overlay
const LABEL_R = 88;                // slightly inside the star shell (SHELL_R=92 in createTrueStars.js)

export function createConstellations() {
  const group = new THREE.Group();
  group.raycast = () => {};
  group.visible = false;

  const lineMat = new THREE.LineBasicMaterial({
    color: LINE_COLOR, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false,
  });
  const lineGeo = new THREE.BufferGeometry();
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  lines.raycast = () => {}; lines.frustumCulled = false;
  group.add(lines);

  let raw = null;                    // parsed constellations.json: [{abbrev,name,segments:[[hr,hr]]}]
  let segIdx = [];                   // resolved: [[arrayIndexA, arrayIndexB], ...] (flattened across all constellations)
  let linePos = new Float32Array(0);
  let labelDefs = [];                 // [{ name, memberIdx: [array indices] }] — one per constellation with >=1 resolved segment
  const _dir = new THREE.Vector3(), _world = new THREE.Vector3(), _ndc = new THREE.Vector3(), _camPos = new THREE.Vector3();

  const ready = fetch(constellationsUrl).then((r) => r.json()).then((json) => { raw = json; });

  /* Call once both constellations.json (this module's `ready`) and the star catalog's own catalog
     (its `ready`) have resolved. Builds the flattened segment index list + per-constellation
     member-star lists (for label centroids) against the star catalog's hrToIndex. */
  function resolve(hrToIndex) {
    segIdx = [];
    labelDefs = [];
    for (const c of raw) {
      const members = new Set();
      const before = segIdx.length;
      for (const [hrA, hrB] of c.segments) {
        const a = hrToIndex.get(hrA), b = hrToIndex.get(hrB);
        if (a == null || b == null) continue;   // shouldn't happen (the packer already resolved all 692) but stay defensive
        segIdx.push([a, b]);
        members.add(a); members.add(b);
      }
      if (segIdx.length > before) labelDefs.push({ name: c.name, memberIdx: [...members] });
    }
    linePos = new Float32Array(segIdx.length * 2 * 3);
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  }

  /* positionBuf: the star catalog's live Float32Array (star index -> [x,y,z], already scaled to its
     shell radius, in the group-local frame that rides the camera). nightK/visible gate opacity;
     camera is needed to project label centroids to screen space. Returns the label list for a
     consumer's DOM overlay to position: [{ name, x, y }] in 0..1 screen fractions, only for labels
     currently in front of the camera. */
  function update(positionBuf, nightK, visible, camera) {
    group.visible = visible && segIdx.length > 0;
    lineMat.opacity = visible ? nightK * LINE_OPACITY : 0;
    if (!group.visible) return [];

    for (let s = 0; s < segIdx.length; s++) {
      const [a, b] = segIdx[s];
      const o = s * 6;
      linePos[o] = positionBuf[a * 3]; linePos[o + 1] = positionBuf[a * 3 + 1]; linePos[o + 2] = positionBuf[a * 3 + 2];
      linePos[o + 3] = positionBuf[b * 3]; linePos[o + 4] = positionBuf[b * 3 + 1]; linePos[o + 5] = positionBuf[b * 3 + 2];
    }
    lineGeo.attributes.position.needsUpdate = true;

    if (nightK < 0.05) return [];   // no point projecting labels for an invisible/day sky
    camera.getWorldPosition(_camPos);
    const labels = [];
    for (const { name, memberIdx } of labelDefs) {
      _dir.set(0, 0, 0);
      for (const idx of memberIdx) _dir.x += positionBuf[idx * 3], _dir.y += positionBuf[idx * 3 + 1], _dir.z += positionBuf[idx * 3 + 2];
      _dir.divideScalar(memberIdx.length).normalize();
      _world.copy(_dir).multiplyScalar(LABEL_R).add(_camPos);
      _ndc.copy(_world).project(camera);
      if (_ndc.z > 1) continue;   // behind the camera
      labels.push({ name, x: _ndc.x * 0.5 + 0.5, y: 1 - (_ndc.y * 0.5 + 0.5), opacity: nightK * LINE_OPACITY });
    }
    return labels;
  }

  return { group, ready, resolve, update };
}
