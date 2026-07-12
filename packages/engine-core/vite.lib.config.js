import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

// J3 — FULL lib build: @lgr/engine-core → lgr-engine.es.js
// city + all engine tools, THREE bundled in, code-panel/shiki excised.
//
// Single entry produces a self-contained monolithic ES module (no shared chunks).
// Two entries shared too much code → rolldown-vite extracted a shared chunk, breaking
// the "drop one file" guarantee. Two separate config files is the clean solution.
//
// assetsInlineLimit: 0 attempted and documented: rolldown-vite lib mode ignores this
// flag and inlines ?url assets (GLBs etc.) as base64 data URIs regardless. The bundle
// is fully self-contained (confirmed in J1/J2). Acceptable — proved in J2 consumer test.
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
  },
});
