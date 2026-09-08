// Immutable tracked-source snapshot plus the one repair under evaluation.
// Never builds in the shared checkout or copies user/app/workspace data.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { repo, artifactRoot } from './isolation.mjs';
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
await fs.mkdir(artifactRoot, { recursive: true });
const codeRoot = await fs.mkdtemp(path.join(artifactRoot, `code-${revision.slice(0, 8)}-`));
const archive = path.join(codeRoot, 'source.tar');
execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, revision], { cwd: repo, windowsHide: true });
execFileSync('tar', ['-xf', archive, '-C', codeRoot], { windowsHide: true });
const overlay = [
  'src/built-in/chat/data/chatDataService.ts',
  'tests/unit/chatSummarizationRouting.test.ts',
  'tests/unit/chatCompactionDurability.test.ts',
];
for (const file of overlay) await fs.copyFile(path.join(repo, file), path.join(codeRoot, file));
await fs.symlink(path.join(repo, 'node_modules'), path.join(codeRoot, 'node_modules'), 'junction');
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], { cwd: codeRoot, windowsHide: true, stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/build.mjs', '--production'], { cwd: codeRoot, windowsHide: true, stdio: 'inherit' });
await fs.writeFile(path.join(codeRoot, 'snapshot.json'), JSON.stringify({ revision, overlay, created: new Date().toISOString() }, null, 2));
await fs.writeFile(path.join(artifactRoot, 'prepared.json'), JSON.stringify({ codeRoot, revision }, null, 2));
console.log(`Prepared isolated build: ${codeRoot}`);
