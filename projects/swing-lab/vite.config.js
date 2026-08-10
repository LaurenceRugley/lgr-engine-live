import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

export default defineConfig({
  base: './',
  plugins: [glsl()],
  server: { port: Number(process.env.PORT) || 5179 },
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
