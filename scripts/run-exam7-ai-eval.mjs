import { runPlaywrightSuite } from './ai-eval-runner.mjs';
import { EXAM7_WORKSPACE, formatExam7MissingFilesMessage, getMissingExam7BenchmarkFiles } from './exam7-workspace.mjs';

const exam7WorkspaceStatus = getMissingExam7BenchmarkFiles(EXAM7_WORKSPACE);

if (!exam7WorkspaceStatus.workspaceExists || exam7WorkspaceStatus.missingFiles.length > 0) {
  console.error(formatExam7MissingFilesMessage(EXAM7_WORKSPACE));
  process.exit(1);
}

const exitCode = await runPlaywrightSuite({
  tests: ['tests/ai-eval/exam7-quality.spec.ts'],
  workspacePath: EXAM7_WORKSPACE,
  workspaceName: 'Exam 7',
});

process.exit(exitCode);