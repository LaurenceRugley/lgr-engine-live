import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import glsl from 'vite-plugin-glsl';

// HOARD v2 build (fresh game → deploys to /hoard2/). ONE page: index.html → main.js (the composition
// root). base: './' so hashed assets resolve under the /hoard2/ subfolder. Imports the shared frozen
// @lgr/engine-core; vite-plugin-glsl processes the package's shaders via the workspace symlink. The
// `three` chunk split matches every sibling project (bundle-size warning budget). No GLSL of our own —
// all shaders are the engine's; the game layer is pure JS composition over the frozen core.
const page = (f) => fileURLToPath(new URL(f, import.meta.url));
export default defineConfig({
  base: './',
  plugins: [glsl()],
  server: { port: Number(process.env.PORT) || 5174 },
  build: {
    chunkSizeWarningLimit: 820,
    rolldownOptions: {
      input: { main: page('./index.html') },
      output: {
        codeSplitting: {
          groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }],
        },
      },
    },
  },
});
