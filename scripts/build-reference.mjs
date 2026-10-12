// build-reference.mjs — writes docs/reference/{commands,settings,views}.md
// from the registries. The rendering lives in tests/unit/referenceDocs.test.ts
// (it needs the TypeScript modules, which vitest loads); this runs that file
// in write mode. npm run build calls it; the test alone keeps the files honest.

import { spawnSync } from 'child_process';

const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vitest', 'run', 'tests/unit/referenceDocs.test.ts'], {
  stdio: 'inherit',
  env: { ...process.env, UPDATE_REFERENCE: '1' },
});
if (r.status !== 0) {
  console.error('[build-reference] writing docs/reference failed');
  process.exit(r.status ?? 1);
}
console.log('[build-reference] docs/reference written');
