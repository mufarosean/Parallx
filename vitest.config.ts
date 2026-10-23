import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    globals: true,
    pool: 'forks',
    setupFiles: ['tests/unit/setup/domGeometry.ts', 'tests/unit/setup/settleDomTimers.ts'],
    // `import css from './x.css?raw'` gives the stylesheet's text, as the
    // build's raw-text plugin does; every other .css stays stubbed.
    css: { include: [/\.css\?raw$/] },
  },
  resolve: {
    alias: {
      'platform': path.resolve(__dirname, 'src/platform'),
      'services': path.resolve(__dirname, 'src/services'),
      'workbench': path.resolve(__dirname, 'src/workbench'),
      'layout': path.resolve(__dirname, 'src/layout'),
      'parts': path.resolve(__dirname, 'src/parts'),
    },
  },
});
