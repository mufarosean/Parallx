import { defineConfig } from 'vitest/config';
import path from 'path';

// vitest.tier0.config.ts — M86-W5 tier-0 (pure Node) test runner
//
// Tier 0: tests that have no DOM, no IPC mocks, no electron deps, and no
// filesystem dependencies. They run under `environment: 'node'` so vitest
// doesn't pay the jsdom setup cost (jsdom add ~250ms/file).
//
// Selection: anything under `tests/unit/platform/**` OR any file matching
// `*.tier0.test.ts`. Authors opt in by either putting the test under the
// platform/ folder or by suffixing the filename.
//
// Tier 1 (current behavior, jsdom + everything): vitest.config.ts.

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
    include: [
      'tests/unit/platform/**/*.test.ts',
      'tests/unit/**/*.tier0.test.ts',
    ],
    environment: 'node',
    globals: true,
    pool: 'forks',
  },
});
