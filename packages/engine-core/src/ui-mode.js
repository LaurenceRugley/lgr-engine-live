/* ui-mode.js — PRESENT / AUTHOR profile gate (Lesson I).
   Pure — no DOM, no localStorage direct reads. Pass `devOn` from the caller so this is Node-testable.

   Two profiles (PLAY deferred until a shipped game needs it):
   - PRESENT: default for bare public URLs — in-world HUD only, ZERO editor chrome.
   - AUTHOR:  owner tools — unlocked by the EXISTING `lgr_dev_on` localStorage key
              (main.js backtick gesture sets it; we do NOT invent a new key — Rule 7).

   `?preview` is a ONE-WAY CLIENT LOCK: always PRESENT regardless of devOn.
   The owner badge fires ONLY for AUTHOR on a non-`?preview` URL, so shared/screen-shared
   browsers never silently expose editor chrome without a visible indicator.

   C++ anchor: think of `resolveProfile` as `AuthSession::resolve(env)` — it reads the environment
   once at boot and returns an immutable capability policy; every caller is a `can(cap)` call, not a
   scattered re-derivation of the same flags. */

const CAPS = {
  PRESENT: { editorChrome: false, devTools: false },
  AUTHOR:  { editorChrome: true,  devTools: true  },
};

function makeProfile(name, badge) {
  const caps = CAPS[name];
  return {
    profile: name,
    badge,             // true iff AUTHOR on non-?preview URL (drives the OWNER badge in city main.js)
    can(cap) { return caps[cap] === true; },
  };
}

/* resolveProfile(search, opts) — pure, Node-testable.
   opts.devOn:             boolean — true if lgr_dev_on localStorage === '1' (caller reads, we decide).
   opts.deploymentDefault: 'PRESENT' | 'AUTHOR' (default 'PRESENT' — clean bare-URL default). */
export function resolveProfile(search, { deploymentDefault = 'PRESENT', devOn = false } = {}) {
  const preview = new URLSearchParams(search).has('preview');
  if (preview) return makeProfile('PRESENT', false);   // ?preview: always clean, never badge
  if (devOn)   return makeProfile('AUTHOR',  true);    // lgr_dev_on unlock → AUTHOR + OWNER badge
  return makeProfile(deploymentDefault, false);
}
