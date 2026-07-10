import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `SINGLEFILE=1 vite build` emits ONE self-contained dist/index.html (all JS +
// CSS inlined) for an offline, double-click-to-play build. A post-build step
// (scripts/build-singlefile.mjs) then inlines the runtime GLB models as data
// URIs so the figures load from file:// too. The normal build is unchanged.
const singlefile = process.env.SINGLEFILE === '1';

export default defineConfig({
  base: './',
  plugins: singlefile ? [viteSingleFile()] : [],
  build: {
    target: 'es2022',
    sourcemap: !singlefile,
    rollupOptions: singlefile ? undefined : { input: ['index.html', 'model-audit.html'] },
  },
  server: {
    host: true,
    port: 5173,
  },
});
