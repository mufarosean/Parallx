import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    globals: true,
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
