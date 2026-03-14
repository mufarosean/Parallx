import {
  test,
  openFolderViaMenu,
  openChatPanel,
  waitForRagReady,
  startNewSession,
  sendAndWaitForResponse,
  RESPONSE_TIMEOUT,
} from './ai-eval-fixtures';
import { BOOKS_RUBRIC } from './booksRubric';
import {
  evaluateAssertions,
  evaluateRetrievalMetrics,
  scoreTurn,
  type TestCaseResult,
} from './scoring';
import {
  buildBooksEvalReport,
  evaluatePipelineMetrics,
  type BooksTestCaseResult,
  type BooksTurnResult,
} from './booksScoring';
import { runAutonomyBenchmarkScenarios } from './autonomyScenarioRunner';
import { validateBooksWorkspaceGroundTruth } from './booksGroundTruth';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const REPORT_DIR = path.join(PROJECT_ROOT, 'test-results');

if (!process.env.PARALLX_AI_EVAL_WORKSPACE) {
  test.skip(true, 'Books eval requires PARALLX_AI_EVAL_WORKSPACE to point at the Books workspace.');
}

test.describe.serial('Books Workspace Evaluation', () => {
  const allResults: BooksTestCaseResult[] = [];
  let workspaceDisplayName = process.env.PARALLX_AI_EVAL_WORKSPACE_NAME || 'Books';

  test.beforeAll(async ({ window, electronApp, workspacePath, workspaceLabel }) => {
    workspaceDisplayName = process.env.PARALLX_AI_EVAL_WORKSPACE_NAME || workspaceLabel || path.basename(workspacePath) || 'Books';
    await validateBooksWorkspaceGroundTruth(workspacePath);
    console.log(`\n  [Setup] Opening ${workspaceDisplayName}...`);
    await openFolderViaMenu(electronApp, window, workspacePath);

    console.log('  [Setup] Waiting 30s for indexing pipeline...');
    await window.waitForTimeout(30_000);

    console.log('  [Setup] Opening chat panel...');
    await openChatPanel(window);

    console.log('  [Setup] Waiting for RAG readiness...');
    await waitForRagReady(window);

    console.log('  [Setup] Ready. Running Books evaluation...\n');
  });

  for (const tc of BOOKS_RUBRIC) {
    test(`${tc.id}: ${tc.name}`, async ({ window }) => {
      await startNewSession(window);
      await window.waitForTimeout(500);

      const turns: BooksTurnResult[] = [];

      for (const turn of tc.turns) {
        let text = '';
        let latencyMs = 0;
        let debug;

        try {
          const result = await sendAndWaitForResponse(window, turn.prompt, RESPONSE_TIMEOUT);
          text = result.text;
          latencyMs = result.latencyMs;
          debug = result.debug;
        } catch (err) {
          console.warn(`  [WARN] ${tc.id}: Infrastructure error for "${turn.prompt}": ${err}`);
        }

        const assertionResults = evaluateAssertions(text, turn.assertions);
        const score = scoreTurn(assertionResults);
        const retrievalMetrics = turn.retrievalExpectation
          ? evaluateRetrievalMetrics(text, turn.retrievalExpectation)
          : undefined;
        const pipelineMetrics = turn.pipelineExpectation
          ? evaluatePipelineMetrics(debug, turn.pipelineExpectation)
          : undefined;
        turns.push({
          prompt: turn.prompt,
          response: text || '(empty response)',
          latencyMs,
          assertions: assertionResults,
          retrievalMetrics,
          pipelineMetrics,
          debug,
          score,
        });
      }

      const testScore = turns.length > 0
        ? turns.reduce((sum, turn) => sum + turn.score, 0) / turns.length
        : 0;

      allResults.push({
        id: tc.id,
        name: tc.name,
        dimension: tc.dimension as TestCaseResult['dimension'],
        turns,
        score: testScore,
      });

      const icon = testScore >= 0.85 ? 'PASS' : testScore >= 0.5 ? 'PART' : 'FAIL';
      console.log(`  [${icon}] ${tc.id}: ${(testScore * 100).toFixed(0)}% — ${tc.name}`);
    });
  }

  test.afterAll(async ({ ollamaModel }) => {
    if (allResults.length === 0) {
      console.log('\n  No Books results to report.\n');
      return;
    }

    const autonomyScenarios = await runAutonomyBenchmarkScenarios();
    console.log('  Autonomy scenario summary:');
    for (const scenario of autonomyScenarios) {
      console.log(`    [${scenario.passed ? 'PASS' : 'FAIL'}] ${scenario.id}: ${scenario.name}`);
    }

    const report = buildBooksEvalReport(allResults, ollamaModel, {
      autonomyScenarios,
      workspaceName: workspaceDisplayName,
    });

    console.log(report.summary);

    await fs.mkdir(REPORT_DIR, { recursive: true });

    const safeWorkspaceName = workspaceDisplayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'books';
    const jsonPath = path.join(REPORT_DIR, `${safeWorkspaceName}-ai-eval-report.json`);
    const textPath = path.join(REPORT_DIR, `${safeWorkspaceName}-ai-eval-report.txt`);

    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
    await fs.writeFile(textPath, report.summary);

    console.log('  Reports saved:');
    console.log(`    ${jsonPath}`);
    console.log(`    ${textPath}`);
  });
});