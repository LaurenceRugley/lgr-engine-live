/* ============================================================
   triplanar-forge.test.mjs — the two invariants that would ship SILENTLY broken (Rule 9: encode WHY).
   ------------------------------------------------------------
   Neither of these is "does it run". Each is a failure this repo has already paid for once, in a
   different module, and would pay for again:

     1. THE FALLBACK MUST BE THE OLD LOOK. `createTextureForge.bake()` returns null on a GPU with no
        high-precision fragment float (iOS p0, owner-verified). If this factory patched a shader anyway
        it would ship a program sampling null samplers to exactly the devices least able to survive it.
        The contract is that a null set produces a PLAIN MeshStandardMaterial — no onBeforeCompile, no
        cache key — in the consumer's stated fallback colour, i.e. what the city rendered before.

     2. THE PROGRAM CACHE KEY MUST SEPARATE CONFIGURATIONS. three caches compiled programs by material
        TYPE plus `customProgramCacheKey`. Two triplanar materials at different tile scales are the
        same type and the same patched source; without distinct keys the second silently renders with
        the first's uniforms, which looks like "the roof texture is the wrong size" and is unfindable
        by reading either call site. (`applyGlint`/`ground-macro` learned this the same way.)

   Plus `tilesPerUnit`, which is pure arithmetic and the one number everyone gets upside down — a tile
   is stated in METRES per tile and a material wants TILES per world unit, so the test pins the
   direction, not just the value.

   Headless: three's material classes construct fine in node (no GL context is touched until render).
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTriplanarForgeMaterial, tilesPerUnit } from './triplanar-forge.js';

// a stand-in for one createTextureForge.bake() set — only the two texture slots are read here.
const fakeSet = () => ({ map: new THREE.Texture(), ormMap: new THREE.Texture() });

test('a NULL baked set falls back to the plain flat material — the iOS-p0 path is the OLD look, not a broken shader', () => {
  const m = createTriplanarForgeMaterial({ side: null, fallbackColor: 0x7d8496, roughness: 0.82 });
  assert.ok(m.isMeshStandardMaterial);
  assert.equal(m.color.getHex(), new THREE.Color(0x7d8496).getHex(), 'wears the consumer\'s stated fallback colour');
  assert.equal(m.roughness, 0.82, 'and still takes the consumer\'s material options');
  assert.equal(m.onBeforeCompile.length, 0, 'no shader patch is installed (three\'s own no-op stub)');
  assert.equal(m.userData.triplanar, undefined, 'and it does not claim to be a triplanar material');
});

test('a real baked set installs the patch, keeps the consumer\'s options, and records its own config', () => {
  const side = fakeSet(), top = fakeSet();
  const m = createTriplanarForgeMaterial({ side, top, scale: 0.4, topScale: 1.2, sharpness: 6, roughness: 0.85, flatShading: true });
  assert.equal(typeof m.onBeforeCompile, 'function');
  assert.equal(m.flatShading, true, 'flatShading survives — the house look is not overridden by the texture pass');
  assert.equal(m.userData.triplanar.scale, 0.4);
  assert.equal(m.userData.triplanar.topScale, 1.2, 'an explicit topScale is NOT collapsed into scale');
  assert.equal(m.userData.triplanar.uniforms.uLgrTopMap.value, top.map, 'the TOP set feeds the +Y projection');
  assert.equal(m.userData.triplanar.uniforms.uLgrSideMap.value, side.map, 'and the SIDE set the X/Z ones');
  // no top set supplied => the side set carries the up-faces too, rather than a null sampler.
  const m2 = createTriplanarForgeMaterial({ side, scale: 0.4 });
  assert.equal(m2.userData.triplanar.uniforms.uLgrTopMap.value, side.map);
  assert.equal(m2.userData.triplanar.topScale, 0.4, 'topScale defaults to scale, not to 1');
});

test('the program cache key SEPARATES configurations — two scales must not share one compiled program', () => {
  const side = fakeSet();
  const a = createTriplanarForgeMaterial({ side, scale: 0.4 });
  const b = createTriplanarForgeMaterial({ side, scale: 1.1 });
  const c = createTriplanarForgeMaterial({ side, scale: 0.4, detail: { set: fakeSet(), scale: 3, amount: 0.3 } });
  assert.notEqual(a.customProgramCacheKey(), b.customProgramCacheKey(), 'a different tile scale is a different program');
  assert.notEqual(a.customProgramCacheKey(), c.customProgramCacheKey(), 'so is adding the detail octave');
  const a2 = createTriplanarForgeMaterial({ side, scale: 0.4 });
  assert.equal(a.customProgramCacheKey(), a2.customProgramCacheKey(), 'but an identical config SHARES one — the cache still works');
});

test('the detail octave is OFF unless a real set is handed in (a half-specified detail must not half-apply)', () => {
  const side = fakeSet();
  const off = createTriplanarForgeMaterial({ side, detail: { scale: 3, amount: 0.9 } });   // no `set`
  assert.equal(off.userData.triplanar.detail, null);
  assert.equal(off.userData.triplanar.uniforms.uLgrDetAmt.value, 0, 'amount 0 is what the shader early-outs on');
});

test('tilesPerUnit converts METRES-per-tile into TILES-per-unit — the direction, not just the number', () => {
  // a recipe covering 6 m per tile, in a world where 1 unit is 6 m, is exactly ONE tile per unit.
  assert.equal(tilesPerUnit({ worldSize: 6, metresPerUnit: 6 }), 1);
  // halve the tile's world coverage and you need TWICE as many tiles per unit (not half).
  assert.equal(tilesPerUnit({ worldSize: 3, metresPerUnit: 6 }), 2);
  // tilesPerTile is the art override and is a straight multiplier on the result.
  assert.equal(tilesPerUnit({ worldSize: 8, metresPerUnit: 6, tilesPerTile: 0.55 }), (6 / 8) * 0.55);
  assert.throws(() => tilesPerUnit({ worldSize: 0 }), /worldSize/, 'a zero tile is a divide-by-zero, not a default');
});
