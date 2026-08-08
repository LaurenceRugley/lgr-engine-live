import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

// CITY project build (the showcase / public /live/ demo). E2: each project is its own workspace
// package with its own vite build, importing the shared @lgr/engine-core (vite-plugin-glsl
// processes the package's .vert/.frag via the workspace symlink → real path outside node_modules).
//
// base: './' → RELATIVE asset URLs, so the built dist/ works at ANY path — the repo root, a Pages
// sub-path, whatever. Critical for the E2 deploy (addendum v2): CI drops each project's dist into
// its OWN subfolder (/live/, /office/, /hoard/); relative bases mean the hashed assets resolve in
// each without per-subpath absolute bases.
export default defineConfig({
  base: './',
  plugins: [glsl()],
  server: { port: Number(process.env.PORT) || 5173 },
  build: {
    // @lgr/engine-core re-exports three (`export * as THREE`) for the one-three rule, which defeats
    // three's tree-shaking → ~767 kB vendor chunk. Deliberate (a duplicate three silently breaks the
    // by-ref sun/weather uniforms); the peerDep tree-shake trim is queued for the perf-wins lesson.
    chunkSizeWarningLimit: 820,
    rolldownOptions: {
      // L113 (smoke-gate item G): ship ONLY the showcase. The standalone dev tools (PixelKit `tools/pixelate.html`,
      // L56 sprite-anim preview `tools/anim-preview.html`) were being bundled into dist/tools/ and PUBLISHED under
      // /live/tools/ — a public leak of internal tooling with zero prospect value. They're driven by the DEV server
      // (asset-factory/process.mjs:34) and the running `npm run dev`, never from the built dist, so dropping them as
      // rollup inputs is safe. smoke.mjs asserts dist/tools/ stays absent so the leak can't silently return.
      input: {
        main: 'index.html',
      },
      output: {
        codeSplitting: {
          groups: [
            { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ },
          ],
        },
      },
    },
  },
});
