import { defineConfig } from 'vite';

// Serves the bake page on its own (README.md), not part of the game's build.
export default defineConfig({
  root: import.meta.dirname,
  server: { port: 8099, strictPort: true, fs: { allow: ['../..'] } },
  resolve: { dedupe: ['three'] },
  esbuild: { target: 'esnext' },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
});
