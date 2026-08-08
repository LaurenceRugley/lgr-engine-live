import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

// J3 — FULL lib build: @lgr/engine-core → lgr-engine.es.js
// city + all engine tools, code-panel/shiki excised.
//
// Single entry produces a self-contained monolithic ES module (no shared chunks).
// Two entries shared too much code → rolldown-vite extracted a shared chunk, breaking
// the "drop one file" guarantee. Two separate config files is the clean solution.
//
// assetsInlineLimit: 0 attempted and documented: rolldown-vite lib mode ignores this
// flag and inlines ?url assets (GLBs etc.) as base64 data URIs regardless. The bundle
// is fully self-contained (confirmed in J1/J2). Acceptable — proved in J2 consumer test.
//
// THREE EXTERNALIZED (2026-08-02, docs/efficiency-audit-2026-08-02.md §8): was "THREE bundled
// in" until this pass — measured 718.9KB gz with Three inlined vs. bare three.module.min.js at
// 84.4KB gz. Rule-7 checked every existing consumer first: no project (all import engine-core's
// SOURCE barrel via the npm workspace, never this built file) and no cross-repo consumer (neither
// lgr-live-sky nor lgr-image-studio import it) touch this bundle at all. The only real consumers
// are 20 examples/*.html pages — none previously supplied `three` themselves (this build's inlined
// copy was their only source), so this same change adds a `<script type="importmap">` to each one
// pointing the bare `three` specifier at node_modules — see each file's own diff.
export default defineConfig({
  base: './',
  plugins: [glsl()],
  build: {
    lib: {
      entry: 'index-lib.js',
      formats: ['es'],
      fileName: () => 'lgr-engine.es.js',
    },
    outDir: 'dist-lib',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 900,
    rollupOptions: { external: ['three'] },
  },
});
