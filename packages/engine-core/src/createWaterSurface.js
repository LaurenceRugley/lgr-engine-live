/* ============================================================
   @lgr/engine-core — createWaterSurface (A12 WATER, PROPERLY): a CONTEXTUAL water body, mobile-safe.
   ------------------------------------------------------------
   THE ABILITY (the owner's spec, B2 ruling): water is contextual, ON TOP of the ground — a pond, a lake, a
   shoreline — never a global plane. This builds one water body as a disc whose per-vertex SHORE-DEPTH (0 at
   the rim -> 1 at the centre) drives a depth colour ramp + a soft shoreline alpha, shaded by an ANALYTIC
   ripple/Fresnel/glint shader (water.vert/.frag). The disc serves both a POND (small, centred) and a LAKE
   (big, off-centre so its rim arcs across the arena as a shoreline) — same geometry, different extent.

   MOBILE-SAFE BY CONSTRUCTION (the black-screen constraint): the shader samples NO textures and reads NO
   render targets, so it never touches OES_texture_half_float_linear (missing on the owner's iPhone) — it
   rides the mobile DIRECT path exactly like a MeshBasic. It is a ShaderMaterial (not "lit"), so hoard2's
   LOWP/safe material swaps leave it untouched. Reflection is a cheap Fresnel SKY-TINT, not the city's
   half-float planar-reflection pass. NO buoyancy / swimming / wave-sim / boats — a surface, not a fluid.

   Contract: createWaterSurface(opts) -> { group, mesh, update(t), setSun(dir,color), setSky(c), setFog(c,d), setRain(v), dispose() }
     opts: { at:[x,z], radius, y, segments, depthPower, colors {shallow,deep,sky}, opacity, ripple, speed, glint, rain }
   ============================================================ */
import * as THREE from 'three';
import waterVert from './shaders/water.vert';
import waterFrag from './shaders/water.frag';

