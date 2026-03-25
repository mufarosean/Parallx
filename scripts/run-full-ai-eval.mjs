import fs from 'node:fs';

import { runCommand, runPlaywrightSuite } from './ai-eval-runner.mjs';
import { EXAM7_WORKSPACE, formatExam7MissingFilesMessage, getMissingExam7BenchmarkFiles } from './exam7-workspace.mjs';

const BOOKS_WORKSPACE = 'C:/Users/mchit/OneDrive/Documents/Books';

const suiteResults = [];

async function runSuite(label, runner) {
  console.log(`\n=== ${label} ===`);
  const exitCode = await runner();
  suiteResults.push({ label, status: exitCode === 0 ? 'passed' : 'failed', exitCode });
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

function recordSkip(label, reason) {
  suiteResults.push({ label, status: 'skipped', reason });
  console.log(`\n=== ${label} ===`);
  console.log(`SKIPPED: ${reason}`);
}

await runSuite('Build renderer', () => runCommand('npm', ['run', 'build:renderer']));

await runSuite('Core AI eval suites (bundled insurance demo)', () => runPlaywrightSuite({
  tests: [
    'tests/ai-eval/ai-quality.spec.ts',
    'tests/ai-eval/memory-layers.spec.ts',
    'tests/ai-eval/route-authority.spec.ts',
    'tests/ai-eval/workspace-bootstrap-diagnostic.spec.ts',
  ],
  clearWorkspaceOverride: true,
}));

await runSuite('Stress AI eval suite', () => runPlaywrightSuite({
  tests: ['tests/ai-eval/stress-quality.spec.ts'],
  workspacePath: 'tests/ai-eval/stress-workspace',
  workspaceName: 'stress-workspace',
}));

if (fs.existsSync(BOOKS_WORKSPACE)) {
  await runSuite('Books AI eval suite', () => runPlaywrightSuite({
    tests: ['tests/ai-eval/books-quality.spec.ts'],
    workspacePath: BOOKS_WORKSPACE,
    workspaceName: 'Books',
  }));
} else {
  recordSkip('Books AI eval suite', `Workspace not found: ${BOOKS_WORKSPACE}`);
}

const exam7WorkspaceStatus = getMissingExam7BenchmarkFiles(EXAM7_WORKSPACE);

if (!exam7WorkspaceStatus.workspaceExists || exam7WorkspaceStatus.missingFiles.length > 0) {
  recordSkip('Exam 7 AI eval suite', formatExam7MissingFilesMessage(EXAM7_WORKSPACE));
} else {
  await runSuite('Exam 7 AI eval suite', () => runPlaywrightSuite({
    tests: ['tests/ai-eval/exam7-quality.spec.ts'],
    workspacePath: EXAM7_WORKSPACE,
    workspaceName: 'Exam 7',
  }));
}

console.log('\n=== AI eval suite summary ===');
for (const result of suiteResults) {
  if (result.status === 'skipped') {
    console.log(`- ${result.label}: skipped (${result.reason})`);
    continue;
  }
  console.log(`- ${result.label}: ${result.status}`);
}