// run-all-quality.mjs — the live quality run of
// docs/CREATIONS_QUALITY_TESTING.md, in the order that swaps models least:
// every player pass first (your play model stays loaded), then every judge
// pass (the judge loads once). Each harness caches what it gets, so a run
// that is stopped can be started again and picks up where it was; --replay
// on any harness rescores without a model.
//
//   node ext/creations-ai/test/run-all-quality.mjs                 (live, hours)
//   node ext/creations-ai/test/run-all-quality.mjs --mock          (wiring, seconds)
//   node ext/creations-ai/test/run-all-quality.mjs --only creation,directions,roleplay
//   Any other flag (--model, --judge, --samples, --num-ctx, --turns) is passed on.
//
// Reports: last-creation-checks.md, last-directions-checks.md,
// last-roleplay-sessions.md, next to this file.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const onlyAt = args.indexOf('--only');
const only = new Set(onlyAt >= 0 ? args[onlyAt + 1].split(',') : ['creation', 'directions', 'roleplay']);
const pass = onlyAt >= 0 ? args.filter((_, i) => i !== onlyAt && i !== onlyAt + 1) : args;
const mock = pass.includes('--mock');

const HARNESSES = [
  ['creation', 'run-creation-checks.mjs'],
  ['directions', 'run-directions-checks.mjs'],
  ['roleplay', 'run-roleplay-sessions.mjs'],
].filter(([id]) => only.has(id));

function run(file, extra) {
  const started = Date.now();
  console.log(`\n=== ${file} ${extra.join(' ')} ===`);
  const res = spawnSync(process.execPath, [path.join(__dirname, file), ...extra], { stdio: 'inherit' });
  console.log(`=== ${file}: exit ${res.status}, ${((Date.now() - started) / 60000).toFixed(1)} min ===`);
  return res.status ?? 1;
}

let failed = 0;
if (mock) {
  for (const [, file] of HARNESSES) failed += run(file, [...pass, ...(file.includes('roleplay') ? ['--turns', '12', '--samples', '1'] : ['--samples', '1'])]) ? 1 : 0;
} else {
  for (const [, file] of HARNESSES) failed += run(file, ['--pass', 'play', ...pass]) ? 1 : 0;
  for (const [, file] of HARNESSES) failed += run(file, ['--pass', 'judge', ...pass]) ? 1 : 0;
}
console.log(failed ? `\n${failed} harness run(s) ended with an error.` : '\nAll harness runs finished.');
process.exitCode = failed ? 1 : 0;
