/* createTreeKit.test.mjs — node:test of the A-TREEKIT pure seams + the shipped GLB's contract.
   These encode the ARC'S INVARIANTS, not just "it runs" (Rule 9):
     • SEPARATE STREAMS — variant choice and tint jitter must not perturb the placer's positions
       (proven at the pure level here; the driven A/B position-hash is the browser-side half);
     • DETERMINISM — same seed ⇒ same variants, same tints (the regression + receipt contract);
     • THE HEADLINE — per-instance tints are DISTINCT and hue-tilted, with the value band matching
       the procedural arm's own 0.82..1.18 (the kit may not darken further than the control did);
     • NEUTRAL CENTRE — sat scales with |w|, so a centred draw is a pure grey (value-only) tint:
       the control arm's behaviour is a SUBSET of the kit's, not a different animal;
     • ORDER-INDEPENDENT HASH — splitting one forest across four variant meshes cannot change the
       placement hash (the exact property the procedural-vs-kit A/B leans its whole weight on);
     • THE GLB SHIPS ITS CONTRACT — 4 named variants, ONE primitive each (one draw per variant),
       COLOR_0 present (albedo×AO — the kit's entire texture story). Parsed from the binary
       directly; a passing vite build proves none of this (the GPU-compiles-at-runtime lesson,
       applied to asset shape). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as THREE from 'three';
import { assignTreeVariants, makeTreeTints, hashTreeInstances, TREE_KIT_VARIANTS } from './createTreeKit.js';

test('variant assignment: deterministic per seed, all variants used, uniform-ish', () => {
  const a = assignTreeVariants(600, 4, 7), b = assignTreeVariants(600, 4, 7), c = assignTreeVariants(600, 4, 8);
  assert.deepEqual([...a], [...b], 'same seed ⇒ same assignment');
  assert.notDeepEqual([...a], [...c], 'a different seed reshuffles');
  const counts = [0, 0, 0, 0];
  for (const v of a) counts[v]++;
  for (let i = 0; i < 4; i++) assert.ok(counts[i] > 600 / 4 * 0.6, `variant ${i} underused: ${counts[i]}/600`);
});

test('tints: deterministic, distinct per instance, value band = the procedural arm\'s own', () => {
  const { colors: c1, report } = makeTreeTints(500, 7);
  const { colors: c2 } = makeTreeTints(500, 7);
  assert.deepEqual([...c1], [...c2], 'same seed ⇒ same tints');
  // the headline: instances differ. 500 draws over a continuous jitter must be ~all distinct.
  assert.ok(report.distinct >= 490, `only ${report.distinct}/500 distinct tints — variety collapsed`);
  // value stays inside the control arm's band (0.82..1.18) and actually USES most of it
  assert.ok(report.vRange[0] >= 0.82 - 1e-9 && report.vRange[1] <= 1.18 + 1e-9,
    `value range ${report.vRange} escaped the procedural arm's 0.82..1.18`);
  assert.ok(report.vRange[1] - report.vRange[0] > 0.25, 'value jitter barely moved — the dial is dead');
  // and the hue axis got exercised both ways
  assert.ok(report.wRange[0] < -0.8 && report.wRange[1] > 0.8, `hue axis span ${report.wRange} too narrow`);
});

test('neutral centre: sat scales with |w| — a zero-sat request is a pure grey multiplier', () => {
  // sat 0 removes the hue poles entirely: every channel equal ⇒ value-only, the control arm's world
  const { colors } = makeTreeTints(64, 3, { sat: 0 });
  for (let i = 0; i < 64; i++) {
    const r = colors[i * 3], g = colors[i * 3 + 1], b = colors[i * 3 + 2];
    assert.ok(Math.abs(r - g) < 1e-6 && Math.abs(g - b) < 1e-6, `tint ${i} not grey at sat 0: ${r},${g},${b}`);
  }
});

test('hashTreeInstances: splitting one forest across meshes cannot change the hash', () => {
  const pts = Array.from({ length: 24 }, (_, i) => [Math.sin(i) * 9, i * 0.13, Math.cos(i * 1.7) * 9]);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial();
  const write = (mesh, list) => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    list.forEach(([x, y, z], k) => mesh.setMatrixAt(k, m.compose(p.set(x, y, z), q, s)));
    mesh.count = list.length;
    mesh.userData.type = 'tree';
    return mesh;
  };
  // arm 1: ONE mesh holding all 24 (the procedural shape)
  const g1 = new THREE.Group();
  g1.add(write(new THREE.InstancedMesh(geo, mat, 24), pts));
  // arm 2: FOUR meshes, interleaved assignment (the kit shape) — same positions, different grouping/order
  const g2 = new THREE.Group();
  for (let v = 0; v < 4; v++) g2.add(write(new THREE.InstancedMesh(geo, mat, 6), pts.filter((_, i) => i % 4 === v)));
  const h1 = hashTreeInstances(g1), h2 = hashTreeInstances(g2);
  assert.equal(h1.count, 24); assert.equal(h2.count, 24);
  assert.equal(h1.hash, h2.hash, 'grouping changed the hash — the A/B receipt would be meaningless');
  // and it CAN go red: nudge one tree by one float ulp-scale step
  const g3 = new THREE.Group();
  g3.add(write(new THREE.InstancedMesh(geo, mat, 24), pts.map(([x, y, z], i) => (i === 11 ? [x + 1e-3, y, z] : [x, y, z]))));
  assert.notEqual(hashTreeInstances(g3).hash, h1.hash, 'a moved tree must change the hash');
});

test('tree_kit.glb ships its contract: 4 variants, one primitive each, COLOR_0 aboard', () => {
  const glb = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'models', 'tree_kit.glb'));
  assert.equal(glb.readUInt32LE(0), 0x46546c67, 'glTF magic');           // 'glTF'
  const jlen = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.subarray(20, 20 + jlen).toString('utf8'));
  const byName = new Map(gltf.nodes.map((n) => [n.name, n]));
  for (const name of TREE_KIT_VARIANTS) {
    const node = byName.get(name);
    assert.ok(node && node.mesh != null, `variant node '${name}' missing from the GLB`);
    const prims = gltf.meshes[node.mesh].primitives;
    assert.equal(prims.length, 1, `'${name}' has ${prims.length} primitives — one draw per variant is the collapse contract`);
    assert.ok('COLOR_0' in prims[0].attributes, `'${name}' lost its COLOR_0 (albedo×AO) — the kit has no other texture story`);
  }
  assert.equal(gltf.materials.length, 4, `expected 4 collapsed materials, got ${gltf.materials.length}`);
});
