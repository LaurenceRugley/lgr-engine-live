import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import glsl from 'vite-plugin-glsl';

// HOARD project build (The Hoard standalone → deploys to /hoard/). TWO pages: index.html → main.js (the
// wave-survivor) and cavern.html → cavern.js (the Lesson HOARD-1 iso→FPS treasure dive). base: './' so the
// hashed assets resolve under the /hoard/ subfolder. Imports the shared @lgr/engine-core; vite-plugin-glsl
// processes the package's shaders via the workspace symlink.
const page = (f) => fileURLToPath(new URL(f, import.meta.url));
export default defineConfig({
  base: './',
  plugins: [glsl()],
  server: { port: Number(process.env.PORT) || 5173 },
  build: {
    chunkSizeWarningLimit: 820,
    rolldownOptions: {
      input: { main: page('./index.html'), cavern: page('./cavern.html') },
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
