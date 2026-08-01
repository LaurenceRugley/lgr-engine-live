/* ============================================================
   character-rig-profiles.test.mjs — THE A8 RED TEST (Rule 9: encode WHY, not "runs"; Rule 16: enforce, don't wish).
   ------------------------------------------------------------
   WHY THIS EXISTS: the A5→A8 silent no-op. The zombie horde's procedural lunge + hit-react targeted mixamo
   bone names the Quaternius rig doesn't have (Spine2 vs Torso, LeftArm vs UpperArmL) → the bone resolved
   NULL → the layer block skipped → the whole horde's attack animation was DEAD for three arcs and nothing
   ever errored. A missing bone degrading to a no-op is invisible. This test makes that class of bug RED:
   every motion layer a consumer drives is validated against that consumer's REAL rig bone-set, so a layer
   that targets a bone a shipped rig lacks fails in CI. The two decisive tests are the last ones —
   'RED on a planted missing bone' (prove it fails) and its GREEN restore (prove it passes on the real rig).
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_BONES, RIG_PROFILES, LAYER_BONES, CONSUMER_LAYERS,
  detectProfile, resolveRig, findMissingLayerBones, assertLayersResolvable,
} from './character-rig-profiles.js';

// ── PROVENANCE: the RAW glTF joint names of the two SHIPPED rigs (extracted from the GLB JSON chunks of
// projects/hoard2/public/models/{zombie,survivor}.glb). We sanitise them below with three.js's own rule and
// validate the layers against the RESULT — so the fixtures are the real skeletons, not a hand-typed guess.
// Regenerate if a GLB is swapped: node -e '…read glb json.skins.joints…' (see the arc's world-recipe notes).
const ZOMBIE_RAW = [ // Quaternius "CharacterArmature" — dotted .L/.R names
  'Abdomen', 'Body', 'Eyelid.L', 'Eyelid.R', 'Foot.L', 'Foot.R', 'Head', 'Hips',
  'Index1.L', 'Index1.R', 'LowerArm.L', 'LowerArm.R', 'LowerLeg.L', 'LowerLeg.R', 'Neck',
  'Root', 'Shoulder.L', 'Shoulder.R', 'Torso', 'UpperArm.L', 'UpperArm.R', 'UpperLeg.L', 'UpperLeg.R',
];
const SURVIVOR_RAW = [ // Mixamo "Human Armature" — already dotless
  'Head', 'Hips', 'LeftArm', 'LeftFoot', 'LeftForeArm', 'LeftHand', 'LeftLeg', 'LeftShoulder', 'LeftUpLeg',
  'Neck', 'RightArm', 'RightFoot', 'RightForeArm', 'RightHand', 'RightLeg', 'RightShoulder', 'RightUpLeg',
  'Spine', 'Spine1', 'Spine2',
];

// three.js PropertyBinding.sanitizeNodeName: spaces → '_', then strip the reserved chars [ ] . : /. This is
// what GLTFLoader.createUniqueName applies to every node, so `bone.name` at runtime is the sanitised form.
// (Pinned here so a three upgrade that changed the rule would fail THIS test loudly rather than the rig silently.)
const RESERVED_RE = /[\[\]\.:/]/g;
const sanitize = (n) => n.replace(/\s/g, '_').replace(RESERVED_RE, '');
const ZOMBIE = ZOMBIE_RAW.map(sanitize);       // → FootL, UpperArmL, Torso, …
const SURVIVOR = SURVIVOR_RAW.map(sanitize);   // unchanged (no reserved chars)
const dict = (names) => Object.fromEntries(names.map((n) => [n, { name: n, isBone: true }]));  // fake bone objects

test('sanitisation matches three.js: the Quaternius dotted names become the dotless runtime names', () => {
  // If this drifts, the whole profile map is built on a false premise (the A8 finding rested on this exact fact).
  assert.equal(sanitize('Foot.L'), 'FootL');
  assert.equal(sanitize('UpperArm.L'), 'UpperArmL');
  assert.equal(sanitize('LowerArm.R'), 'LowerArmR');
  assert.ok(ZOMBIE.includes('FootL') && ZOMBIE.includes('UpperArmL') && ZOMBIE.includes('Torso'));
  assert.ok(!ZOMBIE.includes('Foot.L'), 'the dotted name is NOT what bone.name is at runtime');
});

test('profile detection: the two shipped rigs resolve to their expected exporter families', () => {
  const has = (set) => (n) => set.includes(n);
  assert.equal(detectProfile(has(ZOMBIE)).id, 'quaternius');
  assert.equal(detectProfile(has(SURVIVOR)).id, 'mixamo');
  assert.equal(detectProfile(() => false), null, 'an unknown skeleton matches no profile (graceful, not a crash)');
});

test('resolveRig maps every canonical role to a real bone on both shipped rigs (no silent gaps)', () => {
  for (const [label, names] of [['zombie', ZOMBIE], ['survivor', SURVIVOR]]) {
    const { profile, bones, missing } = resolveRig(dict(names));
    assert.ok(profile, `${label}: a profile resolved`);
    assert.deepEqual(missing, [], `${label}: the profile names no bone the skeleton lacks`);
    for (const role of CANONICAL_BONES) {
      assert.ok(bones[role], `${label}: canonical role '${role}' resolved to a bone (${profile.bones[role]})`);
    }
  }
});

test('resolveRig on the zombie picks the Quaternius names the A8 fix depends on (Torso, UpperArmL, FootL)', () => {
  const { bones } = resolveRig(dict(ZOMBIE));
  assert.equal(bones.spine.name, 'Torso', 'the lunge/hit-react spine is Torso on the zombie — NOT the mixamo Spine2 (the A8 bug)');
  assert.equal(bones.armL.name, 'UpperArmL');
  assert.equal(bones.armR.name, 'UpperArmR');
  assert.equal(bones.footL.name, 'FootL');
});

test('resolveRig on the survivor picks the mixamo names (Spine2, LeftArm, LeftFoot)', () => {
  const { bones } = resolveRig(dict(SURVIVOR));
  assert.equal(bones.spine.name, 'Spine2');
  assert.equal(bones.armL.name, 'LeftArm');
  assert.equal(bones.foreArmR.name, 'RightForeArm', 'the aim-IK elbow bone resolves on the survivor');
  assert.equal(bones.footL.name, 'LeftFoot');
});

test('EVERY consumer layer resolves on its rig — the horde CAN lunge/hit-react, the survivor CAN aim/reload', () => {
  // This is the assertion that would have failed in A5 and stayed failing through A8 had it existed.
  assert.deepEqual(findMissingLayerBones(ZOMBIE, CONSUMER_LAYERS.zombieHorde), [], 'zombie horde layers all resolve');
  assert.deepEqual(findMissingLayerBones(SURVIVOR, CONSUMER_LAYERS.survivor), [], 'survivor layers all resolve');
  // Both shipped rigs are complete bipeds, so in fact ALL layers resolve on BOTH — a stronger guarantee.
  assert.deepEqual(findMissingLayerBones(ZOMBIE), [], 'all layers resolve on the zombie');
  assert.deepEqual(findMissingLayerBones(SURVIVOR), [], 'all layers resolve on the survivor');
  assert.doesNotThrow(() => assertLayersResolvable(ZOMBIE, CONSUMER_LAYERS.zombieHorde, 'zombie'));
  assert.doesNotThrow(() => assertLayersResolvable(SURVIVOR, CONSUMER_LAYERS.survivor, 'survivor'));
});

test('RED on a planted missing bone: a Quaternius rig missing its spine bone FAILS the lunge/hit-react check', () => {
  // Reproduce the A8 bug directly: a zombie skeleton whose spine bone name changed/vanished (here we drop the
  // Torso + Abdomen bones). Detection still says quaternius (arms/feet present), but the lunge + hit-react
  // require role 'spine' → 'Torso', which is now ABSENT. The old code would have silently no-op'd the attack;
  // the check must throw.
  const broken = ZOMBIE.filter((n) => n !== 'Torso' && n !== 'Abdomen');
  const misses = findMissingLayerBones(broken, CONSUMER_LAYERS.zombieHorde);
  assert.ok(misses.length > 0, 'the missing spine bone is DETECTED, not silently ignored');
  assert.ok(misses.some((m) => m.layer === 'lunge' && m.role === 'spine'), 'the lunge is flagged as unable to run');
  assert.ok(misses.some((m) => m.layer === 'hitReact' && m.role === 'spine'), 'the hit-react is flagged too');
  assert.throws(
    () => assertLayersResolvable(broken, CONSUMER_LAYERS.zombieHorde, 'zombie'),
    /SILENT no-op/,
    'assertLayersResolvable throws a loud, readable error naming the silent-no-op risk',
  );
});

test('GREEN after restore: the SAME check passes once the spine bone is present again (proves the check is real)', () => {
  // The mirror of the RED test — restoring the bone makes the identical assertion pass, so the RED above was
  // caused by the missing bone and nothing else (a check that can't go green on a good rig is worthless).
  assert.doesNotThrow(() => assertLayersResolvable(ZOMBIE, CONSUMER_LAYERS.zombieHorde, 'zombie'));
});

test('RED on a planted bad LAYER: a layer that names an unknown role is rejected, not silently skipped', () => {
  // The other half of the class: someone adds a layer with a typo'd requirement. findMissingLayerBones must
  // throw on an unknown layer name rather than pretend it validated.
  assert.throws(() => findMissingLayerBones(ZOMBIE, ['nonexistentLayer']), /unknown layer/);
});
