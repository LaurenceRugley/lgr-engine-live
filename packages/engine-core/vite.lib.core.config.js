import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

// J3 — SLIM CORE lib build: @lgr/engine-core → lgr-engine-core.es.js
// THREE + renderer/rig/post/sun + general tools. No city content, no GLBs, no code-panel.
//
// emptyOutDir: false — appends to dist-lib alongside lgr-engine.es.js produced by
// vite.lib.config.js (which runs first and cleans the dir on its own build step).
//
// Single entry avoids shared chunk extraction (see vite.lib.config.js comments).
// Expected: ~<250 KB gz (THREE ~300 KB gz + engine core with no GLB base64 ballast).
export default defineConfig({
  base: './',
  plugins: [glsl()],
  build: {
    lib: {
      entry: 'index-core-lib.js',
      formats: ['es'],
      fileName: () => 'lgr-engine-core.es.js',
    },
    outDir: 'dist-lib',
    emptyOutDir: false,
    assetsDir: 'assets',
    chunkSizeWarningLimit: 900,
  },
});
