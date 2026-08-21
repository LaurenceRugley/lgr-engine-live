/* ============================================================
   @lgr/engine-core — createVehicleGlbMesh (ARC A-DRIVE, 2026-08-21): the ROSTER's body loader.
   ------------------------------------------------------------
   ONE loader for every modelled vehicle — car, van, fire truck, helicopter, aeroplane, spaceship
   — so adding a craft to a project is a TABLE ROW plus a GLB, never a new module. It is the
   generalization of `createBikeGlbMesh` (moto.js), which is the same idea hard-wired to one bike:
   that function knows the names `bike_forks` / `bike_wheel_f`, the raked steer axis and the box
   bike fallback. None of those are facts about VEHICLES; they are facts about that bike. Here the
   articulated parts arrive as DATA (`spin`), so a helicopter's two rotors and an aeroplane's
   propeller are three rows in a project's roster rather than three branches in the engine.
     C++ anchor: `createBikeGlbMesh` is a concrete class; this is the template parameterized on the
     part table. The GLB is a serialized scene subtree — find-by-name once, keep the node pointers,
     touch nothing per frame but a rotation scalar (no allocation in update()).

   WHY IT IS NOT A SECOND STYLE (Rule 6). It keeps every convention the two shipped GLB loaders
   already share, because those conventions are the contract consumers depend on:
     · `url` IS THE CONSUMER'S. A `?url` import inside a lib module base64-inlines the asset into
       every bundle that touches the lib (the pedestrians.js rule). The project imports
       '@lgr/engine-core/assets/models/veh_sedan.glb?url' and passes it in.
     · GROUP NOW, CONTENT WHEN READY. The group is returned synchronously and fills in place, so a
       caller can `scene.add()` and start stepping physics before the fetch lands.
     · DEGRADE WHOLE, LOUDLY (the createCrowdTiers.js:116 convention). A failed fetch/parse logs
       and swaps in a plain massing box at the declared footprint — the ride degrades to a SHAPE,
       never to an invisible driver. A partial articulation set is refused for the same reason a
       partial tree kit is: two rotors turning and one frozen reads worse than none turning.
     · `mode` ('loading' -> 'glb' | 'box') and `ready` are PROBE RECEIPTS, not control flow.
     · update(state, dt) takes the movement model's own state object verbatim — the VISUAL is a
       pure consumer of the physics, so swapping meshes cannot move a craft (the property
       moto-lab's 16 checks exist to hold).

   THE MODEL'S ORIGIN IS ITS GROUND CONTACT (tools/blender/build_vehicles.py's stated contract:
   wheels/skids/gear touch y=0), so `group.position.y = state.y` with no offset — the same
   contract createBikeMesh states. A model that does not honour it needs `yOff`, not a fudge at
   the call site.

   THE NOSE IS +Z at yaw 0 — pilot.js's convention, stated in every movement model
   ("forward = (sinθ, cosθ) ... so +Z is the craft's nose"). `yawOffset` exists for a model that
   was authored the other way round; it is a LAST RESORT, and the right fix is the generator
   (which A-DRIVE did: build_vehicles.py's three road tables were authored nose-at-−Z and were
   flipped at the source rather than corrected here, so the runtime needs no per-model constant).

   CONTRACT
     createVehicleGlbMesh({ url, tint, scale, yOff, yawOffset, spin, fallback })
       -> { group, ready, mode, nodes, update(state, dt), setVisible(v), dispose() }
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';   // the in-convention loader (moto.js / createTreeKit.js)

/* ---- THE FALLBACK BODY — a plain massing box at the declared footprint. Not decoration: a
   vehicle you cannot see is a vehicle you cannot drive, and a silent failure here would read as
   "the controls are broken" rather than "the asset did not load". Origin at ground contact, like
   every real model, so the swap changes ART and nothing else. ---- */
export function createBoxVehicleMesh({ w = 0.34, h = 0.34, l = 0.74, color = '#8b909a' } = {}) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, l),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, flatShading: true }),
  );
  mesh.position.y = h / 2;            // the box grows UP from the contact plane
  mesh.castShadow = true; mesh.receiveShadow = false;
  group.add(mesh);
  /* a nose wedge, so which way it points is visible at a glance — the one thing a bare box
     cannot tell you, and the exact thing you need when the fallback is what you are looking at. */
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(w * 0.28, l * 0.22, 4),
    new THREE.MeshStandardMaterial({ color: '#e2e5ea', roughness: 0.5, flatShading: true }),
  );
  nose.rotation.x = Math.PI / 2;      // cone's +Y apex -> +Z, the nose direction
  nose.position.set(0, h * 0.7, l * 0.5);
  nose.castShadow = true;
  group.add(nose);
  return {
    group,
    update(state) { group.position.set(state.x, state.y, state.z); group.quaternion.copy(state.quat); },
    dispose() { for (const m of group.children) { m.geometry.dispose(); m.material.dispose(); } },
  };
}

