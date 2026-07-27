# Model licenses — projects/hoard/public/models/

## zombie.glb — CC0 (Public Domain)
- **Source:** Quaternius, via the poly.pizza mirror — https://poly.pizza/m/VlXjG0N8Eg
  (direct file: https://static.poly.pizza/c4002f69-6979-42e8-ad6e-2f4e14fc3a9d.glb)
- **License:** **CC0 1.0 (Public Domain)** — free to use, modify, and redistribute, including in
  commercial and open-source projects; attribution appreciated but not required. Verified on the model
  page and in `docs/hoard-oneshot-asset-forge-2026-07-26.md` §licenses (Quaternius' own CC0 statement).
- **Downloaded:** 2026-07-26, with the owner's explicit approval (the M1 asset gate — see HANDOFF.md).
- **Size:** 960 KB (glTF-binary v2, one "Atlas" material → one draw call per instance). Well within the
  Tier-1 brief's ≤ ~5 MB committed-asset budget.
- **Contents:** a skinned humanoid (SkinnedMesh + skeleton) with animation clips including Idle, Walk,
  Run, Punch, HitReact, Death, Crawl, Jump, Wave — the Hoard's rig maps its six states onto these.
- **Used by:** Lesson M1a (`createCharacterRig` demo) + M1b (the Hoard's zombie horde).

## survivor.glb — CC0 (Public Domain)
- **Source:** Quaternius ("Animated Human"), via the poly.pizza mirror — https://poly.pizza/m/c3Ibh9I3udk
  (direct file: https://static.poly.pizza/170235d2-cdeb-4cb2-a82f-4828585138fe.glb)
- **License:** **CC0 1.0 (Public Domain)** — verified on the model page (same Quaternius CC0 grant as the
  zombie; see `docs/hoard-oneshot-asset-forge-2026-07-26.md` §licenses).
- **Downloaded:** 2026-07-26, under the owner's PRE-APPROVED asset class (one-shot sign-off #2,
  `docs/hoard-oneshot-prompt-2026-07.md`) — the CC0 Quaternius survivor/character class.
- **Size:** 682 KB / 0.67 MB (glTF-binary v2, one "Texture" material). Well within the one-shot's ≤ ~2 MB
  survivor-asset budget.
- **Contents:** a skinned humanoid (SkinnedMesh + 1 skeleton) from the SAME Quaternius animated-character
  family as the zombie — clips are armature-prefixed (`Human Armature|<name>`): **Idle, Walk, Run, Punch,
  Death**, plus Jump / Working / ArmatureAction.002. Covers **5 of the 6** rig states (Idle/Walk/Run/attack
  =Punch/death=Death); **HitReact is ABSENT** — `createCharacterRig`'s `findClip` tolerates the armature
  prefix, and `setState('hit')` gracefully no-ops when the clip is missing (the run's hoard2 can map 'hit'
  to a short flinch or accept none).
- **Used by:** the one-shot hoard2 run (the survivor character; the run copies this in-repo).

CC0 assets are safe to commit to this public repo. **Never** commit raw Mixamo character/animation files
here — Adobe's license forbids redistributing the raw files (asset-forge doc). CC0 (Quaternius/Kenney) only.
