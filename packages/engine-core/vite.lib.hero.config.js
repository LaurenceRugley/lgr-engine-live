import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

// L-O — HERO-ONLY lib build: @lgr/engine-core hero surface → lgr-engine-hero.es.js
// createEngineCore + the 4 scene packs + director + transitive deps ONLY. No editor/pilot/cockpit/
// terrain/catalog/audio/tracer/etc. (the ~185 KB raw of hero-unused source the audit measured in slim core).
//
// emptyOutDir: false — appends to dist-lib alongside the full + slim-core entries (both run first).
// Single entry avoids shared-chunk extraction (the J self-containment rule).
export default defineConfig({
  base: './',
  plugins: [glsl()],
  build: {
    lib: {
      entry: 'index-hero-lib.js',
      formats: ['es'],
      fileName: () => 'lgr-engine-hero.es.js',
    },
    outDir: 'dist-lib',
    emptyOutDir: false,
    assetsDir: 'assets',
    chunkSizeWarningLimit: 900,
  },
});