export function createVehicleGlbMesh({
  url, tint = null, scale = 1, yOff = 0, yawOffset = 0,
  /* SPIN — the articulation table. Each row names a glTF node and how it turns:
       { node, axis: 'x'|'y'|'z', rate, perDist }
     `rate`    rad/s of CONSTANT rotation — a rotor or a propeller, which turns because the engine
               is running, not because the craft is moving. A parked helicopter still idles.
     `perDist` rad per world unit TRAVELLED — a wheel, whose spin is speed/radius by definition
               (pass 1/wheelRadius). Both may be present; they add.
     The axes are RUNTIME axes (three's Y-up), not Blender's: a main rotor turns about +Y, a tail
     rotor about +X, a propeller about +Z (it faces down the nose). ---- */
  spin = [],
  fallback = {},
} = {}) {
  if (!url) throw new Error('createVehicleGlbMesh: `url` is required — import it from \'@lgr/engine-core/assets/models/<name>.glb?url\' (a ?url inside the lib would inline the asset into every bundle; see pedestrians.js)');
  const group = new THREE.Group();
  /* scale is set ONCE, here, not per frame in update(). It is a property of the model, not of the
     craft's state, and re-asserting it 120 times a second is work that buys nothing. Safe before
     the GLB lands because it scales the GROUP: whatever arrives later is a child of it. */
  if (scale !== 1) group.scale.setScalar(scale);
  let mode = 'loading';
  let inner = null;                     // the box fallback delegate (mode 'box')
  const spun = [];                      // [{ node, axis, rate, perDist }] — resolved once, at load

  const ready = new Promise((res) => {
    new GLTFLoader().loadAsync(url).then((gltf) => {
      const root = gltf.scene;
      for (const row of spin) {
        const node = root.getObjectByName(row.node);
        /* ALL OR NONE, loudly — a helicopter with one rotor turning and one frozen reads as a
           broken model, which is worse than a static one (createTreeKit's own partial-kit rule). */
        if (!node) throw new Error(`${url.split('/').pop()} is missing the articulated node '${row.node}' — re-run tools/blender/build_vehicles.py and read its RECEIPT lines`);
        spun.push({ node, axis: row.axis || 'y', rate: row.rate || 0, perDist: row.perDist || 0 });
      }
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = false;
        /* per-instance tint via the MATERIAL SLOT contract: every colourable panel is on a
           material named *_body (build_vehicles.py's slots_for()), so one roster row can ship a
           red van and a blue one off one GLB without a second file. */
        if (tint && o.material) {
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (m.name && m.name.endsWith('_body')) m.color.set(tint);
          }
        }
      });
      group.add(root);
      mode = 'glb';
      res(mode);
    }).catch((e) => {
      console.error(`vehicle GLB failed to load (falling back to a massing box): ${url}`, e);
      inner = createBoxVehicleMesh(fallback);
      group.add(inner.group);
      mode = 'box';
      res(mode);
    });
  });

  /* scratch reused every frame — the no-hot-alloc invariant (docs/engine-invariants.md) */
  const _q = new THREE.Quaternion();
  const _yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawOffset);

  return {
    group,
    ready,
    get mode() { return mode; },
    get nodes() { return spun.map((s) => s.node.name); },   // probe receipt: what actually articulates
    setVisible(v) { group.visible = v; },
    /* Place + orient from the movement model's state, then turn whatever spins. `state.speed` is
       the shared vocabulary of every model in pilot.js, so a wheel row works against any of them. */
    update(state, dt) {
      group.position.set(state.x, state.y + yOff, state.z);
      if (yawOffset) group.quaternion.copy(_q.copy(state.quat).multiply(_yaw));
      else group.quaternion.copy(state.quat);
      if (!spun.length) return;
      const d = Math.abs(state.speed || 0) * dt;   // distance travelled this frame — a wheel's own clock
      for (const s of spun) {
        s.node.rotation[s.axis] += s.rate * dt + s.perDist * d;
      }
    },
    dispose() {
      if (inner) { inner.dispose(); return; }
      group.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      });
    },
  };
}
