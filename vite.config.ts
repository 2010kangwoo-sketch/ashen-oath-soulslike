import { defineConfig } from 'vite';

export default defineConfig({
  // Relative assets allow the same build to work locally and under /repository/ on GitHub Pages.
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 2200,
  },
});
