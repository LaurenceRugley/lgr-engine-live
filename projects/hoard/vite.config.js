import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

// HOARD project build (The Hoard standalone → deploys to /hoard/). Single page (index.html →
// main.js). base: './' so the hashed assets resolve under the /hoard/ subfolder. Imports the shared
// @lgr/engine-core; vite-plugin-glsl processes the package's shaders via the workspace symlink.
export default defineConfig({
  base: './',
  plugins: [glsl()],
  server: { port: Number(process.env.PORT) || 5173 },
  build: {
    chunkSizeWarningLimit: 820,
    rolldownOptions: {
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
