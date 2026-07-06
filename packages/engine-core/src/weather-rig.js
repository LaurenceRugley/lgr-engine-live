/* ============================================================
   weather-rig.js — Lesson 18: weather (rain / snow / fog / clear) + a light season hook.
   ------------------------------------------------------------
   A portable sibling to the SunRig (it knows nothing about the city). It owns the visible
   particle layers (rain + snow) and exposes a few EASED scalars the scene wires into its
   shaders/lights — the same "compose, don't fork" pattern as the SunRig: weather is a small
   modifier on top of the world, not a rewrite of it.

   THE SHOWPIECE: rain that ripples the REAL water. We don't fake it — each frame we hand the
   L03 height-field sim a fistful of random raindrops through the SAME "drop" path the mouse
   uses. The FBO simulation just gained a second input source, so the water genuinely stipples.

   PARTICLES = AN INSTANCE POOL. Rain and snow are each ONE InstancedMesh of a fixed pool of
   quads. We never create/destroy particles in the loop — we RECYCLE: when a drop falls below
   the ground we teleport it back to the top with a fresh x/z. (C++ analogy: an object pool /
   ring buffer you index into; allocation happens once, never in the hot loop.)
   ============================================================ */
import * as THREE from 'three';

export const WEATHER_KINDS = ['clear', 'rain', 'snow', 'fog'];

