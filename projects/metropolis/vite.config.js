import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import glsl from 'vite-plugin-glsl';

// Arc A-METRO: a fresh project → deploys to /metropolis/. ONE page: index.html → main.js. base: './' so
// hashed assets resolve under the subfolder. Imports the shared @lgr/engine-core; vite-plugin-glsl
// processes the package's shaders via the workspace symlink. No GLSL of our own — pure composition.
const page = (f) => fileURLToPath(new URL(f, import.meta.url));
export default defineConfig({
  base: './',
  plugins: [glsl()],
  server: { port: Number(process.env.PORT) || 5176 },
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