export function createWaterSurface(opts = {}) {
  const {
    kind = 'pond',
    at = [0, 0], radius = 8, y = 0, segments = 96, depthPower = 1.0,
    shallow = 0x3a5f55, deep = 0x14231f, sky = 0x2b3a44,
    opacity = 0.9, ripple = 0.42, speed = 1.0, glint = 0.9, renderOrder = 1,
    // A13 OCEAN (kind:'ocean') — Gerstner swell; all zero/off for pond/lake so those stay flat + unchanged.
    rings = null, waveAmp = 0, swellDir = [0.85, 0.5], wavelength = 14, steepness = 0.7,
    waveSpeed = 1.0, lodNear = 22, lodFar = 90, foam = 0,
    // A14 GLINT — glinty-NDF sun glitter. glintDensity = 0 (default) → the shader skips it entirely, so
    // existing pond/lake/ocean water is byte-identical; a consumer opts in by setting glintDensity > 0.
    glintDensity = 0, glintRough = 0.55, glintMicro = 0.16, glintGain = 1.4,
    // A16 LIFT#2 RAIN RIPPLES — dimpled impact rings. rain = 0 (default) → the shader skips it → byte-
    // identical; a consumer drives it per-frame off the weather schedule via setRain(weather.rain). Pure
    // math (no textures) → stays on the mobile direct path.
    rain = 0,
  } = opts;
  const isOcean = kind === 'ocean' || waveAmp > 0;

  // GEOMETRY. Pond/lake: a CircleGeometry fan (shaded per-fragment; the analytic normal means the fan never
  // bands — A9's defect). Ocean: a TESSELLATED ring-disc (RingGeometry gives radial rings) so the Gerstner
  // VERTEX displacement has vertices to move; the LOD in the shader flattens it toward the horizon. Both
  // carry a shore-depth attribute (1 centre -> 0 rim) driving the depth ramp + soft shoreline.
  const _rings = rings != null ? rings : (isOcean ? 72 : 1);
  const geo = isOcean
    ? new THREE.RingGeometry(0.0, radius, segments, _rings).rotateX(-Math.PI / 2)
    : new THREE.CircleGeometry(radius, segments).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const r = Math.min(1, Math.hypot(pos.getX(i), pos.getZ(i)) / radius);   // 0 centre -> 1 rim
    depth[i] = Math.pow(1 - r, depthPower);                                 // 1 centre -> 0 rim (shore)
  }
  geo.setAttribute('aShoreDepth', new THREE.BufferAttribute(depth, 1));

  const uniforms = {
    uTime: { value: 0 },
    uShallow: { value: new THREE.Color(shallow) },
    uDeep: { value: new THREE.Color(deep) },
    uSky: { value: new THREE.Color(sky) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(0xffffff) },
    uOpacity: { value: opacity },
    uRipple: { value: ripple },
    uSpeed: { value: speed },
    uGlint: { value: glint },
    uFogColor: { value: new THREE.Color(0x000000) },
    uFogDensity: { value: 0 },
    // A13 OCEAN Gerstner + foam (all 0/off for pond/lake → the vertex shader stays flat, the frag no-foam).
    uWaveAmp: { value: waveAmp },
    uSwellDir: { value: new THREE.Vector2(swellDir[0], swellDir[1]) },
    uWavelength: { value: wavelength },
    uSteepness: { value: steepness },
    uWaveSpeed: { value: waveSpeed },
    uLodNear: { value: lodNear },
    uLodFar: { value: lodFar },
    uFoam: { value: foam },
    // A14 GLINT (glintDensity 0 = off; the frag skips the whole term → byte-identical existing water).
    uGlintDensity: { value: glintDensity },
    uGlintRough: { value: glintRough },
    uGlintMicro: { value: glintMicro },
    uGlintGain: { value: glintGain },
    // A16 rain-ripple gain (0 = off → the frag skips it → byte-identical existing water).
    uRain: { value: rain },
    // A-NIGHTFALL light level (1 = off/full daylight → byte-identical existing water). See water.frag.
    uLight: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: waterVert, fragmentShader: waterFrag, uniforms,
    transparent: true, depthWrite: false, fog: false,
    // the glint term reads screen-space derivatives (dFdx/dFdy) for its constant-time LoD; enable the
    // extension so the GLSL-ES-1.00 program compiles on WebGL1-style stacks too (a no-op where unused).
    extensions: { derivatives: true },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(at[0], y, at[1]);
  mesh.raycast = () => {};                 // never catches aim/ballistics (cosmetic surface)
  mesh.renderOrder = renderOrder;          // after the opaque ground disc
  mesh.frustumCulled = false;
  const group = new THREE.Group(); group.raycast = () => {}; group.add(mesh);

  const _v = new THREE.Vector3();
  return {
    group, mesh,
    update(t) { uniforms.uTime.value = t; },
    setSun(dir, color) { if (dir) { _v.copy(dir).normalize(); uniforms.uSunDir.value.copy(_v); } if (color) uniforms.uSunColor.value.copy(color); },
    setSky(color) { if (color) uniforms.uSky.value.copy(color); },
    setFog(color, density) { if (color) uniforms.uFogColor.value.copy(color); if (density != null) uniforms.uFogDensity.value = density; },
    // A16 LIFT#2: drive the rain-ripple intensity per-frame (e.g. off a weather schedule). 0 = calm sea.
    setRain(v) { uniforms.uRain.value = v; },
    /* A-NIGHTFALL: how much light is on the water, 1 = full daylight (the default and the pre-arc
       look), lower = the body goes dark as the sky lighting it goes dark. Drive it from the same
       clock the sky uses; see water.frag for why the sea could not otherwise get dark at all. */
    setLight(v) { uniforms.uLight.value = v; },
    get light() { return uniforms.uLight.value; },
    dispose() { geo.dispose(); mat.dispose(); if (group.parent) group.parent.remove(group); },
  };
}
