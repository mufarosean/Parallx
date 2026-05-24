import { defineConfig } from 'vitest/config';
import path from 'path';

// Stub CSS imports so DOM-touching modules can be unit-tested under
// vitest. Real CSS is loaded by the renderer at runtime; unit tests
// only need the import specifier to resolve to a valid (empty) module.
const cssStubPath = path.resolve(__dirname, 'tests/unit/__cssStub.ts');
const cssStubPlugin = {
  name: 'parallx:css-stub',
  enforce: 'pre' as const,
  resolveId(source: string) {
    if (source.endsWith('.css')) {
      return cssStubPath;
    }
    return null;
  },
};

export default defineConfig({
  plugins: [cssStubPlugin],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    globals: true,
    pool: 'forks',
  },
});
