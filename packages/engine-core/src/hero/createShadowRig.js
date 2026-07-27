/* ============================================================
   @lgr/engine-core — createShadowRig (Lesson SHADOWS: a reusable shadow-casting sun).
   ------------------------------------------------------------
   The engine-first shadow ability: a hero scene OPTS IN to real, moving cast shadows by adding
   one of these. It owns a DirectionalLight configured to cast, an orthographic shadow camera
   fitted to the scene's bounds, and the two things a hero scene should not each re-implement:
     1. GOVERNOR INTEGRATION — reads core._qualityShadows and, when the QualityGovernor sheds
        shadows at a low rung, stops re-rendering the shadow map (freezes it) and reports
        strength 0 so the receiving shader can drop the effect. Shadows cost nothing on weak GPUs.
     2. THE DIRTY-FLAG — three's renderer.shadowMap.autoUpdate is OFF engine-wide (createEngineCore),
        so the shadow map only re-renders when someone sets needsUpdate. Re-rendering it every
        frame is wasteful when nothing moved; this rig sets the flag only when the sun MOVED —
        the same discipline the city uses (createCityWorld.fitShadowFrustum + SHADOW_EPS gate) —
        UNLESS the caster geometry itself animates every frame (a flowing silk surface), in which
        case `animatedCaster:true` re-renders each frame because the wave that casts is new each frame.

   BUILDS ON the existing seam, does not sit beside it: the global renderer.shadowMap.enabled +
   PCFShadowMap type + autoUpdate:false + the _qualityShadows governor lever were already set up in
   createEngineCore; this rig drives them for a hero scene the same way createCityWorld drives them
   for the city. No second shadow system.

   Directional light ⇒ ORTHOGRAPHIC shadow camera (the sun is effectively at infinity — parallel
   rays — so its view is a box, not a cone). We fit that box to a bounding sphere of the scene so
   the whole surface is inside the shadow frustum at every sun angle. The light itself defaults to
   a real intensity so three definitely counts it among the shadow-casting lights, but a scene
   whose colour is not light-driven (Dusk-Silk colours by wave height) is unaffected by it except
   through the shadow mask — such a scene can leave the lighting to its own shader and use this
   purely as a shadow source.

   C++ anchor: think of it as a small RAII object that owns a light + its shadow-camera config and
   a dirty bit; update() is the per-frame tick that decides whether the shadow map is stale.

   Contract: createShadowRig(core, opts) -> { light, setSunDir(v3), fit({center,radius}), update(),
   get strength, get active, get sunDir, dispose() }. Add it to a scene, call setSunDir as the sun
   moves, call update() once per frame, multiply your shader's shadow strength by `.strength`.
   ============================================================ */
import * as THREE from 'three';

export function createShadowRig(core, {
  scene,                                  // REQUIRED — the scene to add the light + target to
  color        = 0xffffff,
  intensity    = 1.0,                     // kept > 0 so three always counts this shadow-caster;
                                          // scenes that don't light by this can ignore its shading
  center       = [0, 0, 0],               // centre of the bounding sphere the frustum must cover
  radius       = 20,                      // radius of that sphere (world units)
  distance     = 40,                      // how far back along the sun direction the light sits
  mapSize      = 2048,                    // shadow map resolution (px). Higher = crisper, costlier
  bias         = -0.0004,                 // depth-compare epsilon — see the acne↔peter-pan note below
  normalBias   = 0.0,                     // world-normal offset (inert on a raw ShaderMaterial: no HAS_NORMAL)
  softness     = 1.0,                     // PCF radius — how soft the shadow edge is
  animatedCaster = false,                 // true → caster geometry changes every frame (re-render each frame)
} = {}) {
  if (!scene) throw new Error('createShadowRig: `scene` is required (the scene to cast shadows in)');
  const { renderer } = core;

  const light = new THREE.DirectionalLight(color, intensity);
  light.castShadow = true;

  /* Shadow quality knobs. bias is the star of the acne↔peter-panning tradeoff: too small and a
     self-shadowing surface stipples with dark speckles (it tests as just behind itself); too large
     and the shadow detaches from its caster (peter-panning). This default is tuned for the silk;
     a blockier scene wants a different value — hence it's a parameter, not a constant. */
  light.shadow.mapSize.set(mapSize, mapSize);
  light.shadow.bias = bias;
  light.shadow.normalBias = normalBias;
  light.shadow.radius = softness;

  const _center = new THREE.Vector3().fromArray(center);
  let _radius = radius;

  scene.add(light);
  scene.add(light.target);

  const _sunDir  = new THREE.Vector3(0, 1, 0);     // unit direction TOWARD the sun
  const _lastDir = new THREE.Vector3(0, -1, 0);    // ≠ _sunDir so the first update() renders
  let _lastOn = false;

  /* Fit the orthographic shadow frustum to the bounding sphere so nothing clips at any sun angle. */
  function fit({ center: c, radius: r } = {}) {
    if (c) _center.fromArray(c);
    if (typeof r === 'number') _radius = r;
    const cam = light.shadow.camera;               // OrthographicCamera (directional light)
    cam.left = -_radius; cam.right = _radius;
    cam.top  =  _radius; cam.bottom = -_radius;
    cam.near = 0.1;
    cam.far  = distance + _radius * 2 + 0.1;        // light sits `distance` back; box spans 2r beyond centre
    cam.updateProjectionMatrix();
    light.target.position.copy(_center);
    light.target.updateMatrixWorld();
    renderer.shadowMap.needsUpdate = true;
  }

  /* Aim the sun. `dir` points FROM the scene TOWARD the sun (like SunRig.sunDir): the light is
     placed on that side and looks back at the centre. */
  function setSunDir(dir) {
    _sunDir.copy(dir).normalize();
    light.position.copy(_center).addScaledVector(_sunDir, distance);
    light.target.position.copy(_center);
    light.target.updateMatrixWorld();
  }

  /* Per-frame tick. Governor: when shadows are shed, stop re-rendering the map (freeze) — the
     receiving shader is separately zeroed via `.strength`. Dirty-flag: re-render when the sun
     moved, when shadows just turned back on, or every frame if the caster animates. */
  function update() {
    const on = core._qualityShadows;
    if (on) {
      const moved = _lastDir.distanceToSquared(_sunDir) > 1e-6;
      if (animatedCaster || moved || !_lastOn) {
        renderer.shadowMap.needsUpdate = true;
        _lastDir.copy(_sunDir);
      }
    }
    _lastOn = on;
  }

  fit({ center, radius });

  return {
    light,
    setSunDir,
    fit,
    update,
    get sunDir()   { return _sunDir; },
    get strength() { return core._qualityShadows ? 1 : 0; },   // multiply the receiver's shadow term by this
    get active()   { return core._qualityShadows; },
    dispose() {
      scene.remove(light);
      scene.remove(light.target);
      light.dispose?.();
    },
  };
}