export function createWeatherRig({ extent = 7 } = {}) {
  const group = new THREE.Group();
  group.raycast = () => {};

  const COL = extent + 2;        // half-width of the column the precip falls through (covers the city)
  const TOP = 11, BOT = 0.25;    // recycle band: spawn at TOP, recycle when below BOT
  const rnd = (a, b) => a + Math.random() * (b - a);   // weather is decoration → Math.random is fine

  /* ---- visible RAIN: thin vertical streaks, one InstancedMesh ---- */
  const RAIN_N = 600;
  const rain = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.015, 0.5),
    new THREE.MeshBasicMaterial({ color: '#a9bdd6', transparent: true, opacity: 0.0, depthWrite: false, fog: false }),
    RAIN_N,
  );
  rain.frustumCulled = false; rain.raycast = () => {};
  const rPos = new Float32Array(RAIN_N * 3), rSpd = new Float32Array(RAIN_N);
  for (let i = 0; i < RAIN_N; i++) { rPos[i * 3] = rnd(-COL, COL); rPos[i * 3 + 1] = rnd(BOT, TOP); rPos[i * 3 + 2] = rnd(-COL, COL); rSpd[i] = rnd(9, 14); }

  /* ---- visible SNOW: small soft flakes, slower, swaying ---- */
  const SNOW_N = 700;
  const snow = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.07, 0.07),
    new THREE.MeshBasicMaterial({ color: '#f3f7ff', transparent: true, opacity: 0.0, depthWrite: false, fog: false }),
    SNOW_N,
  );
  snow.frustumCulled = false; snow.raycast = () => {};
  const sPos = new Float32Array(SNOW_N * 3), sPh = new Float32Array(SNOW_N), sSpd = new Float32Array(SNOW_N);
  for (let i = 0; i < SNOW_N; i++) { sPos[i * 3] = rnd(-COL, COL); sPos[i * 3 + 1] = rnd(BOT, TOP); sPos[i * 3 + 2] = rnd(-COL, COL); sPh[i] = rnd(0, 6.28); sSpd[i] = rnd(0.6, 1.2); }

  group.add(rain, snow);

  // raindrops handed to the water sim: 8 Vector3 (uv.x, uv.y, strength), bound by reference in main.
  const rainDrops = Array.from({ length: 8 }, () => new THREE.Vector3());
  let dropCount = 0;

  let kind = 'clear';
  // EASED outputs (consumers read these getters): overcast (sun dim/ambient lift), fog density,
  // snow accumulation (white-roof tint), cloud cover (drifting cloud-shadow strength).
  let intensity = 0, overcast = 0, fogAmt = 0, snowAccum = 0, cloudAmt = 0;
  const dummy = new THREE.Object3D();
  const ease = (cur, goal, dt, k) => cur + (goal - cur) * Math.min(1, dt * k);

  function setKind(k) { if (WEATHER_KINDS.includes(k)) kind = k; }
  function cycle() { kind = WEATHER_KINDS[(WEATHER_KINDS.indexOf(kind) + 1) % WEATHER_KINDS.length]; }

  function update(dt, elapsed) {
    const isRain = kind === 'rain', isSnow = kind === 'snow', isFog = kind === 'fog';
    const active = kind !== 'clear';
    intensity = ease(intensity, active ? 1 : 0, dt, 1.4);
    overcast  = ease(overcast,  active ? 1 : 0, dt, 1.2);
    fogAmt    = ease(fogAmt,    isFog ? 1 : 0, dt, 0.9);
    cloudAmt  = ease(cloudAmt,  (active && !isFog) ? 1 : 0, dt, 1.0);
    snowAccum = ease(snowAccum, isSnow ? 1 : 0, dt, isSnow ? 0.22 : 0.5);  // builds slowly, melts faster

    // --- RAIN: fall + wind shear, recycle, and feed the water sim ---
    const rainAmt = isRain ? intensity : 0;
    const rainVisible = Math.round(RAIN_N * rainAmt);
    for (let i = 0; i < RAIN_N; i++) {
      if (i >= rainVisible) { dummy.position.set(0, -50, 0); dummy.scale.setScalar(0); dummy.updateMatrix(); rain.setMatrixAt(i, dummy.matrix); continue; }
      rPos[i * 3 + 1] -= rSpd[i] * dt;          // fall
      rPos[i * 3] += dt * 1.1;                   // wind shear (drift +x)
      if (rPos[i * 3 + 1] < BOT) { rPos[i * 3] = rnd(-COL, COL); rPos[i * 3 + 1] = TOP; rPos[i * 3 + 2] = rnd(-COL, COL); }
      dummy.position.set(rPos[i * 3], rPos[i * 3 + 1], rPos[i * 3 + 2]);
      dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      rain.setMatrixAt(i, dummy.matrix);
    }
    rain.instanceMatrix.needsUpdate = true; rain.material.opacity = 0.55 * rainAmt;
    // water drops: up to 8 random gaussian dimples per frame, scaled by intensity.
    dropCount = isRain ? Math.round(8 * intensity) : 0;
    for (let i = 0; i < dropCount; i++) rainDrops[i].set(Math.random(), Math.random(), 0.05 * intensity);

    // --- SNOW: slow fall + horizontal sway ---
    const snowVisible = Math.round(SNOW_N * (isSnow ? intensity : 0));
    for (let i = 0; i < SNOW_N; i++) {
      if (i >= snowVisible) { dummy.position.set(0, -50, 0); dummy.scale.setScalar(0); dummy.updateMatrix(); snow.setMatrixAt(i, dummy.matrix); continue; }
      sPos[i * 3 + 1] -= sSpd[i] * dt;
      const sway = Math.sin(elapsed * 1.5 + sPh[i]) * 0.5;
      if (sPos[i * 3 + 1] < BOT) { sPos[i * 3] = rnd(-COL, COL); sPos[i * 3 + 1] = TOP; sPos[i * 3 + 2] = rnd(-COL, COL); }
      dummy.position.set(sPos[i * 3] + sway, sPos[i * 3 + 1], sPos[i * 3 + 2]);
      dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
      snow.setMatrixAt(i, dummy.matrix);
    }
    snow.instanceMatrix.needsUpdate = true; snow.material.opacity = 0.9 * (isSnow ? intensity : 0);
  }

  return {
    group, update, cycle, setKind, rainDrops,
    get kind() { return kind; },
    get intensity() { return intensity; },
    get overcast() { return overcast; },     // 0 clear → 1 any weather (sun dim / ambient lift)
    get fog() { return fogAmt; },            // fog density driver
    get snow() { return snowAccum; },        // white-roof accumulation 0..1
    get cloud() { return cloudAmt; },        // drifting cloud-shadow strength
    get rainDropCount() { return dropCount; },
    poolCounts: { rain: RAIN_N, snow: SNOW_N },
  };
}
