/**
 * M39 Stress Workspace — AI Quality Evaluation Spec
 *
 * End-to-end Playwright tests that launch Parallx with the stress-test workspace
 * (20 messy files, contradictions, stubs, noise), interact with AI chat using
 * REAL Ollama inference, and score skill-activated responses.
 *
 * Must be run with PARALLX_AI_EVAL_WORKSPACE pointing to the stress workspace:
 *
 *   PARALLX_AI_EVAL_WORKSPACE=tests/ai-eval/stress-workspace \
 *     npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/stress-quality.spec.ts
 *
 * Prerequisites:
 *   - Ollama running at localhost:11434
 *   - The test model available (default: `ollama pull gpt-oss:20b`)
 *   - Build Parallx: `npm run build:renderer`
 */
import {
  test,
  expect,
  openFolderViaMenu,
  openChatPanel,
  waitForRagReady,
  startNewSession,
  sendAndWaitForResponse,
  RESPONSE_TIMEOUT,
} from './ai-eval-fixtures';
import { STRESS_RUBRIC } from './stressRubric';
import {
  evaluateAssertions,
  scoreTurn,
  buildReport,
  type TestCaseResult,
  type TurnResult,
} from './scoring';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const REPORT_DIR = path.join(PROJECT_ROOT, 'test-results');

// ── Accumulated results (module-level, safe with workers:1) ──────────────────
const allResults: TestCaseResult[] = [];

// ═════════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════════

test.describe.serial('M39 Stress Workspace — Skill Quality Evaluation', () => {
  let workspaceDisplayName = 'stress-workspace';

  // ── Setup: Open workspace, wait for indexing, open chat ────────────────────

  test.beforeAll(
    async ({ window, electronApp, workspacePath, workspaceLabel, workspaceHasPersistedIndex }) => {
      workspaceDisplayName = workspaceLabel || path.basename(workspacePath) || 'stress-workspace';
      console.log(`\n  [Stress Eval] Opening ${workspaceDisplayName}...`);
      console.log(`  [Stress Eval] Source workspace persisted index: ${workspaceHasPersistedIndex ? 'present' : 'missing'}`);
      await openFolderViaMenu(electronApp, window, workspacePath);

      // Stress workspace has 20 files — allow extra indexing time
      console.log('  [Stress Eval] Waiting 45s for indexing pipeline...');
      await window.waitForTimeout(45_000);

      console.log('  [Stress Eval] Opening chat panel...');
      await openChatPanel(window);

      console.log('  [Stress Eval] Waiting for RAG readiness...');
      await waitForRagReady(window);

      console.log('  [Stress Eval] Ready. Running stress evaluation...\n');
    },
  );

  // ── Rubric Tests (S-T01 through S-T10) ─────────────────────────────────────

  for (const tc of STRESS_RUBRIC) {
    test(`${tc.id}: ${tc.name}`, async ({ window }) => {
      // Multi-turn tests (S-T09 ambiguous phrasing, S-T10 multi-turn) need more time
      const perTurnTimeout = tc.turns.length >= 3 ? 240_000 : RESPONSE_TIMEOUT;
      if (tc.turns.length >= 3) {
        test.setTimeout(12 * 60 * 1000);
      }

      await startNewSession(window);
      await window.waitForTimeout(500);

      const turns: TurnResult[] = [];

      for (const turn of tc.turns) {
        let text = '';
        let latencyMs = 0;
        let debug;

        try {
          const result = await sendAndWaitForResponse(
            window,
            turn.prompt,
            perTurnTimeout,
          );
          text = result.text;
          latencyMs = result.latencyMs;
          debug = result.debug;

          if (!text.trim()) {
            console.warn(`  [WARN] ${tc.id}: empty response for "${turn.prompt}"`);
          }
        } catch (err) {
          console.warn(`  [WARN] ${tc.id}: Infrastructure error for "${turn.prompt}": ${err}`);
        }

        if (tc.id === 'S-T09' && turn.prompt === 'Tell me about everything in here.' && text.trim()) {
          expect(debug?.runtimeTrace?.route?.reason).toContain('Semantic fallback applied');
          expect(debug?.runtimeTrace?.route?.workflowType).toBe('folder-summary');
          expect(debug?.runtimeTrace?.contextPlan?.retrievalPlan?.coverageMode).toBe('exhaustive');
        }

        const assertionResults = evaluateAssertions(text, turn.assertions);
        const score = scoreTurn(assertionResults);

        turns.push({
          prompt: turn.prompt,
          response: text || '(empty response)',
          latencyMs,
          assertions: assertionResults,
          score,
        });

        test.info().annotations.push({
          type: 'ai-eval-score',
          description: `${(score * 100).toFixed(0)}% — ${assertionResults.filter(a => a.passed).length}/${assertionResults.length} assertions passed`,
        });
      }

      const testScore =
        turns.length > 0
          ? turns.reduce((s, t) => s + t.score, 0) / turns.length
          : 0;

      allResults.push({
        id: tc.id,
        name: tc.name,
        dimension: tc.dimension,
        turns,
        score: testScore,
      });

      const icon = testScore >= 0.85 ? 'PASS' : testScore >= 0.5 ? 'PART' : 'FAIL';
      console.log(
        `  [${icon}] ${tc.id}: ${(testScore * 100).toFixed(0)}% — ${tc.name}`,
      );
    });
  }

  // ── Report Generation ────────────────────────────────────────────────────

  test.afterAll(async () => {
    if (allResults.length === 0) { return; }

    const report = buildReport(allResults, workspaceDisplayName);
    const reportJson = JSON.stringify(report, null, 2);
    const reportTxt = formatTextReport(report, allResults);

    await fs.mkdir(REPORT_DIR, { recursive: true });
    await fs.writeFile(path.join(REPORT_DIR, 'stress-eval-report.json'), reportJson, 'utf8');
    await fs.writeFile(path.join(REPORT_DIR, 'stress-eval-report.txt'), reportTxt, 'utf8');

    console.log(`\n  [Stress Eval] Score: ${(report.overallScore * 100).toFixed(0)}% (${report.grade})`);
    console.log(`  [Stress Eval] Report written to test-results/stress-eval-report.{json,txt}`);
  });
});

// ── Text Report Formatter ────────────────────────────────────────────────────

function formatTextReport(
  report: ReturnType<typeof buildReport>,
  results: TestCaseResult[],
): string {
  const lines: string[] = [
    '═══════════════════════════════════════════════════════════════════',
    `  M39 Stress Workspace Quality Report — ${report.workspace}`,
    `  Overall Score: ${(report.overallScore * 100).toFixed(0)}% (${report.grade})`,
    `  Tests: ${results.length} | Pass (≥85%): ${results.filter(r => r.score >= 0.85).length}`,
    '═══════════════════════════════════════════════════════════════════',
    '',
  ];

  for (const tc of results) {
    const icon = tc.score >= 0.85 ? '✓' : tc.score >= 0.5 ? '~' : '✗';
    lines.push(`${icon} ${tc.id}: ${(tc.score * 100).toFixed(0)}% — ${tc.name}`);

    for (const turn of tc.turns) {
      lines.push(`    Prompt: "${turn.prompt}"`);
      for (const a of turn.assertions) {
        const mark = a.passed ? '  ✓' : '  ✗';
        lines.push(`    ${mark} [w=${a.weight}] ${a.name}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
