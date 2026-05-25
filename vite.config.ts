// vite.config.ts — M86-W12 parallel-build escape valve
//
// Parallx ships with an esbuild-driven renderer build (`scripts/build.mjs`).
// esbuild is fast, has zero quirks for our bundle, and stays. This vite
// config is the SECOND option — an escape valve we can reach for when
// esbuild can't handle a future need (HMR for the renderer, on-demand
// dynamic imports, an SSR pipeline for an embedded preview pane, etc.).
//
// Status: scaffold. The config is intentionally minimal and exists to
// prove the renderer entry point compiles under vite with no behavioural
// drift. We do not switch the default build over to vite. That decision
// is reserved for a future milestone with measurable justification.
//
// Use:
//   npx vite build      → equivalent to `npm run build`, output in dist/
//   npx vite            → dev server with HMR (renderer only, no electron)
//
// vite is NOT in `dependencies` or `devDependencies` on purpose: it stays
// off the install surface until someone opts in. `npx vite build` will
// fetch it on demand. If we promote vite to the default builder we will
// add it to devDependencies in the same commit that flips the default.

import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: '.',
  publicDir: false,
  resolve: {
    alias: {
      // Match esbuild's CSS co-location convention. The renderer imports
      // its CSS via `import './foo.css'` next to each component; vite
      // handles this natively, so no alias config required, but we list
      // src/ here for parity with future tsconfig path mappings.
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: false, // electron/* assets live here too; don't nuke them.
    sourcemap: process.env.NODE_ENV === 'production' ? true : 'inline',
    target: 'es2022',
    minify: process.env.NODE_ENV === 'production',
    lib: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/main.ts'),
      output: {
        entryFileNames: 'main.js',
        assetFileNames: (asset) => {
          if (asset.name && /\.(woff2?|ttf)$/.test(asset.name)) {
            return 'fonts/[name][extname]';
          }
          return '[name][extname]';
        },
        format: 'iife',
        name: 'parallxRenderer',
      },
    },
  },
  // PDF.js runtime assets (worker + cmaps + fonts + wasm) are copied by
  // `scripts/build.mjs` after bundling. When vite becomes the default
  // builder we'll port that copy step into a vite plugin; for the
  // scaffold, run `node scripts/build.mjs` first or copy manually.
  server: {
    port: 5173,
    strictPort: true,
  },
});
